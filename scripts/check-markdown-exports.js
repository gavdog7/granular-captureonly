#!/usr/bin/env node

// Script to check for meetings and their markdown export status
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs-extra');
const os = require('os');

async function checkMarkdownExports() {
  console.log('🔍 Checking Markdown Export Status\n');
  console.log('='.repeat(50));

  // Open database
  const dbPath = path.join(os.homedir(), 'Library', 'Application Support', 'Electron', 'granular-captureonly.db');
  console.log(`📂 Database path: ${dbPath}`);
  
  if (!await fs.pathExists(dbPath)) {
    console.error('❌ Database file not found!');
    return;
  }

  const db = new sqlite3.Database(dbPath);
  const projectRoot = path.dirname(__dirname);
  
  // Get all meetings
  const meetings = await new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        m.id,
        m.title,
        m.folder_name,
        m.start_time,
        m.end_time,
        m.notes_content,
        m.participants
      FROM meetings m
      ORDER BY m.start_time DESC
      LIMIT 20
    `, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  console.log(`\n📊 Found ${meetings.length} meetings\n`);

  let totalMeetings = 0;
  let meetingsWithNotes = 0;
  let meetingsWithMarkdown = 0;
  let missingMarkdownFiles = [];

  for (const meeting of meetings) {
    totalMeetings++;
    const hasNotes = !!meeting.notes_content;
    if (hasNotes) meetingsWithNotes++;

    // Check for markdown file
    const dateStr = meeting.start_time.split('T')[0];
    const markdownPath = path.join(projectRoot, 'assets', dateStr, meeting.folder_name, `${meeting.folder_name}-notes.md`);
    const markdownExists = await fs.pathExists(markdownPath);
    if (markdownExists) meetingsWithMarkdown++;

    console.log(`\n📄 Meeting: ${meeting.title}`);
    console.log(`   ID: ${meeting.id}`);
    console.log(`   Time: ${new Date(meeting.start_time).toLocaleString()}`);
    console.log(`   Folder: ${meeting.folder_name}`);
    console.log(`   Has Notes: ${hasNotes ? '✅' : '❌'}`);
    
    if (hasNotes) {
      try {
        const notesContent = JSON.parse(meeting.notes_content);
        const noteLength = JSON.stringify(notesContent).length;
        console.log(`   Notes Length: ${noteLength} chars`);
        
        // Check if it's empty Delta
        if (notesContent.ops && notesContent.ops.length === 1 && notesContent.ops[0].insert === '\n') {
          console.log(`   Notes Status: ⚠️  Empty (only newline)`);
        } else {
          console.log(`   Notes Status: ✅ Has content`);
        }
      } catch (e) {
        console.log(`   Notes Status: ⚠️  Plain text (not Quill Delta)`);
      }
    }
    
    console.log(`   Markdown File: ${markdownExists ? '✅' : '❌'} ${markdownPath.replace(projectRoot, '.')}`);
    console.log(`   Markdown Path: ${markdownPath}`);

    if (hasNotes && !markdownExists) {
      missingMarkdownFiles.push({
        id: meeting.id,
        title: meeting.title,
        path: markdownPath
      });
    }

    // Check for audio files
    const meetingDir = path.join(projectRoot, 'assets', dateStr, meeting.folder_name);
    if (await fs.pathExists(meetingDir)) {
      const files = await fs.readdir(meetingDir);
      const audioFiles = files.filter(f => f.endsWith('.webm') || f.endsWith('.wav'));
      if (audioFiles.length > 0) {
        console.log(`   Audio Files: ${audioFiles.length} found`);
      }
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log('📊 SUMMARY:');
  console.log(`   Total Meetings: ${totalMeetings}`);
  console.log(`   Meetings with Notes: ${meetingsWithNotes} (${Math.round(meetingsWithNotes/totalMeetings*100)}%)`);
  console.log(`   Meetings with Markdown: ${meetingsWithMarkdown} (${Math.round(meetingsWithMarkdown/totalMeetings*100)}%)`);
  
  if (missingMarkdownFiles.length > 0) {
    console.log(`\n⚠️  Missing Markdown Files (${missingMarkdownFiles.length}):`);
    missingMarkdownFiles.forEach(m => {
      console.log(`   - Meeting ${m.id}: ${m.title}`);
    });
  }

  // Check for orphaned markdown files
  console.log('\n🔍 Checking for orphaned markdown files...');
  const assetsDir = path.join(projectRoot, 'assets');
  if (await fs.pathExists(assetsDir)) {
    const dates = await fs.readdir(assetsDir);
    let orphanedCount = 0;
    
    for (const date of dates) {
      const datePath = path.join(assetsDir, date);
      const stat = await fs.stat(datePath);
      if (stat.isDirectory()) {
        const folders = await fs.readdir(datePath);
        for (const folder of folders) {
          const folderPath = path.join(datePath, folder);
          const folderStat = await fs.stat(folderPath);
          if (folderStat.isDirectory()) {
            const markdownFile = path.join(folderPath, `${folder}-notes.md`);
            if (await fs.pathExists(markdownFile)) {
              // Check if this folder_name exists in database
              const meeting = meetings.find(m => m.folder_name === folder);
              if (!meeting) {
                console.log(`   ⚠️  Orphaned markdown: ${markdownFile.replace(projectRoot, '.')}`);
                orphanedCount++;
              }
            }
          }
        }
      }
    }
    
    if (orphanedCount === 0) {
      console.log('   ✅ No orphaned markdown files found');
    }
  }

  db.close();
}

// Run the check
checkMarkdownExports().catch(console.error);