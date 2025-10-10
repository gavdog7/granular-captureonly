# Logging System Implementation Plan (Revised)

## Overview
Implement a comprehensive, production-grade logging system that writes logs to both console and persistent log files. The system will provide structured logging with proper log levels, automatic file rotation, and configurable verbosity to aid in debugging and troubleshooting production issues.

**🎯 PRIMARY OBJECTIVES:**
This logging system is specifically designed to diagnose and resolve the following critical production issues:

1. **Audio Recording Failures** - Meetings sometimes don't record audio, especially when reopening meetings
2. **Silent Google Drive Upload Failures** - Uploads fail without visibility into the root cause
3. **Meeting Rename Issues** - Renaming meetings causes recording/upload failures due to path mismatches
4. **Upload Pipeline Audit Trail** - No visibility into timing from meeting end → Google Drive availability

## Current State Analysis

### Existing Implementation
- **Logging Method**: Direct `console.log()`, `console.error()`, `console.warn()` calls throughout codebase
- **Total Occurrences**: 626 console statements across 19 source files
- **Log Locations**: Scattered across main process (main.js, services) and renderer process code
- **Existing Logger**: `AudioDebugLogger` class (`src/utils/audio-debug.js`) - specialized for audio debugging only
  - Environment-variable controlled (AUDIO_DEBUG flags)
  - Categorized logging (PROCESS, FILE I/O, VALIDATION, LIFECYCLE)
  - Only outputs to console, no file persistence

### Key Files with Heavy Logging
1. **main.js** - 120 console statements (app lifecycle, IPC handlers, cleanup)
2. **meeting-notes.js** - 127 console statements (UI interactions)
3. **audio-recorder.js** - 69 console statements (recording lifecycle)
4. **upload-service.js** - 58 console statements (upload operations)
5. **database.js** - 61 console statements (database operations)
6. **meeting-loader.js** - 21 console statements (meeting sync)
7. **meeting-health-checker.js** - 35 console statements (health checks)

### Current Pain Points
1. **No Persistence**: Logs only visible in dev console, lost after app restart
2. **No Rotation**: Cannot manage log file growth
3. **Inconsistent Format**: Mix of emoji-prefixed messages and plain text
4. **No Context**: Missing timestamps, severity levels, and structured data
5. **No Production Debugging**: Cannot investigate issues after they occur
6. **Performance**: Excessive logging with no way to control verbosity

### Critical Issue Analysis

#### Issue #1: Audio Recording Failures (Open/Close/Reopen)
**Current Code Flow** (audio-recorder.js:41-152, meeting-notes.js:716-829):
1. User opens meeting → renderer calls `initializeRecording()` → calls `start-recording` IPC
2. Main process → `audioRecorder.startRecording(meetingId, attempt=1)`
3. Checks for existing active recording (line 44-50)
4. **CRITICAL**: Audio session cleanup delay handling (lines 54-63) - waits 1000ms if last stop was recent
5. Creates directory, generates filename, spawns native audio process
6. Validates after 2 seconds (lines 121-136), retries up to 6 times on failure
7. User closes meeting → `stopRecording()` → sets `lastStopTime`
8. User reopens meeting → repeats from step 1

**Missing Logging for Diagnostics:**
- Meeting page lifecycle events (opened, closed, reopened with timestamps)
- Recording session state machine (idle → starting → active → stopping → stopped)
- Session ID correlation (which recording session belongs to which page view)
- File path at each stage (temp → final, with existence checks)
- Process PID tracking across open/close/reopen cycles
- Audio session cleanup timing (actual delay waited, reason)
- Validation results (file size at 2s, 4s, 6s checkpoints)

#### Issue #2: Silent Upload Failures
**Current Code Flow** (upload-service.js:21-233, meeting-notes.js:1391-1492):
1. User navigates back → `handleNavigationBack()` → exports markdown → queues upload
2. Upload service processes queue → validates content → authenticates → creates folder structure
3. Uploads files (markdown + audio) → handles retries → updates status

**Missing Logging for Diagnostics:**
- Upload queue lifecycle (queued → processing → completed/failed with exact timestamps)
- Authentication checks (token exists, token valid, refresh attempt results)
- File validation (which files found, which files missing, actual vs expected paths)
- Individual file upload progress (started, bytes uploaded, completed/failed)
- Retry logic (attempt number, backoff delay, reason for retry)
- Failure categorization (auth failure vs file not found vs network error vs quota)
- Silent failures (operations that catch exceptions but don't log them)

#### Issue #3: Meeting Rename Impact
**Current Code Flow** (main.js:547-594, file-manager.js:52, database.js:407-446):
1. User edits title → `update-meeting-title` IPC
2. Get current folder info → update title in DB
3. **CRITICAL**: `renameNoteFolderAndFiles()` - renames folder on disk
4. **CRITICAL**: `updateMeetingFolderName()` - updates folder_name in DB
5. **CRITICAL**: `updateRecordingPaths()` - updates recording paths in DB (lines 421-446)
6. Upload service uses complex path resolution (upload-service.js:534-712)

**Missing Logging for Diagnostics:**
- Rename operation start/end with old/new folder names
- File system rename success/failure for each file
- Database updates for folder_name and recording paths (before/after values)
- Path resolution attempts during upload (which paths tried, which succeeded)
- Active recording detection (whether recording was in progress during rename)
- Orphan detection (files that exist but DB doesn't reference)

#### Issue #4: Upload Pipeline Timing Audit
**Current Code Flow** (meeting-notes.js:1391-1492, upload-service.js:50-233):
1. T0: User clicks back button → `handleNavigationBack()`
2. T1: Notes saved → `ensureNotesAreSaved()`
3. T2: Recording stopped → `stop-recording` IPC
4. T3: Markdown exported → `export-meeting-notes-markdown` IPC
5. T4: Upload queued → `queue-meeting-upload` IPC
6. T5: Queue processor starts → `uploadMeeting(meetingId)`
7. T6: File validation → `validateMeetingContent()`
8. T7: Folder creation → `ensureGoogleDriveFolderStructure()`
9. T8: File uploads complete → status set to 'completed'

**Missing Logging for Diagnostics:**
- Correlation ID to trace single meeting through entire pipeline
- High-precision timestamps at each stage (T0-T8)
- Duration calculations (T1-T0, T2-T1, T3-T2, etc.)
- End-to-end timing (T8-T0 = total time from back button to upload complete)
- Queue wait time (T5-T4 = time spent waiting in queue)
- Upload time per file (with file sizes for throughput calculation)
- Bottleneck identification (which stage took longest)

## Proposed Implementation

### 1. Logging Library Selection

**Recommendation: electron-log**

**Rationale:**
- Purpose-built for Electron applications
- Zero dependencies
- Simple configuration
- Built-in file rotation
- Supports both main and renderer processes
- Active maintenance (2025)
- No performance overhead

**Alternative Considered:**
- **Winston**: More powerful but overkill for Electron, requires additional dependencies
- **Bunyan**: JSON-only, harder for humans to read in development
- **Pino**: Excellent performance but less Electron-specific features

### 2. Architecture Design

```
┌─────────────────────────────────────────────────────────────┐
│                    Application Code                          │
│  (main.js, services, database, renderer)                    │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   Logger Abstraction                         │
│              (src/utils/logger.js)                          │
│  - log.info()     - log.error()     - log.debug()          │
│  - log.warn()     - log.verbose()                          │
└────────────┬──────────────────┬─────────────────────────────┘
             │                  │
             ▼                  ▼
    ┌────────────────┐  ┌──────────────────┐
    │ Console Output │  │ File Transport   │
    │   (colored)    │  │ (auto-rotating)  │
    └────────────────┘  └──────────────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │ Log Files            │
                    │ - logs/main.log      │
                    │ - logs/main.old.log  │
                    │ - logs/renderer.log  │
                    └──────────────────────┘
```

### 3. Log File Structure

```
<app-data>/Granular CaptureOnly/
├── logs/
│   ├── main.log           # Current main process log (max 10MB)
│   ├── main.old.log       # Previous main process log (archived)
│   ├── renderer.log       # Current renderer process log (max 10MB)
│   └── renderer.old.log   # Previous renderer process log (archived)
├── granular.db            # Existing database
└── config.json            # Existing electron-store config
```

### 4. Logger Configuration

```javascript
// src/utils/logger.js
const log = require('electron-log');
const path = require('path');
const { app } = require('electron');

// Configure log file location
log.transports.file.resolvePathFn = () => {
  return path.join(app.getPath('userData'), 'logs', 'main.log');
};

// Configure file rotation (10MB max file size)
log.transports.file.maxSize = 10 * 1024 * 1024; // 10MB

// Configure log format
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';
log.transports.console.format = '[{h}:{i}:{s}.{ms}] [{level}] {text}';

// Set log levels based on environment
if (process.env.NODE_ENV === 'production') {
  log.transports.file.level = 'info';
  log.transports.console.level = 'warn';
} else {
  log.transports.file.level = 'debug';
  log.transports.console.level = 'debug';
}

// Add process identifier for clarity
log.hooks.push((message, transport) => {
  if (transport === log.transports.file) {
    message.data.unshift(`[${process.type || 'main'}]`);
  }
  return message;
});

module.exports = log;
```

### 5. Log Levels Strategy

| Level | Usage | Example |
|-------|-------|---------|
| **error** | Critical failures, exceptions | `log.error('Failed to start recording:', error)` |
| **warn** | Recoverable issues, deprecations | `log.warn('Upload retry attempt 2/3')` |
| **info** | Important milestones, state changes | `log.info('Meeting 123 upload completed')` |
| **verbose** | Detailed operational info | `log.verbose('Processing 15 items in queue')` |
| **debug** | Development debugging | `log.debug('Validating file size:', stats)` |

### 6. Migration Strategy

#### Phase 1: Add Logger Infrastructure (Non-Breaking)
1. Install electron-log: `npm install electron-log --save`
2. Create `src/utils/logger.js` with configuration
3. Test logger in isolation

#### Phase 2: Incremental Replacement (File-by-File)
Replace console statements module by module:

**Priority Order:**
1. **main.js** (app lifecycle, critical errors)
2. **audio-recorder.js** (recording operations)
3. **upload-service.js** (upload operations)
4. **database.js** (data operations)
5. **meeting-health-checker.js** (background jobs)
6. **meeting-loader.js** (sync operations)
7. **google-drive.js** (OAuth, API calls)
8. **renderer files** (UI interactions)

**Replacement Pattern:**
```javascript
// Before:
console.log('Starting upload for meeting', meetingId);
console.error('Upload failed:', error);

// After:
const log = require('./utils/logger');
log.info(`Starting upload for meeting ${meetingId}`);
log.error('Upload failed:', { meetingId, error: error.message, stack: error.stack });
```

#### Phase 3: Enhanced AudioDebugLogger
Update `AudioDebugLogger` to use the new logger instead of console:
```javascript
// In audio-debug.js
const log = require('./logger');

logProcess(message, data) {
  if (!this.processDebug) return;
  log.debug(`[AUDIO] [PROCESS] ${message}`, data);
}
```

### 7. Critical Issue-Specific Logging Requirements

#### A. Audio Recording Failure Logging

**Meeting Lifecycle Tracking:**
```javascript
// Meeting page opened (renderer/meeting-notes.js:716)
log.info('[RECORDING] Meeting page opened', {
  meetingId,
  viewId: generateViewId(), // Unique ID for this page view
  timestamp: Date.now(),
  existingRecordingStatus: await getRecordingStatus(meetingId)
});

// Recording start attempt (audio-recorder.js:41)
log.info('[RECORDING] Start attempt', {
  meetingId,
  sessionId: null, // Will be set after creation
  attempt,
  activeRecordings: this.activeRecordings.size,
  lastStopTime: this.lastStopTime,
  timeSinceLastStop: this.lastStopTime ? Date.now() - this.lastStopTime : null
});

// Audio session cleanup delay (audio-recorder.js:54-63)
if (timeSinceLastStop < minDelay) {
  log.warn('[RECORDING] Audio session cleanup delay required', {
    meetingId,
    timeSinceLastStop,
    waitTime,
    reason: 'macOS audio session management'
  });
}

// Recording session created (audio-recorder.js:86)
log.info('[RECORDING] Session created', {
  meetingId,
  sessionId,
  finalPath,
  dirExists: await fs.pathExists(recordingDir),
  partNumber: recordingSession.partNumber
});

// Process spawned (audio-recorder.js:481)
log.info('[RECORDING] Native process spawned', {
  meetingId,
  sessionId,
  pid: process.pid,
  command: `${binaryPath} start --output ${outputPath}`,
  timestamp: Date.now()
});

// Validation checkpoint (audio-recorder.js:526)
log.info('[RECORDING] Validation checkpoint', {
  meetingId,
  sessionId,
  fileSize: stats.size,
  expectedMinSize: 1024,
  passed: stats.size >= 1024,
  elapsedSeconds: 2
});

// Recording stopped (audio-recorder.js:290)
log.info('[RECORDING] Recording stopped', {
  meetingId,
  sessionId,
  duration: recording.duration,
  finalFileSize: stats?.size,
  finalPath: recording.finalPath,
  wasValidated: true
});

// Meeting page closed (renderer/meeting-notes.js:204)
log.info('[RECORDING] Meeting page closed', {
  meetingId,
  viewId,
  recordingStopped: true,
  timestamp: Date.now()
});
```

**Log Query for Debugging:**
```bash
# Find all events for a specific meeting across open/close/reopen
grep "meetingId.*123" logs/main.log | grep "\[RECORDING\]"

# Find recording failures
grep "ERROR.*RECORDING" logs/main.log
```

#### B. Upload Failure Logging

**Upload Pipeline Tracking:**
```javascript
// Upload queued (upload-service.js:23, meeting-notes.js:1454)
log.info('[UPLOAD] Meeting queued for upload', {
  meetingId,
  correlationId: generateCorrelationId(meetingId), // e.g., "upload-123-1728480000"
  queuedAt: Date.now(),
  queueLength,
  triggerSource: 'navigation-back' // or 'health-checker', 'manual', etc.
});

// Queue processing started (upload-service.js:62)
log.info('[UPLOAD] Processing queue', {
  pendingCount: pendingUploads.length,
  firstMeetingId: pendingUploads[0]?.meeting_id
});

// Authentication check (upload-service.js:150-156)
if (!this.googleDriveService.drive) {
  log.warn('[UPLOAD] Google Drive not authenticated, initializing', {
    meetingId,
    correlationId
  });
  try {
    await this.googleDriveService.initializeOAuth();
    log.info('[UPLOAD] Authentication successful', { meetingId, correlationId });
  } catch (authError) {
    log.error('[UPLOAD] Authentication failed', {
      meetingId,
      correlationId,
      error: authError.message,
      requiresUserAction: true
    });
  }
}

// File validation (upload-service.js:136-147)
log.info('[UPLOAD] Validating meeting content', {
  meetingId,
  correlationId,
  notesFound: validation.notes.length,
  recordingsFound: validation.recordings.length,
  issues: validation.issues
});

// Individual file upload (upload-service.js:172)
log.info('[UPLOAD] Uploading file', {
  meetingId,
  correlationId,
  fileName: noteFile.name,
  filePath: noteFile.path,
  fileSize: stats.size,
  type: 'markdown',
  uploadStartTime: Date.now()
});

// Upload success (upload-service.js:178)
log.info('[UPLOAD] File uploaded successfully', {
  meetingId,
  correlationId,
  fileName: noteFile.name,
  driveFileId: result.id,
  uploadDuration: Date.now() - uploadStartTime
});

// Upload failure (upload-service.js:180)
log.error('[UPLOAD] File upload failed', {
  meetingId,
  correlationId,
  fileName: noteFile.name,
  error: error.message,
  errorType: categorizeError(error), // 'auth', 'network', 'notfound', 'quota'
  willRetry: uploadItem.attempts < this.maxRetries
});

// Final status (upload-service.js:209)
log.info('[UPLOAD] Upload completed', {
  meetingId,
  correlationId,
  status: 'completed',
  filesUploaded: successfulUploads,
  filesFailed: uploadResults.failed.length,
  totalDuration: Date.now() - queuedAt
});
```

**Log Query for Debugging:**
```bash
# Trace entire upload pipeline for meeting 123
grep "correlationId.*upload-123" logs/main.log

# Find all upload failures
grep "\[UPLOAD\].*ERROR" logs/main.log

# Find authentication issues
grep "\[UPLOAD\].*Authentication failed" logs/main.log
```

#### C. Meeting Rename Logging

**Rename Operation Tracking:**
```javascript
// Rename initiated (main.js:548)
log.info('[RENAME] Meeting rename initiated', {
  meetingId,
  oldTitle: folderInfo.title,
  newTitle: title,
  oldFolderName: folderInfo.folder_name,
  activeRecording: await checkActiveRecording(meetingId)
});

// Folder rename (file-manager.js:52)
log.info('[RENAME] Renaming folder on disk', {
  meetingId,
  oldPath: oldFolderPath,
  newPath: newFolderPath,
  filesInFolder: files.length
});

// File rename iteration (file-manager.js - in loop)
log.debug('[RENAME] Renaming file', {
  meetingId,
  oldFilePath: path.join(oldFolderPath, file),
  newFilePath: path.join(newFolderPath, file),
  fileSize: stats.size
});

// Database folder update (database.js:407)
log.info('[RENAME] Updating folder name in database', {
  meetingId,
  oldFolderName: folderInfo.folder_name,
  newFolderName: renameResult.newFolderName
});

// Recording paths update (database.js:421)
log.info('[RENAME] Updating recording paths', {
  meetingId,
  recordingsToUpdate: recordings.length,
  oldFolderName,
  newFolderName
});

recordings.forEach(recording => {
  log.info('[RENAME] Updated recording path', {
    meetingId,
    recordingId: recording.id,
    oldPath: recording.final_path,
    newPath: newPath
  });
});

// Rename completed (main.js:576)
log.info('[RENAME] Rename operation completed', {
  meetingId,
  success: renameResult.success,
  newFolderName: renameResult.newFolderName,
  filesRenamed: renameResult.filesRenamed,
  duration: Date.now() - renameStartTime
});

// Path resolution during upload (upload-service.js:548-577)
log.debug('[RENAME] Resolving paths for upload', {
  meetingId,
  currentFolderName: meeting.folder_name,
  pathsToTry: possibleDirs.map(d => path.basename(d))
});

possibleDirs.forEach(dir => {
  log.debug('[RENAME] Checking directory', {
    meetingId,
    dir,
    exists: await fs.pathExists(dir),
    filesFound: exists ? (await fs.readdir(dir)).length : 0
  });
});
```

**Log Query for Debugging:**
```bash
# Trace rename operation
grep "\[RENAME\].*meetingId.*123" logs/main.log

# Find orphaned files after rename
grep "Path resolution.*meetingId.*123" logs/main.log
```

#### D. Upload Pipeline Timing Audit

**End-to-End Pipeline Tracking:**
```javascript
// Generate correlation ID at start
const pipelineId = `pipeline-${meetingId}-${Date.now()}`;

// T0: Navigation back initiated (meeting-notes.js:1392)
log.info('[PIPELINE] Navigation back initiated', {
  meetingId,
  pipelineId,
  stage: 'T0-navigation-start',
  timestamp: Date.now()
});

// T1: Notes saved (meeting-notes.js:1400)
log.info('[PIPELINE] Notes saved', {
  meetingId,
  pipelineId,
  stage: 'T1-notes-saved',
  timestamp: Date.now(),
  duration: Date.now() - t0 // Calculate from pipeline start
});

// T2: Recording stopped (meeting-notes.js:1422)
log.info('[PIPELINE] Recording stopped', {
  meetingId,
  pipelineId,
  stage: 'T2-recording-stopped',
  timestamp: Date.now(),
  duration: Date.now() - t0
});

// T3: Markdown exported (meeting-notes.js:1446)
log.info('[PIPELINE] Markdown exported', {
  meetingId,
  pipelineId,
  stage: 'T3-markdown-exported',
  timestamp: Date.now(),
  duration: Date.now() - t0,
  filePath: exportResult.filePath
});

// T4: Upload queued (meeting-notes.js:1456)
log.info('[PIPELINE] Upload queued', {
  meetingId,
  pipelineId,
  stage: 'T4-upload-queued',
  timestamp: Date.now(),
  duration: Date.now() - t0
});

// T5: Queue processing starts (upload-service.js:65)
log.info('[PIPELINE] Queue processing started', {
  meetingId,
  pipelineId,
  stage: 'T5-queue-processing',
  timestamp: Date.now(),
  duration: Date.now() - t0,
  queueWaitTime: Date.now() - t4 // Time spent waiting in queue
});

// T6: Content validated (upload-service.js:147)
log.info('[PIPELINE] Content validated', {
  meetingId,
  pipelineId,
  stage: 'T6-content-validated',
  timestamp: Date.now(),
  duration: Date.now() - t0
});

// T7: Folders created (upload-service.js:160)
log.info('[PIPELINE] Google Drive folders created', {
  meetingId,
  pipelineId,
  stage: 'T7-folders-created',
  timestamp: Date.now(),
  duration: Date.now() - t0,
  folderId: meetingFolderId
});

// T8: Upload completed (upload-service.js:210)
log.info('[PIPELINE] Upload completed', {
  meetingId,
  pipelineId,
  stage: 'T8-upload-complete',
  timestamp: Date.now(),
  duration: Date.now() - t0,
  totalTime: Date.now() - t0,
  breakdown: {
    t1_t0_notes: t1 - t0,
    t2_t1_recording: t2 - t1,
    t3_t2_markdown: t3 - t2,
    t4_t3_queue: t4 - t3,
    t5_t4_wait: t5 - t4,
    t6_t5_validate: t6 - t5,
    t7_t6_folders: t7 - t6,
    t8_t7_upload: t8 - t7
  }
});
```

**Log Query for Debugging:**
```bash
# Trace entire pipeline for meeting 123
grep "pipelineId.*pipeline-123" logs/main.log

# Extract timing summary
grep "stage.*T8.*meetingId.*123" logs/main.log | jq '.breakdown'

# Find slow uploads (> 60 seconds)
grep "PIPELINE.*T8.*totalTime" logs/main.log | awk '$NF > 60000'
```

### 8. Structured Logging Examples

```javascript
// Recording lifecycle
log.info('[RECORDING] Session started', {
  meetingId: 123,
  sessionId: 'abc-123',
  filePath: '/path/to/file.opus',
  attempt: 1
});

// Upload operations
log.info('[UPLOAD] Meeting queued', {
  meetingId: 123,
  correlationId: 'upload-123-1728480000',
  queueLength: 5,
  status: 'pending'
});

// Error with context
log.error('[DATABASE] Query failed', {
  operation: 'getMeetingById',
  meetingId: 123,
  error: error.message,
  stack: error.stack
});

// Performance tracking
log.debug('[DATABASE] Query performance', {
  query: 'SELECT * FROM meetings',
  duration: '45ms',
  rows: 150
});
```

### 8. Log Viewing & Analysis

**Development:**
- Console: Real-time colored output with filtering
- File: `tail -f ~/Library/Application\ Support/Granular\ CaptureOnly/logs/main.log`

**Production:**
- User can locate logs via Help menu → "Open Logs Folder"
- Support can request log files for troubleshooting
- Logs are plain text for easy sharing/analysis

### 9. Troubleshooting Guides Using Logs

#### Issue #1: Meeting Won't Record Audio

**Symptoms:** Recording indicator doesn't change, file size shows 0KB, or recording appears to start but no audio is captured

**Diagnostic Steps:**
```bash
# 1. Find the meeting page lifecycle
grep "meetingId.*${MEETING_ID}.*Meeting page" logs/main.log

# Output will show:
# [RECORDING] Meeting page opened - meetingId: 123, viewId: view-abc-123
# [RECORDING] Meeting page closed - meetingId: 123, viewId: view-abc-123
# [RECORDING] Meeting page opened - meetingId: 123, viewId: view-def-456 (reopened!)

# 2. Check recording start attempts
grep "meetingId.*${MEETING_ID}.*Start attempt" logs/main.log

# Look for:
# - Attempt number (should start at 1, may go up to 6 for retries)
# - activeRecordings count (should be 0 when starting fresh)
# - lastStopTime (should be null or > 1000ms ago)
# - timeSinceLastStop (if < 1000ms, audio session cleanup issue)

# 3. Check for validation failures
grep "meetingId.*${MEETING_ID}.*Validation checkpoint" logs/main.log

# File size should be >= 1024 bytes after 2 seconds
# If fileSize < 1024, recording likely failed to capture audio

# 4. Check for process spawn issues
grep "meetingId.*${MEETING_ID}.*Native process spawned" logs/main.log

# Should see PID and command
# If missing, audio capture binary failed to start

# 5. Check for errors
grep "meetingId.*${MEETING_ID}.*ERROR" logs/main.log
```

**Common Root Causes:**
- **Rapid open/close/reopen**: Check `timeSinceLastStop < 1000` - macOS audio session not cleaned up
- **Missing binary**: "Native process spawned" log missing - audio-capture binary not found
- **Permissions**: Check for "Microphone permission" errors
- **Stale recording session**: `activeRecordings > 0` when starting - previous session wasn't cleaned up

#### Issue #2: Upload Silently Fails

**Symptoms:** Meeting shows "pending" upload status indefinitely, or status changes to "failed" with no visible error

**Diagnostic Steps:**
```bash
# 1. Find upload correlation ID
grep "meetingId.*${MEETING_ID}.*queued for upload" logs/main.log

# Output: correlationId: "upload-123-1728480000"
CORRELATION_ID="upload-123-1728480000"

# 2. Trace entire upload pipeline
grep "correlationId.*${CORRELATION_ID}" logs/main.log

# Should see sequence:
# [UPLOAD] Meeting queued
# [UPLOAD] Processing queue
# [UPLOAD] Validating content
# [UPLOAD] Uploading file (for each file)
# [UPLOAD] Upload completed

# 3. Check for authentication failures
grep "correlationId.*${CORRELATION_ID}.*Authentication" logs/main.log

# Look for "Authentication failed" - requires user to re-auth

# 4. Check file validation
grep "correlationId.*${CORRELATION_ID}.*Validating" logs/main.log

# Check notesFound and recordingsFound counts
# If both are 0, no content to upload

# 5. Check individual file failures
grep "correlationId.*${CORRELATION_ID}.*upload failed" logs/main.log

# errorType will indicate: 'auth', 'network', 'notfound', 'quota'
```

**Common Root Causes:**
- **Expired OAuth token**: `errorType: 'auth'` - user needs to reconnect Google Drive
- **Files not found**: `errorType: 'notfound'` - likely due to rename operation or path mismatch
- **Network issues**: `errorType: 'network'` - temporary connectivity problem, should retry
- **Google Drive quota**: `errorType: 'quota'` - storage full

#### Issue #3: Rename Breaks Recording/Upload

**Symptoms:** After renaming a meeting, subsequent uploads fail or recording files can't be found

**Diagnostic Steps:**
```bash
# 1. Find the rename operation
grep "meetingId.*${MEETING_ID}.*RENAME.*initiated" logs/main.log

# Note oldFolderName and newFolderName

# 2. Check if rename completed successfully
grep "meetingId.*${MEETING_ID}.*RENAME.*completed" logs/main.log

# success: true/false
# filesRenamed: count

# 3. Check database updates
grep "meetingId.*${MEETING_ID}.*Updating folder name" logs/main.log
grep "meetingId.*${MEETING_ID}.*Updating recording paths" logs/main.log

# Should see old/new paths for each recording

# 4. Check path resolution during upload
grep "meetingId.*${MEETING_ID}.*Resolving paths" logs/main.log

# Shows which directories were checked
# Should find files in directory with newFolderName

# 5. Check for orphaned files
grep "meetingId.*${MEETING_ID}.*Checking directory" logs/main.log

# If exists: false for newFolderName directory, files weren't moved
```

**Common Root Causes:**
- **Active recording during rename**: Check for `activeRecording: true` - can't rename while recording
- **Filesystem rename failed**: `success: false` - permissions or disk error
- **Database update failed**: Recording paths not updated - database inconsistent with filesystem
- **Path resolution fails**: Upload looks in old folder - database has old folder_name

#### Issue #4: Slow Upload Pipeline

**Symptoms:** Long delay between ending meeting and files appearing in Google Drive

**Diagnostic Steps:**
```bash
# 1. Find the pipeline ID
grep "meetingId.*${MEETING_ID}.*Navigation back initiated" logs/main.log

# Note pipelineId: "pipeline-123-1728480000"
PIPELINE_ID="pipeline-123-1728480000"

# 2. Extract full timing breakdown
grep "pipelineId.*${PIPELINE_ID}.*stage.*T8" logs/main.log | jq '.breakdown'

# Output:
# {
#   "t1_t0_notes": 150,      # Notes save: 150ms
#   "t2_t1_recording": 3200, # Recording stop: 3.2s
#   "t3_t2_markdown": 400,   # Markdown export: 400ms
#   "t4_t3_queue": 50,       # Queue operation: 50ms
#   "t5_t4_wait": 15000,     # Queue wait time: 15s ⚠️
#   "t6_t5_validate": 200,   # Content validation: 200ms
#   "t7_t6_folders": 1200,   # Folder creation: 1.2s
#   "t8_t7_upload": 8500     # File uploads: 8.5s
# }

# 3. Identify bottleneck
# - High t2_t1: Recording taking long to stop
# - High t5_t4: Queue backlog, many meetings uploading
# - High t7_t6: Google Drive API slow (folder creation)
# - High t8_t7: Large files or slow network

# 4. Check queue status during slow period
grep "UPLOAD.*Processing queue" logs/main.log

# pendingCount > 5 indicates backlog
```

**Timing Benchmarks:**
- **Normal total time**: < 15 seconds (T0 → T8)
- **Acceptable**: 15-30 seconds
- **Slow**: 30-60 seconds
- **Problem**: > 60 seconds

**Common Bottlenecks:**
- **Queue wait (t5_t4)**: Multiple meetings uploading simultaneously - expected, not a problem
- **Recording stop (t2_t1)**: > 5 seconds - audio process not responding, may need force kill
- **Folder creation (t7_t6)**: > 3 seconds - Google Drive API latency, may indicate quota throttling
- **File upload (t8_t7)**: Varies by file size, but > 10 seconds for < 5MB indicates network issue

### 10. Configuration Management

Add log settings to electron-store config:
```javascript
// In main.js
store = new Store({
  defaults: {
    // ... existing settings
    logging: {
      fileLevel: 'info',      // File logging level
      consoleLevel: 'warn',   // Console logging level
      maxFileSize: 10,        // MB
      enableDebugMode: false  // Enable verbose debug logs
    }
  }
});
```

## Implementation Steps

### Phase 1: Foundation (Day 1)
1. ✓ Investigate current logging (COMPLETED)
2. ✓ Research best practices (COMPLETED)
3. ✓ Analyze critical issues (COMPLETED)
4. Install electron-log dependency
5. Create `src/utils/logger.js` with configuration
6. Add correlation ID generators for tracking
7. Write test script to validate log output and rotation
8. Update `.gitignore` to exclude log files

### Phase 2: Critical Path Logging - Audio Recording (Day 2)
**Focus: Solve Issue #1 - Recording Failures**
1. Migrate audio-recorder.js (69 statements)
   - Add [RECORDING] prefix to all logs
   - Log session state machine transitions
   - Track audio session cleanup timing
   - Log validation checkpoints with file sizes
   - Track process PIDs and spawning
2. Migrate meeting-notes.js recording functions (renderer)
   - Log page lifecycle (opened/closed)
   - Generate unique viewId for each page view
   - Correlate renderer events with main process
3. **Test:** Reproduce open/close/reopen scenario, verify logs show root cause

### Phase 3: Critical Path Logging - Upload Pipeline (Day 3)
**Focus: Solve Issue #2 - Silent Upload Failures**
1. Migrate upload-service.js (58 statements)
   - Add [UPLOAD] prefix and correlation IDs
   - Log authentication checks explicitly
   - Log file validation with found/missing files
   - Categorize errors (auth/network/notfound/quota)
   - Track individual file upload progress
2. Migrate google-drive.js (8 statements)
   - Log OAuth token status
   - Log API errors with categorization
3. **Test:** Trigger auth failure, network error, and missing file scenarios

### Phase 4: Critical Path Logging - Rename & Pipeline Timing (Day 4)
**Focus: Solve Issues #3 & #4**
1. Migrate file-manager.js rename operations
   - Add [RENAME] prefix
   - Log before/after folder names
   - Track filesystem operations
   - Log database path updates
2. Add pipeline timing to meeting-notes.js
   - Add [PIPELINE] prefix with stages T0-T8
   - Generate pipeline correlation ID
   - Calculate duration between each stage
   - Output final timing breakdown
3. Update upload-service.js with pipeline timing
   - Continue [PIPELINE] logging in queue processor
   - Track queue wait time separately
4. **Test:** Rename meeting while recording, verify path resolution logs

### Phase 5: Supporting Infrastructure (Day 5)
1. Migrate database.js (61 statements)
   - Use [DATABASE] prefix
   - Log query timing for slow operations
   - Log schema migrations
2. Migrate main.js IPC handlers (120 statements)
   - Use [IPC] prefix
   - Log handler execution time
3. Update AudioDebugLogger to use new logger
4. Add log viewer to Help menu

### Phase 6: Testing & Validation (Day 6)
1. **Critical Issue Testing:**
   - Test Issue #1: Rapid open/close/reopen recording
   - Test Issue #2: Upload with expired OAuth, missing files
   - Test Issue #3: Rename while recording, verify path resolution
   - Test Issue #4: Measure end-to-end pipeline timing
2. **Infrastructure Testing:**
   - Verify log rotation at 10MB
   - Test log levels (debug/info/warn/error)
   - Verify renderer process logging
   - Test correlation ID tracking across processes
3. **Documentation:**
   - Write troubleshooting guide (already in this plan)
   - Update README with logging examples
   - Create diagnostic script for common issues

## Risk Analysis & Mitigation

### 1. **Breaking Changes During Migration**
**Risk**: Accidentally removing logging that's critical for debugging
**Mitigation**:
- Migrate incrementally, one file at a time
- Test each file after migration
- Keep console output during development
- Git commit after each file migration

### 2. **Performance Impact**
**Risk**: Excessive file I/O could slow down the app
**Mitigation**:
- electron-log uses async file writes
- Buffer writes to minimize I/O
- Test performance with high-volume logging
- Use appropriate log levels (verbose/debug only in dev)

### 3. **Disk Space Consumption**
**Risk**: Log files could fill up user's disk
**Mitigation**:
- Automatic rotation at 10MB (keeps only 2 files)
- Maximum ~20MB per process (main + renderer)
- Document log location for users
- Consider adding log cleanup on app startup (delete logs > 30 days)

### 4. **Sensitive Data Logging**
**Risk**: Accidentally logging passwords, tokens, or PII
**Mitigation**:
- Never log credentials (passwords, API keys, tokens)
- Never log full file contents
- Redact email addresses in production logs (optional)
- Code review checklist for sensitive data

### 5. **Log File Location Issues**
**Risk**: Users can't find logs when needed for support
**Mitigation**:
- Add Help menu item: "Open Logs Folder"
- Document location in README
- Include path in error dialogs
- Consistent cross-platform paths via app.getPath('userData')

### 6. **Renderer Process Logging**
**Risk**: Renderer logs might not be captured if configured incorrectly
**Mitigation**:
- Test renderer logging separately
- Use separate log file for renderer
- Verify in dev tools that logs appear
- Document renderer-specific setup

### 7. **Log Rotation Not Working**
**Risk**: Files grow unbounded if rotation fails
**Mitigation**:
- Test rotation explicitly (write > 10MB)
- Monitor file sizes in testing
- Add manual cleanup fallback
- Document expected behavior

### 8. **Timezone Confusion in Logs**
**Risk**: Log timestamps might not match user's timezone
**Mitigation**:
- Use local time for timestamps
- Include timezone in format
- Document timestamp format
- Consider ISO 8601 format for clarity

## Success Criteria

### Critical Issue Resolution (PRIMARY)
**These are the MUST-HAVE criteria - the logging system MUST enable diagnosis of these issues:**

1. **Issue #1 - Recording Failures**
   - ✓ Can trace meeting page lifecycle (open → close → reopen)
   - ✓ Can identify audio session cleanup delays
   - ✓ Can see validation checkpoint file sizes
   - ✓ Can correlate recording session with page view
   - ✓ Can identify root cause within 5 minutes of analyzing logs

2. **Issue #2 - Silent Upload Failures**
   - ✓ Can trace complete upload pipeline with correlation ID
   - ✓ Can identify authentication failures explicitly
   - ✓ Can see which files were found/missing during validation
   - ✓ Can categorize failure type (auth/network/notfound/quota)
   - ✓ Can identify root cause within 3 minutes of analyzing logs

3. **Issue #3 - Rename Breaking Recording/Upload**
   - ✓ Can see old and new folder names for rename operation
   - ✓ Can verify filesystem rename succeeded
   - ✓ Can verify database path updates occurred
   - ✓ Can trace path resolution attempts during upload
   - ✓ Can identify root cause within 5 minutes of analyzing logs

4. **Issue #4 - Upload Pipeline Timing Audit**
   - ✓ Can measure end-to-end time (T0 → T8)
   - ✓ Can identify which stage is the bottleneck
   - ✓ Can measure queue wait time separately
   - ✓ Can compare actual timing against benchmarks
   - ✓ Can answer "how long to Google Drive?" within 1 minute

### Functional Requirements
1. ✓ All console.log statements replaced with structured logger calls
2. ✓ Logs written to persistent files in userData directory
3. ✓ Files rotate automatically when exceeding 10MB
4. ✓ Both main and renderer process logs captured
5. ✓ Log levels configurable (dev vs production)
6. ✓ Timestamps included in all log entries
7. ✓ Structured data support (objects, errors)
8. ✓ Correlation IDs track operations across function boundaries
9. ✓ Log prefixes ([RECORDING], [UPLOAD], [RENAME], [PIPELINE]) for filtering

### Quality Requirements
1. No performance degradation (< 5ms overhead per log)
2. Zero data loss during rotation
3. Readable format for both humans and machines
4. No sensitive data logged (passwords, tokens)
5. Comprehensive error context (stack traces, error categorization)
6. Correlation IDs enable end-to-end tracing
7. Grep-able logs (can find issue in < 3 grep commands)

### Operational Requirements
1. Users can locate logs easily (Help menu → "Open Logs Folder")
2. Support team can diagnose issues without source code access
3. Log files are shareable (email, file transfer)
4. Logs persist across app restarts
5. Old logs auto-rotate (max ~20MB per process)
6. Troubleshooting guides work with actual log output

### Testing Validation
1. **Critical Path Tests:**
   - Reproduce Issue #1: Open/close/reopen meeting, analyze logs, identify root cause
   - Reproduce Issue #2: Expire OAuth token, trigger upload, identify auth failure in logs
   - Reproduce Issue #3: Rename during recording, upload, trace path resolution
   - Reproduce Issue #4: Complete pipeline, extract timing breakdown, identify bottleneck
2. **Infrastructure Tests:**
   - Write 11MB of logs, confirm .old.log created
   - Set level to 'warn', confirm debug logs excluded
   - Trigger renderer logs, confirm in file
   - Verify correlation IDs persist across IPC calls
3. **Documentation Tests:**
   - Follow troubleshooting guide step-by-step, confirm log queries work
   - Measure time to diagnose known issue (target < 5 minutes)

## Future Enhancements

### Short Term (After Initial Release)
1. **Remote Log Upload**
   - Allow users to upload logs for support
   - Generate shareable log URLs
   - Automatic redaction of sensitive paths

2. **Log Filtering UI**
   - In-app log viewer
   - Filter by level, component, time range
   - Search functionality

3. **Performance Metrics**
   - Log execution times for critical operations
   - Track upload success rates
   - Monitor recording failure patterns

### Long Term
1. **Crash Reporting Integration**
   - Integrate with Sentry or similar
   - Automatic error reporting
   - Stack trace symbolication

2. **Log Analytics**
   - Aggregate error patterns
   - Identify common issues
   - Usage analytics (opt-in)

3. **Advanced Structured Logging**
   - JSON format option
   - Correlation IDs for request tracing
   - Distributed tracing support

4. **Log Compression**
   - Compress old logs to save space
   - Archive logs older than 30 days
   - Configurable retention policies

## Configuration Reference

### Environment Variables
```bash
# Development
NODE_ENV=development    # Enables debug logs
LOG_LEVEL=debug        # Override log level

# Production
NODE_ENV=production    # Info level only
LOG_LEVEL=info         # Explicit level setting

# Debugging
ELECTRON_LOG_FILE=/custom/path/main.log  # Custom log path
```

### Runtime Configuration
```javascript
// Programmatic level change
const log = require('./utils/logger');
log.transports.file.level = 'debug';
log.transports.console.level = 'info';

// Disable specific transport
log.transports.console.level = false;  // Disable console
log.transports.file.level = false;     // Disable file

// Custom format
log.transports.file.format = '{iso} [{level}] {text}';
```

## Documentation Updates Required

1. **README.md**: Add "Logging" section
2. **CONTRIBUTING.md**: Add logging guidelines for contributors
3. **TROUBLESHOOTING.md**: Create guide on using logs for debugging
4. **Help Menu**: Add "Open Logs Folder" and "Copy Log Path" options

## Rollout Plan

### Week 1: Development
- Implement logger infrastructure
- Migrate core files (main.js, audio-recorder.js)
- Initial testing

### Week 2: Complete Migration
- Migrate all remaining files
- Update AudioDebugLogger integration
- Comprehensive testing

### Week 3: Polish & Documentation
- Add log viewer to Help menu
- Write troubleshooting documentation
- User acceptance testing

### Production Release
- Enable info-level logging by default
- Monitor log file sizes
- Gather user feedback on log accessibility
- Fine-tune verbosity based on support needs

## Dependencies

```json
{
  "dependencies": {
    "electron-log": "^5.1.0"
  }
}
```

## Estimated Effort

- **Planning & Design**: 0.5 days (COMPLETED)
- **Foundation Setup**: 0.5 days
- **Core Migration**: 2 days
- **Service Layer Migration**: 1 day
- **Supporting Modules**: 1 day
- **Testing & Documentation**: 1 day
- **Total**: ~6 days of focused development

## Summary: How This Solves Your Problems

### Before Logging System
| Issue | Problem | Impact |
|-------|---------|--------|
| **Recording Failures** | Meetings sometimes don't record, no way to know why | Lost meeting audio, manual retry, uncertainty |
| **Silent Upload Failures** | Uploads fail without visibility | Content not in Google Drive, no error message, can't diagnose |
| **Rename Breaks Things** | Renaming causes recording/upload failures | Files orphaned, uploads fail, data inconsistent |
| **No Pipeline Timing** | Can't measure end-to-end upload time | Can't optimize, can't audit SLA, no visibility |

### After Logging System
| Issue | Solution | Time to Diagnose |
|-------|----------|------------------|
| **Recording Failures** | Trace page lifecycle, see audio session cleanup delays, validate file growth | < 5 minutes with 3 grep commands |
| **Silent Upload Failures** | Correlation IDs track pipeline, auth failures explicit, error categorization | < 3 minutes with correlation ID |
| **Rename Breaks Things** | See old/new paths, verify filesystem ops, trace path resolution | < 5 minutes with [RENAME] filter |
| **No Pipeline Timing** | End-to-end T0→T8 breakdown, identify bottlenecks, measure each stage | < 1 minute with pipeline ID |

### Key Innovations
1. **Correlation IDs** - Track single meeting through entire pipeline (renderer → main → upload → Google Drive)
2. **Log Prefixes** - [RECORDING], [UPLOAD], [RENAME], [PIPELINE] enable instant filtering
3. **Structured Data** - Objects with context, not just string messages
4. **State Machine Logging** - Capture transitions, not just end states
5. **Timing Breakdown** - Measure each stage, identify bottlenecks
6. **Error Categorization** - auth/network/notfound/quota for targeted fixes
7. **Troubleshooting Guides** - Grep commands that actually work on real logs

### Example: Diagnosing "Meeting Won't Record"
```bash
# Before: No idea why, try restarting app, maybe reinstall?
# After: 3 commands, 2 minutes
grep "meetingId.*123.*Meeting page" logs/main.log  # See open/close/reopen
grep "meetingId.*123.*Start attempt" logs/main.log  # See timeSinceLastStop: 500ms ⚠️
# Root cause: Audio session not cleaned up, reopened too quickly
```

### Example: Diagnosing "Upload Failed Silently"
```bash
# Before: No error message, no idea what failed
# After: 1 command, 1 minute
grep "correlationId.*upload-123-172" logs/main.log  # See full pipeline
# Output shows: "Authentication failed" - need to reconnect Google Drive
```

### Example: Auditing Pipeline Timing
```bash
# Before: No idea how long uploads take
# After: 1 command, 30 seconds
grep "pipelineId.*pipeline-123.*T8" logs/main.log | jq '.breakdown'
# Output: Total 45 seconds, bottleneck is "t5_t4_wait: 30000" (queue backlog)
```

## References

- [electron-log Documentation](https://github.com/megahertz/electron-log)
- [Electron App Data Paths](https://www.electronjs.org/docs/latest/api/app#appgetpathname)
- [Node.js Logging Best Practices 2025](https://betterstack.com/community/guides/logging/)
- [PADL Protocol](../CLAUDE.md) - Principled Agentic Development Lifecycle
