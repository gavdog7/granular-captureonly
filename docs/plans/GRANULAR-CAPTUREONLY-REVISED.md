# Granular CaptureOnly - Revised Implementation Plan

## Project Overview
Create an Electron application for capturing meeting data from Excel files and recording system audio during meetings with note-taking capabilities.

## Revised File Organization Strategy

### Assets Directory Structure (Daily Organization)
```
assets/
├── 2025-07-09-Tuesday/
│   ├── {meeting-title-1}/
│   │   ├── recording-session-1.wav
│   │   ├── recording-session-2.wav
│   │   ├── notes.md
│   │   └── attachments/
│   │       ├── file1.pdf
│   │       └── file2.docx
│   └── {meeting-title-2}/
│       ├── recording-session-1.wav
│       ├── notes.md
│       └── attachments/
├── 2025-07-10-Wednesday/
│   └── {meeting-title-3}/
│       ├── recording-session-1.wav
│       └── notes.md
└── temp/
```

### Folder Naming Convention
- Format: `YYYY-MM-DD-DayOfWeek` (e.g., `2025-07-09-Tuesday`)
- All assets for a given day stored in single dated folder
- Meeting-specific subfolders within each day
- Multiple recording sessions per meeting supported

## Revised Milestone Breakdown

### Milestone 1: Excel Import & Meeting List Display
**Goal**: Load Excel file and display meeting list
**Files to create/modify**:
- `src/main.js` - Main Electron process
- `src/preload.js` - IPC bridge
- `src/data/excel-parser.js` - Excel processing
- `src/renderer/index.html` - Meeting selection UI
- `src/renderer/app.js` - Frontend logic
- `src/renderer/styles.css` - Basic styling
- `package.json` - Dependencies

**Features**:
- Automatically load Excel file on app start
- Parse '6-week meeting forecast' tab
- Display meetings in clean, clickable list format
- Show meeting title, date, time, participants
- Basic UI styling for meeting selection

**Success Criteria**:
- [ ] Excel file automatically loaded on app start
- [ ] Meeting list displays correctly with all required fields
- [ ] UI is responsive and clickable
- [ ] No console errors during normal operation

### Milestone 2: Meeting Selection & Navigation to Notes Page
**Goal**: Select meeting and navigate to notes interface
**Files to create/modify**:
- `src/renderer/notes.html` - Notes page UI template
- Update `src/renderer/app.js` - Meeting selection and navigation logic
- Update `src/renderer/styles.css` - Navigation styling
- Update `src/main.js` - IPC handlers for meeting selection

**Features**:
- Click meeting to select it
- Navigate from meeting list to notes page
- Pass meeting data to notes page
- Basic navigation between pages
- Meeting context preserved during navigation

**Success Criteria**:
- [ ] Meeting selection triggers navigation
- [ ] Notes page loads with meeting information
- [ ] Navigation is smooth and intuitive
- [ ] Meeting data correctly passed between pages

### Milestone 3: Notes Page Interface
**Goal**: Create functional notes interface without recording
**Files to create/modify**:
- Complete `src/renderer/notes.html` - Full notes page UI
- Update `src/renderer/app.js` - Notes page functionality
- Update `src/renderer/styles.css` - Notes page styling
- Add `src/storage/file-manager.js` - Basic file operations

**Features**:
- Display meeting title at top
- Show meeting participants (editable list)
- Large markdown text area for notes
- Back button to return to meeting list
- Basic file system integration for notes persistence

**Success Criteria**:
- [ ] Meeting title and participants display correctly
- [ ] Markdown text area is functional and saves
- [ ] Participant list is editable
- [ ] Back button returns to meeting list
- [ ] Notes persist when navigating away and back

### Milestone 4: Audio Recording with Status Indicator
**Goal**: Add system audio recording with visual status feedback
**Files to create/modify**:
- `src/audio/native-audio-capture.js` - System audio capture
- Update `src/storage/file-manager.js` - Recording file management
- Update `src/renderer/notes.html` - Recording status indicator
- Update `src/renderer/app.js` - Recording control logic
- Update `src/main.js` - Audio recording IPC handlers

**Features**:
- Start audio recording when entering notes page
- Visual recording status indicator (green dot for recording, red for errors)
- Stop recording when leaving notes page
- Save recordings to daily folder structure
- Real-time status updates

**Success Criteria**:
- [ ] Audio recording starts automatically on notes page entry
- [ ] Recording status indicator shows correct state (green/red)
- [ ] System audio is captured successfully
- [ ] Recording stops when navigating back
- [ ] Files saved to correct daily folder structure

### Milestone 5: File Attachment System
**Goal**: Drag & drop file attachment functionality
**Files to create/modify**:
- Update `src/storage/file-manager.js` - File attachment handling
- Update `src/renderer/notes.html` - Drop zone UI
- Update `src/renderer/app.js` - File attachment logic
- Update `src/renderer/styles.css` - Drop zone styling

**Features**:
- Drag & drop zone for file attachments
- Copy files to meeting-specific attachments folder
- Display list of attached files
- Basic file management (remove attachments)
- Files organized in daily folder structure

**Success Criteria**:
- [ ] File drop zone accepts files via drag & drop
- [ ] Files copied to correct attachments folder
- [ ] Attached files listed in UI
- [ ] File removal functionality works
- [ ] Files properly organized in daily structure

### Milestone 6: File Management & Session Persistence
**Goal**: Enhanced file organization and data persistence
**Files to create/modify**:
- Update `src/storage/file-manager.js` - Enhanced file operations
- Add `src/data/meeting-store.js` - Meeting data storage
- Update `src/main.js` - Session persistence
- Update folder creation logic for daily structure

**Features**:
- Automatic daily folder creation
- Meeting data persistence between sessions
- Enhanced file organization within daily folders
- Meeting metadata storage
- Proper cleanup of temporary files

**Success Criteria**:
- [ ] Daily folders created automatically
- [ ] Meeting data persists between app sessions
- [ ] Files properly organized by date and meeting
- [ ] Metadata storage works correctly
- [ ] No orphaned files or folders

### Milestone 7: Resume Recording Functionality
**Goal**: Resume recording for existing meetings
**Files to create/modify**:
- Update `src/audio/native-audio-capture.js` - Multiple recording sessions
- Update `src/storage/file-manager.js` - Session file versioning
- Update `src/renderer/app.js` - Resume recording logic
- Update `src/data/meeting-store.js` - Session tracking

**Features**:
- Click existing meeting to resume
- Create new recording session file
- Load previous notes and participants
- Maintain recording session history
- Visual indication of multiple sessions

**Success Criteria**:
- [ ] Previously recorded meetings show in list
- [ ] Resume recording creates new session file
- [ ] Previous notes and participants load correctly
- [ ] Multiple recording sessions tracked per meeting
- [ ] Session history maintained in daily folders

## Technical Architecture

### Core Technologies
- **Electron**: Main application framework
- **Node.js**: Backend services  
- **HTML/CSS/JavaScript**: Frontend UI
- **XLSX**: Excel file processing
- **Native Audio Capture**: System audio recording
- **File System API**: Local file storage

### Project Structure
```
granular-captureonly/
├── docs/
│   └── plans/
├── src/
│   ├── main.js                 # Main Electron process
│   ├── preload.js             # Preload script for IPC
│   ├── audio/
│   │   └── native-audio-capture.js
│   ├── data/
│   │   ├── excel-parser.js     # Excel file processing
│   │   └── meeting-store.js    # Meeting data storage
│   ├── storage/
│   │   └── file-manager.js     # File system operations
│   └── renderer/
│       ├── index.html          # Meeting selection page
│       ├── notes.html          # Notes page
│       ├── app.js              # Main application logic
│       └── styles.css          # Application styles
├── assets/                     # Daily organized recordings and files
├── package.json
└── README.md
```

## Data Models

### Meeting Data Structure
```javascript
{
  id: string,
  title: string,
  body: string,
  startDate: Date,
  endDate: Date,
  startTime: string,
  endTime: string,
  participants: string[],
  status: 'OWNER' | 'INVITED',
  notes: string,
  recordings: string[],
  attachments: string[],
  sessions: [{
    timestamp: Date,
    recordingFile: string,
    notes: string
  }]
}
```

### Daily Folder Structure
```javascript
{
  date: string, // YYYY-MM-DD
  dayOfWeek: string, // Monday, Tuesday, etc.
  folderName: string, // 2025-07-09-Tuesday
  meetings: [{
    meetingTitle: string,
    recordingSessions: string[],
    notesFile: string,
    attachments: string[]
  }]
}
```

## User Flow

### Primary Workflow
1. **App Launch**: Excel file loaded, meetings displayed
2. **Meeting Selection**: Click meeting → navigate to notes page
3. **Notes Page**: Meeting info displayed, text area ready
4. **Auto-Recording**: Recording starts automatically, status indicator shows green
5. **Note Taking**: User types notes, can edit participants
6. **File Attachment**: Drag files to attach to meeting
7. **Navigation Back**: Recording stops, files saved to daily folder
8. **Resume**: Click same meeting again → new recording session starts

### File Organization Flow
1. **Daily Folder Creation**: Auto-created based on current date
2. **Meeting Subfolder**: Created within daily folder
3. **Recording Files**: Multiple sessions numbered sequentially
4. **Notes Persistence**: Single notes.md file per meeting
5. **Attachments**: Separate attachments subfolder

## Risk Assessment & Mitigation

### Technical Risks
1. **Audio Permissions**: macOS requires specific permissions for system audio
   - **Mitigation**: Implement permission request flow and clear error messages

2. **Daily Folder Management**: Complex date-based folder structure
   - **Mitigation**: Robust date handling and folder validation

3. **File Naming Conflicts**: Multiple sessions may create naming conflicts
   - **Mitigation**: Timestamp-based naming with session numbering

### User Experience Risks
1. **Recording Status**: Users may not know if recording is active
   - **Mitigation**: Prominent visual indicator and status messages

2. **File Organization**: Users may lose track of daily folders
   - **Mitigation**: Clear folder naming and consistent organization

## Success Criteria Summary

### Overall Application Success
- [ ] Excel file automatically processed on startup
- [ ] Meeting list displays correctly with all data
- [ ] Meeting selection navigates to notes page
- [ ] Notes page shows meeting details and allows editing
- [ ] Audio recording starts/stops automatically
- [ ] Recording status clearly indicated with green/red dot
- [ ] File attachments work via drag & drop
- [ ] All files organized in daily folder structure
- [ ] Resume recording creates new session files
- [ ] Notes and attachments persist between sessions

### File Organization Success
- [ ] Daily folders created automatically (YYYY-MM-DD-DayOfWeek)
- [ ] Meeting subfolders within each day
- [ ] Multiple recording sessions per meeting
- [ ] Notes and attachments properly organized
- [ ] No orphaned files or incorrect folder structure

## Dependencies & Requirements

### Node.js Dependencies
- `electron` - Main framework
- `xlsx` - Excel file processing
- `path` - File system operations
- `fs` - File system access
- `date-fns` - Date formatting and manipulation
- Native audio capture module (from granular-mac)

### System Requirements
- macOS 10.15+ (for system audio capture)
- Node.js 16+
- Electron 22+
- System audio permissions

## Conclusion

This revised implementation plan addresses the specific requirements for daily folder organization and separates the milestone progression into logical, testable increments:

1. **Data Foundation** (Milestone 1)
2. **Navigation** (Milestone 2) 
3. **Notes Interface** (Milestone 3)
4. **Audio Recording** (Milestone 4)
5. **File Management** (Milestones 5-7)

The daily folder structure ensures all meeting assets are organized by date, making it easy to find recordings, notes, and attachments for any given day. Each milestone builds upon the previous one, allowing for thorough testing and user feedback at each stage.