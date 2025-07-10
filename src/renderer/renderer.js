const { ipcRenderer } = require('electron');
const { dateOverride } = require('../date-override');

class MeetingApp {
    constructor() {
        this.meetings = [];
        this.allMeetings = [];
        this.selectedMeeting = null;
        this.isLoading = false;
        this.showingAll = false;
        this.showingAllPastEvents = false;
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadMeetings();
        this.checkGoogleAuthStatus();
        
        setInterval(() => this.updateMeetingStatuses(), 30000);
    }

    setupEventListeners() {
        const newNoteBtn = document.getElementById('new-note-btn');
        newNoteBtn.addEventListener('click', () => this.createNewNote());

        const showMoreBtn = document.getElementById('show-more-btn');
        showMoreBtn.addEventListener('click', () => this.toggleShowMore());

        const excelUploadBtn = document.getElementById('excel-upload-btn');
        excelUploadBtn.addEventListener('click', () => this.uploadExcelFile());

        const googleAuthBtn = document.getElementById('google-auth-btn');
        googleAuthBtn.addEventListener('click', () => this.handleGoogleAuth());

        ipcRenderer.on('meetings-refreshed', () => {
            this.loadMeetings();
        });

        // Listen for upload status changes
        ipcRenderer.on('upload-status-changed', (event, data) => {
            this.handleUploadStatusChange(data);
        });
    }

    async loadMeetings() {
        this.setLoading(true);
        try {
            // Load meetings with upload status
            const result = await ipcRenderer.invoke('get-meetings-with-upload-status');
            if (result.success) {
                this.meetings = result.meetings;
            } else {
                // Fallback to regular meetings if upload status fails
                console.warn('Failed to get upload status, using regular meetings:', result.error);
                this.meetings = await ipcRenderer.invoke('get-todays-meetings');
            }
            this.showingAll = false;
            this.showingAllPastEvents = false;
            
            // Reset show more button will be handled by updateShowMoreButton()
            
            this.renderMeetings();
            this.updateStatus(`Loaded ${this.meetings.length} meetings for today`);
        } catch (error) {
            console.error('Error loading meetings:', error);
            this.showError('Failed to load meetings: ' + error.message);
        } finally {
            this.setLoading(false);
        }
    }

    async createNewNote() {
        console.log('Creating new note...');
        try {
            // Create a new meeting starting at current time
            const now = new Date();
            const endTime = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour later
            
            const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const newMeeting = {
                title: `New Meeting (${timeStr})`,
                folderName: `new-meeting-${now.getTime()}`,
                startTime: now.toISOString(),
                endTime: endTime.toISOString(),
                participants: []
            };
            
            const result = await ipcRenderer.invoke('create-new-meeting', newMeeting);
            if (result.success) {
                // Navigate to the new meeting's notes page
                window.location.href = `meeting-notes.html?meetingId=${result.meetingId}`;
            } else {
                this.showError('Failed to create new meeting');
            }
        } catch (error) {
            console.error('Error creating new meeting:', error);
            this.showError('Failed to create new meeting: ' + error.message);
        }
    }

    async toggleShowMore() {
        const showMoreBtn = document.getElementById('show-more-btn');
        
        try {
            if (this.showingAll) {
                // Switch back to filtered meetings
                this.showingAll = false;
                this.showingAllPastEvents = false;
                this.meetings = await ipcRenderer.invoke('get-todays-meetings');
                console.log(`Showing filtered meetings: ${this.meetings.length}`);
            } else if (this.showingAllPastEvents) {
                // Currently showing all past events, toggle back to limited past events
                this.showingAllPastEvents = false;
                console.log('Limiting past events to 2 most recent');
            } else {
                // Show all past events (but keep content filtering if active)
                this.showingAllPastEvents = true;
                console.log('Showing all past events');
                
                // If we're in filtered mode, we might need to get all meetings to show all past events
                if (!this.showingAll) {
                    // Check if there are more past events in the full dataset
                    const allMeetings = await ipcRenderer.invoke('get-all-todays-meetings');
                    
                    // Count past events in current filtered vs all meetings
                    const currentPastCount = this.meetings.filter(meeting => {
                        const startTime = new Date(meeting.start_time);
                        const endTime = new Date(meeting.end_time);
                        const status = this.getMeetingStatus(startTime, endTime);
                        return status.class === 'past';
                    }).length;
                    
                    const allPastCount = allMeetings.filter(meeting => {
                        const startTime = new Date(meeting.start_time);
                        const endTime = new Date(meeting.end_time);
                        const status = this.getMeetingStatus(startTime, endTime);
                        return status.class === 'past';
                    }).length;
                    
                    // If there are more past events in the full dataset, show all meetings
                    if (allPastCount > currentPastCount) {
                        this.showingAll = true;
                        this.meetings = allMeetings;
                        console.log('Switched to all meetings to show all past events');
                    }
                }
            }
            
            this.renderMeetings();
            const displayedCount = this.filterMeetingsForDisplay(this.meetings).length;
            this.updateStatus(`Showing ${displayedCount} meetings for today`);
        } catch (error) {
            console.error('Error in toggleShowMore:', error);
            this.showError('Failed to toggle meetings view: ' + error.message);
        }
    }

    async uploadExcelFile() {
        try {
            // Create a file input element
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.xlsx,.xls';
            fileInput.style.display = 'none';
            
            // Add event listener for file selection
            fileInput.addEventListener('change', async (event) => {
                const file = event.target.files[0];
                if (file) {
                    await this.processExcelFile(file);
                }
                // Clean up
                document.body.removeChild(fileInput);
            });
            
            // Add to DOM and trigger click
            document.body.appendChild(fileInput);
            fileInput.click();
            
        } catch (error) {
            console.error('Error initiating Excel upload:', error);
            this.showError('Failed to open file picker: ' + error.message);
        }
    }

    async processExcelFile(file) {
        try {
            console.log(`Processing Excel file: ${file.name}`);
            this.showSuccess(`Processing ${file.name}...`);
            
            // Send file path to main process
            const result = await ipcRenderer.invoke('upload-excel-file', file.path);
            
            if (result.success) {
                this.showSuccess('Excel file processed successfully! Meetings updated.');
                console.log('Excel file processed successfully');
                
                // Reload meetings to show updated data
                await this.loadMeetings();
            } else {
                this.showError('Failed to process Excel file');
            }
            
        } catch (error) {
            console.error('Error processing Excel file:', error);
            this.showError('Failed to process Excel file: ' + error.message);
        }
    }

    async handleGoogleAuth() {
        try {
            // Check current auth status
            const statusResult = await ipcRenderer.invoke('check-google-auth-status');
            
            if (statusResult.success && statusResult.isAuthenticated) {
                this.showSuccess('Google Drive is already connected!');
                this.updateGoogleAuthButton(true);
                return;
            }

            // Get OAuth URL
            const urlResult = await ipcRenderer.invoke('get-google-oauth-url');
            
            if (!urlResult.success) {
                this.showError('Failed to initialize Google Drive: ' + urlResult.error);
                return;
            }

            // Open OAuth URL in default browser
            require('electron').shell.openExternal(urlResult.authUrl);
            
            // Show modal for code input
            this.showOAuthModal();
            
        } catch (error) {
            console.error('Error handling Google auth:', error);
            this.showError('Failed to connect Google Drive: ' + error.message);
        }
    }

    updateGoogleAuthButton(isAuthenticated) {
        const btn = document.getElementById('google-auth-btn');
        if (isAuthenticated) {
            btn.textContent = '✓ Drive';
            btn.classList.add('authenticated');
            btn.title = 'Google Drive connected';
        } else {
            btn.textContent = 'Drive';
            btn.classList.remove('authenticated');
            btn.title = 'Connect Google Drive';
        }
    }

    async resetFailedUploads() {
        try {
            const meetings = await ipcRenderer.invoke('get-meetings-with-upload-status');
            if (meetings.success) {
                // Find failed meetings and reset them to pending
                for (const meeting of meetings.meetings) {
                    if (meeting.upload_status === 'failed') {
                        // This will trigger a re-upload attempt
                        await ipcRenderer.invoke('queue-meeting-upload', meeting.id);
                    }
                }
                this.loadMeetings(); // Refresh the UI
            }
        } catch (error) {
            console.error('Error resetting failed uploads:', error);
        }
    }

    async checkGoogleAuthStatus() {
        try {
            const result = await ipcRenderer.invoke('check-google-auth-status');
            if (result.success) {
                this.updateGoogleAuthButton(result.isAuthenticated);
            }
        } catch (error) {
            console.error('Error checking Google auth status:', error);
        }
    }

    showOAuthModal() {
        const modal = document.getElementById('oauth-modal');
        const input = document.getElementById('oauth-code-input');
        const submitBtn = document.getElementById('oauth-submit-btn');
        const cancelBtn = document.getElementById('oauth-cancel-btn');

        modal.style.display = 'flex';
        input.value = '';
        input.focus();

        // Handle submit
        const handleSubmit = async () => {
            const code = input.value.trim();
            if (!code) {
                this.showError('Please enter the authorization code');
                return;
            }

            try {
                const exchangeResult = await ipcRenderer.invoke('exchange-google-oauth-code', code);
                
                if (exchangeResult.success) {
                    this.showSuccess('Google Drive connected successfully!');
                    this.updateGoogleAuthButton(true);
                    await this.resetFailedUploads();
                    this.hideOAuthModal();
                } else {
                    this.showError('Failed to connect Google Drive: ' + exchangeResult.error);
                }
            } catch (error) {
                this.showError('Failed to connect Google Drive: ' + error.message);
            }
        };

        // Handle cancel
        const handleCancel = () => {
            this.hideOAuthModal();
            this.showError('Authorization cancelled');
        };

        // Event listeners
        submitBtn.onclick = handleSubmit;
        cancelBtn.onclick = handleCancel;
        
        // Enter key to submit
        input.onkeypress = (e) => {
            if (e.key === 'Enter') {
                handleSubmit();
            }
        };

        // Escape key to cancel
        document.onkeydown = (e) => {
            if (e.key === 'Escape' && modal.style.display === 'flex') {
                handleCancel();
            }
        };
    }

    hideOAuthModal() {
        const modal = document.getElementById('oauth-modal');
        modal.style.display = 'none';
        
        // Clean up event listeners
        document.onkeydown = null;
    }

    renderMeetings() {
        const container = document.getElementById('meetings-container');
        
        if (this.meetings.length === 0) {
            container.innerHTML = this.renderNoMeetings();
            this.updateShowMoreButton();
            return;
        }

        const meetingsCard = document.createElement('div');
        meetingsCard.className = 'meetings-card';
        
        // Filter meetings to limit past events if not showing all
        const meetingsToShow = this.filterMeetingsForDisplay(this.meetings);
        
        meetingsToShow.forEach(meeting => {
            const meetingElement = this.createMeetingElement(meeting);
            meetingsCard.appendChild(meetingElement);
        });

        container.innerHTML = '';
        container.appendChild(meetingsCard);
        this.updateShowMoreButton();
    }

    renderNoMeetings() {
        return `
            <div class="no-meetings">
                <h2>No meetings scheduled for today</h2>
                <p>Your calendar is clear for today!</p>
            </div>
        `;
    }

    createMeetingElement(meeting) {
        const meetingDiv = document.createElement('div');
        meetingDiv.className = 'meeting-item';
        meetingDiv.dataset.meetingId = meeting.id;

        const startTime = new Date(meeting.start_time);
        const endTime = new Date(meeting.end_time);
        const status = this.getMeetingStatus(startTime, endTime);
        const participants = meeting.participants ? JSON.parse(meeting.participants) : [];

        // Add past class for styling if meeting is past
        if (status.class === 'past') {
            meetingDiv.classList.add('past');
        }

        // Add upload status classes for visual feedback
        const uploadStatus = meeting.upload_status || 'pending';
        meetingDiv.classList.add(`upload-${uploadStatus}`);
        console.log(`Meeting ${meeting.id} (${meeting.title}) has upload status: ${uploadStatus}`);

        // Format date for badge
        const dateStr = startTime.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric' 
        }).replace(' ', ' ').toUpperCase();

        // Count participants
        let participantText = '';
        if (participants.length === 1) {
            participantText = '1 participant';
        } else if (participants.length > 1) {
            participantText = `${participants.length} participants`;
        }

        meetingDiv.innerHTML = `
            <div class="meeting-header">
                <div class="date-badge">${dateStr}</div>
                <div class="meeting-info">
                    <div class="meeting-title">${this.escapeHtml(meeting.title)}</div>
                    <div class="meeting-time">
                        <span class="status-indicator status-${status.class}"></span>
                        ${this.formatTime(startTime)} - ${this.formatTime(endTime)}
                    </div>
                    ${participantText ? `<div class="meeting-participants">${participantText}</div>` : ''}
                </div>
            </div>
        `;

        meetingDiv.addEventListener('click', (e) => {
            this.selectMeeting(meeting);
        });

        return meetingDiv;
    }

    getMeetingStatus(startTime, endTime) {
        const now = dateOverride.now();
        
        // Add 10-minute grace period to start time
        const startTimeWithGrace = new Date(startTime.getTime() + 10 * 60 * 1000);
        
        if (now < startTimeWithGrace) {
            return { class: 'upcoming', text: 'Upcoming' };
        } else if (now >= startTime && now <= endTime) {
            return { class: 'active', text: 'Active' };
        } else {
            return { class: 'past', text: 'Past' };
        }
    }

    formatTime(date) {
        return date.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    }

    selectMeeting(meeting) {
        // Navigate to meeting notes page
        window.location.href = `meeting-notes.html?meetingId=${meeting.id}`;
    }

    async openMeetingNotes(meetingId) {
        console.log('Opening notes for meeting:', meetingId);
        this.showSuccess('Notes feature will be implemented in Milestone 2');
    }

    updateMeetingStatuses() {
        document.querySelectorAll('.meeting-item').forEach(item => {
            const meetingId = parseInt(item.dataset.meetingId);
            const meeting = this.meetings.find(m => m.id === meetingId);
            if (meeting) {
                const startTime = new Date(meeting.start_time);
                const endTime = new Date(meeting.end_time);
                const status = this.getMeetingStatus(startTime, endTime);
                
                // Update past class for styling
                if (status.class === 'past') {
                    item.classList.add('past');
                } else {
                    item.classList.remove('past');
                }
                
                const statusElement = item.querySelector('.status-indicator');
                if (statusElement) {
                    statusElement.className = `status-indicator status-${status.class}`;
                }
                
                const recordBtn = item.querySelector('.action-btn.success');
                if (recordBtn) {
                    recordBtn.disabled = status.class !== 'active';
                }
            }
        });
    }

    setLoading(loading) {
        this.isLoading = loading;
        const loadingIndicator = document.getElementById('loading-indicator');
        const container = document.getElementById('meetings-container');
        
        if (loading) {
            container.innerHTML = '<div class="loading">Loading meetings...</div>';
        } else {
            const loadingDiv = container.querySelector('.loading');
            if (loadingDiv) {
                loadingDiv.remove();
            }
        }
    }

    updateStatus(message) {
        const statusElement = document.getElementById('status-text');
        if (statusElement) {
            statusElement.textContent = message;
        } else {
            console.log('Status:', message);
        }
    }

    showError(message) {
        this.removeMessages();
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.textContent = message;
        document.querySelector('.content').insertBefore(errorDiv, document.querySelector('.meetings-container'));
        
        setTimeout(() => errorDiv.remove(), 5000);
    }

    showSuccess(message) {
        this.removeMessages();
        const successDiv = document.createElement('div');
        successDiv.className = 'success-message';
        successDiv.textContent = message;
        document.querySelector('.content').insertBefore(successDiv, document.querySelector('.meetings-container'));
        
        setTimeout(() => successDiv.remove(), 3000);
    }

    removeMessages() {
        document.querySelectorAll('.error-message, .success-message').forEach(msg => msg.remove());
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    filterMeetingsForDisplay(meetings) {
        if (this.showingAllPastEvents) {
            return meetings;
        }

        // Sort meetings by start time (most recent first)
        const sortedMeetings = [...meetings].sort((a, b) => {
            return new Date(b.start_time) - new Date(a.start_time);
        });

        // Separate meetings by status
        const pastMeetings = [];
        const activeMeetings = [];
        const upcomingMeetings = [];
        
        sortedMeetings.forEach(meeting => {
            const startTime = new Date(meeting.start_time);
            const endTime = new Date(meeting.end_time);
            const status = this.getMeetingStatus(startTime, endTime);
            
            if (status.class === 'past') {
                pastMeetings.push(meeting);
            } else if (status.class === 'active') {
                activeMeetings.push(meeting);
            } else {
                upcomingMeetings.push(meeting);
            }
        });

        // Take only the 2 most recent past meetings
        const limitedPastMeetings = pastMeetings.slice(0, 2);
        
        // Combine and re-sort by original time order
        const combinedMeetings = [...limitedPastMeetings, ...activeMeetings, ...upcomingMeetings];
        return combinedMeetings.sort((a, b) => {
            return new Date(a.start_time) - new Date(b.start_time);
        });
    }

    updateShowMoreButton() {
        const showMoreBtn = document.getElementById('show-more-btn');
        if (!showMoreBtn) return;
        
        // Count total past meetings
        const pastMeetingsCount = this.meetings.filter(meeting => {
            const startTime = new Date(meeting.start_time);
            const endTime = new Date(meeting.end_time);
            const status = this.getMeetingStatus(startTime, endTime);
            return status.class === 'past';
        }).length;
        
        // Hide button if there are 2 or fewer past meetings
        if (pastMeetingsCount <= 2) {
            showMoreBtn.style.display = 'none';
            return;
        }
        
        showMoreBtn.style.display = 'block';
        
        if (this.showingAllPastEvents) {
            showMoreBtn.textContent = 'Show less ▲';
        } else {
            const hiddenCount = pastMeetingsCount - 2;
            showMoreBtn.textContent = `Show ${hiddenCount} more past event${hiddenCount > 1 ? 's' : ''} ▼`;
        }
    }

    handleUploadStatusChange(data) {
        const { meetingId, status, timestamp } = data;
        console.log(`📡 Upload status change: meeting ${meetingId} -> ${status} at ${timestamp}`);
        
        // Find the meeting element and update its CSS class
        const meetingElement = document.querySelector(`[data-meeting-id="${meetingId}"]`);
        if (meetingElement) {
            // Remove existing upload status classes
            meetingElement.classList.remove('upload-pending', 'upload-uploading', 'upload-completed', 'upload-failed');
            
            // Add new upload status class
            meetingElement.classList.add(`upload-${status}`);
            
            console.log(`✅ Updated meeting ${meetingId} visual status to: ${status}`);
            
            // Show success message for completed uploads
            if (status === 'completed') {
                const meeting = this.meetings.find(m => m.id == meetingId);
                const meetingTitle = meeting ? meeting.title : `Meeting ${meetingId}`;
                this.showSuccess(`"${meetingTitle}" uploaded to Google Drive successfully!`);
            }
        } else {
            console.warn(`⚠️ Could not find meeting element for ID: ${meetingId}`);
        }
    }

}

const app = new MeetingApp();