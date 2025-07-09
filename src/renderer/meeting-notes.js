// Meeting Notes Page JavaScript
console.log('meeting-notes.js script loading...');
const { ipcRenderer } = require('electron');
console.log('ipcRenderer loaded successfully');

let quill;
let currentMeetingId;
let saveTimeout;
let isLoading = true;

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
        placeholder: 'Start typing your meeting notes...'
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
    document.getElementById('backButton').addEventListener('click', async () => {
        await ensureNotesAreSaved();
        window.location.href = 'index.html';
    });
    
    // Escape key to go back - wait for save before navigating
    document.addEventListener('keydown', async (e) => {
        if (e.key === 'Escape' || (e.metaKey && e.key === 'ArrowLeft')) {
            await ensureNotesAreSaved();
            window.location.href = 'index.html';
        }
    });
    
    // Save before page unload
    window.addEventListener('beforeunload', (e) => {
        if (saveTimeout) {
            clearTimeout(saveTimeout);
            console.log('Page unloading, forcing immediate save');
            // Force an immediate synchronous save
            try {
                const content = quill.getContents();
                // Use sendSync for synchronous save before page unload
                ipcRenderer.sendSync('update-meeting-notes-sync', currentMeetingId, JSON.stringify(content));
                console.log('Synchronous save completed');
            } catch (error) {
                console.error('Error in synchronous save:', error);
            }
        }
    });
    
    // Save on focus loss
    window.addEventListener('blur', async () => {
        await ensureNotesAreSaved();
    });
    
    // Legacy participant input handling (now handled in modal)
    // These listeners are now in the modal setup above
    
    // Validate participant input
    document.getElementById('participantInput').addEventListener('input', validateParticipantInput);
    
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
    
    // Participant modal functionality
    document.getElementById('addParticipantBtn').addEventListener('click', showParticipantModal);
    document.getElementById('participantModal').addEventListener('click', (e) => {
        if (e.target.id === 'participantModal') {
            hideParticipantModal();
        }
    });
    document.getElementById('participantInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            addParticipant();
            hideParticipantModal();
        }
        if (e.key === 'Escape') {
            hideParticipantModal();
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
            console.warn('Failed to parse participants, using empty array');
            participants = [];
        }
        renderParticipants(participants);
        
        // Load notes content
        console.log('Loading notes for meeting:', meeting.id, 'Notes content:', meeting.notes_content);
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
    participantsList.innerHTML = '';
    
    participants.forEach(participant => {
        const participantTag = document.createElement('div');
        participantTag.className = 'participant-tag';
        participantTag.innerHTML = `
            <span>${participant}</span>
            <button class="participant-remove" onclick="removeParticipant('${participant}')">×</button>
        `;
        participantsList.appendChild(participantTag);
    });
}

// Add participant
async function addParticipant() {
    const input = document.getElementById('participantInput');
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
            input.value = '';
            return;
        }
        
        participants.push(email);
        
        setSaveStatus('saving');
        await ipcRenderer.invoke('update-meeting-participants', currentMeetingId, participants);
        renderParticipants(participants);
        setSaveStatus('saved');
        
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

// Validate participant input
function validateParticipantInput() {
    const input = document.getElementById('participantInput');
    const button = document.getElementById('addParticipantBtn');
    const email = input.value.trim();
    
    button.disabled = !email || !isValidEmail(email);
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
        console.log('Saving notes for meeting', currentMeetingId, content);
        await ipcRenderer.invoke('update-meeting-notes', currentMeetingId, JSON.stringify(content));
        console.log('Notes saved successfully');
        setSaveStatus('saved');
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
function setRecordingStatus(isRecording) {
    const indicator = document.getElementById('recordingIndicator');
    indicator.className = `status-indicator ${isRecording ? 'recording' : ''}`;
    indicator.title = isRecording ? 'Recording' : 'Not Recording';
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

// Participant modal functions
function showParticipantModal() {
    const modal = document.getElementById('participantModal');
    const input = document.getElementById('participantInput');
    
    modal.style.display = 'flex';
    input.value = '';
    input.focus();
}

function hideParticipantModal() {
    const modal = document.getElementById('participantModal');
    modal.style.display = 'none';
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

// Make functions available globally
window.removeParticipant = removeParticipant;
window.openAttachment = openAttachment;
window.removeAttachmentTile = removeAttachmentTile;