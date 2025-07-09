Granular CaptureOnly - Implementation Plan

Project Overview
A macOS-only Electron application for capturing single-day meeting data from Excel files and recording system audio during meetings with note-taking capabilities. All captured data is exported daily as a zip file - initially for manual upload, then automated to Google Drive for processing on a separate server.
Context & Constraints
	•	Single User: Designed for one user's personal workflow
	•	macOS Only: No cross-platform requirements
	•	Capture-Only: No historical data browsing - only today's meetings
	•	Daily Export: All data moved to Google Drive at end of day
	•	External Processing: A separate server handles all analysis and long-term storage
Core Design Decisions
1. Simplified Architecture
	•	Focus on today's meetings only
	•	No pagination, search, or filtering needed
	•	Minimal UI - just today's meeting list and active meeting notes
	•	All historical data management delegated to external server
2. Audio Format
	•	Opus codec exclusively (no fallback)
	•	Target bitrate: 32 kbps for voice (excellent quality, minimal size)
	•	Real-time encoding during recording
3. Data Storage & Source of Truth
	•	SQLite for all live data during the day (source of truth)
	•	Exported files (.md, .opus, etc.) created at export time from database
	•	Soft delete policy for exported data with configurable retention
4. Timestamp Standardization
	•	All timestamps stored as ISO 8601 strings in UTC
	•	Consistent format across database, manifest, and exports
5. Phased Export Approach
	•	Phase 1 (Milestone 4): Manual export to local zip file
	•	Phase 2 (Milestone 5): Automated upload to Google Drive
File Organization
Daily Folder Structure
assets/
├── 2025-07-09/
│   ├── manifest.json              # Daily manifest for processing
│   ├── team-standup/
│   │   ├── recording-001.opus     # Sequential numbering
│   │   ├── recording-002.opus
│   │   ├── notes.md               # Generated from DB at export
│   │   └── attachments/
│   │       ├── file1.pdf
│   │       └── file2.docx
│   └── client-meeting/
│       ├── recording-001.opus
│       └── notes.md
├── _uploaded/                     # Soft-deleted after successful export
│   └── 2025-07-08/               # Retained for X days (configurable)
└── temp/
    └── current-recording.tmp      # Active recording buffer
Daily Manifest Format
{
  "date": "2025-07-09",
  "exportVersion": "1.0",
  "exportedAt": "2025-07-09T23:00:00Z",
  "meetings": [
    {
      "folderName": "team-standup",
      "title": "Team Standup",
      "startTime": "2025-07-09T13:00:00Z",  // All times in UTC ISO 8601
      "endTime": "2025-07-09T13:30:00Z",
      "participants": ["john@company.com", "jane@company.com"],
      "hasNotes": true,
      "recordings": [
        {
          "filename": "recording-001.opus",
          "duration": 1200,
          "startedAt": "2025-07-09T13:00:00Z",
          "endedAt": "2025-07-09T13:20:00Z"
        }
      ],
      "attachments": ["file1.pdf", "file2.docx"]
    }
  ]
}
Technical Architecture
System Audio Recording (macOS)
// Using ScreenCaptureKit (macOS 12.3+)
// Native module approach with node-addon-api

// Requirements:
// 1. Request screen recording permission
// 2. Create audio-only capture session
// 3. Stream PCM data to Opus encoder

// Implementation approach:
// - Native Swift module for audio capture
// - N-API bridge to Node.js
// - Stream interface for audio data
// - Real-time Opus encoding with opus-recorder
Database Schema (SQLite)
-- Core meeting data
CREATE TABLE meetings (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  folder_name TEXT UNIQUE NOT NULL,
  start_time TEXT NOT NULL,        -- ISO 8601 UTC
  end_time TEXT NOT NULL,          -- ISO 8601 UTC
  participants TEXT,               -- JSON array
  notes_content TEXT,              -- Live-edited content
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Recording tracking with crash recovery
CREATE TABLE recording_sessions (
  id INTEGER PRIMARY KEY,
  meeting_id INTEGER NOT NULL,
  temp_path TEXT,                  -- Path to .tmp file during recording
  final_path TEXT,                 -- Path after successful completion
  started_at TEXT NOT NULL,        -- ISO 8601 UTC
  ended_at TEXT,                   -- ISO 8601 UTC, NULL if in progress
  duration INTEGER,                -- Duration in seconds
  completed BOOLEAN DEFAULT 0,
  FOREIGN KEY (meeting_id) REFERENCES meetings(id)
);

CREATE TABLE attachments (
  id INTEGER PRIMARY KEY,
  meeting_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  uploaded_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (meeting_id) REFERENCES meetings(id)
);

-- Track export history
CREATE TABLE export_history (
  id INTEGER PRIMARY KEY,
  export_date TEXT NOT NULL,       -- Date being exported
  started_at TEXT NOT NULL,        -- ISO 8601 UTC
  completed_at TEXT,               -- ISO 8601 UTC
  status TEXT CHECK(status IN ('pending', 'uploading', 'completed', 'failed')),
  google_drive_file_id TEXT,
  error_message TEXT
);
Data Flow & Source of Truth
// During the day: Database is source of truth
async function autoSaveNotes(meetingId, content) {
  await db.run(
    'UPDATE meetings SET notes_content = ?, updated_at = ? WHERE id = ?',
    [content, new Date().toISOString(), meetingId]
  );
}

// At export time: Generate files from database
async function generateDailyManifest(date) {
  const meetings = await db.all(
    'SELECT * FROM meetings WHERE date(start_time) = date(?)',
    [date]
  );
  
  for (const meeting of meetings) {
    // Write notes from DB to file
    if (meeting.notes_content) {
      const notesPath = path.join(meeting.folder_name, 'notes.md');
      await fs.writeFile(notesPath, meeting.notes_content);
    }
    
    // Gather recordings
    const recordings = await db.all(
      'SELECT * FROM recording_sessions WHERE meeting_id = ? AND completed = 1',
      [meeting.id]
    );
    
    // Build manifest entry...
  }
}
Manual Export Process (Milestone 4)
async function exportDailyDataManual() {
  const exportDate = new Date().toISOString().split('T')[0];
  // Default to Desktop/GranularExports, but make configurable
  const defaultExportPath = path.join(app.getPath('desktop'), 'GranularExports');
  const exportPath = settings.get('manualExportPath', defaultExportPath);
  
  try {
    // Show progress dialog
    const progressWindow = new BrowserWindow({
      width: 400,
      height: 150,
      frame: false,
      alwaysOnTop: true,
      webPreferences: { nodeIntegration: true }
    });
    
    progressWindow.loadFile('export-progress.html');
    
    // 1. Generate manifest and notes files from database
    progressWindow.webContents.send('progress-update', 'Generating manifest...');
    const manifest = await generateDailyManifest(exportDate);
    
    // 2. Create zip archive
    progressWindow.webContents.send('progress-update', 'Creating archive...');
    const zipFileName = `capture-${exportDate}.zip`;
    const zipPath = path.join(exportPath, zipFileName);
    
    // Ensure export directory exists
    await fs.ensureDir(exportPath);
    
    // Create the zip
    await createDailyArchive(exportDate, zipPath);
    
    // The zip contains:
    // - manifest.json
    // - [meeting-folder]/
    //   - notes.md (if notes exist)
    //   - recording-001.opus
    //   - attachments/ (if any)
    
    // 3. Move to _uploaded folder (simple soft delete)
    const sourcePath = path.join(assetsDir, exportDate);
    const uploadedPath = path.join(assetsDir, '_uploaded', exportDate);
    await fs.ensureDir(path.dirname(uploadedPath));
    await fs.move(sourcePath, uploadedPath, { overwrite: true });
    
    // 4. Close progress and show completion
    progressWindow.close();
    
    // Show notification with file location
    new Notification({
      title: 'Export Complete',
      body: `File saved to: ${zipFileName}`,
      subtitle: 'Click to show in Finder'
    }).show();
    
    // Open file location in Finder
    shell.showItemInFolder(zipPath);
    
    // Log export
    await db.run(
      'INSERT INTO export_history (export_date, started_at, completed_at, status) VALUES (?, ?, ?, ?)',
      [exportDate, new Date().toISOString(), new Date().toISOString(), 'completed']
    );
    
  } catch (error) {
    console.error('Export failed:', error);
    dialog.showErrorBox('Export Failed', error.message);
  }
}

// Menu item for manual export
const exportMenuItem = {
  label: 'Export Today\'s Data',
  accelerator: 'CmdOrCtrl+E',
  click: async () => {
    const result = await dialog.showMessageBox({
      type: 'question',
      buttons: ['Export', 'Cancel'],
      defaultId: 0,
      message: 'Export today\'s meetings?',
      detail: 'This will create a zip file on your Desktop.'
    });
    
    if (result.response === 0) {
      await exportDailyDataManual();
    }
  }
};
Google Drive Export (Milestone 5)
// OAuth 2.0 Configuration
const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  'urn:ietf:wg:oauth:2.0:oob' // Note: Consider local server approach in future
);

// Export Process with Idempotency (builds on manual export from Milestone 4)
async function exportDailyData() {
  const exportDate = new Date().toISOString().split('T')[0];
  
  // Check for in-progress uploads
  const existingExport = await db.get(
    'SELECT * FROM export_history WHERE export_date = ? AND status = "uploading"',
    [exportDate]
  );
  
  if (existingExport) {
    const choice = await dialog.showMessageBox({
      type: 'question',
      buttons: ['Resume', 'Start New'],
      message: 'An export is already in progress. Resume or start new?'
    });
    
    if (choice.response === 0) {
      return resumeExport(existingExport);
    }
  }
  
  // Track export start
  const exportId = await db.run(
    'INSERT INTO export_history (export_date, started_at, status) VALUES (?, ?, ?)',
    [exportDate, new Date().toISOString(), 'pending']
  );
  
  try {
    // 1. Generate manifest and notes files from database
    const manifest = await generateDailyManifest(exportDate);
    
    // 2. Create zip archive (reuse logic from manual export)
    const tempZipPath = path.join(app.getPath('temp'), `capture-${exportDate}.zip`);
    await createDailyArchive(exportDate, tempZipPath);
    
    // 3. Update status
    await updateExportStatus(exportId, 'uploading');
    
    // 4. Upload to Google Drive
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    
    // 5. Ensure folder structure (idempotent)
    const folderId = await ensureFolderStructure(drive, new Date());
    
    // 6. Check if file already exists
    const existingFiles = await drive.files.list({
      q: `name='capture-${exportDate}.zip' and '${folderId}' in parents`,
      fields: 'files(id, name)'
    });
    
    if (existingFiles.data.files.length > 0) {
      // Update existing file
      await drive.files.update({
        fileId: existingFiles.data.files[0].id,
        media: { body: fs.createReadStream(tempZipPath) }
      });
    } else {
      // Create new file
      const uploadResult = await drive.files.create({
        requestBody: {
          name: `capture-${exportDate}.zip`,
          parents: [folderId]
        },
        media: {
          body: fs.createReadStream(tempZipPath)
        },
        fields: 'id,name'
      });
      
      await updateExportStatus(exportId, 'completed', uploadResult.data.id);
    }
    
    // 7. Soft delete: Move to _uploaded folder
    await softDeleteExportedData(exportDate);
    
    // 8. Clean up temp file
    await fs.remove(tempZipPath);
    
  } catch (error) {
    await updateExportStatus(exportId, 'failed', null, error.message);
    throw error;
  }
}

// Prevent quit during upload
app.on('before-quit', (event) => {
  const activeUploads = db.get(
    'SELECT COUNT(*) as count FROM export_history WHERE status = "uploading"'
  );
  
  if (activeUploads.count > 0) {
    event.preventDefault();
    dialog.showMessageBox({
      type: 'warning',
      message: 'Export in progress',
      detail: 'Please wait for the export to complete before quitting.'
    });
  }
});
Soft Delete with Retention
async function softDeleteExportedData(exportDate) {
  const sourcePath = path.join(assetsDir, exportDate);
  const uploadedPath = path.join(assetsDir, '_uploaded', exportDate);
  
  // Ensure _uploaded directory exists
  await fs.ensureDir(path.dirname(uploadedPath));
  
  // Move instead of delete
  await fs.move(sourcePath, uploadedPath, { overwrite: true });
  
  // Schedule cleanup based on retention setting
  scheduleCleanup(uploadedPath);
}

async function cleanupOldExports() {
  const retentionDays = settings.get('exportRetentionDays', 7);
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
  
  const uploadedDir = path.join(assetsDir, '_uploaded');
  const folders = await fs.readdir(uploadedDir);
  
  for (const folder of folders) {
    const folderDate = new Date(folder);
    if (folderDate < cutoffDate) {
      await fs.remove(path.join(uploadedDir, folder));
    }
  }
}
Excel Parsing Strategy
class MeetingLoader {
  constructor() {
    this.lastParsedTime = null;
    this.cachedMeetings = [];
  }
  
  async loadTodaysMeetings() {
    const excelPath = settings.get('excelFilePath');
    
    // Parse Excel file
    const workbook = await parseExcelFile(excelPath);
    const today = new Date().toISOString().split('T')[0];
    
    // Filter for today's meetings
    const todaysMeetings = workbook.meetings.filter(meeting => {
      const meetingDate = new Date(meeting.startTime).toISOString().split('T')[0];
      return meetingDate === today;
    });
    
    // Update database
    for (const meeting of todaysMeetings) {
      await db.run(`
        INSERT OR REPLACE INTO meetings (title, folder_name, start_time, end_time, participants)
        VALUES (?, ?, ?, ?, ?)
      `, [
        meeting.title,
        sanitizeFolderName(meeting.title),
        meeting.startTime,  // Already in ISO 8601 UTC
        meeting.endTime,    // Already in ISO 8601 UTC
        JSON.stringify(meeting.participants || [])
      ]);
    }
    
    this.lastParsedTime = new Date();
    this.cachedMeetings = todaysMeetings;
  }
  
  async refreshMeetings() {
    // Manual refresh button handler
    await this.loadTodaysMeetings();
    mainWindow.webContents.send('meetings-refreshed');
  }
}

// Load on startup
app.on('ready', async () => {
  const loader = new MeetingLoader();
  await loader.loadTodaysMeetings();
});
Simplified Milestones
Milestone 1: Core Infrastructure
	•	SQLite database setup with complete schema
	•	Basic Electron app with menu bar
	•	Excel file selection and parsing at startup
	•	Manual refresh button for meetings
	•	Today's meeting list display
	•	OAuth setup for Google Drive (with deprecation note)
Milestone 2: Meeting Notes Interface
	•	Notes editor with auto-save to database
	•	Participant list management
	•	Basic attachment support (drag & drop)
	•	Markdown preview
	•	Export notes from DB to .md files
Milestone 3: System Audio Recording
	•	macOS permission handling
	•	Native audio capture module
	•	Real-time Opus encoding (no fallback)
	•	Recording status indicator
	•	Pause/resume functionality
	•	Crash recovery implementation
Milestone 4: Export File Generation
	•	Daily manifest generation from database
	•	Export notes from DB to .md files
	•	Zip archive creation with progress indicator
	•	Save to designated export location (configurable, default: Desktop/GranularExports)
	•	Manual export trigger button (menu item with Cmd+E)
	•	Export completion notification
	•	Show exported file in Finder
	•	Basic soft delete (move to _uploaded folder)
	•	NOT included: OAuth, Google Drive upload, automatic scheduling
Milestone 5: Automated Google Drive Upload
	•	OAuth flow implementation
	•	Google Drive folder structure creation
	•	Upload with progress tracking
	•	Automatic daily export scheduler
	•	Export retry with idempotency
	•	Upload interruption handling
	•	Enhanced soft delete with retention policy
Milestone 6: Polish & Reliability
	•	Complete crash recovery testing
	•	System tray integration
	•	Preferences window (retention days, export time)
	•	Error notifications
	•	Cleanup scheduler for old exports
	•	Performance optimizations
App Settings (Preferences)
{
  // Core settings (Milestone 1-4)
  excelFilePath: string,              // Path to schedule Excel file
  audioQuality: 'low'|'medium'|'high', // Opus bitrate preset
  exportRetentionDays: number,        // Days to keep in _uploaded (default: 7)
  autoRefreshMeetings: boolean,       // Auto-refresh meetings at interval
  manualExportPath: string,           // Where to save manual exports
  
  // Google Drive settings (Milestone 5+)
  exportTime: string,                 // Daily export time (e.g., "18:00")
  autoExport: boolean,                // Enable automatic daily export
  googleDriveFolderId: string        // Target folder in Google Drive
}
Success Metrics
Performance Targets
	•	Excel parsing: < 1 second for typical day
	•	App launch: < 2 seconds
	•	Recording start: < 500ms
	•	Export upload: Limited by connection speed
	•	Notes auto-save: < 100ms
Reliability Targets
	•	Zero data loss on crash
	•	Successful daily exports: 99%+
	•	Recording quality: Consistent Opus encoding
	•	Export idempotency: Handle retries gracefully
	•	Soft delete safety: X days retention buffer
