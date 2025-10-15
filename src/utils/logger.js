/**
 * Unified Logging System v3
 *
 * Single log file for both main and renderer processes.
 * Always debug level. Structured JSON payloads for jq queries.
 *
 * Usage (Main Process):
 *   const log = require('./utils/logger');
 *   log.info('[RECORDING] Session started', { meetingId: 123, sessionId: 'abc' });
 *
 * Usage (Renderer Process via preload):
 *   window.log.info('[PIPELINE] Navigation initiated', { meetingId: 123 });
 */

const log = require('electron-log');
const path = require('path');
const { app } = require('electron');

// ONE file. That's it.
log.transports.file.resolvePathFn = () => {
  return path.join(app.getPath('userData'), 'logs', 'app.log');
};

// Always debug level. Disk is cheap, time is not.
log.transports.file.level = 'debug';
log.transports.console.level = 'debug';

// No rotation initially. Start with 50MB.
log.transports.file.maxSize = 50 * 1024 * 1024; // 50MB

// Format for structured logging + jq queries
// Format: [timestamp] [LEVEL] message {json_payload}
// Using electron-log's built-in template format for proper handling
log.transports.file.format = '[{iso}] [{level}] {text}';

// Add process identifier to messages for file transport
log.hooks.push((message, transport) => {
  if (transport === log.transports.file) {
    const processType = process.type || 'main';
    // Prepend process type to the first data element (the message text)
    if (message.data && message.data.length > 0) {
      message.data[0] = `[${processType}] ${message.data[0]}`;
    }
  }
  return message;
});

module.exports = log;
