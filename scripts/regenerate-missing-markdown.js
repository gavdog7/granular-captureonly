#!/usr/bin/env node

// Script to regenerate missing markdown files for meetings that have notes
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const { generateMarkdownDocument } = require('../src/quill-to-markdown');

async function regenerateMissingMarkdown() {
  console.log('🔄 Regenerating Missing Markdown Files\n');
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
  
  // Get all meetings with notes
  const meetings = await new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        id,
        title,
        folder_name,
        start_time,
        end_time,
        notes_content,
        participants
      FROM meetings
      WHERE notes_content IS NOT NULL
      ORDER BY start_time DESC
    `, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  console.log(`\n📊 Found ${meetings.length} meetings with notes\n`);

  let regeneratedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const meeting of meetings) {
    const dateStr = meeting.start_time.split('T')[0];
    const meetingDir = path.join(projectRoot, 'assets', dateStr, meeting.folder_name);
    const markdownPath = path.join(meetingDir, `${meeting.folder_name}-notes.md`);
    
    // Check if markdown already exists
    if (await fs.pathExists(markdownPath)) {
      console.log(`✅ Markdown exists for: ${meeting.title}`);
      skippedCount++;
      continue;
    }

    // Check if meeting has actual content (not just empty Delta)
    let hasContent = false;
    try {
      const notesContent = JSON.parse(meeting.notes_content);
      if (notesContent.ops && notesContent.ops.length > 0) {
        // Check if it's not just a single newline
        hasContent = !(notesContent.ops.length === 1 && notesContent.ops[0].insert === '\n');
      }
    } catch (e) {
      // If it's plain text, check if it has content
      hasContent = meeting.notes_content && meeting.notes_content.trim().length > 0;
    }

    console.log(`\n📝 Meeting: ${meeting.title}`);
    console.log(`   ID: ${meeting.id}`);
    console.log(`   Folder: ${meeting.folder_name}`);
    console.log(`   Has Content: ${hasContent ? 'Yes' : 'No (empty)'}`);

    try {
      // Ensure directory exists
      await fs.ensureDir(meetingDir);
      
      // Generate markdown content
      const markdownContent = generateMarkdownDocument(meeting);
      
      // Write markdown file
      await fs.writeFile(markdownPath, markdownContent, 'utf8');
      
      console.log(`   ✅ Regenerated markdown at: ${markdownPath.replace(projectRoot, '.')}`);
      regeneratedCount++;
      
    } catch (error) {
      console.error(`   ❌ Error regenerating markdown: ${error.message}`);
      errorCount++;
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log('📊 REGENERATION SUMMARY:');
  console.log(`   Total meetings with notes: ${meetings.length}`);
  console.log(`   Markdown files regenerated: ${regeneratedCount}`);
  console.log(`   Skipped (already exist): ${skippedCount}`);
  console.log(`   Errors: ${errorCount}`);

  db.close();
}

// Run the regeneration
regenerateMissingMarkdown().catch(console.error);