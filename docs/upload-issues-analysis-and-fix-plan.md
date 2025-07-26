# Upload Issues Analysis & Fix Plan

## CRITICAL UPDATE: OAuth Token Expired

### 🚨 **Primary Issue: Google OAuth Token Expired**
The error logs show `invalid_grant: Token has been expired or revoked`. This means:
- The Google Drive authentication token has expired
- **ALL uploads are failing** due to authentication, not data integrity issues
- The user needs to re-authenticate with Google before ANY uploads can work

### Immediate Action Required
**The user must disconnect and reconnect their Google Drive account to refresh the OAuth token.**

## Problem Summary

Investigation revealed significant issues with Google Drive upload tracking that resulted in local meeting content not being uploaded despite showing as "completed" in the database.

### Key Statistics
- **11 meetings**: Marked as "completed" but uploaded BEFORE the meeting occurred (data integrity issue)
- **73 meetings**: Marked as "no_content" but some have actual recordings/notes
- **23 meetings**: Have "no_content" status but recordings exist in database
- **14 meetings**: Stuck in "pending" status
- **Total affected**: ~87+ meetings with incorrect upload status

## Root Cause Analysis

### 1. Data Integrity Issues
**Problem**: Meetings show `uploaded_at` timestamps before their `start_time`
```sql
-- Example: Meeting ID 7
-- title: "Gavin/Stephen 1:1" 
-- start_time: "2025-07-21T20:00:00.000Z"
-- uploaded_at: "2025-07-14T19:58:14.607Z" (7 days BEFORE meeting!)
-- upload_status: "completed"
```

**Root Cause**: Recurring meetings inherit upload status from previous instances without proper timestamp reset.

### 2. False "No Content" Detection
**Problem**: Meetings marked as `no_content` despite having:
- Local markdown files in `/assets/YYYY-MM-DD/folder-name/`
- Completed recording sessions in database
- Notes content in `meetings.notes_content`

**Root Cause**: Content detection logic doesn't properly check all content sources.

### 3. Stale Upload Status
**Problem**: Upload status not updated when meeting content changes after initial processing.

## Detailed Examples

### Anomalous Upload Timestamps
```sql
SELECT id, title, start_time, uploaded_at 
FROM meetings 
WHERE upload_status = 'completed' AND uploaded_at < start_time;

-- Returns 11 meetings with impossible upload timestamps
```

### False No-Content Status
```sql
SELECT COUNT(*) FROM meetings m 
INNER JOIN recording_sessions r ON m.id = r.meeting_id 
WHERE m.upload_status = 'no_content' AND r.completed = 1;

-- Returns 23 meetings marked "no_content" but have recordings
```

## Proposed Solution: 3-Phase Approach

### Phase 1: Database Cleanup & Reset (HIGH PRIORITY)
**Objective**: Fix data integrity issues immediately

**Actions**:
1. Reset anomalous upload statuses where `uploaded_at < start_time`
2. Reset meetings with false "no_content" status that have recordings
3. Clear invalid Google Drive folder IDs

**SQL Commands**:
```sql
-- Fix meetings uploaded before they happened
UPDATE meetings 
SET upload_status = 'pending', uploaded_at = NULL, gdrive_folder_id = NULL 
WHERE upload_status = 'completed' AND uploaded_at < start_time;

-- Fix false no-content meetings that have recordings
UPDATE meetings 
SET upload_status = 'pending' 
WHERE upload_status = 'no_content' 
AND id IN (SELECT DISTINCT meeting_id FROM recording_sessions WHERE completed = 1);

-- Fix false no-content meetings that have notes
UPDATE meetings 
SET upload_status = 'pending' 
WHERE upload_status = 'no_content' 
AND (notes_content IS NOT NULL AND notes_content != '');
```

**Expected Impact**: ~34+ meetings reset to pending status for proper upload

### Phase 2: Smart Content Detection (MEDIUM PRIORITY)
**Objective**: Prevent future false "no_content" classifications

**Implementation**:
1. Create `hasContentToUpload(meetingId)` function that checks:
   - Markdown files in `/assets/YYYY-MM-DD/folder-name/`
   - Completed recording sessions in database
   - Non-empty `notes_content` field
   - Attachment files

2. Update upload service to use smart detection before marking "no_content"

**Code Location**: `src/upload-service.js` - enhance content detection logic

### Phase 3: Bulk Re-upload System (LOW PRIORITY)
**Objective**: Systematically upload all missing content

**Implementation**:
1. Create audit script to compare local assets vs database upload status
2. Generate list of meetings with local content but missing from Google Drive
3. Implement bulk queue system with:
   - Chronological ordering (oldest first)
   - Progress tracking
   - Failure handling and retry logic
   - Rate limiting to avoid API limits

**Deliverables**:
- `scripts/audit-missing-uploads.js` - Identify missing uploads
- `scripts/bulk-reupload.js` - Queue missing uploads
- Enhanced error logging and monitoring

## Database Schema Context

### Key Tables
```sql
-- Meetings table
meetings (
  id INTEGER PRIMARY KEY,
  title TEXT,
  folder_name TEXT,
  start_time TEXT,
  upload_status TEXT DEFAULT 'pending',
  uploaded_at TEXT,
  gdrive_folder_id TEXT,
  notes_content TEXT
)

-- Recording sessions
recording_sessions (
  id INTEGER PRIMARY KEY,
  meeting_id INTEGER,
  completed BOOLEAN DEFAULT 0
)

-- Upload queue
upload_queue (
  id INTEGER PRIMARY KEY,
  meeting_id INTEGER,
  status TEXT DEFAULT 'pending',
  attempts INTEGER DEFAULT 0
)
```

### Upload Status Values
- `pending`: Not yet uploaded
- `completed`: Successfully uploaded to Google Drive
- `no_content`: Meeting has no content to upload
- `failed`: Upload failed after retries

## File System Structure
```
assets/
├── YYYY-MM-DD/
│   ├── meeting-folder-name/
│   │   ├── meeting-notes.md
│   │   ├── recording-*.opus
│   │   └── attachments/
```

## Implementation Priority

### Immediate (Phase 1)
- [ ] Run database cleanup SQL commands
- [ ] Verify corrected upload statuses
- [ ] Test upload queue processing

### Short-term (Phase 2)
- [ ] Implement smart content detection
- [ ] Update upload service logic
- [ ] Add comprehensive logging

### Long-term (Phase 3)
- [ ] Create audit scripts
- [ ] Implement bulk re-upload system
- [ ] Add monitoring and alerting

## Success Criteria

1. **Data Integrity**: Zero meetings with `uploaded_at < start_time`
2. **Content Detection**: Accurate "no_content" classifications (< 5% false positives)
3. **Upload Coverage**: All meetings with local content successfully uploaded
4. **Monitoring**: Real-time visibility into upload queue status and failures

## Risks & Mitigation

### Risk: Duplicate Uploads
**Mitigation**: Check Google Drive folder existence before upload

### Risk: API Rate Limits
**Mitigation**: Implement exponential backoff and rate limiting

### Risk: Data Loss
**Mitigation**: Backup database before cleanup operations

## Testing Strategy

1. **Phase 1**: Verify database changes don't break existing functionality
2. **Phase 2**: Test content detection with various meeting types
3. **Phase 3**: Test bulk upload with small batch first

## Monitoring & Alerting

- Upload queue length monitoring
- Failed upload rate tracking
- Daily upload summary reports
- Alert on repeated failures for same meeting