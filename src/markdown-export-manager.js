const path = require('path');
const fs = require('fs-extra');

// Use a different variable name to avoid conflicts
let exportIpcRenderer;

class MarkdownExportManager {
  constructor() {
    this.pendingExports = new Map();
    this.exportInterval = null;
    this.lastExportTime = new Map();
    this.exportDebounceDelay = 3000; // 3 seconds debounce
    
    // Initialize ipcRenderer reference
    try {
      exportIpcRenderer = require('electron').ipcRenderer;
    } catch (e) {
      console.error('Failed to initialize ipcRenderer in MarkdownExportManager:', e);
    }
  }

  initialize(meetingId) {
    this.currentMeetingId = meetingId;
    this.startAutoExport();
    this.setupEventListeners();
    console.log(`📝 Markdown Export Manager initialized for meeting ${meetingId}`);
  }

  cleanup() {
    this.stopAutoExport();
    this.removeEventListeners();
    // Export one final time before cleanup
    this.exportMarkdown('cleanup');
  }

  startAutoExport() {
    // Export every 30 seconds if content has changed
    this.exportInterval = setInterval(() => {
      const notesList = document.getElementById('notesList');
      const hasContent = notesList && notesList.children.length > 0;
      
      if (hasContent && this.hasContentChanged()) {
        this.exportMarkdown('auto-save');
      }
    }, 30000);
  }

  stopAutoExport() {
    if (this.exportInterval) {
      clearInterval(this.exportInterval);
      this.exportInterval = null;
    }
  }

  setupEventListeners() {
    // Export on manual save (Ctrl+S)
    this.saveHandler = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        this.exportMarkdown('manual-save');
      }
    };
    document.addEventListener('keydown', this.saveHandler);

    // Export on page unload
    this.unloadHandler = () => {
      this.exportMarkdown('page-unload', true); // Synchronous export
    };
    window.addEventListener('beforeunload', this.unloadHandler);

    // Export on visibility change (tab switching)
    this.visibilityHandler = () => {
      if (document.hidden) {
        this.exportMarkdown('visibility-change');
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);

    // Export when recording stops
    if (window.meetingNotesManager) {
      const originalStopRecording = window.meetingNotesManager.stopRecording;
      window.meetingNotesManager.stopRecording = async function(...args) {
        const result = await originalStopRecording.apply(this, args);
        window.markdownExportManager.exportMarkdown('recording-stop');
        return result;
      };
    }
  }

  removeEventListeners() {
    if (this.saveHandler) {
      document.removeEventListener('keydown', this.saveHandler);
    }
    if (this.unloadHandler) {
      window.removeEventListener('beforeunload', this.unloadHandler);
    }
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
    }
  }

  hasContentChanged() {
    const currentContent = this.getCurrentContent();
    const lastContent = this.lastExportedContent || '';
    return currentContent !== lastContent;
  }

  getCurrentContent() {
    const notesList = document.getElementById('notesList');
    if (!notesList) return '';
    
    // Get all note contents
    const contents = Array.from(notesList.children).map(note => {
      const contentDiv = note.querySelector('.note-content .ql-editor');
      return contentDiv ? contentDiv.innerHTML : '';
    }).join('\n');
    
    return contents;
  }

  async exportMarkdown(trigger, synchronous = false) {
    if (!this.currentMeetingId) return;

    // Debounce exports
    const now = Date.now();
    const lastExport = this.lastExportTime.get(this.currentMeetingId) || 0;
    if (trigger !== 'page-unload' && trigger !== 'cleanup' && (now - lastExport) < this.exportDebounceDelay) {
      console.log(`📝 Export debounced (${trigger})`);
      return;
    }

    console.log(`📝 Exporting markdown (trigger: ${trigger})`);
    
    try {
      // Get current meeting data
      const meeting = window.currentMeeting;
      if (!meeting) {
        console.warn('No current meeting data available');
        return;
      }

      // Save notes first
      if (window.meetingNotesManager) {
        await window.meetingNotesManager.saveNotes();
      }

      // Export markdown
      if (synchronous) {
        // Synchronous export for page unload
        this.exportMarkdownSync(meeting);
      } else {
        // Async export for all other triggers
        await this.exportMarkdownAsync(meeting);
      }

      this.lastExportTime.set(this.currentMeetingId, now);
      this.lastExportedContent = this.getCurrentContent();
      
      // Update export status in database
      await this.updateExportStatus(this.currentMeetingId, 'success');
      
      console.log(`✅ Markdown exported successfully (${trigger})`);
    } catch (error) {
      console.error(`❌ Error exporting markdown (${trigger}):`, error);
      await this.updateExportStatus(this.currentMeetingId, 'failed', error.message);
    }
  }

  exportMarkdownSync(meeting) {
    // Synchronous IPC call for page unload
    const result = exportIpcRenderer.sendSync('export-meeting-notes-sync', {
      meetingId: meeting.id,
      folderName: meeting.folder_name
    });
    
    if (!result.success) {
      throw new Error(result.error);
    }
  }

  async exportMarkdownAsync(meeting) {
    // Async IPC call for normal exports
    const result = await exportIpcRenderer.invoke('export-meeting-notes', {
      meetingId: meeting.id,
      folderName: meeting.folder_name
    });
    
    if (!result.success) {
      throw new Error(result.error);
    }
  }

  async updateExportStatus(meetingId, status, error = null) {
    try {
      await exportIpcRenderer.invoke('update-markdown-export-status', {
        meetingId,
        status,
        error,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Failed to update export status:', error);
    }
  }

  // Retry failed exports
  async retryFailedExport(meetingId, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`🔄 Retry export attempt ${attempt}/${maxRetries} for meeting ${meetingId}`);
        await this.exportMarkdown(`retry-${attempt}`);
        return true;
      } catch (error) {
        if (attempt === maxRetries) {
          console.error(`❌ Failed to export after ${maxRetries} attempts:`, error);
          throw error;
        }
        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
      }
    }
    return false;
  }
}

// Create singleton instance
window.markdownExportManager = new MarkdownExportManager();

module.exports = { MarkdownExportManager };