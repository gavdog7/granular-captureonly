# Final Google Drive Sync Reliability Fix

## Goals
1. **Ensure all files get backed up** (primary concern)
2. **Prevent duplicate uploads** (avoid re-uploading)
3. **Simple, reliable implementation** (no over-engineering)

## Root Cause
Files aren't syncing because the upload service only looks for files recorded in the database. When meeting folders are renamed or database entries are missing, files become "invisible" to the sync process.

## Solution: Directory-First Approach

### Core Change: Enhanced File Discovery

Update `gatherMeetingFiles()` in `src/upload-service.js`:

```javascript
async gatherMeetingFiles(meetingId, meeting) {
  const files = [];
  const dateStr = meeting.start_time.split('T')[0];
  const projectRoot = path.dirname(__dirname);
  const meetingDir = path.join(projectRoot, 'assets', dateStr, meeting.folder_name);

  try {
    // Check if meeting directory exists
    if (!await fs.pathExists(meetingDir)) {
      console.log(`📁 Meeting directory not found: ${meetingDir}`);
      return files;
    }

    // Get ALL files in the meeting directory
    const dirFiles = await fs.readdir(meetingDir);
    
    // 1. Add markdown files
    const markdownFiles = dirFiles.filter(f => f.endsWith('.md'));
    for (const mdFile of markdownFiles) {
      const filePath = path.join(meetingDir, mdFile);
      const stats = await fs.stat(filePath);
      files.push({
        name: mdFile,
        path: filePath,
        size: stats.size,
        type: 'markdown'
      });
      console.log(`📝 Found markdown: ${mdFile}`);
    }
    
    // 2. Add audio files (.opus, .m4a, .wav)
    const audioExtensions = ['.opus', '.m4a', '.wav', '.mp3'];
    const audioFiles = dirFiles.filter(f => 
      audioExtensions.some(ext => f.endsWith(ext))
    );
    
    for (const audioFile of audioFiles) {
      const filePath = path.join(meetingDir, audioFile);
      const stats = await fs.stat(filePath);
      
      // Get duration from database if available
      const recordings = await this.database.getMeetingRecordings(meetingId);
      const recording = recordings.find(r => 
        path.basename(r.final_path || '') === audioFile
      );
      
      files.push({
        name: audioFile,
        path: filePath,
        size: stats.size,
        type: 'audio',
        duration: recording?.duration || null
      });
      console.log(`🎵 Found audio: ${audioFile} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
    }

    console.log(`📊 Total files found for meeting ${meetingId}: ${files.length}`);

  } catch (error) {
    console.error('Error gathering meeting files:', error);
    throw error;
  }

  return files;
}
```

### Prevent Duplicate Uploads

The existing code already handles this well:

```javascript
async uploadFileToGoogleDrive(file, parentFolderId) {
  try {
    const drive = this.googleDriveService.drive;

    // Check if file already exists and delete it
    const existingFiles = await drive.files.list({
      q: `name='${file.name}' and '${parentFolderId}' in parents and trashed=false`,
      fields: 'files(id, name)'
    });

    if (existingFiles.data.files.length > 0) {
      console.log(`🗑️ Deleting existing file: ${file.name}`);
      await drive.files.delete({
        fileId: existingFiles.data.files[0].id
      });
    }

    // Upload new file
    // ... rest of upload logic
  }
}
```

This ensures files are replaced, not duplicated.

### Fix Upload Status Logic

Update the content check to be more aggressive about finding content:

```javascript
async hasContentToUpload(meetingId, meeting) {
  try {
    const dateStr = meeting.start_time.split('T')[0];
    const projectRoot = path.dirname(__dirname);
    const meetingDir = path.join(projectRoot, 'assets', dateStr, meeting.folder_name);

    // If directory exists and has any content files, return true
    if (await fs.pathExists(meetingDir)) {
      const files = await fs.readdir(meetingDir);
      const contentFiles = files.filter(file => 
        file.endsWith('.md') || 
        file.endsWith('.opus') || 
        file.endsWith('.wav') || 
        file.endsWith('.m4a') ||
        file.endsWith('.mp3')
      );
      
      if (contentFiles.length > 0) {
        console.log(`✅ Meeting ${meetingId} has ${contentFiles.length} content files`);
        return true;
      }
    }

    // Still check database for notes (in case markdown not exported yet)
    if (meeting.notes_content && 
        meeting.notes_content.trim() !== '' && 
        meeting.notes_content !== '{}' &&
        meeting.notes_content !== '[]') {
      return true;
    }

    return false;
  } catch (error) {
    console.error(`Error checking content for meeting ${meetingId}:`, error);
    return true; // Default to true to avoid missing content
  }
}
```

### Immediate Fix Script

Create `scripts/sync-all-content.js`:

```javascript
const path = require('path');
const fs = require('fs-extra');
const Database = require('../src/database');
const UploadService = require('../src/upload-service');
const GoogleDriveService = require('../src/google-drive');

async function syncAllContent() {
  const db = new Database();
  const googleDrive = new GoogleDriveService();
  const uploadService = new UploadService(db, googleDrive, null);

  try {
    await db.initialize();
    await googleDrive.initializeOAuth();
    
    console.log('🚀 Starting comprehensive sync...\n');
    
    // 1. Reset all false "no_content" statuses
    const resetResult = await db.run(`
      UPDATE meetings 
      SET upload_status = 'pending' 
      WHERE upload_status = 'no_content'
    `);
    console.log(`✅ Reset ${resetResult.changes} meetings from no_content to pending\n`);
    
    // 2. Get all meetings that need checking
    const meetings = await db.all(`
      SELECT * FROM meetings 
      WHERE upload_status != 'completed' OR upload_status IS NULL
      ORDER BY start_time DESC
    `);
    
    console.log(`📋 Found ${meetings.length} meetings to check\n`);
    
    // 3. Queue meetings with content for upload
    let queuedCount = 0;
    for (const meeting of meetings) {
      const hasContent = await uploadService.hasContentToUpload(meeting.id, meeting);
      if (hasContent) {
        await uploadService.queueMeetingUpload(meeting.id);
        queuedCount++;
        console.log(`📤 Queued: ${meeting.title}`);
      } else {
        console.log(`⏭️  Skipped (no content): ${meeting.title}`);
      }
    }
    
    console.log(`\n✅ Queued ${queuedCount} meetings for upload`);
    
    // 4. Process the upload queue
    console.log('\n🔄 Processing upload queue...\n');
    await uploadService.processUploadQueue();
    
    console.log('\n🎉 Sync complete!');
    
  } catch (error) {
    console.error('\n❌ Sync failed:', error);
  } finally {
    await db.close();
  }
}

// Run the sync
syncAllContent();
```

### Add to Regular Health Check

Update `MeetingHealthChecker` to use the new directory-based approach:

```javascript
async checkMeetingHealth(meeting) {
  // ... existing health checks ...
  
  // Always re-evaluate meetings marked as "no_content"
  if (meeting.upload_status === 'no_content') {
    const hasContent = await this.uploadService.hasContentToUpload(meeting.id, meeting);
    if (hasContent) {
      console.log(`🔄 Meeting ${meeting.id} has content, resetting status from no_content to pending`);
      await this.database.setMeetingUploadStatus(meeting.id, 'pending');
      await this.uploadService.queueMeetingUpload(meeting.id);
    }
  }
}
```

## Implementation Steps

1. **Backup First**
   ```bash
   cp granular.db granular.db.backup
   ```

2. **Update Upload Service**
   - Replace `gatherMeetingFiles()` with directory-based version
   - Update `hasContentToUpload()` to check directory first

3. **Run Sync Script**
   ```bash
   node scripts/sync-all-content.js
   ```

4. **Monitor Results**
   - Check logs for any errors
   - Verify files appearing in Google Drive

## Expected Outcome

- All 210 unsynced files will be discovered and uploaded
- Future recordings will sync reliably regardless of database state
- No duplicate uploads (existing logic handles this)
- Simple, maintainable solution

## Why This Works

1. **Directory-first approach**: Finds all files regardless of database state
2. **Aggressive content detection**: Checks actual files, not just database
3. **Preserves existing safeguards**: No duplicate uploads
4. **Simple implementation**: No complex validation or rate limiting needed

This approach ensures nothing gets missed while keeping the implementation straightforward.