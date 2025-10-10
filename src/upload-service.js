const fs = require('fs-extra');
const path = require('path');
const { getLocalDateString } = require('./utils/date-utils');
const { app } = require('electron');
const { dateOverride } = require('./date-override');
const log = require('./utils/logger');

// Error categorization helper for structured logging
function categorizeError(error) {
  const message = error.message || '';
  const code = error.code || '';

  if (message.includes('auth') || message.includes('AUTH') || code === 401 || code === 403) return 'auth';
  if (message.includes('ENOENT') || code === 'ENOENT') return 'notfound';
  if (message.includes('quota') || message.includes('QUOTA') || code === 403) return 'quota';
  if (message.includes('network') || message.includes('NETWORK') || code === 'ECONNREFUSED' || code === 'ETIMEDOUT') return 'network';
  return 'unknown';
}

class UploadService {
  constructor(database, googleDriveService, mainWindow) {
    this.database = database;
    this.googleDriveService = googleDriveService;
    this.mainWindow = mainWindow;
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
      
      // Get current upload status
      const uploadStatus = await this.database.getMeetingUploadStatus(meetingId);
      if (uploadStatus && uploadStatus.upload_status === 'completed') {
        console.log(`Meeting ${meetingId} already uploaded`);
        return;
      }

      // Add to persistent database queue
      await this.database.addToUploadQueue(meetingId);

      // Get current queue length for logging
      const queueItems = await this.database.getUploadQueue('pending');
      console.log(`Meeting ${meetingId} added to upload queue. Queue length: ${queueItems.length}`);

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
    if (this.isUploading) {
      return;
    }

    // Get pending items from database
    const pendingUploads = await this.database.getUploadQueue('pending');
    if (pendingUploads.length === 0) {
      return;
    }

    this.isUploading = true;
    console.log(`📤 Starting upload queue processing. ${pendingUploads.length} items in queue`);

    for (const uploadItem of pendingUploads) {
      console.log(`📤 Processing upload for meeting ${uploadItem.meeting_id}`);

      // Extract pipelineId from queue item (stored when queued from renderer)
      const pipelineId = uploadItem.pipeline_id || `pipeline-${uploadItem.meeting_id}-${Date.now()}`;
      const t5 = Date.now();

      // T5: Queue processing started
      log.info('[PIPELINE] Queue processing started', {
        meetingId: uploadItem.meeting_id,
        pipelineId,
        stage: 'T5-queue-processing',
        timestamp: t5,
        queueWaitTime: uploadItem.created_at ? Date.now() - new Date(uploadItem.created_at).getTime() : null,
        attempt: uploadItem.attempts + 1
      });

      try {
        // Update queue status to processing
        await this.database.updateUploadQueueStatus(uploadItem.meeting_id, 'processing');
        
        // Upload the meeting (pass pipelineId for logging)
        await this.uploadMeeting(uploadItem.meeting_id, pipelineId, t5);
        
        // Mark as completed in queue
        await this.database.updateUploadQueueStatus(uploadItem.meeting_id, 'completed');
        console.log(`✅ Successfully uploaded meeting ${uploadItem.meeting_id}`);
        
        // Notify renderer of success
        this.notifyUploadStatusChange(uploadItem.meeting_id, 'completed');
        
      } catch (error) {
        console.error(`❌ Failed to upload meeting ${uploadItem.meeting_id}:`, error);
        
        // Handle authentication failures specially - don't count against retry attempts
        if (error.message === 'UPLOAD_AUTH_REQUIRED') {
          console.log(`🔐 Authentication required for meeting ${uploadItem.meeting_id} - marking as pending for later retry`);
          await this.database.updateUploadQueueStatus(uploadItem.meeting_id, 'pending', 'Authentication required');
          // Don't increment attempts for auth failures
          continue;
        }
        
        if (uploadItem.attempts < this.maxRetries) {
          console.log(`🔄 Will retry upload for meeting ${uploadItem.meeting_id} (attempt ${uploadItem.attempts + 1}/${this.maxRetries})`);
          
          // Mark as pending again for retry
          await this.database.updateUploadQueueStatus(uploadItem.meeting_id, 'pending', error.message);
          
          // Delay before processing next item (exponential backoff)
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, uploadItem.attempts) * 1000));
          
        } else {
          console.error(`❌ Max retries reached for meeting ${uploadItem.meeting_id}. Marking as failed.`);
          await this.database.updateUploadQueueStatus(uploadItem.meeting_id, 'failed', error.message);
          await this.database.setMeetingUploadStatus(uploadItem.meeting_id, 'failed');
          this.notifyUploadStatusChange(uploadItem.meeting_id, 'failed');
        }
      }
    }

    this.isUploading = false;
    console.log('📤 Upload queue processing completed');
    
    // Check if there are more pending items
    const morePending = await this.database.getUploadQueue('pending');
    if (morePending.length > 0) {
      // Process remaining items
      setTimeout(() => this.processUploadQueue(), 1000);
    }
  }

  async uploadMeeting(meetingId, pipelineId, t5) {
    try {
      console.log(`🚀 Starting upload for meeting ${meetingId}`);

      // Default pipelineId if not provided
      if (!pipelineId) {
        pipelineId = `pipeline-${meetingId}-${Date.now()}`;
      }

      await this.database.setMeetingUploadStatus(meetingId, 'uploading');
      this.notifyUploadStatusChange(meetingId, 'uploading');

      const meeting = await this.database.getMeetingById(meetingId);
      if (!meeting) {
        throw new Error(`Meeting ${meetingId} not found`);
      }

      console.log(`📋 Meeting details: ${meeting.title} (${meeting.folder_name})`);

      // Enhanced content validation
      const validation = await this.validateMeetingContent(meetingId, meeting);

      // T6: Content validated
      const t6 = Date.now();
      log.info('[PIPELINE] Content validated', {
        meetingId,
        pipelineId,
        stage: 'T6-content-validated',
        timestamp: t6,
        notesFound: validation.notes.length,
        recordingsFound: validation.recordings.length,
        issues: validation.issues
      });

      if (!validation.hasNotes && !validation.hasRecordings) {
        console.log(`📝 No content to upload for meeting ${meetingId}`);
        await this.database.setMeetingUploadStatus(meetingId, 'no_content');
        return;
      }

      // Log any issues found
      if (validation.issues.length > 0) {
        console.warn(`⚠️ Content validation issues for meeting ${meetingId}:`, validation.issues);
      }

      // Ensure Google Drive authentication
      if (!this.googleDriveService.drive) {
        console.log('🔐 Initializing Google Drive authentication...');
        await this.googleDriveService.initializeOAuth();
        if (!this.googleDriveService.drive) {
          throw new Error('Google Drive authentication required');
        }
      }

      // Create folder structure
      const dateStr = getLocalDateString(meeting.start_time);
      const meetingFolderId = await this.ensureGoogleDriveFolderStructure(dateStr, meeting.folder_name);

      // T7: Folders created
      const t7 = Date.now();
      log.info('[PIPELINE] Google Drive folders created', {
        meetingId,
        pipelineId,
        stage: 'T7-folders-created',
        timestamp: t7,
        folderId: meetingFolderId
      });

      const uploadResults = {
        notes: [],
        recordings: [],
        failed: []
      };

      // Upload notes files
      for (const noteFile of validation.notes) {
        const uploadStartTime = Date.now();
        try {
          console.log(`⬆️ Uploading note: ${noteFile.name}...`);

          log.info('[UPLOAD] Uploading file', {
            meetingId,
            pipelineId,
            fileName: noteFile.name,
            filePath: noteFile.path,
            type: 'markdown',
            uploadStartTime
          });

          const result = await this.uploadFileToGoogleDrive({
            name: noteFile.name,
            path: noteFile.path,
            type: 'markdown'
          }, meetingFolderId);

          uploadResults.notes.push(result);
          console.log(`✅ Uploaded note: ${noteFile.name}`);

          log.info('[UPLOAD] File uploaded successfully', {
            meetingId,
            pipelineId,
            fileName: noteFile.name,
            driveFileId: result.id,
            uploadDuration: Date.now() - uploadStartTime
          });
        } catch (error) {
          console.error(`❌ Failed to upload note ${noteFile.name}:`, error);
          uploadResults.failed.push({ file: noteFile.name, error: error.message, type: 'note' });

          log.error('[UPLOAD] File upload failed', {
            meetingId,
            pipelineId,
            fileName: noteFile.name,
            error: error.message,
            errorType: categorizeError(error),
            uploadDuration: Date.now() - uploadStartTime
          });
        }
      }

      // Upload recording files
      for (const recording of validation.recordings) {
        const uploadStartTime = Date.now();
        try {
          console.log(`⬆️ Uploading recording: ${recording.name}...`);
          const stats = await fs.stat(recording.path);

          log.info('[UPLOAD] Uploading file', {
            meetingId,
            pipelineId,
            fileName: recording.name,
            filePath: recording.path,
            fileSize: stats.size,
            type: 'audio',
            uploadStartTime
          });

          const result = await this.uploadFileToGoogleDrive({
            name: recording.name,
            path: recording.path,
            size: stats.size,
            type: 'audio'
          }, meetingFolderId);

          uploadResults.recordings.push(result);
          console.log(`✅ Uploaded recording: ${recording.name} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);

          log.info('[UPLOAD] File uploaded successfully', {
            meetingId,
            pipelineId,
            fileName: recording.name,
            driveFileId: result.id,
            uploadDuration: Date.now() - uploadStartTime
          });
        } catch (error) {
          console.error(`❌ Failed to upload recording ${recording.name}:`, error);
          uploadResults.failed.push({ file: recording.name, error: error.message, type: 'recording' });

          log.error('[UPLOAD] File upload failed', {
            meetingId,
            pipelineId,
            fileName: recording.name,
            error: error.message,
            errorType: categorizeError(error),
            uploadDuration: Date.now() - uploadStartTime
          });
        }
      }

      // Determine final status
      const totalFiles = validation.notes.length + validation.recordings.length;
      const successfulUploads = uploadResults.notes.length + uploadResults.recordings.length;

      // T8: Upload completed
      const t8 = Date.now();

      if (uploadResults.failed.length === 0) {
        await this.database.setMeetingUploadStatus(meetingId, 'completed', meetingFolderId);
        console.log(`🎉 Meeting ${meetingId} upload completed successfully (${successfulUploads}/${totalFiles} files)`);

        log.info('[PIPELINE] Upload completed', {
          meetingId,
          pipelineId,
          stage: 'T8-upload-complete',
          timestamp: t8,
          status: 'completed',
          filesUploaded: successfulUploads,
          filesFailed: uploadResults.failed.length,
          totalDuration: t5 ? t8 - t5 : null,
          breakdown: t5 ? {
            t6_t5_validate: t6 - t5,
            t7_t6_folders: t7 - t6,
            t8_t7_upload: t8 - t7
          } : null
        });
      } else if (successfulUploads > 0) {
        await this.database.setMeetingUploadStatus(meetingId, 'partial', meetingFolderId);
        console.log(`⚠️ Meeting ${meetingId} upload partially completed (${successfulUploads}/${totalFiles} files, ${uploadResults.failed.length} failed)`);

        log.warn('[PIPELINE] Upload partially completed', {
          meetingId,
          pipelineId,
          stage: 'T8-upload-complete',
          timestamp: t8,
          status: 'partial',
          filesUploaded: successfulUploads,
          filesFailed: uploadResults.failed.length,
          totalDuration: t5 ? t8 - t5 : null,
          failedFiles: uploadResults.failed.map(f => ({ file: f.file, error: f.error, type: f.type }))
        });

        // Re-queue for retry
        setTimeout(() => this.queueMeetingUpload(meetingId), 30000);
      } else {
        log.error('[PIPELINE] Upload failed - all files failed', {
          meetingId,
          pipelineId,
          stage: 'T8-upload-complete',
          timestamp: t8,
          status: 'failed',
          filesUploaded: 0,
          filesFailed: uploadResults.failed.length,
          totalDuration: t5 ? t8 - t5 : null,
          failedFiles: uploadResults.failed.map(f => ({ file: f.file, error: f.error, type: f.type }))
        });

        throw new Error(`All uploads failed: ${uploadResults.failed.map(f => f.error).join(', ')}`);
      }

    } catch (error) {
      console.error(`💥 Upload failed for meeting ${meetingId}:`, error);

      if (error.message === 'AUTH_EXPIRED') {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('upload-auth-required', { meetingId });
        }
        throw new Error('UPLOAD_AUTH_REQUIRED');
      }

      await this.database.setMeetingUploadStatus(meetingId, 'failed');
      throw error;
    }
  }

  async gatherMeetingFiles(meetingId, meeting) {
    const files = [];
    const dateStr = getLocalDateString(meeting.start_time);
    const projectRoot = path.dirname(__dirname);
    
    try {
      // Find all possible directories for this meeting
      const possibleDirs = await this.findMeetingDirectories(meeting, dateStr, projectRoot);
      
      let foundContentDir = null;
      
      // Check each possible directory for content
      for (const meetingDir of possibleDirs) {
        if (await fs.pathExists(meetingDir)) {
          const dirFiles = await fs.readdir(meetingDir);
          const contentFiles = dirFiles.filter(file => 
            file.endsWith('.md') || 
            file.endsWith('.opus') || 
            file.endsWith('.wav') || 
            file.endsWith('.m4a') ||
            file.endsWith('.mp3')
          );
          
          if (contentFiles.length > 0) {
            foundContentDir = meetingDir;
            console.log(`📂 Found content directory: ${meetingDir} (${dirFiles.length} files)`);
            break;
          }
        }
      }
      
      if (!foundContentDir) {
        console.log(`📁 No content directory found for meeting ${meetingId}`);
        return files;
      }
      
      // Get ALL files in the content directory
      const dirFiles = await fs.readdir(foundContentDir);
      
      // 1. Add markdown files
      const markdownFiles = dirFiles.filter(f => f.endsWith('.md'));
      for (const mdFile of markdownFiles) {
        const filePath = path.join(foundContentDir, mdFile);
        const stats = await fs.stat(filePath);
        files.push({
          name: mdFile,
          path: filePath,
          size: stats.size,
          type: 'markdown'
        });
        console.log(`📝 Found markdown: ${mdFile}`);
      }
      
      // 2. Add audio files (.opus, .m4a, .wav)
      const audioExtensions = ['.opus', '.m4a', '.wav', '.mp3'];
      const audioFiles = dirFiles.filter(f => 
        audioExtensions.some(ext => f.endsWith(ext))
      );
      
      // Get duration info from database if available
      const recordings = await this.database.getMeetingRecordings(meetingId);
      
      for (const audioFile of audioFiles) {
        const filePath = path.join(foundContentDir, audioFile);
        const stats = await fs.stat(filePath);
        
        // Try to find duration from database
        const recording = recordings.find(r => 
          path.basename(r.final_path || '') === audioFile
        );
        
        files.push({
          name: audioFile,
          path: filePath,
          size: stats.size,
          type: 'audio',
          duration: recording?.duration || null
        });
        console.log(`🎵 Found audio: ${audioFile} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
      }

      console.log(`📊 Total files found for meeting ${meetingId}: ${files.length}`);

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
      
      // Check if error is due to expired/revoked token
      if (error.message && (error.message.includes('invalid_grant') || 
          error.message.includes('Token has been expired or revoked'))) {
        console.error('🔐 Google OAuth token expired or revoked');
        
        // Notify the UI about auth expiration
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('google-auth-expired');
        }
        
        // Throw AUTH_EXPIRED error to be handled by uploadMeeting
        throw new Error('AUTH_EXPIRED');
      }
      
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
      
      // Check if error is due to expired/revoked token
      if (error.message && (error.message.includes('invalid_grant') || 
          error.message.includes('Token has been expired or revoked'))) {
        console.error('🔐 Google OAuth token expired or revoked');
        
        // Notify the UI about auth expiration
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('google-auth-expired');
        }
        
        // Throw AUTH_EXPIRED error to be handled by uploadMeeting
        throw new Error('AUTH_EXPIRED');
      }
      
      throw error;
    }
  }

  async resumePendingUploads() {
    try {
      console.log('🔍 Checking for pending uploads...');
      
      // First, check upload queue for interrupted uploads
      const interruptedUploads = await this.database.getUploadQueue('processing');
      if (interruptedUploads.length > 0) {
        console.log(`🔄 Found ${interruptedUploads.length} interrupted uploads, resetting to pending`);
        for (const upload of interruptedUploads) {
          await this.database.updateUploadQueueStatus(upload.meeting_id, 'pending');
        }
      }

      // Get all meetings that need uploading
      const meetingsNeedingUpload = await this.database.getMeetingsNeedingUpload();
      
      if (meetingsNeedingUpload.length > 0) {
        console.log(`📤 Found ${meetingsNeedingUpload.length} meetings needing upload`);
        for (const meeting of meetingsNeedingUpload) {
          await this.queueMeetingUpload(meeting.id);
        }
      }

      // Get all meetings that need markdown regeneration
      const meetingsNeedingMarkdown = await this.database.getMeetingsNeedingMarkdown();
      
      if (meetingsNeedingMarkdown.length > 0) {
        console.log(`📝 Found ${meetingsNeedingMarkdown.length} meetings needing markdown generation`);
        // These will be handled by the background health checker
      }

      console.log('✅ Startup recovery complete');
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

  async getQueueStatus() {
    const pendingUploads = await this.database.getUploadQueue('pending');
    const processingUploads = await this.database.getUploadQueue('processing');
    
    return {
      queueLength: pendingUploads.length,
      isUploading: this.isUploading,
      queue: [...processingUploads, ...pendingUploads].map(item => ({
        meetingId: item.meeting_id,
        status: item.status,
        attempts: item.attempts,
        queuedAt: item.created_at
      }))
    };
  }

  getQueueLength() {
    // Synchronous method for backward compatibility
    return this.database.getUploadQueue('pending').then(items => items.length).catch(() => 0);
  }

  async validateMeetingContent(meetingId, meeting) {
    const validation = {
      hasNotes: false,
      hasRecordings: false,
      recordings: [],
      notes: [],
      issues: []
    };

    try {
      const dateStr = getLocalDateString(meeting.start_time);
      const projectRoot = path.dirname(__dirname);

      // Find all possible directories
      const possibleDirs = await this.findMeetingDirectories(meeting, dateStr, projectRoot);

      // Check each directory for content
      for (const dir of possibleDirs) {
        if (await fs.pathExists(dir)) {
          const files = await fs.readdir(dir);

          // Find notes
          const noteFiles = files.filter(f => f.endsWith('.md'));
          noteFiles.forEach(file => {
            validation.notes.push({
              path: path.join(dir, file),
              name: file,
              directory: dir
            });
          });

          // Find recordings
          const audioFiles = files.filter(f =>
            f.endsWith('.opus') || f.endsWith('.m4a') || f.endsWith('.wav')
          );
          audioFiles.forEach(file => {
            validation.recordings.push({
              path: path.join(dir, file),
              name: file,
              directory: dir
            });
          });
        }
      }

      // Additional check: search by session ID
      const sessionRecordings = await this.findRecordingBySessionId(meetingId, dateStr, projectRoot);
      sessionRecordings.forEach(recording => {
        const existing = validation.recordings.find(r => r.path === recording.path);
        if (!existing) {
          validation.recordings.push({
            path: recording.path,
            name: recording.filename,
            directory: recording.folder,
            foundBySessionId: true
          });
          validation.issues.push(`Recording found by session ID in unexpected location: ${recording.folder}`);
        }
      });

      validation.hasNotes = validation.notes.length > 0;
      validation.hasRecordings = validation.recordings.length > 0;

      return validation;

    } catch (error) {
      console.error(`Error validating content for meeting ${meetingId}:`, error);
      validation.issues.push(`Validation error: ${error.message}`);
      return validation;
    }
  }

  async hasContentToUpload(meetingId, meeting) {
    try {
      const validation = await this.validateMeetingContent(meetingId, meeting);

      if (validation.hasNotes || validation.hasRecordings) {
        console.log(`✅ Meeting ${meetingId} has content: ${validation.notes.length} notes, ${validation.recordings.length} recordings`);
        if (validation.issues.length > 0) {
          console.warn(`⚠️ Issues found:`, validation.issues);
        }
        return true;
      }

      // Check database notes (in case markdown not exported yet)
      if (meeting.notes_content &&
          meeting.notes_content.trim() !== '' &&
          meeting.notes_content !== '{}' &&
          meeting.notes_content !== '[]') {
        console.log(`✅ Meeting ${meetingId} has notes in database`);
        return true;
      }

      console.log(`❌ Meeting ${meetingId} has no uploadable content`);
      return false;
    } catch (error) {
      console.error(`Error checking content for meeting ${meetingId}:`, error);
      // Default to true on error to avoid false negatives
      return true;
    }
  }

  async findRecordingBySessionId(meetingId, dateStr, projectRoot) {
    const basePath = path.join(projectRoot, 'assets', dateStr);
    const foundFiles = [];

    try {
      if (await fs.pathExists(basePath)) {
        const subdirs = await fs.readdir(basePath);

        for (const subdir of subdirs) {
          const subdirPath = path.join(basePath, subdir);
          if ((await fs.stat(subdirPath)).isDirectory()) {
            const files = await fs.readdir(subdirPath);
            const matchingFiles = files.filter(file =>
              file.includes(`session${meetingId}`) && file.endsWith('.opus')
            );

            matchingFiles.forEach(file => {
              foundFiles.push({
                path: path.join(subdirPath, file),
                folder: subdir,
                filename: file
              });
            });
          }
        }
      }
    } catch (error) {
      console.error(`Error searching for session ${meetingId}:`, error);
    }

    return foundFiles;
  }

  async findMeetingDirectories(meeting, dateStr, projectRoot) {
    const basePath = path.join(projectRoot, 'assets', dateStr);
    const possibleDirs = [];

    // Strategy 1: Use database folder_name
    possibleDirs.push(path.join(basePath, meeting.folder_name));

    // Strategy 2: Search by session ID for recordings
    const sessionRecordings = await this.findRecordingBySessionId(meeting.id, dateStr, projectRoot);
    sessionRecordings.forEach(recording => {
      const recordingDir = path.dirname(recording.path);
      if (!possibleDirs.includes(recordingDir)) {
        possibleDirs.push(recordingDir);
        console.log(`📁 Found recording by session ID in: ${recording.folder}`);
      }
    });

    // Strategy 3: Look for directories that might match this meeting (title-based)
    try {
      if (await fs.pathExists(basePath)) {
        const allDirs = await fs.readdir(basePath);
        const meetingDirs = allDirs.filter(dir => {
          // Look for directories that contain meeting title words
          const titleWords = meeting.title.toLowerCase().split(/\s+/).filter(word => word.length > 3);
          const dirName = dir.toLowerCase();

          // Check if directory name contains any significant words from the title
          return titleWords.some(word => dirName.includes(word));
        });

        // Add these potential matches
        meetingDirs.forEach(dir => {
          const fullPath = path.join(basePath, dir);
          if (!possibleDirs.includes(fullPath)) {
            possibleDirs.push(fullPath);
          }
        });
      }
    } catch (error) {
      console.warn(`Could not scan directory ${basePath}:`, error.message);
    }

    return possibleDirs;
  }
}

module.exports = UploadService;