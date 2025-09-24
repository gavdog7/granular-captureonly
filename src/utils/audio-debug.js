/**
 * Audio Recording Debug Logger
 * Provides verbose logging for audio recording diagnostics
 */

const { execSync } = require('child_process');
const os = require('os');

class AudioDebugLogger {
  constructor() {
    // Load debug flags from environment
    this.enabled = process.env.AUDIO_DEBUG === 'true';
    this.processDebug = process.env.AUDIO_DEBUG_PROCESS === 'true';
    this.fileIODebug = process.env.AUDIO_DEBUG_FILE_IO === 'true';
    this.validationDebug = process.env.AUDIO_DEBUG_VALIDATION === 'true';
    this.lifecycleDebug = process.env.AUDIO_DEBUG_LIFECYCLE === 'true';

    // Track session start time for relative timestamps
    this.sessionStartTime = Date.now();

    if (this.enabled) {
      console.log('🎙️ [AUDIO DEBUG] Audio debug logging enabled with flags:', {
        process: this.processDebug,
        fileIO: this.fileIODebug,
        validation: this.validationDebug,
        lifecycle: this.lifecycleDebug
      });
    }
  }

  /**
   * Get relative timestamp from session start
   */
  getTimestamp() {
    const elapsed = Date.now() - this.sessionStartTime;
    const seconds = Math.floor(elapsed / 1000);
    const ms = elapsed % 1000;
    return `[+${seconds}.${ms.toString().padStart(3, '0')}s]`;
  }

  /**
   * Log general debug message
   */
  log(category, message, data = null) {
    if (!this.enabled) return;

    const timestamp = this.getTimestamp();
    const prefix = `🎙️ ${timestamp} [${category}]`;

    if (data) {
      console.log(prefix, message, data);
    } else {
      console.log(prefix, message);
    }
  }

  /**
   * Log process-related events
   */
  logProcess(message, data = null) {
    if (!this.processDebug) return;
    this.log('PROCESS', message, data);
  }

  /**
   * Log file I/O operations
   */
  logFileIO(message, data = null) {
    if (!this.fileIODebug) return;
    this.log('FILE I/O', message, data);
  }

  /**
   * Log validation checks
   */
  logValidation(message, data = null) {
    if (!this.validationDebug) return;
    this.log('VALIDATION', message, data);
  }

  /**
   * Log lifecycle events
   */
  logLifecycle(message, data = null) {
    if (!this.lifecycleDebug) return;
    this.log('LIFECYCLE', message, data);
  }

  /**
   * Log audio device information
   */
  async logAudioDevices() {
    if (!this.enabled) return;

    try {
      if (process.platform === 'darwin') {
        // List audio devices on macOS
        const devices = execSync('system_profiler SPAudioDataType -json', { encoding: 'utf-8' });
        const audioData = JSON.parse(devices);

        this.log('AUDIO DEVICES', 'Available audio devices:');

        if (audioData.SPAudioDataType) {
          audioData.SPAudioDataType.forEach(device => {
            this.log('AUDIO DEVICES', `  - ${device._name}`, {
              manufacturer: device.coreaudio_device_manufacturer,
              transport: device.coreaudio_device_transport,
              input: device.coreaudio_device_input || 'N/A',
              output: device.coreaudio_device_output || 'N/A'
            });
          });
        }

        // Get default input device
        try {
          const defaultInput = execSync('SwitchAudioSource -c', { encoding: 'utf-8' }).trim();
          this.log('AUDIO DEVICES', `Default input device: ${defaultInput}`);
        } catch (e) {
          // SwitchAudioSource might not be installed
          this.log('AUDIO DEVICES', 'Could not determine default input device');
        }
      }
    } catch (error) {
      this.log('AUDIO DEVICES', 'Error getting audio devices:', error.message);
    }
  }

  /**
   * Log system audio configuration
   */
  logAudioConfiguration() {
    if (!this.enabled) return;

    this.log('AUDIO CONFIG', 'System audio configuration:', {
      platform: process.platform,
      arch: process.arch,
      osVersion: os.release(),
      nodeVersion: process.version,
      electronVersion: process.versions.electron
    });
  }

  /**
   * Log file statistics with detailed info
   */
  async logFileStats(filePath, label = 'File') {
    if (!this.fileIODebug) return;

    try {
      const fs = require('fs').promises;
      const stats = await fs.stat(filePath);

      this.logFileIO(`${label} statistics:`, {
        path: filePath,
        size: `${stats.size} bytes (${(stats.size / 1024).toFixed(2)} KB)`,
        created: stats.birthtime.toISOString(),
        modified: stats.mtime.toISOString(),
        isFile: stats.isFile(),
        permissions: '0' + (stats.mode & parseInt('777', 8)).toString(8)
      });
    } catch (error) {
      this.logFileIO(`Error getting ${label} stats:`, error.message);
    }
  }

  /**
   * Log path resolution attempts
   */
  logPathResolution(meetingId, pathsAttempted, foundPath = null) {
    if (!this.fileIODebug) return;

    this.logFileIO('File path resolution for recording:', {
      meetingId,
      pathsAttempted: pathsAttempted.length,
      paths: pathsAttempted,
      resolved: foundPath ? 'SUCCESS' : 'FAILED',
      foundAt: foundPath || 'none'
    });
  }

  /**
   * Log process output with categorization
   */
  logProcessOutput(type, data, processName = 'audio-capture') {
    if (!this.processDebug) return;

    const lines = data.toString().trim().split('\n');
    lines.forEach(line => {
      if (line.trim()) {
        if (type === 'stderr') {
          this.logProcess(`[${processName} STDERR] ${line}`);
        } else {
          this.logProcess(`[${processName} STDOUT] ${line}`);
        }
      }
    });
  }

  /**
   * Log recording validation with detailed checks
   */
  logRecordingValidation(filePath, fileSize, duration, expected) {
    if (!this.validationDebug) return;

    const actualBitrate = (fileSize * 8) / duration; // bits per second
    const expectedSize = expected.bitrate * duration / 8; // bytes
    const sizeRatio = fileSize / expectedSize;

    this.logValidation('Recording validation:', {
      file: filePath,
      actualSize: `${fileSize} bytes (${(fileSize / 1024).toFixed(2)} KB)`,
      expectedSize: `${expectedSize.toFixed(0)} bytes (${(expectedSize / 1024).toFixed(2)} KB)`,
      sizeRatio: `${(sizeRatio * 100).toFixed(1)}%`,
      duration: `${duration} seconds`,
      actualBitrate: `${(actualBitrate / 1000).toFixed(1)} kbps`,
      expectedBitrate: `${(expected.bitrate / 1000).toFixed(1)} kbps`,
      status: sizeRatio > 0.8 ? 'PASS' : sizeRatio > 0.5 ? 'WARNING' : 'FAIL'
    });
  }

  /**
   * Log Opus encoding parameters
   */
  logOpusConfig(config) {
    if (!this.processDebug) return;

    this.logProcess('Opus encoder configuration:', {
      bitrate: config.bitrate || '32000',
      complexity: config.complexity || 'default',
      frameSize: config.frameSize || 'default',
      sampleRate: config.sampleRate || '48000',
      channels: config.channels || '1',
      application: config.application || 'voip'
    });
  }

  /**
   * Create a session summary
   */
  logSessionSummary(sessionId, meetingId, filePath, duration, fileSize) {
    if (!this.lifecycleDebug) return;

    const sessionDuration = (Date.now() - this.sessionStartTime) / 1000;

    this.logLifecycle('Recording session summary:', {
      sessionId,
      meetingId,
      filePath,
      recordingDuration: `${duration} seconds (${(duration / 60).toFixed(1)} minutes)`,
      fileSize: `${fileSize} bytes (${(fileSize / 1024 / 1024).toFixed(2)} MB)`,
      averageBitrate: `${((fileSize * 8) / duration / 1000).toFixed(1)} kbps`,
      sessionDuration: `${sessionDuration.toFixed(1)} seconds`,
      compressionRatio: `${(fileSize / (duration * 48000 * 2)).toFixed(4)}` // Assuming 48kHz 16-bit mono
    });
  }

  /**
   * Log path update operations
   */
  logPathUpdate(sessionId, oldPath, newPath, reason = 'path resolution') {
    if (!this.fileIODebug) return;

    this.logFileIO('Recording path updated:', {
      sessionId,
      reason,
      oldPath,
      newPath,
      changed: oldPath !== newPath
    });
  }
}

// Export singleton instance
module.exports = new AudioDebugLogger();