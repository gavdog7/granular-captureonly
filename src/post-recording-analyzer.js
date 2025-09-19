const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const AudioSplitter = require('./audio-splitter');

/**
 * Post-Recording Analyzer
 *
 * Analyzes completed recordings over 1 hour to detect extended silence periods
 * and automatically splits them into meeting content + silence portions.
 */
class PostRecordingAnalyzer {
  constructor(database, options = {}) {
    this.database = database;
    this.minDurationForAnalysis = options.minDurationForAnalysis || 3600; // 1 hour
    this.silenceThreshold = options.silenceThreshold || -40; // dB
    this.minSilenceDuration = options.minSilenceDuration || 600; // 10 minutes
    this.bufferTime = options.bufferTime || 120; // 2 minutes buffer after meeting
    this.audioSplitter = new AudioSplitter();
  }

  /**
   * Main analysis method - checks if recording needs processing and splits if needed
   */
  async analyzeRecording(sessionId, filePath) {
    try {
      console.log(`🔍 Analyzing recording: ${path.basename(filePath)}`);

      // 1. Get audio metadata
      const metadata = await this.getAudioMetadata(filePath);
      const durationHours = Math.round(metadata.duration / 3600 * 100) / 100;

      console.log(`📏 Duration: ${durationHours} hours`);

      // 2. Check if recording meets criteria for analysis
      if (metadata.duration < this.minDurationForAnalysis) {
        console.log(`⏭️ Skipping analysis - under 1 hour (${durationHours}h)`);
        return {
          analyzed: false,
          reason: 'Under 1 hour duration',
          duration: metadata.duration
        };
      }

      // 3. Detect extended silence pattern
      console.log(`🎯 Detecting silence pattern for ${durationHours}h recording...`);
      const silenceDetection = await this.detectExtendedSilence(filePath, metadata.duration);

      if (!silenceDetection.found) {
        console.log(`✅ No problematic silence detected - recording appears normal`);
        return {
          analyzed: true,
          silenceDetected: false,
          duration: metadata.duration
        };
      }

      // 4. Calculate savings potential
      const meetingDurationMin = Math.round(silenceDetection.meetingEndTime / 60);
      const silenceDurationMin = Math.round(silenceDetection.silenceDuration / 60);

      console.log(`📊 Extended silence detected:`);
      console.log(`   Meeting duration: ~${meetingDurationMin} minutes`);
      console.log(`   Silence duration: ~${silenceDurationMin} minutes`);

      // 5. Split the recording
      console.log(`✂️ Splitting recording...`);
      const splitResult = await this.splitRecording(filePath, silenceDetection.meetingEndTime);

      // 6. Update database
      await this.updateDatabaseAfterSplit(sessionId, {
        originalDuration: metadata.duration,
        splitTime: silenceDetection.meetingEndTime,
        silencePath: splitResult.silencePath,
        spaceSaved: splitResult.originalSize - splitResult.meetingSize
      });

      const spaceSavedMB = Math.round((splitResult.originalSize - splitResult.meetingSize) / (1024 * 1024));

      console.log(`✅ Recording successfully split - ${spaceSavedMB}MB saved`);

      return {
        analyzed: true,
        silenceDetected: true,
        originalSize: splitResult.originalSize,
        meetingSize: splitResult.meetingSize,
        silenceSize: splitResult.silenceSize,
        meetingDuration: silenceDetection.meetingEndTime,
        totalSilenceDuration: silenceDetection.silenceDuration,
        spaceSavedMB,
        meetingPath: splitResult.meetingPath,
        silencePath: splitResult.silencePath
      };

    } catch (error) {
      console.error(`❌ Post-recording analysis failed:`, error);
      throw error;
    }
  }

  /**
   * Detect extended silence in the recording using strategic sampling
   */
  async detectExtendedSilence(filePath, totalDuration) {
    console.log(`🎵 Sampling audio levels...`);

    // Strategic sampling: dense for first 2 hours, sparse after
    const samples = await this.strategicSampling(filePath, totalDuration);

    // Analyze samples to find silence pattern
    const analysis = this.analyzeSamplesForSilence(samples);

    return analysis;
  }

  /**
   * Strategic audio sampling to efficiently detect silence patterns
   */
  async strategicSampling(filePath, totalDuration) {
    const samples = [];

    // Phase 1: First 2 hours - sample every 5 minutes (likely meeting period)
    const phase1End = Math.min(7200, totalDuration); // 2 hours or end of file
    for (let t = 300; t < phase1End; t += 300) { // Start at 5min, every 5min
      const level = await this.getAudioLevelAtTime(filePath, t);
      samples.push({ time: t, level, phase: 1 });
    }

    // Phase 2: After 2 hours - sample every 30 minutes (likely silence period)
    if (totalDuration > 7200) {
      for (let t = 7200; t < totalDuration; t += 1800) { // Every 30 minutes
        const level = await this.getAudioLevelAtTime(filePath, t);
        samples.push({ time: t, level, phase: 2 });
      }
    }

    return samples;
  }

  /**
   * Analyze samples to determine if there's a problematic silence pattern
   */
  analyzeSamplesForSilence(samples) {
    console.log(`📊 Analyzing ${samples.length} audio samples...`);

    // Find the transition from active audio to sustained silence
    let lastActiveIndex = -1;
    let firstSilentIndex = -1;

    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      const isActive = sample.level > this.silenceThreshold;

      if (isActive) {
        lastActiveIndex = i;
      } else if (firstSilentIndex === -1) {
        firstSilentIndex = i;
      }
    }

    // Check if we found a clear transition pattern
    if (lastActiveIndex === -1) {
      return { found: false, reason: 'No active audio detected' };
    }

    // If most samples after the last active one are silent, we found the pattern
    const samplesAfterLastActive = samples.slice(lastActiveIndex + 1);
    const silentSamplesAfter = samplesAfterLastActive.filter(s => s.level <= this.silenceThreshold);

    if (samplesAfterLastActive.length === 0) {
      return { found: false, reason: 'No samples after last activity' };
    }

    const silenceRatio = silentSamplesAfter.length / samplesAfterLastActive.length;

    if (silenceRatio < 0.8) { // 80% of subsequent samples should be silent
      return { found: false, reason: 'Insufficient sustained silence detected' };
    }

    // Calculate meeting end time and silence duration
    const lastActiveSample = samples[lastActiveIndex];
    const meetingEndTime = lastActiveSample.time;
    const silenceDuration = samples[samples.length - 1].time - meetingEndTime;

    // Check if silence duration meets minimum threshold
    if (silenceDuration < this.minSilenceDuration) {
      return {
        found: false,
        reason: `Silence duration (${Math.round(silenceDuration/60)}min) below threshold (${this.minSilenceDuration/60}min)`
      };
    }

    console.log(`✅ Silence pattern confirmed - meeting likely ended at ${Math.round(meetingEndTime/60)} minutes`);

    return {
      found: true,
      meetingEndTime,
      silenceDuration,
      confidence: silenceRatio,
      lastActiveLevel: lastActiveSample.level,
      samplesAnalyzed: samples.length
    };
  }

  /**
   * Split the recording at the detected meeting end time
   */
  async splitRecording(filePath, meetingEndTime) {
    console.log(`✂️ Splitting at ${Math.round(meetingEndTime/60)} minutes...`);

    const splitResult = await this.audioSplitter.splitAtTime(
      filePath,
      meetingEndTime,
      this.bufferTime
    );

    if (!splitResult.success) {
      throw new Error('Failed to split recording');
    }

    return splitResult;
  }

  /**
   * Update database with split information
   */
  async updateDatabaseAfterSplit(sessionId, splitData) {
    try {
      await this.database.recordSplit(sessionId, splitData);
      console.log(`📝 Database updated for session ${sessionId}`);
    } catch (error) {
      console.error('❌ Failed to update database:', error);
      throw error;
    }
  }

  /**
   * Get audio level at a specific time
   */
  async getAudioLevelAtTime(filePath, timestamp) {
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-ss', timestamp.toString(),
        '-i', filePath,
        '-t', '30', // 30 second sample
        '-af', 'volumedetect',
        '-f', 'null',
        '-'
      ], { stdio: ['pipe', 'pipe', 'pipe'] });

      // Track the process globally for cleanup
      if (global.trackProcess) {
        global.trackProcess(ffmpeg, `FFmpeg level analysis ${path.basename(filePath)}`);
      }

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
   * Get audio metadata
   */
  async getAudioMetadata(filePath) {
    return new Promise((resolve, reject) => {
      const ffprobe = spawn('ffprobe', [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        filePath
      ]);

      // Track the process globally for cleanup
      if (global.trackProcess) {
        global.trackProcess(ffprobe, `FFprobe metadata ${path.basename(filePath)}`);
      }

      let stdout = '';
      ffprobe.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      ffprobe.on('close', (code) => {
        try {
          const metadata = JSON.parse(stdout);
          resolve({
            duration: parseFloat(metadata.format.duration),
            size: parseInt(metadata.format.size),
            bitRate: parseInt(metadata.format.bit_rate)
          });
        } catch (error) {
          reject(error);
        }
      });

      ffprobe.on('error', reject);
    });
  }

  /**
   * Static method to test the analyzer with a specific file
   */
  static async testWithFile(filePath, database, options = {}) {
    console.log(`🧪 Testing post-recording analyzer with: ${path.basename(filePath)}`);

    const analyzer = new PostRecordingAnalyzer(database, options);
    const mockSessionId = 'test-session';

    try {
      const result = await analyzer.analyzeRecording(mockSessionId, filePath);
      console.log('✅ Test completed successfully');
      return result;
    } catch (error) {
      console.error('❌ Test failed:', error);
      throw error;
    }
  }
}

module.exports = PostRecordingAnalyzer;