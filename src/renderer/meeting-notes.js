// Meeting Notes Page JavaScript
console.log('meeting-notes.js script loading...');
const { ipcRenderer } = require('electron');
console.log('ipcRenderer loaded successfully');

let quill;
let currentMeetingId;
let saveTimeout;
let isLoading = true;
let recordingStatusInterval;
let currentRecordingStatus = null;
let initialNotesContent = null; // Track initial notes content for change detection

// Initialize page
document.addEventListener('DOMContentLoaded', async () => {
    console.log('Meeting notes page loading...');
    
    // Get meeting ID from URL params
    const urlParams = new URLSearchParams(window.location.search);
    currentMeetingId = urlParams.get('meetingId');
    
    console.log('Meeting ID from URL:', currentMeetingId);
    
    if (!currentMeetingId) {
        console.error('No meeting ID provided');
        window.location.href = 'index.html';
        return;
    }
    
    console.log('Initializing components...');
    
    // Initialize components
    initializeQuillEditor();
    console.log('Quill editor initialized');
    
    initializeEventListeners();
    console.log('Event listeners initialized');
    
    await loadMeetingData();
    console.log('Meeting data loaded');
    
    // Initialize recording functionality
    await initializeRecording();
    console.log('Recording initialized');
    
    // Hide loading overlay
    hideLoadingOverlay();
    console.log('Page initialization complete');
});

// Initialize Quill editor with custom configuration
function initializeQuillEditor() {
    console.log('Initializing Quill editor...');
    
    if (typeof Quill === 'undefined') {
        console.error('Quill is not loaded!');
        return;
    }
    
    const editorElement = document.getElementById('editor');
    if (!editorElement) {
        console.error('Editor element not found!');
        return;
    }
    
    const toolbarOptions = [
        ['bold', 'italic', 'underline'],
        ['blockquote', 'code-block'],
        [{ 'list': 'ordered'}, { 'list': 'bullet' }],
        [{ 'indent': '-1'}, { 'indent': '+1' }],
        ['link'],
        ['clean']
    ];
    
    console.log('Creating Quill instance...');
    quill = new Quill('#editor', {
        theme: 'snow',
        modules: {
            toolbar: toolbarOptions,
            keyboard: {
                bindings: {
                    'bold': {
                        key: 'B',
                        ctrlKey: true,
                        handler: function() {
                            this.quill.format('bold', !this.quill.getFormat().bold);
                        }
                    },
                    'italic': {
                        key: 'I',
                        ctrlKey: true,
                        handler: function() {
                            this.quill.format('italic', !this.quill.getFormat().italic);
                        }
                    },
                    'tab': {
                        key: 'Tab',
                        handler: function(range) {
                            this.quill.format('indent', '+1');
                            return false;
                        }
                    },
                    'shift-tab': {
                        key: 'Tab',
                        shiftKey: true,
                        handler: function(range) {
                            this.quill.format('indent', '-1');
                            return false;
                        }
                    },
                    'save': {
                        key: 'S',
                        ctrlKey: true,
                        handler: function() {
                            saveNotes();
                            return false;
                        }
                    }
                }
            }
        },
        placeholder: 'Write notes...'
    });
    
    // Set up auto-save on text change
    quill.on('text-change', (delta, oldDelta, source) => {
        console.log('Text change detected:', { delta, source, isLoading });
        if (source === 'user' && !isLoading) {
            console.log('User text change - setting save status and scheduling auto-save');
            setSaveStatus('saving'); // Immediately show saving status
            scheduleAutoSave();
        }
    });
    
    // Set up drag and drop for attachments
    setupDragAndDrop();
}

// Initialize event listeners
function initializeEventListeners() {
    // Back button - wait for save before navigating
    const backButton = document.getElementById('backButton');
    console.log('🔗 Setting up back button listener, element found:', !!backButton);
    
    if (backButton) {
        backButton.addEventListener('click', (e) => {
            console.log('🖱️ Back button clicked!');
            e.preventDefault(); // Prevent default navigation immediately
            e.stopPropagation(); // Stop event bubbling
            
            // Run async handler without blocking preventDefault
            handleNavigationBack().catch(error => {
                console.error('Error in navigation handler:', error);
                // Still navigate even if handler fails
                window.location.href = 'index.html';
            });
        });
    } else {
        console.error('❌ Back button element not found!');
    }
    
    // Escape key to go back - wait for save before navigating
    document.addEventListener('keydown', async (e) => {
        if (e.key === 'Escape' || (e.metaKey && e.key === 'ArrowLeft')) {
            console.log('⌨️ Escape/back key pressed!');
            e.preventDefault(); // Prevent default behavior
            await handleNavigationBack();
        }
    });
    
    // Save before page unload and stop recording
    window.addEventListener('beforeunload', (e) => {
        // Stop recording status updates
        stopRecordingStatusUpdates();
        
        // Stop recording if active
        if (currentRecordingStatus && currentRecordingStatus.isRecording) {
            console.log('Page unloading, stopping recording');
            try {
                // Use synchronous IPC to stop recording before page unload
                ipcRenderer.sendSync('stop-recording-sync', parseInt(currentMeetingId));
                console.log('Recording stopped synchronously');
            } catch (error) {
                console.error('Error stopping recording synchronously:', error);
            }
        }
        
        // Save notes
        if (saveTimeout) {
            clearTimeout(saveTimeout);
            console.log('Page unloading, forcing immediate save');
            // Force an immediate synchronous save
            try {
                const content = quill.getContents();
                const contentStr = JSON.stringify(content);
                // Use sendSync for synchronous save before page unload
                ipcRenderer.sendSync('update-meeting-notes-sync', currentMeetingId, contentStr);
                console.log('Synchronous save completed');
                // Update initial content even in sync save
                initialNotesContent = contentStr;
            } catch (error) {
                console.error('Error in synchronous save:', error);
            }
        }
        
        // Note: We don't export markdown on beforeunload because:
        // 1. It would need to be synchronous which could block the page
        // 2. The user might be refreshing or navigating elsewhere
        // 3. We only export when explicitly going back to nav page
    });
    
    // Save on focus loss
    window.addEventListener('blur', async () => {
        await ensureNotesAreSaved();
    });
    
    
    // Edit title functionality - click title to edit
    document.getElementById('meetingTitle').addEventListener('click', startEditingTitle);
    document.getElementById('meetingTitleInput').addEventListener('blur', saveTitle);
    document.getElementById('meetingTitleInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            saveTitle();
        }
        if (e.key === 'Escape') {
            cancelEditTitle();
        }
    });
    
    // New inline participant functionality
    document.getElementById('addParticipantBtn').addEventListener('click', showInlineParticipantInput);
    
    // Inline participant input handling
    const inlineInput = document.getElementById('participantInlineInput');
    inlineInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            addParticipantFromInline();
        }
        if (e.key === 'Escape') {
            hideInlineParticipantInput();
        }
    });
    
    inlineInput.addEventListener('blur', () => {
        // Hide if empty when clicking away
        if (!inlineInput.value.trim()) {
            hideInlineParticipantInput();
        }
    });
}

// Load meeting data from database
async function loadMeetingData() {
    try {
        const meeting = await ipcRenderer.invoke('get-meeting-by-id', currentMeetingId);
        
        if (!meeting) {
            console.error('Meeting not found');
            window.location.href = 'index.html';
            return;
        }
        
        // Update meeting details
        document.getElementById('meetingTitle').textContent = meeting.title;
        document.getElementById('meetingTime').textContent = formatMeetingTime(meeting.start_time, meeting.end_time);
        
        // Load participants
        let participants = [];
        try {
            participants = meeting.participants ? JSON.parse(meeting.participants) : [];
        } catch (e) {
            console.warn('Failed to parse participants, using empty array', e);
            participants = [];
        }
        renderParticipants(participants);
        
        // Load notes content
        console.log('Loading notes for meeting:', meeting.id, 'Notes content:', meeting.notes_content);
        // Store initial notes content for change detection
        initialNotesContent = meeting.notes_content || null;
        console.log('🔢 Initial notes content stored:', initialNotesContent ? 'exists' : 'null');
        
        if (meeting.notes_content) {
            // Set loading to true temporarily while setting content
            const wasLoading = isLoading;
            isLoading = true;
            try {
                const parsedContent = JSON.parse(meeting.notes_content);
                console.log('Parsed notes content:', parsedContent);
                // Validate it's a proper Quill Delta
                if (parsedContent && parsedContent.ops && Array.isArray(parsedContent.ops)) {
                    quill.setContents(parsedContent);
                } else {
                    // If it's not a proper Delta, treat as plain text
                    quill.setText(meeting.notes_content);
                }
            } catch (e) {
                console.warn('Failed to parse notes content as JSON, treating as plain text');
                // Try to parse as plain text if it's not JSON
                quill.setText(meeting.notes_content);
            }
            // Restore the loading state
            isLoading = wasLoading;
        } else {
            console.log('No notes content found for meeting', meeting.id);
        }
        
        // Load attachments
        await loadAttachments();
        
        // Set initial save status
        setSaveStatus('saved');
        
        // IMPORTANT: Set isLoading to false after all data is loaded
        isLoading = false;
        console.log('isLoading set to false - auto-save now enabled');
        
    } catch (error) {
        console.error('Error loading meeting data:', error);
        setSaveStatus('error');
        isLoading = false; // Also set to false on error
    }
}

// Format meeting time for display
function formatMeetingTime(startTime, endTime) {
    const start = new Date(startTime);
    const end = new Date(endTime);
    
    const startStr = start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const endStr = end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    return `${startStr} - ${endStr}`;
}

// Render participants list
function renderParticipants(participants) {
    const participantsList = document.getElementById('participantsList');
    const participantsPill = document.getElementById('participantsPill');
    const participantsCollapsed = document.getElementById('participantsCollapsed');
    
    // Update the pill text
    participantsPill.textContent = `${participants.length} participant${participants.length !== 1 ? 's' : ''}`;
    
    // Clear and rebuild the list
    participantsList.innerHTML = '';
    
    participants.forEach(participant => {
        const participantEmail = document.createElement('div');
        participantEmail.className = 'participant-email';
        participantEmail.innerHTML = `
            <span>${participant}</span>
            <button class="participant-remove" onclick="removeParticipant('${participant}')">×</button>
        `;
        participantsList.appendChild(participantEmail);
    });
    
}

// Add participant from inline input
async function addParticipantFromInline() {
    const input = document.getElementById('participantInlineInput');
    const email = input.value.trim();
    
    if (!email || !isValidEmail(email)) {
        return;
    }
    
    try {
        const meeting = await ipcRenderer.invoke('get-meeting-by-id', currentMeetingId);
        let participants = [];
        try {
            participants = meeting.participants ? JSON.parse(meeting.participants) : [];
        } catch (e) {
            console.warn('Failed to parse participants in addParticipant');
            participants = [];
        }
        
        if (participants.includes(email)) {
            hideInlineParticipantInput();
            return;
        }
        
        participants.push(email);
        
        setSaveStatus('saving');
        await ipcRenderer.invoke('update-meeting-participants', currentMeetingId, participants);
        renderParticipants(participants);
        setSaveStatus('saved');
        
        hideInlineParticipantInput();
        
    } catch (error) {
        console.error('Error adding participant:', error);
    }
}

// Remove participant
async function removeParticipant(email) {
    try {
        const meeting = await ipcRenderer.invoke('get-meeting-by-id', currentMeetingId);
        let participants = [];
        try {
            participants = meeting.participants ? JSON.parse(meeting.participants) : [];
        } catch (e) {
            console.warn('Failed to parse participants in removeParticipant');
            participants = [];
        }
        
        const updatedParticipants = participants.filter(p => p !== email);
        
        setSaveStatus('saving');
        await ipcRenderer.invoke('update-meeting-participants', currentMeetingId, updatedParticipants);
        renderParticipants(updatedParticipants);
        setSaveStatus('saved');
        
    } catch (error) {
        console.error('Error removing participant:', error);
    }
}

// Validate email format
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Schedule auto-save
function scheduleAutoSave() {
    clearTimeout(saveTimeout);
    
    saveTimeout = setTimeout(() => {
        saveNotes();
    }, 1000); // Reduced from 3000ms to 1000ms
}

// Ensure notes are saved before navigation
async function ensureNotesAreSaved() {
    if (saveTimeout) {
        clearTimeout(saveTimeout);
        await saveNotes();
    }
}

// Save notes to database
async function saveNotes() {
    try {
        const content = quill.getContents();
        const contentStr = JSON.stringify(content);
        console.log('Saving notes for meeting', currentMeetingId, content);
        await ipcRenderer.invoke('update-meeting-notes', currentMeetingId, contentStr);
        console.log('Notes saved successfully');
        setSaveStatus('saved');
        
        // Update initial content after successful save so we track changes from this point
        initialNotesContent = contentStr;
    } catch (error) {
        console.error('Error saving notes:', error);
        setSaveStatus('error');
    }
}

// Set save status indicator
function setSaveStatus(status) {
    console.log('Setting save status to:', status);
    const indicator = document.getElementById('saveIndicator');
    if (!indicator) {
        console.error('Save indicator element not found!');
        return;
    }
    indicator.className = `status-indicator ${status}`;
    
    // Update tooltip
    const tooltips = {
        saved: 'Saved',
        saving: 'Saving...',
        error: 'Error saving'
    };
    indicator.title = tooltips[status] || 'Save Status';
    console.log('Save status indicator updated to:', status);
}

// Set recording status indicator
function setRecordingStatus(recordingStatus) {
    const indicator = document.getElementById('recordingIndicator');
    
    if (!recordingStatus || !recordingStatus.isRecording) {
        indicator.className = 'status-indicator';
        indicator.title = 'Not Recording - Click to Start';
        return;
    }
    
    if (recordingStatus.isPaused) {
        indicator.className = 'status-indicator paused';
        indicator.title = `Recording Paused (${formatDuration(recordingStatus.duration)}) - Click to Resume`;
    } else {
        indicator.className = 'status-indicator recording';
        indicator.title = `Recording Active (${formatDuration(recordingStatus.duration)}) - Click to Pause`;
    }
}

// Initialize recording functionality
async function initializeRecording() {
    try {
        console.log('Initializing recording for meeting:', currentMeetingId);
        
        // Set up recording indicator click handler
        const recordingIndicator = document.getElementById('recordingIndicator');
        recordingIndicator.addEventListener('click', handleRecordingIndicatorClick);
        
        // Start recording automatically when entering meeting page
        await startRecording();
        
        // Set up periodic status updates
        startRecordingStatusUpdates();
        
    } catch (error) {
        console.error('Error initializing recording:', error);
        setRecordingStatus(null);
    }
}

// Start recording for current meeting
async function startRecording() {
    try {
        console.log('Starting recording for meeting:', currentMeetingId);
        const result = await ipcRenderer.invoke('start-recording', parseInt(currentMeetingId));
        currentRecordingStatus = result;
        setRecordingStatus(currentRecordingStatus);
        console.log('Recording started:', result);
    } catch (error) {
        console.error('Error starting recording:', error);
        setRecordingStatus(null);
    }
}

// Stop recording for current meeting
async function stopRecording() {
    try {
        console.log('Stopping recording for meeting:', currentMeetingId);
        const result = await ipcRenderer.invoke('stop-recording', parseInt(currentMeetingId));
        currentRecordingStatus = result;
        setRecordingStatus(currentRecordingStatus);
        console.log('Recording stopped:', result);
    } catch (error) {
        console.error('Error stopping recording:', error);
    }
}

// Handle recording indicator click (pause/resume)
async function handleRecordingIndicatorClick() {
    try {
        if (!currentRecordingStatus || !currentRecordingStatus.isRecording) {
            // Not recording, start recording
            await startRecording();
            return;
        }
        
        if (currentRecordingStatus.isPaused) {
            // Currently paused, resume recording
            console.log('Resuming recording for meeting:', currentMeetingId);
            const result = await ipcRenderer.invoke('resume-recording', parseInt(currentMeetingId));
            currentRecordingStatus = result;
            setRecordingStatus(currentRecordingStatus);
            console.log('Recording resumed:', result);
        } else {
            // Currently recording, pause recording
            console.log('Pausing recording for meeting:', currentMeetingId);
            const result = await ipcRenderer.invoke('pause-recording', parseInt(currentMeetingId));
            currentRecordingStatus = result;
            setRecordingStatus(currentRecordingStatus);
            console.log('Recording paused:', result);
        }
    } catch (error) {
        console.error('Error handling recording indicator click:', error);
    }
}

// Start periodic recording status updates
function startRecordingStatusUpdates() {
    // Update recording status every 2 seconds
    recordingStatusInterval = setInterval(async () => {
        try {
            const status = await ipcRenderer.invoke('get-recording-status', parseInt(currentMeetingId));
            currentRecordingStatus = status;
            setRecordingStatus(currentRecordingStatus);
        } catch (error) {
            console.error('Error updating recording status:', error);
        }
    }, 2000);
}

// Stop recording status updates
function stopRecordingStatusUpdates() {
    if (recordingStatusInterval) {
        clearInterval(recordingStatusInterval);
        recordingStatusInterval = null;
    }
}

// Format duration in seconds to MM:SS format
function formatDuration(seconds) {
    if (!seconds || seconds < 0) return '00:00';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

// Load attachments for this meeting
async function loadAttachments() {
    try {
        const attachments = await ipcRenderer.invoke('get-meeting-attachments', currentMeetingId);
        
        console.log('Meeting attachments:', attachments);
        
        // Clear existing tiles
        const attachmentsGrid = document.getElementById('attachmentsGrid');
        attachmentsGrid.innerHTML = '';
        
        // Create tiles for existing attachments
        for (const attachment of attachments) {
            // Get file size from disk if available
            const fileSize = await getAttachmentFileSize(attachment.filename);
            createAttachmentTile(attachment.original_name, attachment.filename, fileSize);
        }
        
    } catch (error) {
        console.error('Error loading attachments:', error);
    }
}

// Get file size for existing attachment
async function getAttachmentFileSize(filename) {
    try {
        const result = await ipcRenderer.invoke('get-attachment-info', currentMeetingId, filename);
        return result.size || 0;
    } catch (error) {
        console.error('Error getting attachment size:', error);
        return 0;
    }
}

// Setup drag and drop for attachments (entire page)
function setupDragAndDrop() {
    const container = document.querySelector('.container');
    
    container.addEventListener('dragover', (e) => {
        e.preventDefault();
        container.classList.add('drag-over');
    });
    
    container.addEventListener('dragleave', (e) => {
        e.preventDefault();
        // Only remove drag-over if we're leaving the container entirely
        if (!container.contains(e.relatedTarget)) {
            container.classList.remove('drag-over');
        }
    });
    
    container.addEventListener('drop', (e) => {
        e.preventDefault();
        container.classList.remove('drag-over');
        
        const files = Array.from(e.dataTransfer.files);
        handleFileUpload(files);
    });
}

// Handle file upload
async function handleFileUpload(files) {
    console.log('Files dropped:', files);
    
    if (!files || files.length === 0) return;
    
    setSaveStatus('saving');
    
    try {
        for (const file of files) {
            console.log('Uploading file:', file.name, 'Size:', file.size);
            
            // Create attachment record in database
            const result = await ipcRenderer.invoke('upload-attachment', currentMeetingId, {
                name: file.name,
                path: file.path,
                size: file.size,
                type: file.type
            });
            
            if (result.success) {
                console.log('File uploaded successfully:', result.filename);
                
                // Create attachment tile
                createAttachmentTile(file.name, result.filename, file.size);
            } else {
                console.error('Failed to upload file:', file.name);
            }
        }
        
        setSaveStatus('saved');
        
    } catch (error) {
        console.error('Error uploading files:', error);
        setSaveStatus('error');
        alert('Error uploading files: ' + error.message);
    }
}

// Create attachment tile
function createAttachmentTile(originalName, filename, size) {
    const formatSize = (bytes) => {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
        return Math.round(bytes / (1024 * 1024)) + ' MB';
    };
    
    const attachmentsGrid = document.getElementById('attachmentsGrid');
    
    const tile = document.createElement('div');
    tile.className = 'attachment-tile';
    tile.dataset.filename = filename;
    
    tile.innerHTML = `
        <div class="attachment-tile-name">${originalName}</div>
        <div class="attachment-tile-size">${formatSize(size)}</div>
        <button class="attachment-remove" onclick="removeAttachmentTile('${filename}')">×</button>
    `;
    
    // Click to open file
    tile.addEventListener('click', (e) => {
        if (e.target.classList.contains('attachment-remove')) {
            return; // Don't open if clicking remove button
        }
        openAttachment(filename, originalName);
    });
    
    attachmentsGrid.appendChild(tile);
}

// Hide loading overlay
function hideLoadingOverlay() {
    const overlay = document.getElementById('loadingOverlay');
    overlay.classList.add('hidden');
}

// Show loading overlay
function showLoadingOverlay() {
    const overlay = document.getElementById('loadingOverlay');
    overlay.classList.remove('hidden');
}

// Title editing functions
function startEditingTitle() {
    const titleElement = document.getElementById('meetingTitle');
    const inputElement = document.getElementById('meetingTitleInput');
    
    inputElement.value = titleElement.textContent;
    titleElement.style.display = 'none';
    inputElement.style.display = 'block';
    inputElement.focus();
    inputElement.select();
}

async function saveTitle() {
    const titleElement = document.getElementById('meetingTitle');
    const inputElement = document.getElementById('meetingTitleInput');
    
    const newTitle = inputElement.value.trim();
    if (newTitle && newTitle !== titleElement.textContent) {
        try {
            setSaveStatus('saving');
            await ipcRenderer.invoke('update-meeting-title', currentMeetingId, newTitle);
            titleElement.textContent = newTitle;
            setSaveStatus('saved');
        } catch (error) {
            console.error('Error updating meeting title:', error);
            setSaveStatus('error');
        }
    }
    
    // Hide input, show title
    inputElement.style.display = 'none';
    titleElement.style.display = 'block';
}

function cancelEditTitle() {
    const titleElement = document.getElementById('meetingTitle');
    const inputElement = document.getElementById('meetingTitleInput');
    
    // Hide input, show title without saving
    inputElement.style.display = 'none';
    titleElement.style.display = 'block';
}

// Inline participant input functions
function showInlineParticipantInput() {
    const inputPill = document.getElementById('participantInputPill');
    const input = document.getElementById('participantInlineInput');
    
    inputPill.style.display = 'inline-flex';
    input.value = '';
    input.focus();
}

function hideInlineParticipantInput() {
    const inputPill = document.getElementById('participantInputPill');
    const input = document.getElementById('participantInlineInput');
    
    inputPill.style.display = 'none';
    input.value = '';
}

// Attachment management functions
async function openAttachment(filename, originalName) {
    try {
        const result = await ipcRenderer.invoke('open-attachment', currentMeetingId, filename);
        if (result.success) {
            console.log('File opened:', originalName);
        } else {
            alert('Failed to open file');
        }
    } catch (error) {
        console.error('Error opening attachment:', error);
        alert('Error opening file: ' + error.message);
    }
}

async function removeAttachmentTile(filename) {
    try {
        setSaveStatus('saving');
        const result = await ipcRenderer.invoke('remove-attachment', currentMeetingId, filename);
        if (result.success) {
            // Remove tile from UI
            const tile = document.querySelector(`[data-filename="${filename}"]`);
            if (tile) {
                tile.remove();
            }
        } else {
            alert('Failed to remove attachment');
        }
        setSaveStatus('saved');
    } catch (error) {
        console.error('Error removing attachment:', error);
        setSaveStatus('error');
        alert('Error removing attachment: ' + error.message);
    }
}

// Handle navigation back to nav page
async function handleNavigationBack() {
    console.log('🔙 handleNavigationBack called');
    
    // Also log to main process so we can see it in terminal
    ipcRenderer.invoke('log-to-main', '🔙 MARKDOWN EXPORT: handleNavigationBack called');
    
    try {
        // Ensure notes are saved first
        console.log('💾 Ensuring notes are saved...');
        await ensureNotesAreSaved();
        
        // Get current notes content
        const currentContent = quill.getContents();
        const currentContentStr = JSON.stringify(currentContent);
        
        console.log('📝 Initial notes content:', initialNotesContent ? 'exists' : 'null');
        console.log('📝 Current notes content length:', currentContentStr.length);
        
        ipcRenderer.invoke('log-to-main', `📝 MARKDOWN EXPORT: Initial=${initialNotesContent ? 'exists' : 'null'}, Current length=${currentContentStr.length}`);
        
        // Always export markdown (replace existing file)
        console.log('📄 Always exporting markdown file...');
        ipcRenderer.invoke('log-to-main', '📄 MARKDOWN EXPORT: Always exporting markdown file...');
        
        // Delete existing markdown if any
        console.log('🗑️ Deleting existing markdown if any...');
        await ipcRenderer.invoke('delete-meeting-markdown', currentMeetingId);
        
        // Export new markdown file
        console.log('📄 Exporting new markdown file...');
        const exportResult = await ipcRenderer.invoke('export-meeting-notes-markdown', currentMeetingId);
        if (exportResult.success) {
            console.log('✅ Meeting notes exported to markdown:', exportResult.filename);
            console.log('📂 File path:', exportResult.filePath);
            ipcRenderer.invoke('log-to-main', `✅ MARKDOWN EXPORT: Success! File: ${exportResult.filename}`);
        } else {
            console.error('❌ Failed to export meeting notes:', exportResult.error);
            ipcRenderer.invoke('log-to-main', `❌ MARKDOWN EXPORT: Failed - ${exportResult.error}`);
        }
        
        // Small delay for logs (can be removed later)
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Navigate back to index
        console.log('🏠 Navigating back to index.html');
        window.location.href = 'index.html';
        
    } catch (error) {
        console.error('❌ Error handling navigation back:', error);
        ipcRenderer.invoke('log-to-main', `❌ MARKDOWN EXPORT: Error - ${error.message}`);
        // Still navigate even if export fails
        window.location.href = 'index.html';
    }
}

// Make functions available globally
window.removeParticipant = removeParticipant;
window.openAttachment = openAttachment;
window.removeAttachmentTile = removeAttachmentTile;