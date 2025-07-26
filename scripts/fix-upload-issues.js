#!/usr/bin/env node

/**
 * Upload Recovery Script for Granular CaptureOnly
 * 
 * This script fixes common upload issues:
 * 1. Meetings with impossible upload timestamps
 * 2. False "no_content" meetings that have recordings or notes
 * 3. Queues all fixed meetings for upload
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const os = require('os');

const DB_PATH = path.join(os.homedir(), 'Library/Application Support/Electron/granular-captureonly.db');

class UploadRecovery {
  constructor() {
    this.db = null;
  }

  async initialize() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(DB_PATH, (err) => {
        if (err) {
          console.error('❌ Error opening database:', err);
          reject(err);
        } else {
          console.log('✅ Connected to database');
          resolve();
        }
      });
    });
  }

  async query(sql, params = []) {
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

  async run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes);
        }
      });
    });
  }

  async analyzeIssues() {
    console.log('🔍 Analyzing upload issues...\n');

    // Check impossible timestamps
    const impossibleUploads = await this.query(`
      SELECT COUNT(*) as count FROM meetings 
      WHERE upload_status = 'completed' AND datetime(uploaded_at) < datetime(start_time)
    `);
    console.log(`📅 Meetings with impossible timestamps: ${impossibleUploads[0].count}`);

    // Check false no-content with recordings
    const falseNoContentRecordings = await this.query(`
      SELECT COUNT(*) as count FROM meetings m 
      INNER JOIN recording_sessions r ON m.id = r.meeting_id 
      WHERE m.upload_status = 'no_content' AND r.completed = 1
    `);
    console.log(`🎵 False "no_content" with recordings: ${falseNoContentRecordings[0].count}`);

    // Check false no-content with notes
    const falseNoContentNotes = await this.query(`
      SELECT COUNT(*) as count FROM meetings 
      WHERE upload_status = 'no_content' 
      AND (notes_content IS NOT NULL AND notes_content != '' AND notes_content != '{}')
    `);
    console.log(`📝 False "no_content" with notes: ${falseNoContentNotes[0].count}`);

    // Check pending uploads
    const pendingUploads = await this.query(`
      SELECT COUNT(*) as count FROM meetings WHERE upload_status = 'pending'
    `);
    console.log(`⏳ Pending uploads: ${pendingUploads[0].count}`);

    // Check failed uploads
    const failedUploads = await this.query(`
      SELECT COUNT(*) as count FROM meetings WHERE upload_status = 'failed'
    `);
    console.log(`❌ Failed uploads: ${failedUploads[0].count}\n`);

    return {
      impossibleUploads: impossibleUploads[0].count,
      falseNoContentRecordings: falseNoContentRecordings[0].count,
      falseNoContentNotes: falseNoContentNotes[0].count,
      pendingUploads: pendingUploads[0].count,
      failedUploads: failedUploads[0].count
    };
  }

  async fixIssues() {
    console.log('🔧 Fixing upload issues...\n');

    // Fix 1: Impossible timestamps
    const impossibleFixed = await this.run(`
      UPDATE meetings 
      SET upload_status = 'pending', uploaded_at = NULL, gdrive_folder_id = NULL 
      WHERE upload_status = 'completed' AND datetime(uploaded_at) < datetime(start_time)
    `);
    console.log(`✅ Fixed ${impossibleFixed} meetings with impossible timestamps`);

    // Fix 2: False no-content with recordings
    const recordingsFixed = await this.run(`
      UPDATE meetings 
      SET upload_status = 'pending' 
      WHERE upload_status = 'no_content' 
      AND id IN (SELECT DISTINCT meeting_id FROM recording_sessions WHERE completed = 1)
    `);
    console.log(`✅ Fixed ${recordingsFixed} false "no_content" meetings with recordings`);

    // Fix 3: False no-content with notes
    const notesFixed = await this.run(`
      UPDATE meetings 
      SET upload_status = 'pending' 
      WHERE upload_status = 'no_content' 
      AND (notes_content IS NOT NULL AND notes_content != '' AND notes_content != '{}')
    `);
    console.log(`✅ Fixed ${notesFixed} false "no_content" meetings with notes`);

    console.log(`\n🎉 Total meetings fixed: ${impossibleFixed + recordingsFixed + notesFixed}`);

    return {
      impossibleFixed,
      recordingsFixed,
      notesFixed,
      totalFixed: impossibleFixed + recordingsFixed + notesFixed
    };
  }

  async showExamples() {
    console.log('\n📋 Examples of meetings that will be fixed:\n');

    // Show some examples of meetings to be fixed
    const examples = await this.query(`
      SELECT id, title, folder_name, upload_status, 
             substr(start_time, 1, 19) as start_time,
             substr(uploaded_at, 1, 19) as uploaded_at
      FROM meetings 
      WHERE (upload_status = 'completed' AND datetime(uploaded_at) < datetime(start_time))
         OR (upload_status = 'no_content' AND (
           notes_content IS NOT NULL AND notes_content != '' AND notes_content != '{}'
         ))
      LIMIT 10
    `);

    examples.forEach(meeting => {
      console.log(`📁 ${meeting.title} (${meeting.folder_name})`);
      console.log(`   Status: ${meeting.upload_status}, Start: ${meeting.start_time}, Uploaded: ${meeting.uploaded_at || 'null'}\n`);
    });
  }

  async close() {
    return new Promise((resolve) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) {
            console.error('Error closing database:', err);
          } else {
            console.log('✅ Database connection closed');
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

async function main() {
  const recovery = new UploadRecovery();
  
  try {
    await recovery.initialize();
    
    // Analyze current issues
    const issues = await recovery.analyzeIssues();
    
    if (issues.impossibleUploads === 0 && 
        issues.falseNoContentRecordings === 0 && 
        issues.falseNoContentNotes === 0) {
      console.log('🎉 No upload issues found! Everything looks good.');
      return;
    }

    // Show examples
    await recovery.showExamples();

    // Ask for confirmation (in a real scenario, you'd want user input)
    console.log('🚀 Proceeding with fixes...\n');

    // Apply fixes
    const results = await recovery.fixIssues();

    if (results.totalFixed > 0) {
      console.log('\n📤 These meetings are now queued for upload.');
      console.log('   Start the app to begin automatic uploading.');
    }

  } catch (error) {
    console.error('❌ Error during recovery:', error);
  } finally {
    await recovery.close();
  }
}

// Run the script
if (require.main === module) {
  main().catch(console.error);
}

module.exports = UploadRecovery;