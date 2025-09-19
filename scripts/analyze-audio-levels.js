#!/usr/bin/env node

const { spawn } = require('child_process');
const fs = require('fs');

/**
 * Analyzes audio levels over time to detect when a meeting ends
 * by finding periods of sustained low activity.
 *
 * This script samples audio levels every 60 seconds and identifies
 * when the audio drops to background/silence levels for extended periods.
 */

class AudioLevelAnalyzer {
  constructor(filePath) {
    this.filePath = filePath;
    this.sampleInterval = 60; // Sample every 60 seconds
    this.silenceThreshold = -40; // dB threshold for "silence"
    this.minSilenceDuration = 600; // 10 minutes of silence to consider "ended"
  }

  /**
   * Extract audio levels at regular intervals using ffmpeg
   */
  async extractAudioLevels(duration) {
    console.log(`🎵 Analyzing audio levels for ${duration} seconds (${Math.round(duration/3600, 1)} hours)...`);

    const levels = [];
    const totalSamples = Math.floor(duration / this.sampleInterval);

    for (let i = 0; i < totalSamples; i++) {
      const timestamp = i * this.sampleInterval;
      const level = await this.getAudioLevelAtTime(timestamp);
      levels.push({ timestamp, level });

      if (i % 60 === 0) { // Progress every hour
        console.log(`  Progress: ${Math.round((i/totalSamples)*100)}% (${Math.round(timestamp/3600, 1)}h)`);
      }
    }

    return levels;
  }

  /**
   * Get average audio level at a specific timestamp
   */
  getAudioLevelAtTime(timestamp) {
    return new Promise((resolve, reject) => {
      // Extract 5 seconds of audio starting at timestamp and get RMS level
      const ffmpeg = spawn('ffmpeg', [
        '-ss', timestamp.toString(),
        '-i', this.filePath,
        '-t', '5', // 5 second sample
        '-af', 'volumedetect',
        '-f', 'null',
        '-'
      ], { stdio: ['pipe', 'pipe', 'pipe'] });

      let stderr = '';
      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', (code) => {
        // Parse the volume detect output
        const meanVolumeMatch = stderr.match(/mean_volume: ([-\d\.]+) dB/);
        const level = meanVolumeMatch ? parseFloat(meanVolumeMatch[1]) : -100;
        resolve(level);
      });

      ffmpeg.on('error', reject);
    });
  }

  /**
   * Analyze levels to find when the meeting likely ended
   */
  findMeetingEnd(levels) {
    console.log('\n📊 Analyzing audio patterns...');

    let silenceStart = null;
    let longestSilence = { start: null, duration: 0 };

    for (let i = 0; i < levels.length; i++) {
      const { timestamp, level } = levels[i];

      if (level < this.silenceThreshold) {
        // Start of silence period
        if (silenceStart === null) {
          silenceStart = timestamp;
        }
      } else {
        // End of silence period
        if (silenceStart !== null) {
          const silenceDuration = timestamp - silenceStart;
          if (silenceDuration > longestSilence.duration) {
            longestSilence = { start: silenceStart, duration: silenceDuration };
          }
          silenceStart = null;
        }
      }
    }

    // Check if we ended in silence
    if (silenceStart !== null) {
      const finalSilenceDuration = levels[levels.length - 1].timestamp - silenceStart;
      if (finalSilenceDuration > longestSilence.duration) {
        longestSilence = { start: silenceStart, duration: finalSilenceDuration };
      }
    }

    return longestSilence;
  }

  /**
   * Generate a report of the analysis
   */
  generateReport(levels, meetingEnd) {
    const report = {
      totalDuration: levels[levels.length - 1].timestamp,
      sampleCount: levels.length,
      meetingEndDetected: meetingEnd.start !== null,
      estimatedMeetingEnd: meetingEnd.start,
      silenceDurationAfterMeeting: meetingEnd.duration,
      levelsSummary: this.summarizeLevels(levels)
    };

    console.log('\n📋 ANALYSIS REPORT');
    console.log('==================');
    console.log(`Total recording duration: ${Math.round(report.totalDuration/3600, 2)} hours`);
    console.log(`Meeting end detected: ${report.meetingEndDetected ? 'YES' : 'NO'}`);

    if (report.meetingEndDetected) {
      const endHours = Math.round(report.estimatedMeetingEnd / 3600, 2);
      const silenceHours = Math.round(report.silenceDurationAfterMeeting / 3600, 2);
      console.log(`Estimated meeting end: ${endHours} hours into recording`);
      console.log(`Silence duration after meeting: ${silenceHours} hours`);
      console.log(`Meeting likely duration: ${endHours} hours`);
    }

    return report;
  }

  summarizeLevels(levels) {
    const activeLevels = levels.filter(l => l.level > this.silenceThreshold);
    const silentLevels = levels.filter(l => l.level <= this.silenceThreshold);

    return {
      activeCount: activeLevels.length,
      silentCount: silentLevels.length,
      averageActiveLevel: activeLevels.length > 0 ?
        activeLevels.reduce((sum, l) => sum + l.level, 0) / activeLevels.length : 0,
      averageSilentLevel: silentLevels.length > 0 ?
        silentLevels.reduce((sum, l) => sum + l.level, 0) / silentLevels.length : 0
    };
  }

  /**
   * Main analysis function
   */
  async analyze() {
    try {
      // Get duration from metadata
      const metadata = await this.getMetadata();
      const duration = parseFloat(metadata.format.duration);

      console.log(`🎬 Analyzing file: ${this.filePath}`);
      console.log(`📏 Duration: ${Math.round(duration/3600, 2)} hours`);

      // Extract levels
      const levels = await this.extractAudioLevels(duration);

      // Find meeting end
      const meetingEnd = this.findMeetingEnd(levels);

      // Generate report
      const report = this.generateReport(levels, meetingEnd);

      // Save detailed data
      await this.saveAnalysisData(levels, report);

      return report;
    } catch (error) {
      console.error('❌ Analysis failed:', error);
      throw error;
    }
  }

  getMetadata() {
    return new Promise((resolve, reject) => {
      const ffprobe = spawn('ffprobe', [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        this.filePath
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

  async saveAnalysisData(levels, report) {
    const filename = `audio-analysis-${Date.now()}.json`;
    const data = { levels, report, metadata: { analyzedAt: new Date().toISOString() } };

    await fs.promises.writeFile(filename, JSON.stringify(data, null, 2));
    console.log(`💾 Analysis data saved to: ${filename}`);
  }
}

// CLI usage
if (require.main === module) {
  const filePath = process.argv[2];

  if (!filePath) {
    console.error('Usage: node analyze-audio-levels.js <audio-file-path>');
    process.exit(1);
  }

  const analyzer = new AudioLevelAnalyzer(filePath);
  analyzer.analyze()
    .then(() => console.log('✅ Analysis complete'))
    .catch(error => {
      console.error('❌ Analysis failed:', error);
      process.exit(1);
    });
}

module.exports = AudioLevelAnalyzer;