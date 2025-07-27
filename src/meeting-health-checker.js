const path = require('path');
const fs = require('fs-extra');
const { generateMarkdownDocument } = require('./quill-to-markdown');

class MeetingHealthChecker {
  constructor(database, uploadService) {
    this.database = database;
    this.uploadService = uploadService;
    this.checkInterval = null;
    this.isChecking = false;
    this.projectRoot = path.dirname(__dirname);
  }

  start() {
    console.log('🏥 Starting Meeting Health Checker service');
    
    // Run initial check
    this.performHealthCheck();
    
    // Schedule periodic checks (every hour)
    this.checkInterval = setInterval(() => {
      this.performHealthCheck();
    }, 60 * 60 * 1000); // 1 hour
  }

  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    console.log('🏥 Meeting Health Checker service stopped');
  }

  async performHealthCheck() {
    if (this.isChecking) {
      console.log('🏥 Health check already in progress, skipping');
      return;
    }

    this.isChecking = true;
    console.log('🏥 Starting meeting health check...');

    try {
      // Check 1: Meetings with notes but missing markdown
      await this.checkMissingMarkdown();
      
      // Check 2: Meetings with recordings but failed uploads
      await this.checkFailedUploads();
      
      // Check 3: Orphaned recordings (recordings without meetings)
      await this.checkOrphanedRecordings();
      
      // Check 4: Meetings stuck in 'uploading' state
      await this.checkStuckUploads();
      
      console.log('🏥 Health check completed');
    } catch (error) {
      console.error('🏥 Error during health check:', error);
    } finally {
      this.isChecking = false;
    }
  }

  async checkMissingMarkdown() {
    try {
      console.log('🏥 Checking for meetings with missing markdown...');
      
      const meetingsNeedingMarkdown = await this.database.getMeetingsNeedingMarkdown();
      
      if (meetingsNeedingMarkdown.length === 0) {
        console.log('✅ All meetings have markdown files');
        return;
      }

      console.log(`📝 Found ${meetingsNeedingMarkdown.length} meetings needing markdown generation`);
      
      for (const meeting of meetingsNeedingMarkdown) {
        try {
          await this.regenerateMarkdown(meeting);
        } catch (error) {
          console.error(`❌ Failed to regenerate markdown for meeting ${meeting.id}:`, error);
        }
      }
    } catch (error) {
      console.error('Error checking missing markdown:', error);
    }
  }

  async regenerateMarkdown(meeting) {
    console.log(`📝 Regenerating markdown for meeting ${meeting.id} (${meeting.folder_name})`);
    
    try {
      // Parse notes content
      let notesContent;
      try {
        notesContent = JSON.parse(meeting.notes_content);
      } catch (error) {
        console.error(`Invalid notes JSON for meeting ${meeting.id}`);
        return false;
      }

      // Convert to markdown (needs full meeting object, not just notes)
      const markdownContent = generateMarkdownDocument(meeting);
      
      // Determine file path
      const dateStr = meeting.start_time.split('T')[0];
      const meetingDir = path.join(this.projectRoot, 'assets', dateStr, meeting.folder_name);
      const markdownPath = path.join(meetingDir, `${meeting.folder_name}-notes.md`);
      
      // Ensure directory exists
      await fs.ensureDir(meetingDir);
      
      // Write markdown file
      await fs.writeFile(markdownPath, markdownContent);
      
      // Update database
      await this.database.updateMarkdownExportStatus(meeting.id, 'success');
      
      console.log(`✅ Regenerated markdown for meeting ${meeting.id}`);
      
      // Queue for upload (markdown was just generated, so there's content to upload)
      await this.uploadService.queueMeetingUpload(meeting.id);
      console.log(`📤 Queued meeting ${meeting.id} for upload after markdown generation`);
      
      return true;
    } catch (error) {
      console.error(`Error regenerating markdown for meeting ${meeting.id}:`, error);
      await this.database.updateMarkdownExportStatus(meeting.id, 'failed', error.message);
      return false;
    }
  }

  async checkFailedUploads() {
    try {
      console.log('🏥 Checking for failed uploads...');
      
      const failedUploads = await this.database.all(`
        SELECT m.* 
        FROM meetings m
        WHERE m.upload_status = 'failed'
        AND m.uploaded_at < datetime('now', '-1 hour')
        ORDER BY m.start_time DESC
        LIMIT 10
      `);
      
      if (failedUploads.length === 0) {
        console.log('✅ No failed uploads to retry');
        return;
      }

      console.log(`🔄 Found ${failedUploads.length} failed uploads to retry`);
      
      for (const meeting of failedUploads) {
        console.log(`🔄 Retrying upload for meeting ${meeting.id} (${meeting.folder_name})`);
        await this.uploadService.queueMeetingUpload(meeting.id);
      }
    } catch (error) {
      console.error('Error checking failed uploads:', error);
    }
  }

  async checkOrphanedRecordings() {
    try {
      console.log('🏥 Checking for orphaned recordings...');
      
      const orphanedRecordings = await this.database.all(`
        SELECT rs.* 
        FROM recording_sessions rs
        LEFT JOIN meetings m ON rs.meeting_id = m.id
        WHERE m.id IS NULL
      `);
      
      if (orphanedRecordings.length === 0) {
        console.log('✅ No orphaned recordings found');
        return;
      }

      console.log(`⚠️  Found ${orphanedRecordings.length} orphaned recordings`);
      
      // Log for manual review - these might need cleanup
      for (const recording of orphanedRecordings) {
        console.log(`  - Recording ${recording.id}: ${recording.final_path || recording.temp_path}`);
      }
    } catch (error) {
      console.error('Error checking orphaned recordings:', error);
    }
  }

  async checkStuckUploads() {
    try {
      console.log('🏥 Checking for stuck uploads...');
      
      // Find meetings stuck in 'uploading' state for more than 30 minutes
      const stuckUploads = await this.database.all(`
        SELECT m.* 
        FROM meetings m
        WHERE m.upload_status = 'uploading'
        AND m.updated_at < datetime('now', '-30 minutes')
      `);
      
      if (stuckUploads.length === 0) {
        console.log('✅ No stuck uploads found');
        return;
      }

      console.log(`🔧 Found ${stuckUploads.length} stuck uploads, resetting to pending`);
      
      for (const meeting of stuckUploads) {
        console.log(`🔧 Resetting upload status for meeting ${meeting.id} (${meeting.folder_name})`);
        await this.database.setMeetingUploadStatus(meeting.id, 'pending');
        await this.uploadService.queueMeetingUpload(meeting.id);
      }
    } catch (error) {
      console.error('Error checking stuck uploads:', error);
    }
  }

  // Manual trigger for immediate health check
  async runImmediateCheck() {
    console.log('🏥 Running immediate health check...');
    await this.performHealthCheck();
  }
}

module.exports = { MeetingHealthChecker };