require('dotenv').config();

const { app, BrowserWindow, Menu, dialog, shell, ipcMain, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const log = require('./utils/logger');
const Database = require('./database');
const MeetingLoader = require('./meeting-loader');
const AudioRecorder = require('./audio-recorder');
const UploadService = require('./upload-service');
const FolderReconciliationService = require('./folder-reconciliation');
const GoogleDriveService = require('./google-drive');
const { MeetingHealthChecker } = require('./meeting-health-checker');
const Store = require('electron-store');
const { getLocalDateString } = require('./utils/date-utils');
const audioDebug = require('./utils/audio-debug');

// Optional SMB mount service (may not be available in all environments)
let SMBMountService;
try {
  SMBMountService = require('./smb-mount-service');
} catch (error) {
  console.log('SMB mount service not available:', error.message);
  SMBMountService = null;
}
const { setupTestDate, disableTestDate, dateOverride } = require('./date-override');

let mainWindow;
let database;
let meetingLoader;
let audioRecorder;
let uploadService;
let folderReconciliationService;
let googleDriveService;
let smbMountService;
let healthChecker;
let store;

// Global process tracking for cleanup
global.spawnedProcesses = new Set();

// Helper function to track spawned processes
global.trackProcess = (process, description = 'Unknown process') => {
  if (process && process.pid) {
    global.spawnedProcesses.add({ process, description, pid: process.pid });
    console.log(`📝 Tracking process: ${description} (PID: ${process.pid})`);

    // Auto-remove when process exits
    process.on('exit', () => {
      global.spawnedProcesses.forEach(tracked => {
        if (tracked.pid === process.pid) {
          global.spawnedProcesses.delete(tracked);
          console.log(`🗑️ Process exited: ${description} (PID: ${process.pid})`);
        }
      });
    });
  }
  return process;
};

// Helper function to cleanup all tracked processes
global.cleanupAllProcesses = () => {
  console.log(`🧹 Cleaning up ${global.spawnedProcesses.size} tracked processes...`);

  for (const tracked of global.spawnedProcesses) {
    try {
      if (tracked.process && !tracked.process.killed) {
        console.log(`🔪 Force killing: ${tracked.description} (PID: ${tracked.pid})`);
        tracked.process.kill('SIGKILL');
      }
    } catch (error) {
      console.error(`Error killing process ${tracked.pid}:`, error);
    }
  }

  global.spawnedProcesses.clear();
};

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
    // Test logger - Log system initialization
    log.info('[SYSTEM] Application initializing', {
      version: '1.0.0',
      platform: process.platform,
      nodeVersion: process.version,
      timestamp: Date.now()
    });

    // 🧪 TEST MODE: Override date for testing
    // TO DISABLE: Comment out the line below
    // setupTestDate('2025-07-11'); // Friday, July 11, 2025

    // Request microphone permission for audio recording
    if (process.platform === 'darwin') {
      const microphonePermission = systemPreferences.getMediaAccessStatus('microphone');
      console.log('Microphone permission status:', microphonePermission);
      audioDebug.logValidation('Microphone permission check', {
        status: microphonePermission,
        platform: process.platform
      });

      if (microphonePermission !== 'granted') {
        console.log('Requesting microphone permission...');
        audioDebug.logLifecycle('Requesting microphone permission from user');
        try {
          const granted = await systemPreferences.askForMediaAccess('microphone');
          console.log('Microphone permission granted:', granted);
          audioDebug.logValidation('Microphone permission result', {
            granted,
            finalStatus: granted ? 'granted' : 'denied'
          });
        } catch (error) {
          console.error('Error requesting microphone permission:', error);
          audioDebug.logValidation('ERROR: Microphone permission request failed', {
            error: error.message
          });
        }
      } else {
        audioDebug.logValidation('Microphone permission already granted');
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
        googleDriveFolderId: null,
        lastCalendarSyncDate: null
      }
    });

    // Initialize Google Drive service first
    googleDriveService = new GoogleDriveService(store, mainWindow);
    try {
      await googleDriveService.initializeOAuth();
      console.log('Google Drive service initialized');
    } catch (error) {
      console.warn('Google Drive service initialization failed (will retry on first upload):', error.message);
    }

    // Initialize SMB mount service (if available)
    if (SMBMountService) {
      smbMountService = new SMBMountService(store, mainWindow);
      try {
        await smbMountService.initialize();
        console.log('SMB mount service initialized');
      } catch (error) {
        console.warn('SMB mount service initialization failed:', error.message);
      }
    } else {
      console.log('SMB mount service not available - skipping initialization');
    }
    
    // Initialize services with Google Drive support
    meetingLoader = new MeetingLoader(database, store, googleDriveService);
    audioRecorder = new AudioRecorder(database);
    
    uploadService = new UploadService(database, googleDriveService, mainWindow);
    await uploadService.initialize();
    console.log('Upload service initialized');
    
    // Initialize health checker
    healthChecker = new MeetingHealthChecker(database, uploadService);
    healthChecker.start();
    console.log('Meeting health checker started');

    // Initialize folder reconciliation service
    folderReconciliationService = new FolderReconciliationService(database, uploadService);
    await folderReconciliationService.initialize();
    console.log('Folder reconciliation service started');
    
    // Always load 6 weeks of meetings from the calendar management log
    await meetingLoader.loadSixWeeksMeetings();

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
  // Always quit the app when all windows are closed (including macOS)
  console.log('All windows closed, initiating app quit...');
  app.quit();
});

let isQuitting = false;

app.on('before-quit', async (event) => {
  if (isQuitting) {
    return; // Already in cleanup process
  }

  console.log('App quit initiated, starting cleanup...');
  event.preventDefault(); // Prevent immediate quit
  isQuitting = true;

  // Set a timeout to force quit if cleanup takes too long
  const forceQuitTimeout = setTimeout(() => {
    console.warn('Cleanup timeout reached, force quitting...');
    if (audioRecorder) {
      audioRecorder.forceCleanup();
    }
    global.cleanupAllProcesses();
    process.exit(0);
  }, 5000); // 5 second timeout

  try {
    // Log active processes before cleanup
    if (audioRecorder) {
      const activeProcesses = audioRecorder.getActiveProcesses();
      if (activeProcesses.length > 0) {
        console.log(`Found ${activeProcesses.length} active audio processes to clean up:`, activeProcesses);
      }
    }

    // Stop health checker
    if (healthChecker) {
      console.log('Stopping health checker...');
      healthChecker.stop();
    }

    // Stop folder reconciliation service
    if (folderReconciliationService) {
      console.log('Stopping folder reconciliation service...');
      await folderReconciliationService.shutdown();
    }

    // Clean up audio recorder and its processes
    if (audioRecorder) {
      console.log('Cleaning up audio recorder...');
      await audioRecorder.cleanup();
      console.log('Audio recorder cleanup completed');
    }

    // Clean up any other tracked processes (ffmpeg, ffprobe, etc.)
    global.cleanupAllProcesses();

    // Close database
    if (database) {
      console.log('Closing database...');
      await database.close();
      console.log('Database closed');
    }

    clearTimeout(forceQuitTimeout);
    console.log('Cleanup completed successfully, quitting app...');

    // Force quit after cleanup
    process.exit(0);

  } catch (error) {
    console.error('Error during cleanup:', error);
    clearTimeout(forceQuitTimeout);

    // Force cleanup if normal cleanup fails
    if (audioRecorder) {
      audioRecorder.forceCleanup();
    }

    // Force cleanup all tracked processes
    global.cleanupAllProcesses();

    process.exit(1);
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

ipcMain.handle('get-last-calendar-sync-date', () => {
  return store.get('lastCalendarSyncDate');
});

// Calendar age IPC handler for visual indicator
ipcMain.handle('get-calendar-age', async () => {
  try {
    const CalendarAge = require('./utils/calendar-age');
    const calendarAge = new CalendarAge(store);
    return calendarAge.getCalendarIconData();
  } catch (error) {
    console.error('Error getting calendar age:', error);
    return {
      type: 'calendar',
      days: 0,
      color: '#666666',
      isStale: false
    };
  }
});

ipcMain.handle('update-calendar-sync-date', (event, date) => {
  store.set('lastCalendarSyncDate', date);
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
    // Copy the uploaded file to the assets folder where meeting loader expects it
    const fileName = path.basename(filePath);
    const targetPath = path.join(__dirname, '..', 'assets', fileName);
    await fs.copy(filePath, targetPath, { overwrite: true });
    
    console.log(`📤 Uploaded Excel file: ${fileName} to assets folder`);
    
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
    const meetingDate = getLocalDateString(folderInfo.start_time); // Extract local YYYY-MM-DD
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

// Enhanced markdown export handlers for the new export manager
ipcMain.handle('export-meeting-notes', async (event, { meetingId, folderName }) => {
  try {
    const result = await database.exportMeetingNotesAsMarkdown(meetingId);
    if (result.success) {
      await database.updateMarkdownExportStatus(meetingId, 'success');
    }
    return result;
  } catch (error) {
    console.error('Error exporting meeting notes:', error);
    await database.updateMarkdownExportStatus(meetingId, 'failed', error.message);
    return { success: false, error: error.message };
  }
});

// Synchronous export for page unload
ipcMain.on('export-meeting-notes-sync', (event, { meetingId, folderName }) => {
  try {
    database.exportMeetingNotesAsMarkdown(meetingId)
      .then(result => {
        if (result.success) {
          database.updateMarkdownExportStatus(meetingId, 'success');
        }
        event.returnValue = result;
      })
      .catch(error => {
        console.error('Error in sync export:', error);
        database.updateMarkdownExportStatus(meetingId, 'failed', error.message);
        event.returnValue = { success: false, error: error.message };
      });
  } catch (error) {
    console.error('Error in sync export handler:', error);
    event.returnValue = { success: false, error: error.message };
  }
});

// Update markdown export status
ipcMain.handle('update-markdown-export-status', async (event, { meetingId, status, error, timestamp }) => {
  try {
    await database.updateMarkdownExportStatus(meetingId, status, error);
    return { success: true };
  } catch (error) {
    console.error('Error updating markdown export status:', error);
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

// IPC bridge for renderer logging (unified logging system)
ipcMain.on('log', (event, level, message, data) => {
  if (log[level]) {
    log[level](message, data);
  } else {
    log.info(message, data);
  }
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
    
    // Validate start time
    if (isNaN(startTime.getTime())) {
      console.warn(`Meeting ${meetingId}: Invalid start time '${meeting.start_time}' - skipping duration update`);
      event.returnValue = { success: true, updated: false, reason: 'Invalid start time' };
      return;
    }
    
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

ipcMain.handle('disconnect-google-drive', async () => {
  try {
    if (googleDriveService) {
      googleDriveService.logout();
      console.log('Google Drive disconnected successfully');
      return { success: true };
    }
    return { success: false, error: 'Google Drive service not initialized' };
  } catch (error) {
    console.error('Error disconnecting Google Drive:', error);
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

    // Additional permission check before starting recording
    if (process.platform === 'darwin') {
      const currentPermission = systemPreferences.getMediaAccessStatus('microphone');
      audioDebug.logValidation('Pre-recording permission check', {
        meetingId,
        microphoneStatus: currentPermission
      });

      if (currentPermission !== 'granted') {
        audioDebug.logValidation('ERROR: Microphone permission not granted for recording', {
          meetingId,
          status: currentPermission
        });
        throw new Error(`Microphone permission required but status is: ${currentPermission}`);
      }
    }

    const result = await audioRecorder.startRecording(meetingId);
    console.log(`Recording started for meeting ${meetingId}`);
    return result;
  } catch (error) {
    console.error('Error starting recording:', error);
    audioDebug.logValidation('ERROR: Failed to start recording', {
      meetingId,
      error: error.message
    });
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

// Helper function to reconstruct current path based on current folder name
async function reconstructCurrentPath(meeting, originalPath) {
  if (!originalPath || !meeting.folder_name) return null;

  try {
    // Extract filename from original path
    const fileName = path.basename(originalPath);

    // Reconstruct path with current folder name
    const assetsPath = path.join(__dirname, '..', 'assets');
    const dateStr = getLocalDateString(meeting.start_time);
    const currentPath = path.join(assetsPath, dateStr, meeting.folder_name, fileName);

    return currentPath;
  } catch (error) {
    console.error('Error reconstructing current path:', error);
    return null;
  }
}

// Helper function to search for recording file in current meeting folder
async function findFileInMeetingFolder(meeting) {
  try {
    const assetsPath = path.join(__dirname, '..', 'assets');
    const dateStr = getLocalDateString(meeting.start_time);
    const folderPath = path.join(assetsPath, dateStr, meeting.folder_name);

    // List all .opus files in the folder
    const files = await fs.readdir(folderPath);
    const opusFiles = files.filter(file => file.endsWith('.opus'));

    if (opusFiles.length === 0) return null;

    // Return the most recently modified .opus file
    let newestFile = null;
    let newestTime = 0;

    for (const file of opusFiles) {
      const filePath = path.join(folderPath, file);
      const stats = await fs.stat(filePath);
      if (stats.mtime.getTime() > newestTime) {
        newestTime = stats.mtime.getTime();
        newestFile = filePath;
      }
    }

    return newestFile;
  } catch (error) {
    console.error('Error searching for file in meeting folder:', error);
    return null;
  }
}

// File size monitoring IPC handler with enhanced path resolution
ipcMain.handle('get-file-growth-status', async (event, meetingId) => {
  try {
    // Get meeting info to find file path
    const meeting = await database.getMeetingById(meetingId);
    if (!meeting) {
      return { exists: false, error: 'Meeting not found' };
    }

    // Get the most recent recording session (active or just completed)
    const recordings = await database.all(
      'SELECT id, temp_path, final_path, completed FROM recording_sessions WHERE meeting_id = ? ORDER BY started_at DESC LIMIT 1',
      [meetingId]
    );

    if (recordings.length === 0) {
      return { exists: false, isActive: false };
    }

    const recording = recordings[0];
    const originalPath = recording.final_path || recording.temp_path;

    if (!originalPath) {
      return { exists: false, error: 'No file path available' };
    }

    // Try multiple path resolution strategies
    const pathsToTry = [
      originalPath, // Original database path
      await reconstructCurrentPath(meeting, originalPath), // Reconstructed current path
      await findFileInMeetingFolder(meeting) // Search in current meeting folder
    ].filter(path => path); // Remove null/undefined paths

    console.log(`🔍 [FILE MONITORING] Trying ${pathsToTry.length} paths for meeting ${meetingId}:`);
    pathsToTry.forEach((path, index) => {
      console.log(`  ${index + 1}. ${path}`);
    });

    // Log path resolution attempt
    audioDebug.logPathResolution(meetingId, pathsToTry);

    for (const filePath of pathsToTry) {
      try {
        console.log(`🔍 [FILE MONITORING] Checking path: ${filePath}`);
        const stats = await fs.stat(filePath);
        const currentSize = stats.size;
        const currentTime = Date.now();
        console.log(`✅ [FILE MONITORING] Found file at: ${filePath} (${currentSize} bytes)`);

        // If we found the file at a different path, update the database
        if (filePath !== originalPath) {
          try {
            await database.run(
              'UPDATE recording_sessions SET final_path = ? WHERE id = ?',
              [filePath, recording.id]
            );
            console.log(`✅ [FILE MONITORING] Updated recording path from ${originalPath} to ${filePath}`);
            audioDebug.logPathUpdate(recording.id, originalPath, filePath, 'folder rename detection');
          } catch (updateError) {
            console.error('Error updating recording path:', updateError);
            // Continue anyway since we found the file
          }
        }

        // Log successful path resolution
        audioDebug.logPathResolution(meetingId, pathsToTry, filePath);

        return {
          exists: true,
          isActive: true,
          size: currentSize,
          timestamp: currentTime,
          path: filePath
        };
      } catch (fileError) {
        console.log(`❌ [FILE MONITORING] File not found at: ${filePath} (${fileError.message})`);
        // File not found at this path, try next one
        continue;
      }
    }

    // No file found at any path
    console.warn(`⚠️ [FILE MONITORING] File not found at any expected location for meeting ${meetingId}`);
    audioDebug.logPathResolution(meetingId, pathsToTry, null);
    return { exists: false, error: 'File not found at any expected location' };

  } catch (error) {
    console.error('Error in get-file-growth-status:', error);
    return { exists: false, error: error.message };
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

// SMB Mount Service IPC handlers
ipcMain.handle('check-smb-connection-status', async () => {
  try {
    if (!smbMountService) {
      return { success: false, error: 'SMB service not initialized' };
    }
    const status = await smbMountService.getConnectionStatus();
    return { success: true, ...status };
  } catch (error) {
    console.error('Error checking SMB connection status:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('connect-smb', async (event, credentials) => {
  try {
    if (!smbMountService) {
      return { success: false, error: 'SMB service not initialized' };
    }

    console.log(`🔌 Attempting SMB connection for user: ${credentials.username}`);
    const result = await smbMountService.connect(credentials.username, credentials.password);

    if (result.success) {
      console.log('✅ SMB connection successful');
    } else {
      console.log(`❌ SMB connection failed: ${result.error}`);
    }

    return result;
  } catch (error) {
    console.error('Error connecting to SMB:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('disconnect-smb', async () => {
  try {
    if (!smbMountService) {
      return { success: false, error: 'SMB service not initialized' };
    }

    console.log('🔌 Disconnecting from SMB share...');
    const result = await smbMountService.disconnect();

    if (result.success) {
      console.log('✅ SMB disconnection successful');
    } else {
      console.log(`❌ SMB disconnection failed: ${result.error}`);
    }

    return result;
  } catch (error) {
    console.error('Error disconnecting SMB:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('test-smb-connection', async (event, credentials) => {
  try {
    if (!smbMountService) {
      return { success: false, error: 'SMB service not initialized' };
    }

    console.log(`🧪 Testing SMB connection for user: ${credentials.username}`);
    const result = await smbMountService.testConnection(credentials.username, credentials.password);

    console.log(`🧪 SMB test result: ${result.success ? 'success' : 'failed'}`);
    return result;
  } catch (error) {
    console.error('Error testing SMB connection:', error);
    return { success: false, error: error.message };
  }
});

module.exports = { database, meetingLoader, audioRecorder, store, smbMountService };