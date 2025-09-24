/**
 * Audio Diagnostics Utility
 * Additional diagnostic tools for troubleshooting audio recording issues
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const audioDebug = require('./audio-debug');

class AudioDiagnostics {
  constructor(binaryPath) {
    this.binaryPath = binaryPath;
  }

  /**
   * Test the Swift audio capture binary
   */
  async testAudioCaptureBinary() {
    if (!audioDebug.enabled) return;

    audioDebug.logValidation('Testing audio capture binary...');

    try {
      // Check if binary exists and is executable
      const stats = await fs.stat(this.binaryPath);
      audioDebug.logValidation('Binary file check', {
        path: this.binaryPath,
        exists: true,
        size: `${stats.size} bytes`,
        executable: !!(stats.mode & parseInt('111', 8)),
        permissions: '0' + (stats.mode & parseInt('777', 8)).toString(8)
      });

      // Test binary version/help command
      return new Promise((resolve, reject) => {
        const testProcess = spawn(this.binaryPath, ['version'], {
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 5000
        });

        let stdout = '';
        let stderr = '';

        testProcess.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        testProcess.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        testProcess.on('close', (code) => {
          audioDebug.logValidation('Binary test result', {
            exitCode: code,
            stdout: stdout.trim() || 'empty',
            stderr: stderr.trim() || 'empty'
          });

          if (code === 0) {
            resolve({ success: true, version: stdout.trim() });
          } else {
            reject(new Error(`Binary test failed with code ${code}: ${stderr}`));
          }
        });

        testProcess.on('error', (error) => {
          audioDebug.logValidation('Binary test error', { error: error.message });
          reject(error);
        });
      });

    } catch (error) {
      audioDebug.logValidation('Binary file check failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Validate Opus file integrity
   */
  async validateOpusFile(filePath, expectedDuration) {
    if (!audioDebug.fileIODebug) return;

    try {
      // Check if we have opusinfo available (part of opus-tools)
      try {
        execSync('which opusinfo', { stdio: 'ignore' });
      } catch (e) {
        audioDebug.logFileIO('opusinfo not available - skipping Opus validation');
        return;
      }

      const opusInfo = execSync(`opusinfo "${filePath}"`, { encoding: 'utf-8' });

      // Parse opus info for key details
      const lines = opusInfo.split('\n');
      const info = {};

      lines.forEach(line => {
        if (line.includes('Playback length:')) {
          const match = line.match(/(\d+)m:(\d+\.\d+)s/);
          if (match) {
            info.duration = parseInt(match[1]) * 60 + parseFloat(match[2]);
          }
        }
        if (line.includes('Rate:')) {
          const match = line.match(/Rate:\s*(\d+)\s*Hz/);
          if (match) {
            info.sampleRate = parseInt(match[1]);
          }
        }
        if (line.includes('Channels:')) {
          const match = line.match(/Channels:\s*(\d+)/);
          if (match) {
            info.channels = parseInt(match[1]);
          }
        }
      });

      audioDebug.logValidation('Opus file validation', {
        filePath,
        expectedDuration,
        actualDuration: info.duration || 'unknown',
        sampleRate: info.sampleRate || 'unknown',
        channels: info.channels || 'unknown',
        durationMatch: info.duration ? Math.abs(info.duration - expectedDuration) < 5 : 'unknown'
      });

    } catch (error) {
      audioDebug.logValidation('Opus validation failed', {
        filePath,
        error: error.message
      });
    }
  }

  /**
   * Check for audio session conflicts (macOS)
   */
  async checkAudioSessionConflicts() {
    if (process.platform !== 'darwin' || !audioDebug.validationDebug) return;

    try {
      // List processes that might be using audio
      const audioProcesses = execSync('lsof +c 15 /dev/null 2>&1 | grep -E "(CoreAudio|AudioUnit|coreaudiod)" | head -20',
        { encoding: 'utf-8' }).trim();

      if (audioProcesses) {
        audioDebug.logValidation('Potential audio session conflicts detected', {
          processes: audioProcesses.split('\n').map(line => line.trim()).filter(line => line)
        });
      } else {
        audioDebug.logValidation('No obvious audio session conflicts detected');
      }

    } catch (error) {
      // This is expected if no conflicts are found
      audioDebug.logValidation('Audio conflict check completed (no conflicts)');
    }
  }

  /**
   * Monitor system audio during recording
   */
  async monitorSystemAudioLevels(durationSeconds = 5) {
    if (process.platform !== 'darwin' || !audioDebug.validationDebug) return;

    audioDebug.logValidation(`Starting ${durationSeconds}s audio level monitoring...`);

    return new Promise((resolve, reject) => {
      // Use SoX to monitor audio levels if available
      let monitorProcess;

      try {
        execSync('which sox', { stdio: 'ignore' });

        monitorProcess = spawn('sox', [
          '-t', 'coreaudio', 'default',
          '-n', 'trim', '0', durationSeconds.toString(),
          'stats'
        ], {
          stdio: ['pipe', 'pipe', 'pipe']
        });

      } catch (e) {
        // Fall back to a simple sleep if sox isn't available
        audioDebug.logValidation('SoX not available - cannot monitor audio levels');
        setTimeout(() => resolve({ success: false, reason: 'sox not available' }), 1000);
        return;
      }

      let stderr = '';

      monitorProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      monitorProcess.on('close', (code) => {
        // Parse SoX stats output
        const lines = stderr.split('\n');
        const stats = {};

        lines.forEach(line => {
          if (line.includes('RMS amplitude:')) {
            const match = line.match(/RMS amplitude:\s*([\d.]+)/);
            if (match) stats.rmsAmplitude = parseFloat(match[1]);
          }
          if (line.includes('Maximum amplitude:')) {
            const match = line.match(/Maximum amplitude:\s*([\d.]+)/);
            if (match) stats.maxAmplitude = parseFloat(match[1]);
          }
        });

        audioDebug.logValidation('System audio level monitoring results', {
          duration: durationSeconds,
          rmsAmplitude: stats.rmsAmplitude || 'unknown',
          maxAmplitude: stats.maxAmplitude || 'unknown',
          hasAudio: (stats.rmsAmplitude || 0) > 0.001
        });

        resolve({
          success: true,
          stats,
          hasAudio: (stats.rmsAmplitude || 0) > 0.001
        });
      });

      monitorProcess.on('error', (error) => {
        audioDebug.logValidation('Audio monitoring error', { error: error.message });
        resolve({ success: false, error: error.message });
      });
    });
  }

  /**
   * Check disk space in recording directory
   */
  async checkDiskSpace(recordingDir) {
    if (!audioDebug.fileIODebug) return;

    try {
      if (process.platform === 'darwin') {
        const dfOutput = execSync(`df -h "${recordingDir}"`, { encoding: 'utf-8' });
        const lines = dfOutput.trim().split('\n');
        if (lines.length > 1) {
          const parts = lines[1].split(/\s+/);
          audioDebug.logFileIO('Disk space check', {
            filesystem: parts[0],
            size: parts[1],
            used: parts[2],
            available: parts[3],
            usage: parts[4],
            mountPoint: parts[5]
          });
        }
      }
    } catch (error) {
      audioDebug.logFileIO('Disk space check failed', { error: error.message });
    }
  }

  /**
   * Run comprehensive pre-recording diagnostics
   */
  async runPreRecordingDiagnostics(recordingDir) {
    if (!audioDebug.enabled) return;

    audioDebug.logLifecycle('Running pre-recording diagnostics...');

    const results = {};

    try {
      // Test binary
      results.binaryTest = await this.testAudioCaptureBinary();

      // Check audio session conflicts
      await this.checkAudioSessionConflicts();

      // Check disk space
      await this.checkDiskSpace(recordingDir);

      // Quick audio level check (2 seconds)
      results.audioCheck = await this.monitorSystemAudioLevels(2);

      audioDebug.logLifecycle('Pre-recording diagnostics completed', results);

    } catch (error) {
      audioDebug.logLifecycle('Pre-recording diagnostics failed', { error: error.message });
      throw error;
    }

    return results;
  }
}

module.exports = AudioDiagnostics;