const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

/**
 * Audio Splitter
 *
 * Handles splitting audio files at specified times, creating separate files
 * for meeting content and silence portions.
 */
class AudioSplitter {
  constructor(options = {}) {
    this.tempSuffix = options.tempSuffix || '.tmp';
    this.silenceExtension = options.silenceExtension || '.silence.opus';
    this.preserveOriginal = options.preserveOriginal || false;
  }

  /**
   * Split an audio file at a specific time
   *
   * @param {string} inputPath - Path to the input audio file
   * @param {number} splitTime - Time in seconds where to split
   * @param {number} bufferSeconds - Buffer time to add after split point
   * @returns {Object} Result object with file paths and sizes
   */
  async splitAtTime(inputPath, splitTime, bufferSeconds = 120) {
    const dir = path.dirname(inputPath);
    const ext = path.extname(inputPath);
    const basename = path.basename(inputPath, ext);

    // Define file paths
    const meetingPath = inputPath; // Replace the original file
    const silencePath = path.join(dir, `${basename}${this.silenceExtension}`);
    const backupPath = path.join(dir, `${basename}_original${ext}`);
    const tempMeetingPath = path.join(dir, `${basename}_meeting${ext}`); // Use same extension

    console.log(`✂️ Splitting "${path.basename(inputPath)}" at ${Math.round(splitTime/60)}m ${splitTime%60}s`);

    try {
      // 1. Validate input file
      await this.validateInputFile(inputPath);

      // 2. Get original file size
      const originalStats = await fs.stat(inputPath);
      const originalSize = originalStats.size;

      // 3. Create backup of original file
      console.log(`💾 Creating backup...`);
      await fs.copyFile(inputPath, backupPath);

      // 4. Extract meeting portion (0 to splitTime + buffer)
      const meetingEndTime = splitTime + bufferSeconds;
      console.log(`🎬 Extracting meeting (0 to ${Math.round(meetingEndTime/60)}m ${Math.round(meetingEndTime%60)}s)...`);
      await this.extractSegment(inputPath, 0, meetingEndTime, tempMeetingPath);

      // 5. Extract silence portion (splitTime to end)
      console.log(`🔇 Extracting silence (${Math.round(splitTime/60)}m to end)...`);
      await this.extractSegment(inputPath, splitTime, null, silencePath);

      // 6. Replace original with meeting portion
      console.log(`🔄 Replacing original with meeting portion...`);
      await fs.rename(tempMeetingPath, meetingPath);

      // 7. Get file sizes after split
      const meetingStats = await fs.stat(meetingPath);
      const silenceStats = await fs.stat(silencePath);
      const meetingSize = meetingStats.size;
      const silenceSize = silenceStats.size;

      // 8. Validate split results
      await this.validateSplitResults(meetingPath, silencePath);

      // 9. Remove backup (split was successful)
      if (!this.preserveOriginal) {
        await fs.unlink(backupPath);
        console.log(`🗑️ Backup removed`);
      } else {
        console.log(`💾 Backup preserved at: ${path.basename(backupPath)}`);
      }

      const spaceSaved = originalSize - meetingSize;
      const spaceSavedMB = Math.round(spaceSaved / (1024 * 1024));
      const compressionRatio = spaceSaved / originalSize;

      console.log(`✅ Split completed successfully`);
      console.log(`   Original: ${Math.round(originalSize / (1024 * 1024))}MB`);
      console.log(`   Meeting: ${Math.round(meetingSize / (1024 * 1024))}MB`);
      console.log(`   Silence: ${Math.round(silenceSize / (1024 * 1024))}MB`);
      console.log(`   Space saved: ${spaceSavedMB}MB (${Math.round(compressionRatio * 100)}%)`);

      return {
        success: true,
        meetingPath,
        silencePath,
        backupPath: this.preserveOriginal ? backupPath : null,
        originalSize,
        meetingSize,
        silenceSize,
        spaceSaved,
        compressionRatio,
        splitTime,
        bufferTime: bufferSeconds
      };

    } catch (error) {
      console.error(`❌ Split failed: ${error.message}`);

      // Attempt to restore from backup
      await this.restoreFromBackup(inputPath, backupPath, tempMeetingPath, silencePath);

      throw new Error(`Audio split failed: ${error.message}`);
    }
  }

  /**
   * Extract a segment from an audio file
   *
   * @param {string} inputPath - Input file path
   * @param {number} startTime - Start time in seconds
   * @param {number|null} duration - Duration in seconds (null for end of file)
   * @param {string} outputPath - Output file path
   */
  async extractSegment(inputPath, startTime, duration, outputPath) {
    return new Promise((resolve, reject) => {
      const args = [
        '-y', // Overwrite output files
        '-ss', startTime.toString(),
        '-i', inputPath,
        '-c', 'copy', // Copy streams without re-encoding for speed
        '-avoid_negative_ts', 'make_zero' // Handle timestamp issues
      ];

      if (duration !== null) {
        args.push('-t', duration.toString());
      }

      args.push(outputPath);

      console.log(`   ffmpeg ${args.join(' ')}`);

      const ffmpeg = spawn('ffmpeg', args, {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Track the process globally for cleanup
      if (global.trackProcess) {
        global.trackProcess(ffmpeg, `FFmpeg split ${path.basename(inputFile)}`);
      }

      let stderr = '';
      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg failed with code ${code}. Error: ${stderr}`));
        }
      });

      ffmpeg.on('error', (error) => {
        reject(new Error(`FFmpeg spawn error: ${error.message}`));
      });
    });
  }

  /**
   * Validate input file exists and is accessible
   */
  async validateInputFile(inputPath) {
    try {
      await fs.access(inputPath, fs.constants.R_OK);
      const stats = await fs.stat(inputPath);

      if (!stats.isFile()) {
        throw new Error('Input path is not a file');
      }

      if (stats.size === 0) {
        throw new Error('Input file is empty');
      }

    } catch (error) {
      throw new Error(`Input file validation failed: ${error.message}`);
    }
  }

  /**
   * Validate split results
   */
  async validateSplitResults(meetingPath, silencePath) {
    try {
      // Check meeting file
      const meetingStats = await fs.stat(meetingPath);
      if (meetingStats.size === 0) {
        throw new Error('Meeting file is empty after split');
      }

      // Check silence file
      const silenceStats = await fs.stat(silencePath);
      if (silenceStats.size === 0) {
        throw new Error('Silence file is empty after split');
      }

      // Verify files are valid audio
      await this.validateAudioFile(meetingPath);
      await this.validateAudioFile(silencePath);

    } catch (error) {
      throw new Error(`Split validation failed: ${error.message}`);
    }
  }

  /**
   * Validate that a file is a valid audio file
   */
  async validateAudioFile(filePath) {
    return new Promise((resolve, reject) => {
      const ffprobe = spawn('ffprobe', [
        '-v', 'error',
        '-select_streams', 'a:0',
        '-show_entries', 'stream=duration',
        '-of', 'csv=p=0',
        filePath
      ], { stdio: ['pipe', 'pipe', 'pipe'] });

      // Track the process globally for cleanup
      if (global.trackProcess) {
        global.trackProcess(ffprobe, `FFprobe validate ${path.basename(filePath)}`);
      }

      let stdout = '';
      let stderr = '';

      ffprobe.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      ffprobe.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffprobe.on('close', (code) => {
        if (code === 0 && stdout.trim() !== '' && stdout.trim() !== 'N/A') {
          resolve();
        } else {
          reject(new Error(`Invalid audio file: ${stderr || 'No audio stream found'}`));
        }
      });

      ffprobe.on('error', reject);
    });
  }

  /**
   * Restore files from backup in case of failure
   */
  async restoreFromBackup(originalPath, backupPath, tempMeetingPath, silencePath) {
    console.log(`🔄 Attempting to restore from backup...`);

    try {
      // Remove any temporary files
      const filesToCleanup = [tempMeetingPath, silencePath];

      for (const file of filesToCleanup) {
        try {
          await fs.access(file);
          await fs.unlink(file);
          console.log(`🗑️ Cleaned up: ${path.basename(file)}`);
        } catch (error) {
          // File doesn't exist, ignore
        }
      }

      // Restore original file from backup
      try {
        await fs.access(backupPath);
        await fs.copyFile(backupPath, originalPath);
        await fs.unlink(backupPath);
        console.log(`✅ Original file restored from backup`);
      } catch (error) {
        console.error(`❌ Failed to restore from backup: ${error.message}`);
      }

    } catch (error) {
      console.error(`❌ Backup restoration failed: ${error.message}`);
    }
  }

  /**
   * Get audio duration using ffprobe
   */
  async getAudioDuration(filePath) {
    return new Promise((resolve, reject) => {
      const ffprobe = spawn('ffprobe', [
        '-v', 'quiet',
        '-show_entries', 'format=duration',
        '-of', 'csv=p=0',
        filePath
      ]);

      // Track the process globally for cleanup
      if (global.trackProcess) {
        global.trackProcess(ffprobe, `FFprobe duration ${path.basename(filePath)}`);
      }

      let stdout = '';
      ffprobe.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      ffprobe.on('close', (code) => {
        if (code === 0) {
          const duration = parseFloat(stdout.trim());
          resolve(duration);
        } else {
          reject(new Error(`Failed to get audio duration`));
        }
      });

      ffprobe.on('error', reject);
    });
  }

  /**
   * Merge split files back together (for testing or recovery)
   */
  async mergeSplitFiles(meetingPath, silencePath, outputPath) {
    console.log(`🔧 Merging split files back together...`);

    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-y',
        '-i', meetingPath,
        '-i', silencePath,
        '-filter_complex', '[0:0][1:0]concat=n=2:v=0:a=1[out]',
        '-map', '[out]',
        '-c', 'copy',
        outputPath
      ]);

      // Track the process globally for cleanup
      if (global.trackProcess) {
        global.trackProcess(ffmpeg, `FFmpeg merge ${path.basename(outputPath)}`);
      }

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          console.log(`✅ Files merged successfully: ${path.basename(outputPath)}`);
          resolve();
        } else {
          reject(new Error(`Merge failed with code ${code}`));
        }
      });

      ffmpeg.on('error', reject);
    });
  }
}

module.exports = AudioSplitter;