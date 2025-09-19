#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

/**
 * Meeting End Detector
 *
 * Monitors active recordings for extended periods of silence to automatically
 * detect when a meeting has ended and stop recording.
 *
 * DETECTION ALGORITHM:
 * - Active meeting audio: -35dB to -30dB average
 * - Background/silence: below -40dB average
 * - Transition threshold: -38dB
 * - Minimum silence duration: 10 minutes (configurable)
 * - Sample interval: 30 seconds (configurable)
 */

class MeetingEndDetector {
  constructor(options = {}) {
    this.silenceThreshold = options.silenceThreshold || -38; // dB
    this.minSilenceDuration = options.minSilenceDuration || 600; // 10 minutes in seconds
    this.sampleInterval = options.sampleInterval || 30; // 30 seconds
    this.sampleDuration = options.sampleDuration || 15; // 15 second samples

    this.isMonitoring = false;
    this.silenceStartTime = null;
    this.consecutiveSilentSamples = 0;
    this.callbacks = {
      onSilenceDetected: null,
      onActivityDetected: null,
      onMeetingEndDetected: null
    };
  }

  /**
   * Start monitoring an active recording file
   */
  async startMonitoring(recordingPath, callbacks = {}) {
    if (this.isMonitoring) {
      throw new Error('Already monitoring a recording');
    }

    this.recordingPath = recordingPath;
    this.callbacks = { ...this.callbacks, ...callbacks };
    this.isMonitoring = true;
    this.silenceStartTime = null;
    this.consecutiveSilentSamples = 0;

    console.log(`🎬 Starting meeting end detection for: ${path.basename(recordingPath)}`);
    console.log(`📊 Silence threshold: ${this.silenceThreshold}dB`);
    console.log(`⏱️  Minimum silence duration: ${this.minSilenceDuration / 60} minutes`);
    console.log(`🔄 Sample interval: ${this.sampleInterval} seconds`);

    this.monitoringInterval = setInterval(() => {
      this.checkAudioLevel();
    }, this.sampleInterval * 1000);

    return this;
  }

  /**
   * Stop monitoring
   */
  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    this.isMonitoring = false;
    console.log('🛑 Meeting end detection stopped');
  }

  /**
   * Check current audio level of the recording
   */
  async checkAudioLevel() {
    try {
      const level = await this.getCurrentAudioLevel();
      const timestamp = Date.now();
      const isQuiet = level < this.silenceThreshold;

      if (isQuiet) {
        this.handleSilenceDetected(level, timestamp);
      } else {
        this.handleActivityDetected(level, timestamp);
      }

    } catch (error) {
      console.error('❌ Error checking audio level:', error);
    }
  }

  /**
   * Handle silence detection
   */
  handleSilenceDetected(level, timestamp) {
    if (this.silenceStartTime === null) {
      // Start of new silence period
      this.silenceStartTime = timestamp;
      this.consecutiveSilentSamples = 1;
      console.log(`🔇 Silence detected: ${level.toFixed(1)}dB`);

      if (this.callbacks.onSilenceDetected) {
        this.callbacks.onSilenceDetected(level, timestamp);
      }
    } else {
      // Continuing silence
      this.consecutiveSilentSamples++;
      const silenceDuration = (timestamp - this.silenceStartTime) / 1000;

      console.log(`🔇 Silence continues: ${level.toFixed(1)}dB (${Math.round(silenceDuration/60, 1)}min)`);

      // Check if we've reached the threshold for meeting end
      if (silenceDuration >= this.minSilenceDuration) {
        this.handleMeetingEndDetected(silenceDuration, timestamp);
      }
    }
  }

  /**
   * Handle activity detection (meeting still active)
   */
  handleActivityDetected(level, timestamp) {
    if (this.silenceStartTime !== null) {
      const silenceDuration = (timestamp - this.silenceStartTime) / 1000;
      console.log(`🎙️ Activity resumed: ${level.toFixed(1)}dB (after ${Math.round(silenceDuration/60, 1)}min silence)`);
    } else {
      console.log(`🎙️ Activity detected: ${level.toFixed(1)}dB`);
    }

    // Reset silence tracking
    this.silenceStartTime = null;
    this.consecutiveSilentSamples = 0;

    if (this.callbacks.onActivityDetected) {
      this.callbacks.onActivityDetected(level, timestamp);
    }
  }

  /**
   * Handle meeting end detection
   */
  handleMeetingEndDetected(silenceDuration, timestamp) {
    console.log(`🏁 MEETING END DETECTED after ${Math.round(silenceDuration/60, 1)} minutes of silence`);

    if (this.callbacks.onMeetingEndDetected) {
      this.callbacks.onMeetingEndDetected({
        silenceDuration,
        timestamp,
        estimatedMeetingEndTime: this.silenceStartTime
      });
    }

    // Stop monitoring since we've detected the end
    this.stopMonitoring();
  }

  /**
   * Get current audio level from the end of the file
   */
  getCurrentAudioLevel() {
    return new Promise((resolve, reject) => {
      // Sample from the last 30 seconds of the file
      const ffmpeg = spawn('ffmpeg', [
        '-sseof', `-${this.sampleDuration}`, // Start from N seconds before end
        '-i', this.recordingPath,
        '-af', 'volumedetect',
        '-f', 'null',
        '-'
      ], { stdio: ['pipe', 'pipe', 'pipe'] });

      let stderr = '';
      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', (code) => {
        const meanVolumeMatch = stderr.match(/mean_volume: ([-\d\.]+) dB/);
        const level = meanVolumeMatch ? parseFloat(meanVolumeMatch[1]) : -100;
        resolve(level);
      });

      ffmpeg.on('error', reject);
    });
  }

  /**
   * Test the detector with a completed recording
   */
  static async testWithRecording(recordingPath, options = {}) {
    console.log(`🧪 Testing meeting end detector with: ${path.basename(recordingPath)}`);

    const detector = new MeetingEndDetector(options);

    // Test callbacks
    const results = {
      silencePeriods: [],
      activityPeriods: [],
      meetingEndDetected: false
    };

    const callbacks = {
      onSilenceDetected: (level, timestamp) => {
        results.silencePeriods.push({ level, timestamp });
      },
      onActivityDetected: (level, timestamp) => {
        results.activityPeriods.push({ level, timestamp });
      },
      onMeetingEndDetected: (data) => {
        results.meetingEndDetected = true;
        results.meetingEndData = data;
        console.log(`✅ Test result: Meeting end would be detected after ${Math.round(data.silenceDuration/60, 1)} minutes`);
      }
    };

    // For testing, we'll simulate real-time monitoring by sampling throughout the file
    await detector.simulateMonitoring(recordingPath, callbacks);

    return results;
  }

  /**
   * Simulate monitoring for testing purposes
   */
  async simulateMonitoring(recordingPath, callbacks) {
    this.recordingPath = recordingPath;
    this.callbacks = callbacks;

    // Get file duration
    const metadata = await this.getMetadata(recordingPath);
    const duration = parseFloat(metadata.format.duration);

    console.log(`📝 Simulating monitoring for ${Math.round(duration/3600, 2)}h recording`);

    // Sample every minute for the first 2 hours, then every 10 minutes
    const samples = [];

    // Dense sampling for first 2 hours
    for (let t = 0; t < Math.min(7200, duration); t += 60) {
      samples.push(t);
    }

    // Sparse sampling for remainder
    for (let t = 7200; t < duration; t += 600) {
      samples.push(t);
    }

    let simulatedTime = 0;
    this.silenceStartTime = null;
    this.consecutiveSilentSamples = 0;

    for (const sampleTime of samples) {
      const level = await this.getAudioLevelAtTime(recordingPath, sampleTime);
      const isQuiet = level < this.silenceThreshold;

      // Simulate timestamp
      simulatedTime = sampleTime * 1000; // Convert to milliseconds

      if (isQuiet) {
        this.handleSilenceDetected(level, simulatedTime);
      } else {
        this.handleActivityDetected(level, simulatedTime);
      }

      // If meeting end was detected, stop simulation
      if (!this.isMonitoring) {
        break;
      }
    }
  }

  async getAudioLevelAtTime(filePath, timestamp) {
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-ss', timestamp.toString(),
        '-i', filePath,
        '-t', this.sampleDuration.toString(),
        '-af', 'volumedetect',
        '-f', 'null',
        '-'
      ], { stdio: ['pipe', 'pipe', 'pipe'] });

      let stderr = '';
      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', (code) => {
        const meanVolumeMatch = stderr.match(/mean_volume: ([-\d\.]+) dB/);
        const level = meanVolumeMatch ? parseFloat(meanVolumeMatch[1]) : -100;
        resolve(level);
      });

      ffmpeg.on('error', reject);
    });
  }

  getMetadata(filePath) {
    return new Promise((resolve, reject) => {
      const ffprobe = spawn('ffprobe', [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        filePath
      ]);

      let stdout = '';
      ffprobe.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      ffprobe.on('close', (code) => {
        try {
          resolve(JSON.parse(stdout));
        } catch (error) {
          reject(error);
        }
      });

      ffprobe.on('error', reject);
    });
  }
}

// CLI usage for testing
if (require.main === module) {
  const command = process.argv[2];
  const filePath = process.argv[3];

  if (command === 'test' && filePath) {
    // Test mode
    MeetingEndDetector.testWithRecording(filePath, {
      silenceThreshold: -38,
      minSilenceDuration: 600, // 10 minutes
      sampleInterval: 30
    }).then(results => {
      console.log('🧪 Test completed:', results.meetingEndDetected ? 'PASS' : 'FAIL');
    }).catch(console.error);
  } else {
    console.log('Usage:');
    console.log('  node meeting-end-detector.js test <audio-file-path>');
    console.log('');
    console.log('For integration with recording system, use as module:');
    console.log('  const MeetingEndDetector = require("./meeting-end-detector");');
  }
}

module.exports = MeetingEndDetector;