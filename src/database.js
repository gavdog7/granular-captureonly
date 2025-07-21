const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs-extra');
const { app, shell } = require('electron');
const { dateOverride } = require('./date-override');
const { generateMarkdownDocument } = require('./quill-to-markdown');

class Database {
  constructor() {
    this.db = null;
    this.dbPath = null;
  }

  async initialize() {
    const userDataPath = app.getPath('userData');
    await fs.ensureDir(userDataPath);
    this.dbPath = path.join(userDataPath, 'granular-captureonly.db');
    
    this.db = new sqlite3.Database(this.dbPath);
    await this.createTables();
  }

  async createTables() {
    const createTablesSQL = `
      -- Core meeting data
      CREATE TABLE IF NOT EXISTS meetings (
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
      CREATE TABLE IF NOT EXISTS recording_sessions (
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

      CREATE TABLE IF NOT EXISTS attachments (
        id INTEGER PRIMARY KEY,
        meeting_id INTEGER NOT NULL,
        filename TEXT NOT NULL,
        original_name TEXT NOT NULL,
        uploaded_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (meeting_id) REFERENCES meetings(id)
      );

      -- Track export history
      CREATE TABLE IF NOT EXISTS export_history (
        id INTEGER PRIMARY KEY,
        export_date TEXT NOT NULL,       -- Date being exported
        started_at TEXT NOT NULL,        -- ISO 8601 UTC
        completed_at TEXT,               -- ISO 8601 UTC
        status TEXT CHECK(status IN ('pending', 'uploading', 'completed', 'failed')),
        google_drive_file_id TEXT,
        error_message TEXT
      );

      -- Create indexes for performance
      CREATE INDEX IF NOT EXISTS idx_meetings_start_time ON meetings(start_time);
      CREATE INDEX IF NOT EXISTS idx_meetings_folder_name ON meetings(folder_name);
      CREATE INDEX IF NOT EXISTS idx_recording_sessions_meeting_id ON recording_sessions(meeting_id);
      CREATE INDEX IF NOT EXISTS idx_attachments_meeting_id ON attachments(meeting_id);
      CREATE INDEX IF NOT EXISTS idx_export_history_date ON export_history(export_date);
      CREATE INDEX IF NOT EXISTS idx_export_history_status ON export_history(status);
    `;

    return new Promise((resolve, reject) => {
      this.db.exec(createTablesSQL, async (err) => {
        if (err) {
          console.error('Error creating tables:', err);
          reject(err);
        } else {
          console.log('Database tables created successfully');
          
          // Run migrations for new columns
          try {
            await this.runMigrations();
            console.log('Database migrations completed successfully');
            resolve();
          } catch (migrationError) {
            console.error('Error running migrations:', migrationError);
            reject(migrationError);
          }
        }
      });
    });
  }

  async runMigrations() {
    try {
      // Migration 1: Check if upload_status column exists
      const columnExists = await this.checkColumnExists('meetings', 'upload_status');
      if (!columnExists) {
        console.log('Adding upload status columns to meetings table...');
        
        // Add the new columns
        await this.run('ALTER TABLE meetings ADD COLUMN upload_status TEXT DEFAULT "pending"');
        await this.run('ALTER TABLE meetings ADD COLUMN uploaded_at TEXT');
        await this.run('ALTER TABLE meetings ADD COLUMN gdrive_folder_id TEXT');
        
        console.log('Upload status columns added successfully');
      } else {
        console.log('Upload status columns already exist');
      }

      // Migration 2: Update folder_name to include date prefix for existing meetings
      await this.migrateFolderNamesToDatePrefix();

    } catch (error) {
      console.error('Migration error:', error);
      throw error;
    }
  }

  async checkColumnExists(tableName, columnName) {
    try {
      const result = await this.get(`PRAGMA table_info(${tableName})`);
      const columns = await this.all(`PRAGMA table_info(${tableName})`);
      return columns.some(column => column.name === columnName);
    } catch (error) {
      console.error('Error checking column existence:', error);
      return false;
    }
  }

  async migrateFolderNamesToDatePrefix() {
    try {
      // Check if we need to run this migration by looking for folder_names without date prefixes
      const meetingsWithoutDatePrefix = await this.all(`
        SELECT id, title, folder_name, start_time 
        FROM meetings 
        WHERE folder_name NOT LIKE '____-__-__-%'
      `);

      if (meetingsWithoutDatePrefix.length === 0) {
        console.log('Folder name date prefix migration: No meetings need updating');
        return;
      }

      console.log(`Updating folder names with date prefix for ${meetingsWithoutDatePrefix.length} meetings...`);

      for (const meeting of meetingsWithoutDatePrefix) {
        try {
          // Extract date from start_time (ISO format: 2025-01-15T09:00:00.000Z)
          const startDate = new Date(meeting.start_time);
          const dateStr = startDate.toISOString().split('T')[0]; // YYYY-MM-DD
          
          // Create new folder name with date prefix
          const newFolderName = `${dateStr}-${meeting.folder_name}`;
          
          // Update the database
          await this.run(
            'UPDATE meetings SET folder_name = ? WHERE id = ?',
            [newFolderName, meeting.id]
          );
          
          console.log(`Updated meeting "${meeting.title}": ${meeting.folder_name} → ${newFolderName}`);
          
        } catch (meetingError) {
          console.error(`Error updating meeting ${meeting.id} (${meeting.title}):`, meetingError);
          // Continue with other meetings rather than failing the entire migration
        }
      }
      
      console.log('Folder name date prefix migration completed successfully');
      
    } catch (error) {
      console.error('Error in folder name migration:', error);
      throw error;
    }
  }

  async run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ lastID: this.lastID, changes: this.changes });
        }
      });
    });
  }

  async get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  async all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async getTodaysMeetings() {
    const today = dateOverride.today();
    return this.all(
      'SELECT * FROM meetings WHERE date(start_time) = date(?) ORDER BY start_time',
      [today]
    );
  }

  async upsertMeeting(meeting) {
    // Check if meeting already exists
    const existing = await this.get(
      'SELECT id, notes_content FROM meetings WHERE folder_name = ?',
      [meeting.folderName]
    );
    
    if (existing) {
      // Update existing meeting but preserve notes
      return this.run(`
        UPDATE meetings 
        SET title = ?, start_time = ?, end_time = ?, participants = ?, updated_at = ?
        WHERE folder_name = ?
      `, [
        meeting.title,
        meeting.startTime,
        meeting.endTime,
        JSON.stringify(meeting.participants || []),
        new Date().toISOString(),
        meeting.folderName
      ]);
    } else {
      // Insert new meeting
      return this.run(`
        INSERT INTO meetings (title, folder_name, start_time, end_time, participants, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [
        meeting.title,
        meeting.folderName,
        meeting.startTime,
        meeting.endTime,
        JSON.stringify(meeting.participants || []),
        new Date().toISOString()
      ]);
    }
  }

  async updateMeetingNotes(meetingId, content) {
    return this.run(
      'UPDATE meetings SET notes_content = ?, updated_at = ? WHERE id = ?',
      [content, new Date().toISOString(), meetingId]
    );
  }

  async startRecordingSession(meetingId, tempPath) {
    return this.run(
      'INSERT INTO recording_sessions (meeting_id, temp_path, started_at) VALUES (?, ?, ?)',
      [meetingId, tempPath, new Date().toISOString()]
    );
  }

  async endRecordingSession(sessionId, finalPath, duration) {
    return this.run(
      'UPDATE recording_sessions SET final_path = ?, ended_at = ?, duration = ?, completed = 1 WHERE id = ?',
      [finalPath, new Date().toISOString(), duration, sessionId]
    );
  }

  endRecordingSessionSync(sessionId, finalPath, duration) {
    const stmt = this.db.prepare(
      'UPDATE recording_sessions SET final_path = ?, ended_at = ?, duration = ?, completed = 1 WHERE id = ?'
    );
    return stmt.run(finalPath, new Date().toISOString(), duration, sessionId);
  }

  async addAttachment(meetingId, filename, originalName) {
    return this.run(
      'INSERT INTO attachments (meeting_id, filename, original_name) VALUES (?, ?, ?)',
      [meetingId, filename, originalName]
    );
  }

  async getAttachments(meetingId) {
    return this.all(
      'SELECT * FROM attachments WHERE meeting_id = ?',
      [meetingId]
    );
  }

  async getCompletedRecordings(meetingId) {
    return this.all(
      'SELECT * FROM recording_sessions WHERE meeting_id = ? AND completed = 1',
      [meetingId]
    );
  }

  async createExportRecord(exportDate) {
    return this.run(
      'INSERT INTO export_history (export_date, started_at, status) VALUES (?, ?, ?)',
      [exportDate, new Date().toISOString(), 'pending']
    );
  }

  async updateExportStatus(exportId, status, googleDriveFileId = null, errorMessage = null) {
    const completedAt = status === 'completed' ? new Date().toISOString() : null;
    return this.run(
      'UPDATE export_history SET status = ?, completed_at = ?, google_drive_file_id = ?, error_message = ? WHERE id = ?',
      [status, completedAt, googleDriveFileId, errorMessage, exportId]
    );
  }

  async getExportHistory(exportDate) {
    return this.get(
      'SELECT * FROM export_history WHERE export_date = ? ORDER BY started_at DESC LIMIT 1',
      [exportDate]
    );
  }

  async getMeetingById(meetingId) {
    return this.get(
      'SELECT * FROM meetings WHERE id = ?',
      [meetingId]
    );
  }

  async updateMeetingParticipants(meetingId, participants) {
    return this.run(
      'UPDATE meetings SET participants = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify(participants), new Date().toISOString(), meetingId]
    );
  }

  async updateMeetingTitle(meetingId, title) {
    return this.run(
      'UPDATE meetings SET title = ?, updated_at = ? WHERE id = ?',
      [title, new Date().toISOString(), meetingId]
    );
  }

  async updateMeetingFolderName(meetingId, folderName) {
    return this.run(
      'UPDATE meetings SET folder_name = ?, updated_at = ? WHERE id = ?',
      [folderName, new Date().toISOString(), meetingId]
    );
  }

  async updateMeetingEndTime(meetingId, newEndTime) {
    return this.run(
      'UPDATE meetings SET end_time = ?, updated_at = ? WHERE id = ?',
      [newEndTime, new Date().toISOString(), meetingId]
    );
  }

  async updateRecordingPaths(meetingId, oldFolderName, newFolderName) {
    try {
      // Get all recordings for this meeting
      const recordings = await this.all(
        'SELECT id, final_path FROM recording_sessions WHERE meeting_id = ?',
        [meetingId]
      );
      
      // Update each recording path
      for (const recording of recordings) {
        if (recording.final_path && recording.final_path.includes(oldFolderName)) {
          const newPath = recording.final_path.replace(oldFolderName, newFolderName);
          await this.run(
            'UPDATE recording_sessions SET final_path = ? WHERE id = ?',
            [newPath, recording.id]
          );
          console.log(`📝 Updated recording path from ${recording.final_path} to ${newPath}`);
        }
      }
      
      return { success: true, updated: recordings.length };
    } catch (error) {
      console.error('Error updating recording paths:', error);
      throw error;
    }
  }

  async getMeetingFolderInfo(meetingId) {
    return this.get(
      'SELECT folder_name, start_time FROM meetings WHERE id = ?',
      [meetingId]
    );
  }

  async getMeetingAttachments(meetingId) {
    return this.all(
      'SELECT * FROM attachments WHERE meeting_id = ?',
      [meetingId]
    );
  }

  async createNewMeeting(meetingData) {
    return this.run(`
      INSERT INTO meetings (title, folder_name, start_time, end_time, participants, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      meetingData.title,
      meetingData.folderName,
      meetingData.startTime,
      meetingData.endTime,
      JSON.stringify(meetingData.participants || []),
      new Date().toISOString()
    ]);
  }

  updateMeetingNotesSync(meetingId, content) {
    // Synchronous version for page unload
    return this.db.run(
      'UPDATE meetings SET notes_content = ?, updated_at = ? WHERE id = ?',
      [content, new Date().toISOString(), meetingId]
    );
  }

  updateMeetingEndTimeSync(meetingId, newEndTime) {
    // Synchronous version for page unload
    return this.db.run(
      'UPDATE meetings SET end_time = ?, updated_at = ? WHERE id = ?',
      [newEndTime, new Date().toISOString(), meetingId]
    );
  }

  getMeetingByIdSync(meetingId) {
    // Synchronous version for page unload
    return this.db.prepare('SELECT * FROM meetings WHERE id = ?').get(meetingId);
  }

  async uploadAttachment(meetingId, fileInfo) {
    try {
      // Get meeting info to determine folder structure
      const meeting = await this.getMeetingById(meetingId);
      if (!meeting) {
        throw new Error('Meeting not found');
      }

      // Create attachment directory structure
      const userDataPath = app.getPath('userData');
      const today = dateOverride.today();
      const attachmentsDir = path.join(userDataPath, 'assets', today, meeting.folder_name, 'attachments');
      await fs.ensureDir(attachmentsDir);

      // Generate unique filename
      const timestamp = new Date().getTime();
      const ext = path.extname(fileInfo.name);
      const baseName = path.basename(fileInfo.name, ext);
      const uniqueFilename = `${baseName}-${timestamp}${ext}`;
      const targetPath = path.join(attachmentsDir, uniqueFilename);

      // Copy file to attachments directory
      await fs.copy(fileInfo.path, targetPath);

      // Add to database
      await this.run(
        'INSERT INTO attachments (meeting_id, filename, original_name) VALUES (?, ?, ?)',
        [meetingId, uniqueFilename, fileInfo.name]
      );

      return { filename: uniqueFilename, path: targetPath };
    } catch (error) {
      console.error('Error uploading attachment:', error);
      throw error;
    }
  }

  async openAttachment(meetingId, filename) {
    try {
      // Get meeting info
      const meeting = await this.getMeetingById(meetingId);
      if (!meeting) {
        throw new Error('Meeting not found');
      }

      // Get attachment info
      const attachment = await this.get(
        'SELECT * FROM attachments WHERE meeting_id = ? AND filename = ?',
        [meetingId, filename]
      );

      if (!attachment) {
        throw new Error('Attachment not found');
      }

      // Find file path
      const userDataPath = app.getPath('userData');
      const today = dateOverride.today();
      const filePath = path.join(userDataPath, 'assets', today, meeting.folder_name, 'attachments', filename);

      if (!await fs.pathExists(filePath)) {
        throw new Error('File not found on disk');
      }

      // Open file in default app
      await shell.openPath(filePath);

      return { path: filePath, originalName: attachment.original_name };
    } catch (error) {
      console.error('Error opening attachment:', error);
      throw error;
    }
  }

  async getAttachmentInfo(meetingId, filename) {
    try {
      // Get meeting info
      const meeting = await this.getMeetingById(meetingId);
      if (!meeting) {
        throw new Error('Meeting not found');
      }

      // Find file path
      const userDataPath = app.getPath('userData');
      const today = dateOverride.today();
      const filePath = path.join(userDataPath, 'assets', today, meeting.folder_name, 'attachments', filename);

      if (!await fs.pathExists(filePath)) {
        return { size: 0 };
      }

      // Get file stats
      const stats = await fs.stat(filePath);
      return { size: stats.size };
    } catch (error) {
      console.error('Error getting attachment info:', error);
      return { size: 0 };
    }
  }

  async removeAttachment(meetingId, filename) {
    try {
      // Get meeting info
      const meeting = await this.getMeetingById(meetingId);
      if (!meeting) {
        throw new Error('Meeting not found');
      }

      // Remove from database
      await this.run(
        'DELETE FROM attachments WHERE meeting_id = ? AND filename = ?',
        [meetingId, filename]
      );

      // Remove file from disk
      const userDataPath = app.getPath('userData');
      const today = dateOverride.today();
      const filePath = path.join(userDataPath, 'assets', today, meeting.folder_name, 'attachments', filename);

      if (await fs.pathExists(filePath)) {
        await fs.remove(filePath);
      }

      return { success: true };
    } catch (error) {
      console.error('Error removing attachment:', error);
      throw error;
    }
  }

  async exportMeetingNotesAsMarkdown(meetingId) {
    try {
      // Get meeting data
      const meeting = await this.getMeetingById(meetingId);
      if (!meeting) {
        throw new Error('Meeting not found');
      }

      // Generate markdown content
      const markdownContent = generateMarkdownDocument(meeting);

      // Determine file path (alongside audio recordings in project assets)
      const projectRoot = path.dirname(__dirname); // Go up from src/ to project root
      const dateStr = meeting.start_time.split('T')[0];
      const meetingDir = path.join(projectRoot, 'assets', dateStr, meeting.folder_name);
      await fs.ensureDir(meetingDir);

      // Create filename
      const filename = `${meeting.folder_name}-notes.md`;
      const filePath = path.join(meetingDir, filename);

      // Write markdown file
      await fs.writeFile(filePath, markdownContent, 'utf8');

      return { 
        success: true, 
        filePath,
        filename,
        content: markdownContent
      };
    } catch (error) {
      console.error('Error exporting meeting notes as markdown:', error);
      throw error;
    }
  }

  async checkIfNotesChanged(meetingId, currentNotesContent) {
    try {
      const meeting = await this.getMeetingById(meetingId);
      if (!meeting) {
        return true; // Consider changed if meeting not found
      }

      // Compare stored notes with current notes
      return meeting.notes_content !== currentNotesContent;
    } catch (error) {
      console.error('Error checking if notes changed:', error);
      return true; // Consider changed on error
    }
  }

  async deleteMeetingMarkdownExport(meetingId) {
    try {
      const meeting = await this.getMeetingById(meetingId);
      if (!meeting) {
        return { success: false, error: 'Meeting not found' };
      }

      // Determine file path (same as audio recordings)
      const projectRoot = path.dirname(__dirname); // Go up from src/ to project root
      const dateStr = meeting.start_time.split('T')[0];
      const filename = `${meeting.folder_name}-notes.md`;
      const filePath = path.join(projectRoot, 'assets', dateStr, meeting.folder_name, filename);

      // Check if file exists and delete it
      if (await fs.pathExists(filePath)) {
        await fs.remove(filePath);
        return { success: true, deleted: true };
      }

      return { success: true, deleted: false };
    } catch (error) {
      console.error('Error deleting markdown export:', error);
      return { success: false, error: error.message };
    }
  }

  async close() {
    return new Promise((resolve) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) {
            console.error('Error closing database:', err);
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  // Upload status management methods
  async setMeetingUploadStatus(meetingId, status, gdriveFileId = null) {
    try {
      const updateData = [status];
      let sql = 'UPDATE meetings SET upload_status = ?';
      
      if (status === 'completed') {
        sql += ', uploaded_at = ?, gdrive_folder_id = ?';
        updateData.push(new Date().toISOString(), gdriveFileId);
      }
      
      sql += ' WHERE id = ?';
      updateData.push(meetingId);
      
      await this.run(sql, updateData);
      return { success: true };
    } catch (error) {
      console.error('Error updating meeting upload status:', error);
      throw error;
    }
  }

  async getMeetingUploadStatus(meetingId) {
    try {
      const meeting = await this.get(
        'SELECT upload_status, uploaded_at, gdrive_folder_id FROM meetings WHERE id = ?',
        [meetingId]
      );
      return meeting || { upload_status: 'pending', uploaded_at: null, gdrive_folder_id: null };
    } catch (error) {
      console.error('Error getting meeting upload status:', error);
      throw error;
    }
  }

  async getPendingUploads() {
    try {
      const meetings = await this.all(
        "SELECT id, title, folder_name FROM meetings WHERE upload_status IN ('pending', 'failed')"
      );
      return meetings;
    } catch (error) {
      console.error('Error getting pending uploads:', error);
      throw error;
    }
  }

  async getMeetingRecordings(meetingId) {
    try {
      // First check all recordings for this meeting
      const allRecordings = await this.all(
        'SELECT * FROM recording_sessions WHERE meeting_id = ?',
        [meetingId]
      );
      console.log(`🔍 All recordings for meeting ${meetingId}:`, allRecordings.length);
      allRecordings.forEach(r => {
        console.log(`  - Session ${r.id}: completed=${r.completed}, final_path=${r.final_path}`);
      });
      
      const recordings = await this.all(
        'SELECT final_path, started_at, duration FROM recording_sessions WHERE meeting_id = ? AND completed = 1',
        [meetingId]
      );
      console.log(`✅ Completed recordings for meeting ${meetingId}:`, recordings.length);
      return recordings;
    } catch (error) {
      console.error('Error getting meeting recordings:', error);
      throw error;
    }
  }

  async getAllMeetingsWithUploadStatus() {
    try {
      const meetings = await this.all(`
        SELECT m.*, 
               COUNT(rs.id) as recording_count
        FROM meetings m
        LEFT JOIN recording_sessions rs ON m.id = rs.meeting_id AND rs.completed = 1
        WHERE date(m.start_time) = date(?)
        GROUP BY m.id
        ORDER BY m.start_time ASC
      `, [dateOverride.today()]);
      return meetings;
    } catch (error) {
      console.error('Error getting meetings with upload status:', error);
      throw error;
    }
  }

  async getParticipantSuggestions(searchTerm = '') {
    try {
      // Get all participants from all meetings
      const meetings = await this.all('SELECT participants FROM meetings WHERE participants IS NOT NULL');
      
      // Count frequency of each email
      const emailFrequency = {};
      meetings.forEach(meeting => {
        try {
          const participants = JSON.parse(meeting.participants);
          participants.forEach(email => {
            if (email && typeof email === 'string') {
              emailFrequency[email] = (emailFrequency[email] || 0) + 1;
            }
          });
        } catch (e) {
          console.error('Error parsing participants:', e);
        }
      });

      // Filter by search term (case-insensitive)
      const filtered = Object.entries(emailFrequency)
        .filter(([email]) => email.toLowerCase().startsWith(searchTerm.toLowerCase()))
        .sort((a, b) => b[1] - a[1]) // Sort by frequency descending
        .slice(0, 10) // Top 10 results
        .map(([email, frequency]) => ({ email, frequency }));

      return filtered;
    } catch (error) {
      console.error('Error getting participant suggestions:', error);
      return [];
    }
  }

  async deleteMeeting(meetingId) {
    try {
      // Delete related records first (due to foreign key constraints)
      await this.run('DELETE FROM recording_sessions WHERE meeting_id = ?', [meetingId]);
      await this.run('DELETE FROM attachments WHERE meeting_id = ?', [meetingId]);
      
      // Delete the meeting itself
      const result = await this.run('DELETE FROM meetings WHERE id = ?', [meetingId]);
      
      if (result.changes === 0) {
        throw new Error('Meeting not found or already deleted');
      }
      
      console.log(`🗑️ Database: Deleted meeting ${meetingId} and ${result.changes} related records`);
      return { success: true };
    } catch (error) {
      console.error('Error deleting meeting from database:', error);
      throw error;
    }
  }

  async deleteMeetingFiles(meetingId) {
    try {
      const meeting = await this.getMeetingById(meetingId);
      if (!meeting) {
        return { success: false, error: 'Meeting not found' };
      }

      const projectRoot = path.dirname(__dirname); // Go up from src/ to project root
      const dateStr = meeting.start_time.split('T')[0];
      const meetingDir = path.join(projectRoot, 'assets', dateStr, meeting.folder_name);

      let deletedFiles = [];
      let errors = [];

      // Check if meeting directory exists
      if (await fs.pathExists(meetingDir)) {
        try {
          // Get list of files before deletion for logging
          const files = await fs.readdir(meetingDir);
          deletedFiles = files;
          
          // Delete the entire meeting directory
          await fs.remove(meetingDir);
          console.log(`🗑️ Files: Deleted meeting directory: ${meetingDir}`);
          console.log(`📁 Deleted files: ${files.join(', ')}`);
        } catch (error) {
          errors.push(`Failed to delete directory ${meetingDir}: ${error.message}`);
        }
      } else {
        console.log(`⚠️ Meeting directory not found: ${meetingDir}`);
      }

      return {
        success: errors.length === 0,
        deletedFiles,
        errors: errors.length > 0 ? errors.join('; ') : null
      };
    } catch (error) {
      console.error('Error deleting meeting files:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = Database;