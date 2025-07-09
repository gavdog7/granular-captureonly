const { app, BrowserWindow, Menu, dialog, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const Database = require('./database');
const MeetingLoader = require('./meeting-loader');
const Store = require('electron-store');
const { setupTestDate, disableTestDate, dateOverride } = require('./date-override');

let mainWindow;
let database;
let meetingLoader;
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
    titleBarStyle: 'hiddenInset',
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
    await database.updateMeetingNotes(meetingId, content);
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

ipcMain.handle('get-meeting-attachments', async (event, meetingId) => {
  try {
    return await database.getMeetingAttachments(meetingId);
  } catch (error) {
    console.error('Error getting meeting attachments:', error);
    throw error;
  }
});

module.exports = { database, meetingLoader, store };