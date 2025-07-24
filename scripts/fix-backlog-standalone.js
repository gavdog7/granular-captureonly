#!/usr/bin/env node

const path = require('path');
const fs = require('fs-extra');
const sqlite3 = require('sqlite3').verbose();
const { generateMarkdownDocument } = require('../src/quill-to-markdown');

class StandaloneBacklogFixer {
  constructor() {
    this.projectRoot = path.join(__dirname, '..');
    this.stats = {
      markdownRegenerated: 0,
      errors: []
    };
  }

  async initialize() {
    // Get database path from Electron user data location
    const os = require('os');
    const dbPath = path.join(os.homedir(), 'Library/Application Support/Electron/granular-captureonly.db');
    
    if (!await fs.pathExists(dbPath)) {
      throw new Error(`Database not found at ${dbPath}. Please run the app at least once to create the database.`);
    }
    
    this.db = new sqlite3.Database(dbPath);
    console.log('🚀 Standalone Backlog Fixer initialized');
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

  async findProblematicMeetings() {
    console.log('\n📋 Finding meetings with missing markdown files...');
    
    // Get all meetings with notes content but missing markdown
    const meetings = await this.query(`
      SELECT m.* 
      FROM meetings m
      WHERE m.notes_content IS NOT NULL 
      AND m.notes_content != ''
      AND m.notes_content != '[]'
      ORDER BY m.start_time DESC
    `);

    const problematicMeetings = [];

    for (const meeting of meetings) {
      const markdownPath = this.getMarkdownPath(meeting);
      const markdownExists = await fs.pathExists(markdownPath);
      
      if (!markdownExists) {
        problematicMeetings.push(meeting);
        console.log(`  ❌ Missing markdown: ${meeting.folder_name} (${meeting.start_time})`);
      }
    }

    console.log(`\n📊 Found ${problematicMeetings.length} meetings with missing markdown files`);
    return problematicMeetings;
  }

  getMarkdownPath(meeting) {
    const dateStr = meeting.start_time.split('T')[0];
    return path.join(
      this.projectRoot,
      'assets',
      dateStr,
      meeting.folder_name,
      `${meeting.folder_name}-notes.md`
    );
  }

  async regenerateMarkdown(meeting) {
    try {
      const markdownPath = this.getMarkdownPath(meeting);
      const dir = path.dirname(markdownPath);
      
      // Ensure directory exists
      await fs.ensureDir(dir);

      // Parse notes content
      let notesContent;
      try {
        notesContent = JSON.parse(meeting.notes_content);
      } catch (error) {
        console.error(`  ⚠️  Failed to parse notes for ${meeting.folder_name}:`, error.message);
        this.stats.errors.push({ meeting: meeting.folder_name, error: 'Invalid notes JSON' });
        return false;
      }

      // Convert to markdown
      const markdownContent = generateMarkdownDocument(notesContent);
      
      // Write markdown file
      await fs.writeFile(markdownPath, markdownContent);
      
      // Update database to mark as exported
      await this.run(
        'UPDATE meetings SET markdown_exported = 1 WHERE id = ?',
        [meeting.id]
      );
      
      console.log(`  ✅ Regenerated markdown: ${meeting.folder_name}`);
      this.stats.markdownRegenerated++;
      return true;
    } catch (error) {
      console.error(`  ❌ Error regenerating markdown for ${meeting.folder_name}:`, error.message);
      this.stats.errors.push({ meeting: meeting.folder_name, error: error.message });
      return false;
    }
  }

  async generateReport() {
    console.log('\n📊 === BACKLOG FIX REPORT ===');
    console.log(`✅ Markdown files regenerated: ${this.stats.markdownRegenerated}`);
    
    if (this.stats.errors.length > 0) {
      console.log(`\n❌ Errors encountered (${this.stats.errors.length}):`);
      this.stats.errors.forEach(err => {
        console.log(`  - ${err.meeting}: ${err.error}`);
      });
    }
    
    console.log('\n✨ Markdown regeneration complete!');
    console.log('\n📝 Next steps:');
    console.log('1. Restart the main application');
    console.log('2. The health checker will automatically detect and queue these meetings for upload');
    console.log('3. Or manually trigger uploads through the UI');
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
      
      // Regenerate missing markdown files
      console.log('\n=== REGENERATING MISSING MARKDOWN FILES ===');
      const problematicMeetings = await this.findProblematicMeetings();
      
      for (const meeting of problematicMeetings) {
        await this.regenerateMarkdown(meeting);
      }
      
      // Generate report
      await this.generateReport();
      
    } catch (error) {
      console.error('❌ Fatal error:', error.message);
      process.exit(1);
    } finally {
      await this.close();
    }
  }
}

// Run the fixer
if (require.main === module) {
  const fixer = new StandaloneBacklogFixer();
  fixer.run().catch(console.error);
}

module.exports = { StandaloneBacklogFixer };