// Meeting Notes Page JavaScript
const { ipcRenderer } = require('electron');

let quill;
let currentMeetingId;
let saveTimeout;
let isLoading = true;

// Initialize page
document.addEventListener('DOMContentLoaded', async () => {
    // Get meeting ID from URL params
    const urlParams = new URLSearchParams(window.location.search);
    currentMeetingId = urlParams.get('meetingId');
    
    if (!currentMeetingId) {
        console.error('No meeting ID provided');
        window.location.href = 'index.html';
        return;
    }
    
    // Initialize components
    initializeQuillEditor();
    initializeEventListeners();
    await loadMeetingData();
    
    // Hide loading overlay
    hideLoadingOverlay();
});

// Initialize Quill editor with custom configuration
function initializeQuillEditor() {
    const toolbarOptions = [
        ['bold', 'italic', 'underline'],
        ['blockquote', 'code-block'],
        [{ 'list': 'ordered'}, { 'list': 'bullet' }],
        [{ 'indent': '-1'}, { 'indent': '+1' }],
        ['link'],
        ['clean']
    ];
    
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
        if (source === 'user' && !isLoading) {
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
    
    // Add participant
    document.getElementById('addParticipantBtn').addEventListener('click', addParticipant);
    document.getElementById('participantInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            addParticipant();
        }
    });
    
    // Validate participant input
    document.getElementById('participantInput').addEventListener('input', validateParticipantInput);
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
            isLoading = false;
        } else {
            console.log('No notes content found for meeting', meeting.id);
        }
        
        // Load attachments
        await loadAttachments();
        
        // Set initial save status
        setSaveStatus('saved');
        
    } catch (error) {
        console.error('Error loading meeting data:', error);
        setSaveStatus('error');
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
        input.value = '';
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
    const indicator = document.getElementById('saveIndicator');
    indicator.className = `status-indicator ${status}`;
    
    // Update tooltip
    const tooltips = {
        saved: 'Saved',
        saving: 'Saving...',
        error: 'Error saving'
    };
    indicator.title = tooltips[status] || 'Save Status';
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
        
        // For now, just log attachments - full implementation will come later
        console.log('Meeting attachments:', attachments);
        
    } catch (error) {
        console.error('Error loading attachments:', error);
    }
}

// Setup drag and drop for attachments
function setupDragAndDrop() {
    const editor = document.getElementById('editor');
    
    editor.addEventListener('dragover', (e) => {
        e.preventDefault();
        editor.querySelector('.ql-editor').classList.add('drag-over');
    });
    
    editor.addEventListener('dragleave', (e) => {
        e.preventDefault();
        editor.querySelector('.ql-editor').classList.remove('drag-over');
    });
    
    editor.addEventListener('drop', (e) => {
        e.preventDefault();
        editor.querySelector('.ql-editor').classList.remove('drag-over');
        
        const files = Array.from(e.dataTransfer.files);
        handleFileUpload(files);
    });
}

// Handle file upload (placeholder for future implementation)
function handleFileUpload(files) {
    console.log('Files dropped:', files);
    // TODO: Implement file upload functionality
    // This will be implemented when we add the attachment system
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

// Make functions available globally
window.removeParticipant = removeParticipant;