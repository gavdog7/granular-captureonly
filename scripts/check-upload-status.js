#!/usr/bin/env node

const path = require('path');
const fs = require('fs-extra');
const sqlite3 = require('sqlite3').verbose();

class UploadStatusChecker {
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
    console.log('🔍 Upload Status Checker initialized');
  }

  async query(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  async checkUploadStatuses() {
    console.log('\n📊 Checking upload statuses...');
    
    const uploadStats = await this.query(`
      SELECT 
        upload_status,
        COUNT(*) as count
      FROM meetings 
      WHERE upload_status IS NOT NULL
      GROUP BY upload_status
      ORDER BY count DESC
    `);

    console.log('\n📈 Upload Status Summary:');
    uploadStats.forEach(stat => {
      console.log(`  ${stat.upload_status}: ${stat.count} meetings`);
    });

    // Check meetings with recordings but upload issues
    const problematicMeetings = await this.query(`
      SELECT 
        m.id,
        m.title,
        m.folder_name,
        m.start_time,
        m.upload_status,
        m.uploaded_at,
        COUNT(rs.id) as recording_count,
        SUM(CASE WHEN rs.completed = 1 THEN 1 ELSE 0 END) as completed_recordings
      FROM meetings m
      LEFT JOIN recording_sessions rs ON m.id = rs.meeting_id
      WHERE (m.upload_status IS NULL 
             OR m.upload_status = 'pending' 
             OR m.upload_status = 'failed'
             OR m.upload_status = 'no_content')
      AND m.start_time >= date('now', '-7 days')
      GROUP BY m.id
      HAVING completed_recordings > 0
      ORDER BY m.start_time DESC
    `);

    console.log(`\n🚨 Found ${problematicMeetings.length} meetings from the last 7 days with recordings but upload issues:`);
    
    problematicMeetings.forEach(meeting => {
      console.log(`  - ${meeting.folder_name} (${meeting.start_time})`);
      console.log(`    Status: ${meeting.upload_status || 'NULL'}, Recordings: ${meeting.completed_recordings}`);
      
      // Check if markdown file exists
      const dateStr = meeting.start_time.split('T')[0];
      const markdownPath = path.join(
        this.projectRoot,
        'assets',
        dateStr,
        meeting.folder_name,
        `${meeting.folder_name}-notes.md`
      );
      
      const markdownExists = fs.existsSync(markdownPath);
      console.log(`    Markdown exists: ${markdownExists ? '✅' : '❌'}`);
      console.log('');
    });

    return problematicMeetings;
  }

  async checkRecentMeetings() {
    console.log('\n📅 Checking recent meetings from today and yesterday...');
    
    const recentMeetings = await this.query(`
      SELECT 
        m.id,
        m.title,
        m.folder_name,
        m.start_time,
        m.upload_status,
        m.notes_content IS NOT NULL as has_notes,
        COUNT(rs.id) as recording_count,
        SUM(CASE WHEN rs.completed = 1 THEN 1 ELSE 0 END) as completed_recordings
      FROM meetings m
      LEFT JOIN recording_sessions rs ON m.id = rs.meeting_id
      WHERE m.start_time >= date('now', '-2 days')
      GROUP BY m.id
      ORDER BY m.start_time DESC
    `);

    console.log(`\n📋 Recent meetings (${recentMeetings.length} total):`);
    
    recentMeetings.forEach(meeting => {
      const statusIcon = meeting.upload_status === 'completed' ? '✅' : 
                        meeting.upload_status === 'pending' ? '⏳' :
                        meeting.upload_status === 'failed' ? '❌' :
                        meeting.upload_status === 'no_content' ? '📝' : '❓';
      
      console.log(`  ${statusIcon} ${meeting.folder_name}`);
      console.log(`     Date: ${meeting.start_time}`);
      console.log(`     Status: ${meeting.upload_status || 'NULL'}`);
      console.log(`     Notes: ${meeting.has_notes ? 'Yes' : 'No'}, Recordings: ${meeting.completed_recordings || 0}`);
      console.log('');
    });
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
      await this.checkUploadStatuses();
      await this.checkRecentMeetings();
    } catch (error) {
      console.error('❌ Error:', error.message);
    } finally {
      await this.close();
    }
  }
}

// Run the checker
if (require.main === module) {
  const checker = new UploadStatusChecker();
  checker.run().catch(console.error);
}

module.exports = { UploadStatusChecker };