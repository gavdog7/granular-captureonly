const path = require('path');
const fs = require('fs').promises;

/**
 * File Utilities for handling different file types including .silence files
 */
class FileUtils {
  /**
   * Check if a file is a silence file (.silence.opus extension)
   */
  static isSilenceFile(filePath) {
    return filePath.endsWith('.silence.opus') || filePath.endsWith('.silence');
  }

  /**
   * Check if a file should be processed by audio/transcription services
   */
  static shouldProcessAudioFile(filePath) {
    // Skip .silence files
    if (this.isSilenceFile(filePath)) {
      console.log(`⏭️ Skipping .silence file: ${path.basename(filePath)}`);
      return false;
    }

    // Check for valid audio extensions
    const audioExtensions = ['.opus', '.wav', '.mp3', '.m4a', '.aac', '.flac'];
    const ext = path.extname(filePath).toLowerCase();

    if (!audioExtensions.includes(ext)) {
      console.log(`⏭️ Skipping non-audio file: ${path.basename(filePath)}`);
      return false;
    }

    return true;
  }

  /**
   * Get the corresponding meeting file path for a silence file
   */
  static getMeetingFileFromSilence(silenceFilePath) {
    if (!this.isSilenceFile(silenceFilePath)) {
      throw new Error('File is not a .silence file');
    }

    if (silenceFilePath.endsWith('.silence.opus')) {
      return silenceFilePath.replace('.silence.opus', '.opus');
    } else {
      return silenceFilePath.replace('.silence', '.opus');
    }
  }

  /**
   * Get the corresponding silence file path for a meeting file
   */
  static getSilenceFileFromMeeting(meetingFilePath) {
    const ext = path.extname(meetingFilePath);
    return meetingFilePath.replace(ext, '.silence' + ext);
  }

  /**
   * Check if a recording has been split (has corresponding .silence file)
   */
  static async isRecordingSplit(meetingFilePath) {
    try {
      const silenceFilePath = this.getSilenceFileFromMeeting(meetingFilePath);
      await fs.access(silenceFilePath);
      return {
        isSplit: true,
        silenceFilePath,
        meetingFilePath
      };
    } catch (error) {
      return {
        isSplit: false,
        silenceFilePath: null,
        meetingFilePath
      };
    }
  }

  /**
   * Get file size information for split recordings
   */
  static async getSplitFileInfo(meetingFilePath) {
    const splitInfo = await this.isRecordingSplit(meetingFilePath);

    if (!splitInfo.isSplit) {
      const stats = await fs.stat(meetingFilePath);
      return {
        isSplit: false,
        meetingSize: stats.size,
        silenceSize: 0,
        totalSize: stats.size,
        spaceSaved: 0
      };
    }

    try {
      const meetingStats = await fs.stat(meetingFilePath);
      const silenceStats = await fs.stat(splitInfo.silenceFilePath);

      const meetingSize = meetingStats.size;
      const silenceSize = silenceStats.size;
      const totalSize = meetingSize + silenceSize;
      const spaceSaved = silenceSize; // Space that would have been wasted

      return {
        isSplit: true,
        meetingSize,
        silenceSize,
        totalSize,
        spaceSaved,
        meetingFilePath,
        silenceFilePath: splitInfo.silenceFilePath
      };
    } catch (error) {
      console.error('Error getting split file info:', error);
      throw error;
    }
  }

  /**
   * Filter audio files to exclude .silence files
   */
  static filterProcessableAudioFiles(filePaths) {
    return filePaths.filter(filePath => this.shouldProcessAudioFile(filePath));
  }

  /**
   * Get all .silence files in a directory
   */
  static async getSilenceFilesInDirectory(directoryPath) {
    try {
      const files = await fs.readdir(directoryPath);
      const silenceFiles = files
        .filter(file => this.isSilenceFile(file))
        .map(file => path.join(directoryPath, file));

      return silenceFiles;
    } catch (error) {
      console.error('Error reading directory for .silence files:', error);
      return [];
    }
  }

  /**
   * Get statistics about .silence files in a directory
   */
  static async getSilenceFileStatistics(directoryPath) {
    try {
      const silenceFiles = await this.getSilenceFilesInDirectory(directoryPath);

      let totalSilenceSize = 0;
      let totalFiles = silenceFiles.length;

      for (const filePath of silenceFiles) {
        try {
          const stats = await fs.stat(filePath);
          totalSilenceSize += stats.size;
        } catch (error) {
          console.error(`Error getting stats for ${filePath}:`, error);
        }
      }

      return {
        count: totalFiles,
        totalSizeMB: Math.round(totalSilenceSize / (1024 * 1024)),
        averageSizeMB: totalFiles > 0 ? Math.round((totalSilenceSize / totalFiles) / (1024 * 1024)) : 0,
        files: silenceFiles
      };
    } catch (error) {
      console.error('Error calculating silence file statistics:', error);
      return {
        count: 0,
        totalSizeMB: 0,
        averageSizeMB: 0,
        files: []
      };
    }
  }

  /**
   * Clean up old .silence files (older than specified days)
   */
  static async cleanupOldSilenceFiles(directoryPath, olderThanDays = 30) {
    try {
      const silenceFiles = await this.getSilenceFilesInDirectory(directoryPath);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      let deletedCount = 0;
      let deletedSizeMB = 0;

      for (const filePath of silenceFiles) {
        try {
          const stats = await fs.stat(filePath);

          if (stats.mtime < cutoffDate) {
            const sizeMB = Math.round(stats.size / (1024 * 1024));
            await fs.unlink(filePath);
            deletedCount++;
            deletedSizeMB += sizeMB;
            console.log(`🗑️ Deleted old silence file: ${path.basename(filePath)} (${sizeMB}MB)`);
          }
        } catch (error) {
          console.error(`Error processing ${filePath}:`, error);
        }
      }

      return {
        deletedCount,
        deletedSizeMB,
        message: deletedCount > 0
          ? `Deleted ${deletedCount} old silence files (${deletedSizeMB}MB)`
          : 'No old silence files to delete'
      };
    } catch (error) {
      console.error('Error cleaning up old silence files:', error);
      return {
        deletedCount: 0,
        deletedSizeMB: 0,
        message: `Error during cleanup: ${error.message}`
      };
    }
  }

  /**
   * Validate that meeting and silence files are consistent
   */
  static async validateSplitFiles(meetingFilePath) {
    const splitInfo = await this.isRecordingSplit(meetingFilePath);

    if (!splitInfo.isSplit) {
      return { valid: true, reason: 'Not a split recording' };
    }

    try {
      // Check that both files exist
      await fs.access(meetingFilePath);
      await fs.access(splitInfo.silenceFilePath);

      // Check that both files have content
      const meetingStats = await fs.stat(meetingFilePath);
      const silenceStats = await fs.stat(splitInfo.silenceFilePath);

      if (meetingStats.size === 0) {
        return { valid: false, reason: 'Meeting file is empty' };
      }

      if (silenceStats.size === 0) {
        return { valid: false, reason: 'Silence file is empty' };
      }

      return { valid: true, reason: 'Split files are valid' };
    } catch (error) {
      return { valid: false, reason: `File access error: ${error.message}` };
    }
  }

  /**
   * Create a processing guard function that can be used in other modules
   */
  static createProcessingGuard(operation = 'process') {
    return (filePath) => {
      if (this.isSilenceFile(filePath)) {
        console.log(`⏭️ Skipping ${operation} for .silence file: ${path.basename(filePath)}`);
        return false;
      }
      return true;
    };
  }
}

// Export static utility functions for convenience
module.exports = FileUtils;

// Also export individual functions for direct import
module.exports.isSilenceFile = FileUtils.isSilenceFile.bind(FileUtils);
module.exports.shouldProcessAudioFile = FileUtils.shouldProcessAudioFile.bind(FileUtils);
module.exports.filterProcessableAudioFiles = FileUtils.filterProcessableAudioFiles.bind(FileUtils);
module.exports.createProcessingGuard = FileUtils.createProcessingGuard.bind(FileUtils);