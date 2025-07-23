#!/usr/bin/env node

const path = require('path');
const fs = require('fs-extra');
const { Database } = require('../src/database');
const { convertDeltaToMarkdown } = require('../src/quill-to-markdown');
const { UploadService } = require('../src/upload-service');
const { connectToGoogleDrive } = require('../src/google-drive');

class BacklogUploadFixer {
  constructor() {
    this.database = new Database();
    this.projectRoot = path.join(__dirname, '..');
    this.stats = {
      markdownRegenerated: 0,
      uploadsQueued: 0,
      uploadsCompleted: 0,
      errors: []
    };
  }

  async initialize() {
    await this.database.initialize();
    const driveClient = await connectToGoogleDrive();
    this.uploadService = new UploadService(this.database, driveClient);
    console.log('🚀 Backlog Upload Fixer initialized');
  }

  async findProblematicMeetings() {
    console.log('\n📋 Finding meetings with missing markdown files...');
    
    // Get all meetings with notes content
    const meetings = await this.database.getAllMeetings();
    const problematicMeetings = [];

    for (const meeting of meetings) {
      if (!meeting.notes_content || meeting.notes_content === '[]') continue;

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
      const markdownContent = convertDeltaToMarkdown(notesContent);
      
      // Write markdown file
      await fs.writeFile(markdownPath, markdownContent);
      
      console.log(`  ✅ Regenerated markdown: ${meeting.folder_name}`);
      this.stats.markdownRegenerated++;
      return true;
    } catch (error) {
      console.error(`  ❌ Error regenerating markdown for ${meeting.folder_name}:`, error.message);
      this.stats.errors.push({ meeting: meeting.folder_name, error: error.message });
      return false;
    }
  }

  async findFailedUploads() {
    console.log('\n🔍 Finding meetings that failed to upload...');
    
    const meetings = await this.database.getAllMeetings();
    const failedUploads = [];

    for (const meeting of meetings) {
      // Check if meeting has recordings
      const recordings = await this.database.getMeetingRecordings(meeting.id);
      const hasCompletedRecordings = recordings.some(r => r.completed === 1);
      
      if (!hasCompletedRecordings) continue;

      // Check if files exist but upload failed
      const markdownPath = this.getMarkdownPath(meeting);
      const markdownExists = await fs.pathExists(markdownPath);
      
      // Check upload status
      const uploadStatus = meeting.upload_status;
      
      if (markdownExists && (!uploadStatus || uploadStatus === 'failed' || uploadStatus === 'no_content')) {
        failedUploads.push(meeting);
        console.log(`  📤 Need to upload: ${meeting.folder_name} (status: ${uploadStatus || 'never attempted'})`);
      }
    }

    console.log(`\n📊 Found ${failedUploads.length} meetings that need uploading`);
    return failedUploads;
  }

  async queueForUpload(meeting) {
    try {
      await this.uploadService.queueMeetingUpload(meeting.id);
      this.stats.uploadsQueued++;
      console.log(`  📥 Queued for upload: ${meeting.folder_name}`);
      return true;
    } catch (error) {
      console.error(`  ❌ Error queueing ${meeting.folder_name}:`, error.message);
      this.stats.errors.push({ meeting: meeting.folder_name, error: `Queue error: ${error.message}` });
      return false;
    }
  }

  async processUploadQueue() {
    console.log('\n🚀 Processing upload queue...');
    
    // Wait a bit for queue to be ready
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Check queue status periodically
    let attempts = 0;
    const maxAttempts = 60; // 5 minutes max
    
    while (attempts < maxAttempts) {
      const queueLength = this.uploadService.getQueueLength();
      
      if (queueLength === 0) {
        console.log('✅ Upload queue processed successfully!');
        break;
      }
      
      console.log(`  ⏳ Queue length: ${queueLength}, waiting...`);
      await new Promise(resolve => setTimeout(resolve, 5000)); // Check every 5 seconds
      attempts++;
    }
    
    if (attempts >= maxAttempts) {
      console.log('⚠️  Upload queue processing timed out');
    }
  }

  async generateReport() {
    console.log('\n📊 === BACKLOG FIX REPORT ===');
    console.log(`✅ Markdown files regenerated: ${this.stats.markdownRegenerated}`);
    console.log(`📤 Uploads queued: ${this.stats.uploadsQueued}`);
    
    if (this.stats.errors.length > 0) {
      console.log(`\n❌ Errors encountered (${this.stats.errors.length}):`);
      this.stats.errors.forEach(err => {
        console.log(`  - ${err.meeting}: ${err.error}`);
      });
    }
    
    console.log('\n✨ Backlog fix complete!');
  }

  async run() {
    try {
      await this.initialize();
      
      // Phase 1: Regenerate missing markdown files
      console.log('\n=== PHASE 1: REGENERATE MISSING MARKDOWN ===');
      const problematicMeetings = await this.findProblematicMeetings();
      
      for (const meeting of problematicMeetings) {
        await this.regenerateMarkdown(meeting);
      }
      
      // Phase 2: Queue failed uploads
      console.log('\n=== PHASE 2: QUEUE FAILED UPLOADS ===');
      const failedUploads = await this.findFailedUploads();
      
      for (const meeting of failedUploads) {
        await this.queueForUpload(meeting);
      }
      
      // Phase 3: Process upload queue
      console.log('\n=== PHASE 3: PROCESS UPLOAD QUEUE ===');
      if (this.stats.uploadsQueued > 0) {
        await this.processUploadQueue();
      }
      
      // Generate report
      await this.generateReport();
      
    } catch (error) {
      console.error('❌ Fatal error:', error);
      process.exit(1);
    }
  }
}

// Run the fixer
if (require.main === module) {
  const fixer = new BacklogUploadFixer();
  fixer.run().catch(console.error);
}

module.exports = { BacklogUploadFixer };