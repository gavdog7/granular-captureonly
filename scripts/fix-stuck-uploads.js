#!/usr/bin/env node

const path = require('path');
const fs = require('fs-extra');
const sqlite3 = require('sqlite3').verbose();

class StuckUploadFixer {
  constructor() {
    this.projectRoot = path.join(__dirname, '..');
  }

  async initialize() {
    const os = require('os');
    const dbPath = path.join(os.homedir(), 'Library/Application Support/Electron/granular-captureonly.db');
    
    if (!await fs.pathExists(dbPath)) {
      throw new Error(`Database not found at ${dbPath}`);
    }
    
    this.db = new sqlite3.Database(dbPath);
    console.log('🔧 Stuck Upload Fixer initialized');
  }

  async query(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  async run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  async fixStuckUploads() {
    console.log('\n🔧 Checking for stuck uploads...');
    
    // Find meetings stuck in 'uploading' state for more than 30 minutes
    const stuckUploads = await this.query(`
      SELECT 
        m.id,
        m.title,
        m.folder_name,
        m.start_time,
        m.upload_status,
        m.updated_at
      FROM meetings m
      WHERE m.upload_status = 'uploading'
      AND datetime(m.updated_at) < datetime('now', '-30 minutes')
    `);

    if (stuckUploads.length === 0) {
      console.log('✅ No stuck uploads found');
      return;
    }

    console.log(`🔧 Found ${stuckUploads.length} stuck uploads, resetting to pending:`);
    
    for (const meeting of stuckUploads) {
      console.log(`  - ${meeting.folder_name} (stuck since ${meeting.updated_at})`);
      
      // Reset to pending status
      await this.run(
        'UPDATE meetings SET upload_status = ?, updated_at = datetime("now") WHERE id = ?',
        ['pending', meeting.id]
      );
      
      console.log(`  ✅ Reset ${meeting.folder_name} to pending status`);
    }

    return stuckUploads.length;
  }

  async fixPendingUploads() {
    console.log('\n⏳ Checking pending uploads...');
    
    const pendingUploads = await this.query(`
      SELECT 
        m.id,
        m.title,
        m.folder_name,
        m.start_time,
        m.upload_status,
        COUNT(rs.id) as recording_count,
        SUM(CASE WHEN rs.completed = 1 THEN 1 ELSE 0 END) as completed_recordings
      FROM meetings m
      LEFT JOIN recording_sessions rs ON m.id = rs.meeting_id
      WHERE m.upload_status = 'pending'
      GROUP BY m.id
      ORDER BY m.start_time DESC
    `);

    console.log(`📋 Found ${pendingUploads.length} pending uploads:`);
    
    pendingUploads.forEach(meeting => {
      console.log(`  - ${meeting.folder_name}`);
      console.log(`    Date: ${meeting.start_time}`);
      console.log(`    Recordings: ${meeting.completed_recordings || 0}`);
      
      // Check if markdown exists
      const dateStr = meeting.start_time.split('T')[0];
      const markdownPath = path.join(
        this.projectRoot,
        'assets',
        dateStr,
        meeting.folder_name,
        `${meeting.folder_name}-notes.md`
      );
      
      const markdownExists = fs.existsSync(markdownPath);
      console.log(`    Markdown: ${markdownExists ? '✅' : '❌'}`);
      console.log('');
    });

    return pendingUploads;
  }

  async close() {
    if (this.db) {
      await new Promise((resolve) => {
        this.db.close(resolve);
      });
    }
  }

  async run() {
    try {
      await this.initialize();
      
      const stuckCount = await this.fixStuckUploads();
      const pendingUploads = await this.fixPendingUploads();
      
      console.log('\n📊 === SUMMARY ===');
      console.log(`🔧 Fixed stuck uploads: ${stuckCount}`);
      console.log(`⏳ Pending uploads found: ${pendingUploads.length}`);
      
      if (stuckCount > 0 || pendingUploads.length > 0) {
        console.log('\n📝 Next steps:');
        console.log('1. Restart the main application');
        console.log('2. The health checker will automatically process these uploads');
        console.log('3. Check the upload status again in a few minutes');
      }
      
    } catch (error) {
      console.error('❌ Error:', error.message);
    } finally {
      await this.close();
    }
  }
}

// Run the fixer
if (require.main === module) {
  const fixer = new StuckUploadFixer();
  fixer.run().catch(console.error);
}

module.exports = { StuckUploadFixer };