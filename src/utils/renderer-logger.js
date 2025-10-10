/**
 * Renderer Process Logger
 *
 * Provides logging API for renderer processes that sends logs to main process
 * via IPC to be written to the unified log file.
 *
 * Usage in renderer:
 *   const log = require('../utils/renderer-logger');
 *   log.info('[PIPELINE] Navigation initiated', { meetingId: 123 });
 */

const { ipcRenderer } = require('electron');

const log = {
  debug: (message, data) => {
    ipcRenderer.send('log', 'debug', message, data);
  },

  info: (message, data) => {
    ipcRenderer.send('log', 'info', message, data);
  },

  warn: (message, data) => {
    ipcRenderer.send('log', 'warn', message, data);
  },

  error: (message, data) => {
    ipcRenderer.send('log', 'error', message, data);
  }
};

// Also expose on window for inline usage
if (typeof window !== 'undefined') {
  window.log = log;
}

module.exports = log;
