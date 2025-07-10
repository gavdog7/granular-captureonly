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
    setupTestDate('2025-07-10'); // Thursday, July 10, 2025
    
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

    meetingLoader = new MeetingLoader(database, store);
    audioRecorder = new AudioRecorder(database);
    
    // Initialize Google Drive service and Upload service
    googleDriveService = new GoogleDriveService(store);
    try {
      await googleDriveService.initializeOAuth();
      console.log('Google Drive service initialized');
    } catch (error) {
      console.warn('Google Drive service initialization failed (will retry on first upload):', error.message);
    }
    
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
    await database.updateMeetingTitle(meetingId, title);
    return { success: true };
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

// Audio recording IPC handlers
ipcMain.handle('start-recording', async (event, meetingId) => {
  try {
    if (!audioRecorder) {
      throw new Error('Audio recorder not initialized');
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
    return await audioRecorder.getRecordingSessions(meetingId);
  } catch (error) {
    console.error('Error getting recording sessions:', error);
    throw error;
  }
});

module.exports = { database, meetingLoader, audioRecorder, store };