# Developer Task: Fix Google Drive Upload Issues

## 🚨 CRITICAL: OAuth Token Expired
**Before any database fixes, the Google OAuth token has expired!**

Error: `invalid_grant: Token has been expired or revoked`

### Immediate User Action Required:
1. In the app, disconnect Google Drive 
2. Reconnect and re-authenticate
3. This will refresh the OAuth token and allow uploads to resume

### Developer Enhancement Needed:
Add automatic token refresh handling to prevent this in the future:
- Implement token refresh logic in `google-drive.js`
- Handle `invalid_grant` errors gracefully
- Prompt user to re-authenticate when token expires

## Context
The Granular CaptureOnly app has significant upload tracking issues where local meeting content exists but hasn't been uploaded to Google Drive due to incorrect database status tracking.

## Task Overview
Fix upload system data integrity issues and implement proper content detection to ensure all meeting content gets uploaded to Google Drive.

## Key Files to Review
1. **Analysis Document**: `/docs/upload-issues-analysis-and-fix-plan.md` - Complete problem analysis
2. **Upload Service**: `/src/upload-service.js` - Main upload logic
3. **Database**: `/src/database.js` - Upload status management (lines 713-757)
4. **Database Location**: `~/Library/Application Support/Electron/granular-captureonly.db`

## Phase 1: Immediate Database Fixes (Start Here)

### Problem Summary
- 11 meetings show uploaded BEFORE they occurred (impossible timestamps)
- 73 meetings marked "no_content" but some have recordings/notes
- 14 meetings stuck in "pending" status

### Required SQL Fixes
Run these commands against the app database:

```sql
-- Fix impossible upload timestamps (uploaded before meeting happened)
UPDATE meetings 
SET upload_status = 'pending', uploaded_at = NULL, gdrive_folder_id = NULL 
WHERE upload_status = 'completed' AND uploaded_at < start_time;

-- Fix meetings marked "no_content" that have recordings
UPDATE meetings 
SET upload_status = 'pending' 
WHERE upload_status = 'no_content' 
AND id IN (SELECT DISTINCT meeting_id FROM recording_sessions WHERE completed = 1);

-- Fix meetings marked "no_content" that have notes
UPDATE meetings 
SET upload_status = 'pending' 
WHERE upload_status = 'no_content' 
AND (notes_content IS NOT NULL AND notes_content != '');
```

### Verification Commands
```sql
-- Should return 0 after fixes
SELECT COUNT(*) FROM meetings WHERE upload_status = 'completed' AND uploaded_at < start_time;

-- Check how many meetings were reset to pending
SELECT upload_status, COUNT(*) FROM meetings GROUP BY upload_status;
```

## Phase 2: Improve Content Detection

### Current Issue
The app incorrectly marks meetings as "no_content" when they actually have:
- Markdown files in `/assets/YYYY-MM-DD/folder-name/`
- Audio recordings (`.opus` files)
- Notes content in database

### Implementation Task
1. **Enhance Upload Service** (`src/upload-service.js`):
   - Add `hasContentToUpload(meetingId)` function
   - Check all content sources before marking "no_content"
   - Update upload logic to use smart detection

2. **Content Sources to Check**:
   ```javascript
   async hasContentToUpload(meetingId) {
     // Check 1: Database notes
     const meeting = await this.database.getMeetingById(meetingId);
     if (meeting.notes_content && meeting.notes_content.trim() !== '') return true;
     
     // Check 2: Recording sessions
     const recordings = await this.database.getMeetingRecordings(meetingId);
     if (recordings && recordings.length > 0) return true;
     
     // Check 3: Local files (markdown, audio)
     const hasLocalFiles = await this.checkLocalFiles(meeting);
     if (hasLocalFiles) return true;
     
     return false;
   }
   ```

## Phase 3: Bulk Re-upload Script

### Create Recovery Script
File: `scripts/fix-missing-uploads.js`

```javascript
const Database = require('../src/database');
const UploadService = require('../src/upload-service');

async function fixMissingUploads() {
  // 1. Find all meetings with local content but wrong status
  // 2. Reset their status to 'pending'
  // 3. Queue them for upload
  // 4. Process upload queue
}

// Run: node scripts/fix-missing-uploads.js
```

## Testing & Validation

### Before Starting
1. **Backup Database**: 
   ```bash
   cp "~/Library/Application Support/Electron/granular-captureonly.db" backup.db
   ```

2. **Test Environment**: Run fixes on a copy first

### After Phase 1
1. Start the app and verify it runs normally
2. Check that upload queue begins processing pending meetings
3. Monitor upload progress in app logs

### Success Criteria
- All meetings with local content get uploaded to Google Drive
- No more impossible upload timestamps
- Accurate "no_content" detection (< 5% false positives)

## Key Code Locations

### Database Upload Status Management
```javascript
// src/database.js:713-757
async setMeetingUploadStatus(meetingId, status, gdriveFileId = null) {
  // This sets upload_status and uploaded_at timestamp
}
```

### Upload Queue Processing
```javascript
// src/upload-service.js
async processUploadQueue() {
  // Main upload logic - enhance content detection here
}
```

## Expected Timeline
- **Phase 1** (Database fixes): 1-2 hours
- **Phase 2** (Content detection): 4-6 hours  
- **Phase 3** (Bulk re-upload): 2-3 hours
- **Testing & Validation**: 2-3 hours

## Questions/Support
- Review the full analysis in `docs/upload-issues-analysis-and-fix-plan.md`
- Database schema details and examples included in analysis doc
- All SQL commands have been tested and verified safe

## Deliverables
1. ✅ Database cleanup completed (Phase 1)
2. ✅ Enhanced content detection implemented (Phase 2)
3. ✅ Bulk re-upload script created and run (Phase 3)
4. ✅ Verification that all local content is now uploaded
5. ✅ Documentation of changes made