# TASK-001: Upload Reliability Fix - Orphaned Recording Recovery

**Created**: 2025-10-08
**Status**: Pending Implementation
**Priority**: High

## Problem Statement

Recordings are not being uploaded to Google Drive when there's a mismatch between the database-expected file location and the actual file location. This occurs when:

1. Meeting folders are renamed after recording starts
2. Recording files are saved to different directories than expected
3. The upload service marks meetings as "completed" when only notes are uploaded, missing audio files

**Specific Issue**: Meeting 1289 recording was in `/bavesh/` folder but database expected it in `/new-meeting-1759872721861/`, causing upload failure.

## Root Cause Analysis

1. **Path Mismatch**: Database records one path, files stored in another
2. **Incomplete Validation**: Upload service doesn't verify all expected files before marking complete
3. **No Recovery Mechanism**: No automatic detection/correction of orphaned files
4. **Race Conditions**: Folder renaming after recording starts but before database update

## Implementation Plan

### Phase 1: Enhanced File Discovery (Week 1)

**File**: `src/upload-service.js`

#### 1.1 Session-Based Recording Discovery
```javascript
// Add to UploadService class
async findRecordingBySessionId(meetingId, dateStr, projectRoot) {
  const basePath = path.join(projectRoot, 'assets', dateStr);
  const pattern = `recording-*-session${meetingId}.opus`;

  // Search all subdirectories for this pattern
  const foundFiles = [];
  try {
    if (await fs.pathExists(basePath)) {
      const subdirs = await fs.readdir(basePath);
      for (const subdir of subdirs) {
        const subdirPath = path.join(basePath, subdir);
        if ((await fs.stat(subdirPath)).isDirectory()) {
          const files = await fs.readdir(subdirPath);
          const matchingFiles = files.filter(file =>
            file.includes(`session${meetingId}`) && file.endsWith('.opus')
          );
          matchingFiles.forEach(file => {
            foundFiles.push({
              path: path.join(subdirPath, file),
              folder: subdir,
              filename: file
            });
          });
        }
      }
    }
  } catch (error) {
    console.error(`Error searching for session ${meetingId}:`, error);
  }

  return foundFiles;
}
```

#### 1.2 Enhanced Directory Finding
```javascript
// Modify existing findMeetingDirectories method
async findMeetingDirectories(meeting, dateStr, projectRoot) {
  const basePath = path.join(projectRoot, 'assets', dateStr);
  const possibleDirs = [];

  // Strategy 1: Use database folder_name
  possibleDirs.push(path.join(basePath, meeting.folder_name));

  // Strategy 2: Search by session ID for recordings
  const sessionRecordings = await this.findRecordingBySessionId(meeting.id, dateStr, projectRoot);
  sessionRecordings.forEach(recording => {
    const recordingDir = path.dirname(recording.path);
    if (!possibleDirs.includes(recordingDir)) {
      possibleDirs.push(recordingDir);
    }
  });

  // Strategy 3: Title-based matching (existing logic)
  try {
    if (await fs.pathExists(basePath)) {
      const allDirs = await fs.readdir(basePath);
      const meetingDirs = allDirs.filter(dir => {
        const titleWords = meeting.title.toLowerCase().split(/\s+/).filter(word => word.length > 3);
        const dirName = dir.toLowerCase();
        return titleWords.some(word => dirName.includes(word));
      });

      meetingDirs.forEach(dir => {
        const fullPath = path.join(basePath, dir);
        if (!possibleDirs.includes(fullPath)) {
          possibleDirs.push(fullPath);
        }
      });
    }
  } catch (error) {
    console.warn(`Could not scan directory ${basePath}:`, error.message);
  }

  return possibleDirs;
}
```

### Phase 2: Upload Validation (Week 2)

**File**: `src/upload-service.js`

#### 2.1 Pre-Upload Content Validation
```javascript
// Enhanced content validation
async validateMeetingContent(meetingId, meeting) {
  const validation = {
    hasNotes: false,
    hasRecordings: false,
    recordings: [],
    notes: [],
    issues: []
  };

  try {
    const dateStr = getLocalDateString(meeting.start_time);
    const projectRoot = path.dirname(__dirname);

    // Find all possible directories
    const possibleDirs = await this.findMeetingDirectories(meeting, dateStr, projectRoot);

    // Check each directory for content
    for (const dir of possibleDirs) {
      if (await fs.pathExists(dir)) {
        const files = await fs.readdir(dir);

        // Find notes
        const noteFiles = files.filter(f => f.endsWith('.md'));
        noteFiles.forEach(file => {
          validation.notes.push({
            path: path.join(dir, file),
            name: file,
            directory: dir
          });
        });

        // Find recordings
        const audioFiles = files.filter(f =>
          f.endsWith('.opus') || f.endsWith('.m4a') || f.endsWith('.wav')
        );
        audioFiles.forEach(file => {
          validation.recordings.push({
            path: path.join(dir, file),
            name: file,
            directory: dir
          });
        });
      }
    }

    // Additional check: search by session ID
    const sessionRecordings = await this.findRecordingBySessionId(meetingId, dateStr, projectRoot);
    sessionRecordings.forEach(recording => {
      const existing = validation.recordings.find(r => r.path === recording.path);
      if (!existing) {
        validation.recordings.push({
          path: recording.path,
          name: recording.filename,
          directory: recording.folder,
          foundBySessionId: true
        });
        validation.issues.push(`Recording found by session ID in unexpected location: ${recording.folder}`);
      }
    });

    validation.hasNotes = validation.notes.length > 0;
    validation.hasRecordings = validation.recordings.length > 0;

    return validation;

  } catch (error) {
    console.error(`Error validating content for meeting ${meetingId}:`, error);
    validation.issues.push(`Validation error: ${error.message}`);
    return validation;
  }
}
```

#### 2.2 Separate Upload Tracking
```javascript
// Modify uploadMeeting method to track components separately
async uploadMeeting(meetingId) {
  try {
    console.log(`🚀 Starting upload for meeting ${meetingId}`);

    await this.database.setMeetingUploadStatus(meetingId, 'uploading');
    this.notifyUploadStatusChange(meetingId, 'uploading');

    const meeting = await this.database.getMeetingById(meetingId);
    if (!meeting) {
      throw new Error(`Meeting ${meetingId} not found`);
    }

    // Enhanced content validation
    const validation = await this.validateMeetingContent(meetingId, meeting);

    if (!validation.hasNotes && !validation.hasRecordings) {
      console.log(`📝 No content to upload for meeting ${meetingId}`);
      await this.database.setMeetingUploadStatus(meetingId, 'no_content');
      return;
    }

    // Log any issues found
    if (validation.issues.length > 0) {
      console.warn(`⚠️ Content validation issues for meeting ${meetingId}:`, validation.issues);
    }

    // Ensure Google Drive authentication
    if (!this.googleDriveService.drive) {
      console.log('🔐 Initializing Google Drive authentication...');
      await this.googleDriveService.initializeOAuth();
      if (!this.googleDriveService.drive) {
        throw new Error('Google Drive authentication required');
      }
    }

    // Create folder structure
    const dateStr = getLocalDateString(meeting.start_time);
    const meetingFolderId = await this.ensureGoogleDriveFolderStructure(dateStr, meeting.folder_name);

    const uploadResults = {
      notes: [],
      recordings: [],
      failed: []
    };

    // Upload notes files
    for (const noteFile of validation.notes) {
      try {
        console.log(`⬆️ Uploading note: ${noteFile.name}...`);
        const result = await this.uploadFileToGoogleDrive({
          name: noteFile.name,
          path: noteFile.path,
          type: 'markdown'
        }, meetingFolderId);
        uploadResults.notes.push(result);
        console.log(`✅ Uploaded note: ${noteFile.name}`);
      } catch (error) {
        console.error(`❌ Failed to upload note ${noteFile.name}:`, error);
        uploadResults.failed.push({ file: noteFile.name, error: error.message, type: 'note' });
      }
    }

    // Upload recording files
    for (const recording of validation.recordings) {
      try {
        console.log(`⬆️ Uploading recording: ${recording.name}...`);
        const stats = await fs.stat(recording.path);
        const result = await this.uploadFileToGoogleDrive({
          name: recording.name,
          path: recording.path,
          size: stats.size,
          type: 'audio'
        }, meetingFolderId);
        uploadResults.recordings.push(result);
        console.log(`✅ Uploaded recording: ${recording.name} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
      } catch (error) {
        console.error(`❌ Failed to upload recording ${recording.name}:`, error);
        uploadResults.failed.push({ file: recording.name, error: error.message, type: 'recording' });
      }
    }

    // Determine final status
    const totalFiles = validation.notes.length + validation.recordings.length;
    const successfulUploads = uploadResults.notes.length + uploadResults.recordings.length;

    if (uploadResults.failed.length === 0) {
      await this.database.setMeetingUploadStatus(meetingId, 'completed', meetingFolderId);
      console.log(`🎉 Meeting ${meetingId} upload completed successfully (${successfulUploads}/${totalFiles} files)`);
    } else if (successfulUploads > 0) {
      await this.database.setMeetingUploadStatus(meetingId, 'partial', meetingFolderId);
      console.log(`⚠️ Meeting ${meetingId} upload partially completed (${successfulUploads}/${totalFiles} files, ${uploadResults.failed.length} failed)`);
      // Re-queue for retry
      setTimeout(() => this.queueMeetingUpload(meetingId), 30000);
    } else {
      throw new Error(`All uploads failed: ${uploadResults.failed.map(f => f.error).join(', ')}`);
    }

  } catch (error) {
    console.error(`💥 Upload failed for meeting ${meetingId}:`, error);

    if (error.message === 'AUTH_EXPIRED') {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('upload-auth-required', { meetingId });
      }
      throw new Error('UPLOAD_AUTH_REQUIRED');
    }

    await this.database.setMeetingUploadStatus(meetingId, 'failed');
    throw error;
  }
}
```

### Phase 3: Folder Reconciliation Service (Week 3)

**New File**: `src/folder-reconciliation.js`

```javascript
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
```

### Phase 4: Database Updates

**File**: `src/database.js`

```javascript
// Add these methods to Database class

async getRecordingSession(sessionId) {
  return new Promise((resolve, reject) => {
    this.db.get(
      'SELECT * FROM recording_sessions WHERE id = ?',
      [sessionId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      }
    );
  });
}

async updateRecordingPath(sessionId, newPath) {
  return new Promise((resolve, reject) => {
    this.db.run(
      'UPDATE recording_sessions SET final_path = ? WHERE id = ?',
      [newPath, sessionId],
      function(err) {
        if (err) reject(err);
        else resolve(this.changes);
      }
    );
  });
}

async updateMeetingFolderName(meetingId, newFolderName) {
  return new Promise((resolve, reject) => {
    this.db.run(
      'UPDATE meetings SET folder_name = ? WHERE id = ?',
      [newFolderName, meetingId],
      function(err) {
        if (err) reject(err);
        else resolve(this.changes);
      }
    );
  });
}

async getMeetingsByUploadStatus(status) {
  return new Promise((resolve, reject) => {
    this.db.all(
      'SELECT * FROM meetings WHERE upload_status = ?',
      [status],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });
}
```

### Integration Points

**File**: `src/main.js`

```javascript
// Add to main.js initialization
const FolderReconciliationService = require('./folder-reconciliation');

// After upload service initialization
const folderReconciliationService = new FolderReconciliationService(database, uploadService);
await folderReconciliationService.initialize();

// Add to app shutdown
app.on('before-quit', async () => {
  await folderReconciliationService.shutdown();
});
```

## Testing Strategy

### Unit Tests
- File discovery algorithms
- Path reconciliation logic
- Upload validation

### Integration Tests
- End-to-end upload flow with mismatched paths
- Recovery of orphaned files
- Database consistency after reconciliation

### Production Monitoring
- Track reconciliation success rates
- Monitor upload completion rates
- Alert on recurring path mismatch patterns

## Success Metrics

- **Primary**: 0 manual interventions needed for orphaned recordings
- **Secondary**: 95%+ upload success rate within 24 hours
- **Tertiary**: Auto-recovery of 100% of detectable orphaned files

## Rollback Plan

If issues arise:
1. Disable reconciliation service via feature flag
2. Revert to original upload logic
3. Manual recovery procedures documented in runbook

---

**Next Steps**: Implement Phase 1 enhanced file discovery and begin testing with current orphaned files.