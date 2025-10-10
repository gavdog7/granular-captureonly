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
// Format: [timestamp] [LEVEL] [process] message {json_payload}
log.transports.file.format = (msg) => {
  const { data, date, level } = msg;

  // First arg is the message, second is the structured payload
  const text = data.shift();
  const payload = data.length > 0 ? JSON.stringify(data[0]) : '';

  return `[${date.toISOString()}] [${level.toUpperCase()}] ${text} ${payload}`;
};

// Add process identifier for clarity
log.hooks.push((message, transport) => {
  if (transport === log.transports.file) {
    message.data.unshift(`[${process.type || 'main'}]`);
  }
  return message;
});

module.exports = log;
