const fs = require('fs-extra');
const path = require('path');
const { getLocalDateString } = require('./utils/date-utils');

class FolderReconciliationService {
  constructor(database, uploadService) {
    this.database = database;
    this.uploadService = uploadService;
    this.isRunning = false;
    this.interval = null;
  }

  async initialize() {
    console.log('🔧 Initializing Folder Reconciliation Service');
    // Run immediately on startup
    await this.runReconciliation();

    // Then run every 5 minutes
    this.interval = setInterval(() => {
      this.runReconciliation();
    }, 5 * 60 * 1000);
  }

  async shutdown() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async runReconciliation() {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    console.log('🔍 Starting folder reconciliation...');

    try {
      const orphanedRecordings = await this.findOrphanedRecordings();
      console.log(`Found ${orphanedRecordings.length} potentially orphaned recordings`);

      for (const orphan of orphanedRecordings) {
        await this.attemptReconciliation(orphan);
      }

      const fixedMeetings = await this.fixMismatchedPaths();
      console.log(`Fixed ${fixedMeetings.length} meetings with path mismatches`);

    } catch (error) {
      console.error('Error during folder reconciliation:', error);
    } finally {
      this.isRunning = false;
      console.log('✅ Folder reconciliation completed');
    }
  }

  async findOrphanedRecordings() {
    const orphaned = [];
    const projectRoot = path.dirname(__dirname);
    const assetsPath = path.join(projectRoot, 'assets');

    try {
      if (!await fs.pathExists(assetsPath)) {
        return orphaned;
      }

      const dateDirs = await fs.readdir(assetsPath);

      for (const dateDir of dateDirs) {
        if (!dateDir.match(/^\d{4}-\d{2}-\d{2}$/)) continue;

        const datePath = path.join(assetsPath, dateDir);
        if (!(await fs.stat(datePath)).isDirectory()) continue;

        const subdirs = await fs.readdir(datePath);

        for (const subdir of subdirs) {
          const subdirPath = path.join(datePath, subdir);
          if (!(await fs.stat(subdirPath)).isDirectory()) continue;

          const files = await fs.readdir(subdirPath);
          const recordings = files.filter(file =>
            file.includes('recording-') &&
            file.includes('-session') &&
            file.endsWith('.opus')
          );

          for (const recording of recordings) {
            const sessionMatch = recording.match(/session(\d+)/);
            if (sessionMatch) {
              const sessionId = parseInt(sessionMatch[1]);

              // Check if this recording is in the expected location
              const recordingSession = await this.database.getRecordingSession(sessionId);
              if (recordingSession) {
                const expectedPath = recordingSession.final_path;
                const actualPath = path.join(subdirPath, recording);

                if (expectedPath !== actualPath) {
                  orphaned.push({
                    sessionId,
                    meetingId: recordingSession.meeting_id,
                    actualPath,
                    expectedPath,
                    dateDir,
                    actualFolder: subdir,
                    filename: recording
                  });
                }
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Error finding orphaned recordings:', error);
    }

    return orphaned;
  }

  async attemptReconciliation(orphan) {
    try {
      console.log(`🔧 Attempting reconciliation for session ${orphan.sessionId}`);

      // Get meeting details
      const meeting = await this.database.getMeetingById(orphan.meetingId);
      if (!meeting) {
        console.warn(`Meeting ${orphan.meetingId} not found for session ${orphan.sessionId}`);
        return;
      }

      // Option 1: Move file to expected location
      const expectedDir = path.dirname(orphan.expectedPath);
      if (await fs.pathExists(expectedDir)) {
        console.log(`📁 Moving ${orphan.filename} to expected location: ${expectedDir}`);
        await fs.move(orphan.actualPath, orphan.expectedPath);
        console.log(`✅ Moved recording to expected location`);

        // Re-queue for upload if needed
        if (meeting.upload_status === 'pending' || meeting.upload_status === 'failed') {
          await this.uploadService.queueMeetingUpload(orphan.meetingId);
        }
        return;
      }

      // Option 2: Update database to match actual location
      console.log(`📝 Updating database to reflect actual location: ${orphan.actualPath}`);
      await this.database.updateRecordingPath(orphan.sessionId, orphan.actualPath);

      // Update meeting folder name if it makes sense
      if (orphan.actualFolder !== meeting.folder_name) {
        console.log(`📝 Updating meeting folder name from ${meeting.folder_name} to ${orphan.actualFolder}`);
        await this.database.updateMeetingFolderName(orphan.meetingId, orphan.actualFolder);
      }

      // Re-queue for upload if needed
      if (meeting.upload_status === 'pending' || meeting.upload_status === 'failed') {
        await this.uploadService.queueMeetingUpload(orphan.meetingId);
      }

      console.log(`✅ Reconciled session ${orphan.sessionId}`);

    } catch (error) {
      console.error(`Error reconciling session ${orphan.sessionId}:`, error);
    }
  }

  async fixMismatchedPaths() {
    const fixed = [];

    try {
      // Find meetings marked as completed but missing files
      const completedMeetings = await this.database.getMeetingsByUploadStatus('completed');

      for (const meeting of completedMeetings) {
        const validation = await this.uploadService.validateMeetingContent(meeting.id, meeting);

        if (validation.issues.length > 0 || (!validation.hasNotes && !validation.hasRecordings)) {
          console.log(`🔧 Re-evaluating completed meeting ${meeting.id} due to validation issues`);

          if (validation.hasNotes || validation.hasRecordings) {
            // Has content but was mislocated - re-queue
            await this.database.setMeetingUploadStatus(meeting.id, 'pending');
            await this.uploadService.queueMeetingUpload(meeting.id);
            fixed.push(meeting.id);
            console.log(`✅ Re-queued meeting ${meeting.id} for upload`);
          } else {
            // Truly no content
            await this.database.setMeetingUploadStatus(meeting.id, 'no_content');
            console.log(`📝 Marked meeting ${meeting.id} as no_content`);
          }
        }
      }
    } catch (error) {
      console.error('Error fixing mismatched paths:', error);
    }

    return fixed;
  }
}

module.exports = FolderReconciliationService;