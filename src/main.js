require('dotenv').config();

const { app, BrowserWindow, Menu, dialog, shell, ipcMain, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const Database = require('./database');
const MeetingLoader = require('./meeting-loader');
const AudioRecorder = require('./audio-recorder');
const UploadService = require('./upload-service');
const GoogleDriveService = require('./google-drive');
const Store = require('electron-store');
const { setupTestDate, disableTestDate, dateOverride } = require('./date-override');

let mainWindow;
let database;
let meetingLoader;
let audioRecorder;
let uploadService;
let googleDriveService;
let store;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    frame: false,
    transparent: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Refresh Meetings',
          accelerator: 'CmdOrCtrl+R',
          click: async () => {
            await meetingLoader.refreshMeetings();
          }
        },
        { type: 'separator' },
        {
          label: 'Export Today\'s Data',
          accelerator: 'CmdOrCtrl+E',
          click: async () => {
            // This will be implemented in Milestone 4
            dialog.showInfoBox('Export feature coming in Milestone 4');
          }
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectall' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forcereload' },
        { role: 'toggledevtools' },
        { type: 'separator' },
        { role: 'resetzoom' },
        { role: 'zoomin' },
        { role: 'zoomout' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        {
          label: 'Date Override Status',
          click: () => {
            const status = dateOverride.getStatus();
            const message = status.active 
              ? `Date override is ACTIVE\nUsing: ${status.overrideDate}\nToday string: ${status.todayString}`
              : `Date override is DISABLED\nUsing system date: ${status.systemDate}`;
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Date Override Status',
              message: message
            });
          }
        },
        {
          label: 'Enable Test Date (July 11, 2025)',
          click: async () => {
            setupTestDate('2025-07-11');
            await meetingLoader.refreshMeetings();
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Date Override',
              message: 'Date override enabled for July 11, 2025!\nMeetings refreshed.'
            });
          }
        },
        {
          label: 'Disable Test Date',
          click: async () => {
            disableTestDate();
            await meetingLoader.refreshMeetings();
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Date Override',
              message: 'Date override disabled!\nUsing system date. Meetings refreshed.'
            });
          }
        }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About Granular CaptureOnly',
              message: 'Granular CaptureOnly v1.0.0',
              detail: 'A macOS app for capturing meeting data and audio recordings.'
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

async function initializeApp() {
  try {
    // 🧪 TEST MODE: Override date for testing
    // TO DISABLE: Comment out the line below
    // setupTestDate('2025-07-11'); // Friday, July 11, 2025
    
    // Request microphone permission for audio recording
    if (process.platform === 'darwin') {
      const microphonePermission = systemPreferences.getMediaAccessStatus('microphone');
      console.log('Microphone permission status:', microphonePermission);
      
      if (microphonePermission !== 'granted') {
        console.log('Requesting microphone permission...');
        try {
          const granted = await systemPreferences.askForMediaAccess('microphone');
          console.log('Microphone permission granted:', granted);
        } catch (error) {
          console.error('Error requesting microphone permission:', error);
        }
      }
    }
    
    database = new Database();
    await database.initialize();
    console.log('Database initialized successfully');

    store = new Store({
      defaults: {
        excelFilePath: null,
        audioQuality: 'medium',
        exportRetentionDays: 7,
        autoRefreshMeetings: true,
        manualExportPath: path.join(app.getPath('desktop'), 'GranularExports'),
        exportTime: '18:00',
        autoExport: false,
        googleDriveFolderId: null
      }
    });

    // Initialize Google Drive service first
    googleDriveService = new GoogleDriveService(store);
    try {
      await googleDriveService.initializeOAuth();
      console.log('Google Drive service initialized');
    } catch (error) {
      console.warn('Google Drive service initialization failed (will retry on first upload):', error.message);
    }
    
    // Initialize services with Google Drive support
    meetingLoader = new MeetingLoader(database, store, googleDriveService);
    audioRecorder = new AudioRecorder(database);
    
    uploadService = new UploadService(database, googleDriveService, mainWindow);
    await uploadService.initialize();
    console.log('Upload service initialized');
    
    // Always load today's meetings from the calendar management log
    await meetingLoader.loadTodaysMeetings();

  } catch (error) {
    console.error('Error initializing app:', error);
    dialog.showErrorBox('Initialization Error', 'Failed to initialize the application: ' + error.message);
  }
}

app.whenReady().then(async () => {
  createWindow();
  createMenu();
  await initializeApp();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  if (audioRecorder) {
    await audioRecorder.cleanup();
  }
  if (database) {
    await database.close();
  }
});

// IPC handlers for renderer communication
ipcMain.handle('get-todays-meetings', async () => {
  try {
    return await database.getTodaysMeetings();
  } catch (error) {
    console.error('Error getting today\'s meetings:', error);
    throw error;
  }
});

ipcMain.handle('get-all-todays-meetings', async () => {
  try {
    return await meetingLoader.getAllTodaysMeetings();
  } catch (error) {
    console.error('Error getting all today\'s meetings:', error);
    throw error;
  }
});

ipcMain.handle('update-meeting-notes', async (event, meetingId, content) => {
  try {
    const result = await database.updateMeetingNotes(meetingId, content);
    console.log(`Notes updated for meeting ${meetingId}`);
    return { success: true };
  } catch (error) {
    console.error('Error updating meeting notes:', error);
    throw error;
  }
});

ipcMain.handle('get-settings', () => {
  return store.store;
});

ipcMain.handle('set-setting', (event, key, value) => {
  store.set(key, value);
  return { success: true };
});

ipcMain.handle('refresh-meetings', async () => {
  try {
    await meetingLoader.refreshMeetings();
    return { success: true };
  } catch (error) {
    console.error('Error refreshing meetings:', error);
    throw error;
  }
});

// Add new handler for manual Excel upload
ipcMain.handle('upload-excel-file', async (event, filePath) => {
  try {
    // Copy the uploaded file to the expected location
    const targetPath = path.join(__dirname, '../docs/Calendar import xlsx/Calendar management log.xlsx');
    await fs.copy(filePath, targetPath);
    
    // Refresh meetings with incremental logic
    await meetingLoader.refreshMeetingsFromExcel();
    return { success: true };
  } catch (error) {
    console.error('Error uploading Excel file:', error);
    throw error;
  }
});

// Meeting notes IPC handlers
ipcMain.handle('get-meeting-by-id', async (event, meetingId) => {
  try {
    return await database.getMeetingById(meetingId);
  } catch (error) {
    console.error('Error getting meeting by ID:', error);
    throw error;
  }
});

ipcMain.handle('update-meeting-end-time', async (event, meetingId, newEndTime) => {
  try {
    await database.updateMeetingEndTime(meetingId, newEndTime);
    return { success: true };
  } catch (error) {
    console.error('Error updating meeting end time:', error);
    throw error;
  }
});

ipcMain.handle('update-meeting-participants', async (event, meetingId, participants) => {
  try {
    await database.updateMeetingParticipants(meetingId, participants);
    return { success: true };
  } catch (error) {
    console.error('Error updating meeting participants:', error);
    throw error;
  }
});

ipcMain.handle('update-meeting-title', async (event, meetingId, title) => {
  try {
    // Get current folder info before updating title
    const folderInfo = await database.getMeetingFolderInfo(meetingId);
    if (!folderInfo) {
      throw new Error('Meeting not found');
    }

    // Update the title first
    await database.updateMeetingTitle(meetingId, title);

    // Attempt to rename folder and files
    const meetingDate = folderInfo.start_time.split('T')[0]; // Extract YYYY-MM-DD
    const { renameNoteFolderAndFiles, rollbackRename } = require('./utils/file-manager');
    
    const renameResult = await renameNoteFolderAndFiles(
      meetingDate, 
      folderInfo.folder_name, 
      title
    );

    if (renameResult.success) {
      // Update database with new folder name
      await database.updateMeetingFolderName(meetingId, renameResult.newFolderName);
      
      // Update recording paths to reflect the new folder
      await database.updateRecordingPaths(meetingId, folderInfo.folder_name, renameResult.newFolderName);
      
      return { 
        success: true, 
        folderRenamed: true,
        newFolderName: renameResult.newFolderName 
      };
    } else {
      // Folder rename failed, but title update succeeded
      console.warn('Folder rename failed:', renameResult.error);
      return { 
        success: true, 
        folderRenamed: false,
        error: renameResult.error 
      };
    }
  } catch (error) {
    console.error('Error updating meeting title:', error);
    throw error;
  }
});

ipcMain.handle('get-meeting-attachments', async (event, meetingId) => {
  try {
    return await database.getMeetingAttachments(meetingId);
  } catch (error) {
    console.error('Error getting meeting attachments:', error);
    throw error;
  }
});

ipcMain.handle('create-new-meeting', async (event, meetingData) => {
  try {
    const result = await database.createNewMeeting(meetingData);
    return { success: true, meetingId: result.lastID };
  } catch (error) {
    console.error('Error creating new meeting:', error);
    throw error;
  }
});

// Synchronous version for page unload
ipcMain.on('update-meeting-notes-sync', (event, meetingId, content) => {
  try {
    // Use synchronous database call
    database.updateMeetingNotesSync(meetingId, content);
    console.log(`Notes updated synchronously for meeting ${meetingId}`);
    event.returnValue = { success: true };
  } catch (error) {
    console.error('Error updating meeting notes synchronously:', error);
    event.returnValue = { success: false, error: error.message };
  }
});

// Markdown export IPC handlers
ipcMain.handle('export-meeting-notes-markdown', async (event, meetingId) => {
  try {
    return await database.exportMeetingNotesAsMarkdown(meetingId);
  } catch (error) {
    console.error('Error exporting meeting notes as markdown:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('check-notes-changed', async (event, meetingId, currentContent) => {
  try {
    return await database.checkIfNotesChanged(meetingId, currentContent);
  } catch (error) {
    console.error('Error checking if notes changed:', error);
    return true; // Consider changed on error
  }
});

ipcMain.handle('delete-meeting-markdown', async (event, meetingId) => {
  try {
    return await database.deleteMeetingMarkdownExport(meetingId);
  } catch (error) {
    console.error('Error deleting markdown export:', error);
    return { success: false, error: error.message };
  }
});

// Debug logging handler
ipcMain.handle('log-to-main', async (event, message) => {
  console.log(message);
});

// Synchronous version for stopping recording on page unload
ipcMain.on('stop-recording-sync', (event, meetingId) => {
  try {
    if (audioRecorder) {
      // Stop recording synchronously
      const result = audioRecorder.stopRecordingSync(meetingId);
      console.log(`Recording stopped synchronously for meeting ${meetingId}`);
      event.returnValue = result;
    } else {
      event.returnValue = { success: false, error: 'Audio recorder not available' };
    }
  } catch (error) {
    console.error('Error stopping recording synchronously:', error);
    event.returnValue = { success: false, error: error.message };
  }
});

// Synchronous version for updating meeting duration on page unload
ipcMain.on('update-meeting-duration-sync', (event, meetingId) => {
  try {
    // Validate meeting ID
    if (!meetingId || isNaN(meetingId)) {
      console.log(`Skipping duration update for invalid meeting ID: ${meetingId}`);
      event.returnValue = { success: true, updated: false, reason: 'Invalid meeting ID' };
      return;
    }
    
    // Get meeting data synchronously
    const meeting = database.getMeetingByIdSync(meetingId);
    if (!meeting) {
      console.warn(`Meeting ${meetingId} not found for duration update`);
      event.returnValue = { success: false, error: 'Meeting not found' };
      return;
    }
    
    const startTime = new Date(meeting.start_time);
    const actualEndTime = new Date();
    
    // Calculate duration and apply minimum threshold
    const durationMinutes = Math.round((actualEndTime - startTime) / (1000 * 60));
    const minimumDuration = 5;
    
    if (durationMinutes < minimumDuration || actualEndTime <= startTime) {
      console.log(`Meeting ${meetingId}: Duration ${durationMinutes}min not updated (below minimum or invalid)`);
      event.returnValue = { success: true, updated: false };
      return;
    }
    
    // Update the meeting end time synchronously
    database.updateMeetingEndTimeSync(meetingId, actualEndTime.toISOString());
    console.log(`Meeting ${meetingId} duration updated synchronously: ${durationMinutes} minutes`);
    event.returnValue = { success: true, updated: true, duration: durationMinutes };
    
  } catch (error) {
    console.error('Error updating meeting duration synchronously:', error);
    event.returnValue = { success: false, error: error.message };
  }
});

// Attachment management IPC handlers
ipcMain.handle('upload-attachment', async (event, meetingId, fileInfo) => {
  try {
    const result = await database.uploadAttachment(meetingId, fileInfo);
    return { success: true, filename: result.filename };
  } catch (error) {
    console.error('Error uploading attachment:', error);
    throw error;
  }
});

ipcMain.handle('open-attachment', async (event, meetingId, filename) => {
  try {
    const result = await database.openAttachment(meetingId, filename);
    return { success: true, path: result.path };
  } catch (error) {
    console.error('Error opening attachment:', error);
    throw error;
  }
});

ipcMain.handle('get-attachment-info', async (event, meetingId, filename) => {
  try {
    const result = await database.getAttachmentInfo(meetingId, filename);
    return { size: result.size };
  } catch (error) {
    console.error('Error getting attachment info:', error);
    throw error;
  }
});

ipcMain.handle('remove-attachment', async (event, meetingId, filename) => {
  try {
    await database.removeAttachment(meetingId, filename);
    return { success: true };
  } catch (error) {
    console.error('Error removing attachment:', error);
    throw error;
  }
});

// Upload service IPC handlers
ipcMain.handle('queue-meeting-upload', async (event, meetingId) => {
  try {
    await uploadService.queueMeetingUpload(meetingId);
    return { success: true };
  } catch (error) {
    console.error('Error queueing meeting upload:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-upload-status', async (event, meetingId) => {
  try {
    const status = await database.getMeetingUploadStatus(meetingId);
    return { success: true, ...status };
  } catch (error) {
    console.error('Error getting upload status:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-upload-queue-status', async () => {
  try {
    const status = uploadService.getQueueStatus();
    return { success: true, ...status };
  } catch (error) {
    console.error('Error getting upload queue status:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-meetings-with-upload-status', async () => {
  try {
    const meetings = await database.getAllMeetingsWithUploadStatus();
    return { success: true, meetings };
  } catch (error) {
    console.error('Error getting meetings with upload status:', error);
    return { success: false, error: error.message };
  }
});

// Google Drive OAuth IPC handlers
ipcMain.handle('get-google-oauth-url', async () => {
  try {
    await googleDriveService.initializeOAuth();
    const authUrl = googleDriveService.generateAuthUrl();
    return { success: true, authUrl };
  } catch (error) {
    console.error('Error generating Google OAuth URL:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('exchange-google-oauth-code', async (event, code) => {
  try {
    await googleDriveService.exchangeCodeForTokens(code);
    return { success: true };
  } catch (error) {
    console.error('Error exchanging Google OAuth code:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('check-google-auth-status', async () => {
  try {
    await googleDriveService.initializeOAuth();
    const isAuthenticated = googleDriveService.isAuthenticated();
    return { success: true, isAuthenticated };
  } catch (error) {
    console.error('Error checking Google auth status:', error);
    return { success: false, error: error.message };
  }
});

// Audio recording IPC handlers
ipcMain.handle('start-recording', async (event, meetingId) => {
  try {
    if (!audioRecorder) {
      throw new Error('Audio recorder not initialized');
    }
    
    // Validate meeting ID
    if (!meetingId || isNaN(meetingId)) {
      throw new Error(`Cannot start recording for invalid meeting ID: ${meetingId}`);
    }
    
    const result = await audioRecorder.startRecording(meetingId);
    console.log(`Recording started for meeting ${meetingId}`);
    return result;
  } catch (error) {
    console.error('Error starting recording:', error);
    throw error;
  }
});

ipcMain.handle('stop-recording', async (event, meetingId) => {
  try {
    if (!audioRecorder) {
      throw new Error('Audio recorder not initialized');
    }
    
    // Validate meeting ID
    if (!meetingId || isNaN(meetingId)) {
      throw new Error(`Cannot stop recording for invalid meeting ID: ${meetingId}`);
    }
    
    const result = await audioRecorder.stopRecording(meetingId);
    console.log(`Recording stopped for meeting ${meetingId}`);
    return result;
  } catch (error) {
    console.error('Error stopping recording:', error);
    throw error;
  }
});

ipcMain.handle('pause-recording', async (event, meetingId) => {
  try {
    if (!audioRecorder) {
      throw new Error('Audio recorder not initialized');
    }
    
    // Validate meeting ID
    if (!meetingId || isNaN(meetingId)) {
      throw new Error(`Cannot pause recording for invalid meeting ID: ${meetingId}`);
    }
    
    const result = await audioRecorder.pauseRecording(meetingId);
    console.log(`Recording paused for meeting ${meetingId}`);
    return result;
  } catch (error) {
    console.error('Error pausing recording:', error);
    throw error;
  }
});

ipcMain.handle('resume-recording', async (event, meetingId) => {
  try {
    if (!audioRecorder) {
      throw new Error('Audio recorder not initialized');
    }
    
    // Validate meeting ID
    if (!meetingId || isNaN(meetingId)) {
      throw new Error(`Cannot resume recording for invalid meeting ID: ${meetingId}`);
    }
    
    const result = await audioRecorder.resumeRecording(meetingId);
    console.log(`Recording resumed for meeting ${meetingId}`);
    return result;
  } catch (error) {
    console.error('Error resuming recording:', error);
    throw error;
  }
});

ipcMain.handle('get-recording-status', async (event, meetingId) => {
  try {
    if (!audioRecorder) {
      throw new Error('Audio recorder not initialized');
    }
    
    // Validate meeting ID
    if (!meetingId || isNaN(meetingId)) {
      // Return a default status for invalid meeting IDs
      return { isRecording: false, isPaused: false };
    }
    
    return audioRecorder.getRecordingStatus(meetingId);
  } catch (error) {
    console.error('Error getting recording status:', error);
    throw error;
  }
});

ipcMain.handle('get-recording-sessions', async (event, meetingId) => {
  try {
    if (!audioRecorder) {
      throw new Error('Audio recorder not initialized');
    }
    
    // Validate meeting ID
    if (!meetingId || isNaN(meetingId)) {
      // Return empty array for invalid meeting IDs
      return [];
    }
    
    return await audioRecorder.getRecordingSessions(meetingId);
  } catch (error) {
    console.error('Error getting recording sessions:', error);
    throw error;
  }
});

ipcMain.handle('get-participant-suggestions', async (event, searchTerm) => {
  try {
    return await database.getParticipantSuggestions(searchTerm);
  } catch (error) {
    console.error('Error getting participant suggestions:', error);
    return [];
  }
});

ipcMain.handle('delete-meeting', async (event, meetingId) => {
  try {
    console.log(`🗑️ Deleting meeting ${meetingId}...`);
    
    // Get meeting info before deletion for cleanup
    const meeting = await database.getMeetingById(meetingId);
    if (!meeting) {
      return { success: false, error: 'Meeting not found' };
    }
    
    console.log(`📝 Meeting to delete: "${meeting.title}" (folder: ${meeting.folder_name})`);
    
    // Delete from Google Drive if uploaded
    if (meeting.upload_status === 'completed' && meeting.gdrive_folder_id) {
      try {
        console.log(`☁️ Deleting from Google Drive: ${meeting.gdrive_folder_id}`);
        await googleDriveService.deleteFolder(meeting.gdrive_folder_id);
        console.log(`✅ Successfully deleted from Google Drive`);
      } catch (driveError) {
        console.warn(`⚠️ Failed to delete from Google Drive: ${driveError.message}`);
        // Continue with local deletion even if Google Drive fails
      }
    }
    
    // Delete local files (markdown and audio recordings)
    const deleteResult = await database.deleteMeetingFiles(meetingId);
    if (!deleteResult.success) {
      console.warn(`⚠️ Failed to delete some files: ${deleteResult.error}`);
    }
    
    // Delete from database (this will cascade to related tables)
    await database.deleteMeeting(meetingId);
    
    console.log(`✅ Meeting ${meetingId} deleted successfully`);
    return { success: true };
    
  } catch (error) {
    console.error('Error deleting meeting:', error);
    return { success: false, error: error.message };
  }
});

module.exports = { database, meetingLoader, audioRecorder, store };