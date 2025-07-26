# OAuth Fix and Upload Recovery Plan

## 🚨 Critical Issue: Google OAuth Token Expired

### Problem
All Google Drive uploads are failing with:
```
error: 'invalid_grant',
error_description: 'Token has been expired or revoked.'
```

This means the stored OAuth refresh token is no longer valid and ALL uploads will fail until re-authentication.

## Immediate Fix (For You)

### Step 1: Re-authenticate with Google
1. Open the Granular CaptureOnly app
2. Look for Google Drive connection status (likely shows as connected but it's using expired token)
3. Click "Disconnect" from Google Drive
4. Click "Connect" to Google Drive again
5. Complete the OAuth flow in your browser
6. The app should now have a fresh token

### Step 2: Verify Connection
After reconnecting:
1. Check if new meetings start uploading automatically
2. Monitor the logs for successful uploads
3. If uploads still fail, there may be additional issues

## Developer Tasks

### Phase 0: OAuth Token Management (URGENT)
**File**: `src/google-drive.js`

#### Current Issue
The app doesn't handle token expiration gracefully. When the refresh token expires or is revoked, all uploads fail silently.

#### Required Implementation
```javascript
// In google-drive.js - Add token refresh handling
async handleAuthError(error) {
  if (error.message.includes('invalid_grant')) {
    // Token expired or revoked
    console.error('🔐 Google OAuth token expired - user must re-authenticate');
    
    // Notify the UI
    if (this.mainWindow) {
      this.mainWindow.webContents.send('google-auth-expired');
    }
    
    // Clear stored tokens
    await this.clearStoredTokens();
    
    // Return specific error for upload service to handle
    throw new Error('AUTH_EXPIRED');
  }
  throw error;
}

// In upload-service.js - Handle auth errors
async uploadMeeting(meetingId) {
  try {
    // ... existing upload logic
  } catch (error) {
    if (error.message === 'AUTH_EXPIRED') {
      // Don't retry - mark as auth failure
      await this.database.setMeetingUploadStatus(meetingId, 'auth_failed');
      
      // Notify user to re-authenticate
      this.notifyAuthRequired();
      return;
    }
    // ... handle other errors
  }
}
```

### Phase 1: Database Cleanup (After OAuth Fixed)
Once authentication is working:

```sql
-- Reset meetings that failed due to auth issues
UPDATE meetings 
SET upload_status = 'pending' 
WHERE upload_status = 'failed' 
AND (uploaded_at IS NULL OR uploaded_at > '2025-07-24');

-- Fix the data integrity issues (as previously identified)
UPDATE meetings 
SET upload_status = 'pending', uploaded_at = NULL, gdrive_folder_id = NULL 
WHERE upload_status = 'completed' AND uploaded_at < start_time;
```

### Phase 2: Bulk Recovery
After OAuth is fixed and database is cleaned:
1. All pending meetings should start uploading automatically
2. Monitor progress and handle any content detection issues
3. Implement the enhanced content detection as previously planned

## Expected Timeline

### Today (Immediate)
1. **You**: Disconnect and reconnect Google Drive (5 minutes)
2. **Verify**: Check if uploads resume (10 minutes)

### Developer Implementation
1. **Phase 0**: OAuth error handling (2-3 hours)
2. **Phase 1**: Database cleanup (1 hour)
3. **Phase 2**: Monitor recovery (ongoing)

## Monitoring Upload Recovery

After re-authentication, check upload progress:
```sql
-- Monitor upload queue
SELECT status, COUNT(*) FROM upload_queue GROUP BY status;

-- Check recent upload attempts
SELECT id, title, upload_status, uploaded_at 
FROM meetings 
WHERE updated_at > datetime('now', '-1 hour')
ORDER BY updated_at DESC;

-- Count pending uploads
SELECT COUNT(*) FROM meetings WHERE upload_status = 'pending';
```

## Prevention Strategy

### 1. Token Refresh Implementation
- Implement automatic token refresh before expiration
- Google OAuth tokens typically last 6 months
- Refresh tokens can expire if unused for 6 months

### 2. Auth Status Monitoring
- Add periodic auth validation checks
- Notify user BEFORE token expires
- Add "Test Connection" button in settings

### 3. Error Handling
- Distinguish between temporary and permanent auth failures
- Don't mark meetings as "failed" for auth issues
- Queue them separately for retry after re-auth

## Quick Summary for Another Developer

> "The Google OAuth token expired, causing all uploads to fail with `invalid_grant`. The user needs to disconnect and reconnect Google Drive to fix it immediately. Then implement proper token refresh handling in `google-drive.js` to prevent this. After auth is fixed, run the database cleanup SQL to reset ~87 meetings that have incorrect upload status, and they'll upload automatically."