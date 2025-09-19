#!/usr/bin/env node

const { spawn } = require('child_process');
const fs = require('fs');

/**
 * Quick audio analysis that samples key time periods to detect meeting end
 */

class QuickAudioAnalyzer {
  constructor(filePath) {
    this.filePath = filePath;
  }

  /**
   * Get audio level statistics for a time range
   */
  getAudioStatsForRange(startTime, duration = 300) { // 5 minute samples
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-ss', startTime.toString(),
        '-i', this.filePath,
        '-t', duration.toString(),
        '-af', 'volumedetect',
        '-f', 'null',
        '-'
      ], { stdio: ['pipe', 'pipe', 'pipe'] });

      let stderr = '';
      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', (code) => {
        // Parse volumedetect output
        const meanVolumeMatch = stderr.match(/mean_volume: ([-\d\.]+) dB/);
        const maxVolumeMatch = stderr.match(/max_volume: ([-\d\.]+) dB/);
        const histogramMatch = stderr.match(/histogram_(\d+)db: (\d+)/g);

        const meanVolume = meanVolumeMatch ? parseFloat(meanVolumeMatch[1]) : -100;
        const maxVolume = maxVolumeMatch ? parseFloat(maxVolumeMatch[1]) : -100;

        resolve({
          startTime,
          duration,
          meanVolume,
          maxVolume,
          isLikelySilence: meanVolume < -40 && maxVolume < -20
        });
      });

      ffmpeg.on('error', reject);
    });
  }

  /**
   * Strategic sampling approach:
   * - Sample first 2 hours heavily (likely meeting time)
   * - Sample middle period sparsely
   * - Sample end period to confirm extended silence
   */
  async strategicAnalysis(totalDuration) {
    console.log(`🎯 Strategic analysis of ${Math.round(totalDuration/3600, 1)} hour recording`);

    const samples = [];

    // Phase 1: First 2 hours (likely meeting) - sample every 30 minutes
    console.log('📊 Phase 1: Analyzing first 2 hours (expected meeting time)...');
    for (let t = 0; t < Math.min(7200, totalDuration); t += 1800) { // Every 30 min
      const stats = await this.getAudioStatsForRange(t, 300);
      samples.push(stats);
      console.log(`  ${Math.round(t/3600, 1)}h: ${stats.meanVolume.toFixed(1)}dB (${stats.isLikelySilence ? 'QUIET' : 'ACTIVE'})`);
    }

    // Phase 2: Middle period - sample every 2 hours to detect transition
    console.log('📊 Phase 2: Scanning middle period for activity transition...');
    for (let t = 7200; t < totalDuration - 7200; t += 7200) { // Every 2 hours
      const stats = await this.getAudioStatsForRange(t, 300);
      samples.push(stats);
      console.log(`  ${Math.round(t/3600, 1)}h: ${stats.meanVolume.toFixed(1)}dB (${stats.isLikelySilence ? 'QUIET' : 'ACTIVE'})`);
    }

    // Phase 3: Last 2 hours - sample every hour to confirm silence
    console.log('📊 Phase 3: Analyzing final 2 hours (expected silence)...');
    const startLast2Hours = Math.max(totalDuration - 7200, 7200);
    for (let t = startLast2Hours; t < totalDuration; t += 3600) { // Every hour
      const stats = await this.getAudioStatsForRange(t, 300);
      samples.push(stats);
      console.log(`  ${Math.round(t/3600, 1)}h: ${stats.meanVolume.toFixed(1)}dB (${stats.isLikelySilence ? 'QUIET' : 'ACTIVE'})`);
    }

    return samples;
  }

  /**
   * Detect meeting end by finding transition from active to sustained silence
   */
  detectMeetingEnd(samples) {
    console.log('\n🔍 Detecting meeting end transition...');

    // Find the last sample with significant activity
    let lastActiveIndex = -1;
    for (let i = samples.length - 1; i >= 0; i--) {
      if (!samples[i].isLikelySilence) {
        lastActiveIndex = i;
        break;
      }
    }

    if (lastActiveIndex === -1) {
      return { found: false, reason: 'No active audio detected in any samples' };
    }

    const lastActiveSample = samples[lastActiveIndex];
    const nextSample = samples[lastActiveIndex + 1];

    // Estimate meeting end time
    let estimatedEndTime = lastActiveSample.startTime + lastActiveSample.duration;

    // If there's a next sample that's silent, the meeting likely ended between them
    if (nextSample && nextSample.isLikelySilence) {
      // Binary search between the two samples for more precision
      console.log(`🎯 Meeting ended between ${Math.round(lastActiveSample.startTime/3600, 2)}h and ${Math.round(nextSample.startTime/3600, 2)}h`);
    }

    return {
      found: true,
      estimatedEndTime,
      estimatedEndHours: Math.round(estimatedEndTime / 3600, 2),
      lastActiveTime: lastActiveSample.startTime,
      confidence: lastActiveIndex < samples.length - 2 ? 'HIGH' : 'MEDIUM'
    };
  }

  async analyze() {
    try {
      // Get total duration
      const metadata = await this.getMetadata();
      const duration = parseFloat(metadata.format.duration);

      console.log(`🎬 Quick analysis of: ${this.filePath}`);
      console.log(`⏱️  Total duration: ${Math.round(duration/3600, 2)} hours\n`);

      // Strategic sampling
      const samples = await this.strategicAnalysis(duration);

      // Detect meeting end
      const meetingEnd = this.detectMeetingEnd(samples);

      // Generate report
      this.generateReport(samples, meetingEnd, duration);

      return { samples, meetingEnd, duration };
    } catch (error) {
      console.error('❌ Quick analysis failed:', error);
      throw error;
    }
  }

  generateReport(samples, meetingEnd, totalDuration) {
    console.log('\n📋 QUICK ANALYSIS REPORT');
    console.log('========================');
    console.log(`Total recording: ${Math.round(totalDuration/3600, 2)} hours`);
    console.log(`Samples analyzed: ${samples.length}`);

    if (meetingEnd.found) {
      console.log(`✅ Meeting end detected: ${meetingEnd.estimatedEndHours} hours`);
      console.log(`📏 Estimated meeting duration: ${meetingEnd.estimatedEndHours} hours`);
      console.log(`🔇 Silent period after meeting: ${Math.round((totalDuration - meetingEnd.estimatedEndTime)/3600, 2)} hours`);
      console.log(`🎯 Confidence: ${meetingEnd.confidence}`);
    } else {
      console.log(`❌ Could not detect meeting end: ${meetingEnd.reason}`);
    }

    // Show activity pattern
    console.log('\n📈 ACTIVITY PATTERN:');
    samples.forEach(sample => {
      const hour = Math.round(sample.startTime/3600, 1);
      const status = sample.isLikelySilence ? '🔇 QUIET' : '🎙️  ACTIVE';
      console.log(`  ${hour.toString().padStart(4)}h: ${status} (${sample.meanVolume.toFixed(1)}dB)`);
    });
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
}

// CLI usage
if (require.main === module) {
  const filePath = process.argv[2];

  if (!filePath) {
    console.error('Usage: node quick-audio-analysis.js <audio-file-path>');
    process.exit(1);
  }

  const analyzer = new QuickAudioAnalyzer(filePath);
  analyzer.analyze()
    .then(() => console.log('\n✅ Quick analysis complete'))
    .catch(error => {
      console.error('❌ Analysis failed:', error);
      process.exit(1);
    });
}

module.exports = QuickAudioAnalyzer;