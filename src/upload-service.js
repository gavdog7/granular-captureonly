const fs = require('fs-extra');
const path = require('path');
const { app } = require('electron');
const { dateOverride } = require('./date-override');

class UploadService {
  constructor(database, googleDriveService, mainWindow) {
    this.database = database;
    this.googleDriveService = googleDriveService;
    this.mainWindow = mainWindow;
    this.uploadQueue = [];
    this.isUploading = false;
    this.maxRetries = 3;
  }

  async initialize() {
    // Resume any pending uploads on startup
    await this.resumePendingUploads();
  }

  async queueMeetingUpload(meetingId) {
    try {
      console.log(`📤 Queueing upload for meeting ${meetingId}`);
      
      // Check if already in queue or uploading
      const existingUpload = this.uploadQueue.find(item => item.meetingId === meetingId);
      if (existingUpload) {
        console.log(`Meeting ${meetingId} already in upload queue`);
        return;
      }

      // Get current upload status
      const uploadStatus = await this.database.getMeetingUploadStatus(meetingId);
      if (uploadStatus.upload_status === 'completed') {
        console.log(`Meeting ${meetingId} already uploaded`);
        return;
      }

      // Add to queue
      this.uploadQueue.push({
        meetingId,
        retryCount: 0,
        queuedAt: new Date().toISOString()
      });

      console.log(`Meeting ${meetingId} added to upload queue. Queue length: ${this.uploadQueue.length}`);

      // Start processing if not already running
      if (!this.isUploading) {
        this.processUploadQueue();
      }

    } catch (error) {
      console.error('Error queueing meeting upload:', error);
      throw error;
    }
  }

  async processUploadQueue() {
    if (this.isUploading || this.uploadQueue.length === 0) {
      return;
    }

    this.isUploading = true;
    console.log(`📤 Starting upload queue processing. ${this.uploadQueue.length} items in queue`);

    while (this.uploadQueue.length > 0) {
      const uploadItem = this.uploadQueue.shift();
      console.log(`📤 Processing upload for meeting ${uploadItem.meetingId}`);

      try {
        await this.uploadMeeting(uploadItem.meetingId);
        console.log(`✅ Successfully uploaded meeting ${uploadItem.meetingId}`);
        
        // Notify renderer of success
        this.notifyUploadStatusChange(uploadItem.meetingId, 'completed');
        
      } catch (error) {
        console.error(`❌ Failed to upload meeting ${uploadItem.meetingId}:`, error);
        
        uploadItem.retryCount++;
        
        if (uploadItem.retryCount < this.maxRetries) {
          console.log(`🔄 Retrying upload for meeting ${uploadItem.meetingId} (attempt ${uploadItem.retryCount + 1}/${this.maxRetries})`);
          
          // Add back to queue with exponential backoff
          setTimeout(() => {
            this.uploadQueue.push(uploadItem);
            if (!this.isUploading) {
              this.processUploadQueue();
            }
          }, Math.pow(2, uploadItem.retryCount) * 1000); // 2s, 4s, 8s delay
          
        } else {
          console.error(`❌ Max retries reached for meeting ${uploadItem.meetingId}. Marking as failed.`);
          await this.database.setMeetingUploadStatus(uploadItem.meetingId, 'failed');
          this.notifyUploadStatusChange(uploadItem.meetingId, 'failed');
        }
      }
    }

    this.isUploading = false;
    console.log('📤 Upload queue processing completed');
  }

  async uploadMeeting(meetingId) {
    try {
      console.log(`🚀 Starting upload for meeting ${meetingId}`);
      
      // Set status to uploading
      await this.database.setMeetingUploadStatus(meetingId, 'uploading');
      this.notifyUploadStatusChange(meetingId, 'uploading');

      // Get meeting details
      const meeting = await this.database.getMeetingById(meetingId);
      if (!meeting) {
        throw new Error(`Meeting ${meetingId} not found`);
      }

      console.log(`📋 Meeting details: ${meeting.title} (${meeting.folder_name})`);

      // Gather files to upload
      const filesToUpload = await this.gatherMeetingFiles(meetingId, meeting);
      console.log(`📁 Found ${filesToUpload.length} files to upload:`, filesToUpload.map(f => f.name));

      if (filesToUpload.length === 0) {
        throw new Error('No files found to upload for this meeting');
      }

      // Ensure Google Drive is authenticated
      if (!this.googleDriveService.drive) {
        console.log('🔐 Initializing Google Drive authentication...');
        await this.googleDriveService.initializeOAuth();
        if (!this.googleDriveService.drive) {
          throw new Error('Google Drive authentication required. Please configure OAuth credentials.');
        }
      }

      // Create folder structure in Google Drive
      const dateStr = meeting.start_time.split('T')[0]; // YYYY-MM-DD
      const meetingFolderId = await this.ensureGoogleDriveFolderStructure(dateStr, meeting.folder_name);
      console.log(`📂 Google Drive folder created: ${meetingFolderId}`);

      // Upload all files
      for (const file of filesToUpload) {
        console.log(`⬆️ Uploading ${file.name}...`);
        await this.uploadFileToGoogleDrive(file, meetingFolderId);
        console.log(`✅ Uploaded ${file.name}`);
      }

      // Mark as completed
      await this.database.setMeetingUploadStatus(meetingId, 'completed', meetingFolderId);
      console.log(`🎉 Meeting ${meetingId} upload completed successfully`);

    } catch (error) {
      console.error(`💥 Upload failed for meeting ${meetingId}:`, error);
      await this.database.setMeetingUploadStatus(meetingId, 'failed');
      throw error;
    }
  }

  async gatherMeetingFiles(meetingId, meeting) {
    const files = [];
    const dateStr = meeting.start_time.split('T')[0];
    const projectRoot = path.dirname(__dirname);
    const meetingDir = path.join(projectRoot, 'assets', dateStr, meeting.folder_name);

    try {
      // 1. Markdown file
      const markdownFile = path.join(meetingDir, `${meeting.folder_name}-notes.md`);
      if (await fs.pathExists(markdownFile)) {
        const stats = await fs.stat(markdownFile);
        files.push({
          name: 'notes.md',
          path: markdownFile,
          size: stats.size,
          type: 'markdown'
        });
        console.log(`📝 Found markdown file: ${markdownFile}`);
      } else {
        console.warn(`⚠️ Markdown file not found: ${markdownFile}`);
      }

      // 2. Audio recordings
      const recordings = await this.database.getMeetingRecordings(meetingId);
      for (const recording of recordings) {
        if (recording.final_path && await fs.pathExists(recording.final_path)) {
          const stats = await fs.stat(recording.final_path);
          const fileName = path.basename(recording.final_path);
          files.push({
            name: fileName,
            path: recording.final_path,
            size: stats.size,
            type: 'audio',
            duration: recording.duration
          });
          console.log(`🎵 Found audio file: ${recording.final_path} (${recording.duration}s)`);
        } else {
          console.warn(`⚠️ Audio file not found: ${recording.final_path}`);
        }
      }

    } catch (error) {
      console.error('Error gathering meeting files:', error);
      throw error;
    }

    return files;
  }

  async ensureGoogleDriveFolderStructure(dateStr, meetingFolderName) {
    try {
      const drive = this.googleDriveService.drive;

      // 1. Ensure "Notes" folder exists
      let notesFolderId = await this.findOrCreateFolder(drive, 'Notes', null);

      // 2. Ensure date folder exists (e.g., "2025-07-10")
      let dateFolderId = await this.findOrCreateFolder(drive, dateStr, notesFolderId);

      // 3. Ensure meeting folder exists (e.g., "team-standup")
      let meetingFolderId = await this.findOrCreateFolder(drive, meetingFolderName, dateFolderId);

      return meetingFolderId;

    } catch (error) {
      console.error('Error creating Google Drive folder structure:', error);
      throw error;
    }
  }

  async findOrCreateFolder(drive, folderName, parentFolderId) {
    try {
      // Search for existing folder
      const query = parentFolderId 
        ? `name='${folderName}' and '${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
        : `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;

      const response = await drive.files.list({
        q: query,
        fields: 'files(id, name)'
      });

      if (response.data.files.length > 0) {
        console.log(`📂 Found existing folder: ${folderName} (${response.data.files[0].id})`);
        return response.data.files[0].id;
      }

      // Create new folder
      const folderMetadata = {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder'
      };

      if (parentFolderId) {
        folderMetadata.parents = [parentFolderId];
      }

      const folder = await drive.files.create({
        requestBody: folderMetadata,
        fields: 'id'
      });

      console.log(`📂 Created new folder: ${folderName} (${folder.data.id})`);
      return folder.data.id;

    } catch (error) {
      console.error(`Error finding/creating folder ${folderName}:`, error);
      throw error;
    }
  }

  async uploadFileToGoogleDrive(file, parentFolderId) {
    try {
      const drive = this.googleDriveService.drive;

      // Check if file already exists and delete it
      const existingFiles = await drive.files.list({
        q: `name='${file.name}' and '${parentFolderId}' in parents and trashed=false`,
        fields: 'files(id, name)'
      });

      if (existingFiles.data.files.length > 0) {
        console.log(`🗑️ Deleting existing file: ${file.name}`);
        await drive.files.delete({
          fileId: existingFiles.data.files[0].id
        });
      }

      // Upload new file
      const fileMetadata = {
        name: file.name,
        parents: [parentFolderId]
      };

      const media = {
        mimeType: file.type === 'markdown' ? 'text/markdown' : 'audio/opus',
        body: fs.createReadStream(file.path)
      };

      const uploadResult = await drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: 'id,name,size'
      });

      console.log(`📤 Uploaded ${file.name} to Google Drive (${uploadResult.data.id})`);
      return uploadResult.data;

    } catch (error) {
      console.error(`Error uploading file ${file.name}:`, error);
      throw error;
    }
  }

  async resumePendingUploads() {
    try {
      console.log('🔄 Checking for pending uploads...');
      const pendingUploads = await this.database.getPendingUploads();
      
      if (pendingUploads.length > 0) {
        console.log(`📤 Found ${pendingUploads.length} pending uploads, adding to queue`);
        for (const meeting of pendingUploads) {
          await this.queueMeetingUpload(meeting.id);
        }
      } else {
        console.log('✅ No pending uploads found');
      }
    } catch (error) {
      console.error('Error resuming pending uploads:', error);
    }
  }

  notifyUploadStatusChange(meetingId, status) {
    try {
      if (this.mainWindow && this.mainWindow.webContents) {
        this.mainWindow.webContents.send('upload-status-changed', {
          meetingId,
          status,
          timestamp: new Date().toISOString()
        });
        console.log(`📡 Notified renderer: meeting ${meetingId} status changed to ${status}`);
      }
    } catch (error) {
      console.error('Error notifying upload status change:', error);
    }
  }

  getQueueStatus() {
    return {
      queueLength: this.uploadQueue.length,
      isUploading: this.isUploading,
      queue: this.uploadQueue.map(item => ({
        meetingId: item.meetingId,
        retryCount: item.retryCount,
        queuedAt: item.queuedAt
      }))
    };
  }
}

module.exports = UploadService;