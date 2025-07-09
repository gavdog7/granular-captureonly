const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs-extra');
const { app } = require('electron');

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
      this.db.exec(createTablesSQL, (err) => {
        if (err) {
          console.error('Error creating tables:', err);
          reject(err);
        } else {
          console.log('Database tables created successfully');
          resolve();
        }
      });
    });
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
    const today = new Date().toISOString().split('T')[0];
    return this.all(
      'SELECT * FROM meetings WHERE date(start_time) = date(?) ORDER BY start_time',
      [today]
    );
  }

  async upsertMeeting(meeting) {
    return this.run(`
      INSERT OR REPLACE INTO meetings (title, folder_name, start_time, end_time, participants, updated_at)
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
}

module.exports = Database;