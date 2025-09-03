#!/usr/bin/env node

const path = require('path');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs-extra');

async function fixOrphanedMeeting() {
  const dbPath = path.join(os.homedir(), 'Library/Application Support/Electron/granular-captureonly.db');
  const db = new sqlite3.Database(dbPath);
  
  console.log('🔧 Fixing orphaned bavesh-gavin meeting...\n');
  
  const folderPath = '/Users/gavinedgley/Desktop/granular-captureonly/assets/2025-09-03/bavesh-gavin';
  
  // Read the markdown file to get meeting details
  const notesPath = path.join(folderPath, 'bavesh-gavin-notes.md');
  const notesContent = await fs.readFile(notesPath, 'utf8');
  
  console.log('📝 Found notes content:', notesContent.substring(0, 200) + '...');
  
  // Extract details from markdown frontmatter
  const lines = notesContent.split('\n');
  let title = 'Bavesh & Gavin';
  let startTime = '2025-09-03T14:07:39.847Z'; // Default from file timestamps
  
  // Parse frontmatter
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('title:')) {
      title = lines[i].replace('title:', '').replace(/"/g, '').trim();
    }
    if (lines[i].startsWith('start_time:')) {
      const timeStr = lines[i].replace('start_time:', '').trim();
      // Convert "9/3/2025, 9:07:39 AM" to ISO
      const date = new Date(timeStr);
      if (!isNaN(date.getTime())) {
        startTime = date.toISOString();
      }
    }
  }
  
  console.log('📋 Meeting details:');
  console.log('  Title:', title);
  console.log('  Start time:', startTime);
  console.log('  Folder name: bavesh-gavin');
  
  // Insert meeting into database
  const result = await new Promise((resolve, reject) => {
    db.run(`
      INSERT INTO meetings (
        title, 
        folder_name, 
        start_time, 
        end_time,
        participants,
        notes_content,
        upload_status,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
    `, [
      title,
      'bavesh-gavin',
      startTime,
      startTime, // Use same for end time since we don't have it
      JSON.stringify(['bavesh.patel@databricks.com']),
      notesContent,
    ], function(err) {
      if (err) reject(err);
      else resolve(this.lastID);
    });
  });
  
  console.log('✅ Added meeting to database with ID:', result);
  
  // Add recording sessions to database
  const files = await fs.readdir(folderPath);
  const recordingFiles = files.filter(f => f.endsWith('.opus'));
  
  for (const recordingFile of recordingFiles) {
    const recordingPath = path.join(folderPath, recordingFile);
    const stats = await fs.stat(recordingPath);
    
    // Extract session ID from filename: recording-2025-09-03-14-07-40-144Z-session355.opus
    const sessionMatch = recordingFile.match(/session(\d+)/);
    const sessionId = sessionMatch ? parseInt(sessionMatch[1]) : Math.floor(Math.random() * 1000000);
    
    await new Promise((resolve, reject) => {
      db.run(`
        INSERT INTO recording_sessions (
          id,
          meeting_id,
          final_path,
          started_at,
          ended_at,
          completed
        ) VALUES (?, ?, ?, ?, ?, 1)
      `, [
        sessionId,
        result,
        recordingPath,
        startTime,
        startTime
      ], err => err ? reject(err) : resolve());
    });
    
    console.log('🎙️  Added recording session:', recordingFile);
  }
  
  // Add to upload queue
  await new Promise((resolve, reject) => {
    db.run(`
      INSERT INTO upload_queue (meeting_id, status, created_at, attempts)
      VALUES (?, 'pending', datetime('now'), 0)
    `, [result], err => err ? reject(err) : resolve());
  });
  
  console.log('📤 Added to upload queue');
  console.log('\n✅ Orphaned meeting fixed and ready for upload!');
  
  db.close();
}

fixOrphanedMeeting().catch(console.error);