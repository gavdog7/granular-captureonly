#!/usr/bin/env node

const path = require('path');
const Database = require('../src/database');
const PostRecordingAnalyzer = require('../src/post-recording-analyzer');
const FileUtils = require('../src/file-utils');

/**
 * Test script for post-recording analysis and file splitting
 */

class PostProcessingTester {
  constructor() {
    this.database = null;
    this.analyzer = null;
  }

  async initialize() {
    // Initialize in-memory database for testing
    const sqlite3 = require('sqlite3').verbose();
    this.database = {
      db: new sqlite3.Database(':memory:'),
      run(sql, params = []) {
        return new Promise((resolve, reject) => {
          this.db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
          });
        });
      },
      get(sql, params = []) {
        return new Promise((resolve, reject) => {
          this.db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
          });
        });
      },
      all(sql, params = []) {
        return new Promise((resolve, reject) => {
          this.db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
          });
        });
      },

      // Mock database methods for testing
      async recordSplit(sessionId, splitData) {
        console.log(`📝 Mock: Recording split for session ${sessionId}`);
        console.log(`   Original duration: ${Math.round(splitData.originalDuration/60)}min`);
        console.log(`   Split at: ${Math.round(splitData.splitTime/60)}min`);
        console.log(`   Space saved: ${Math.round(splitData.spaceSaved/(1024*1024))}MB`);
        return { success: true };
      }
    };

    this.analyzer = new PostRecordingAnalyzer(this.database, {
      silenceThreshold: -40,
      minSilenceDuration: 600,
      bufferTime: 120
    });
  }

  async testWithAllHandsRecording() {
    const testFile = './assets/2025-09-18/2025-09-18-all-hands/recording-2025-09-18-23-11-25-497Z-session580.opus';

    console.log('🧪 Testing Post-Recording Analysis');
    console.log('==================================\\n');

    try {
      // Test 1: File existence check
      console.log('1️⃣ Checking file existence...');
      const fs = require('fs').promises;
      await fs.access(testFile);
      console.log(`✅ File exists: ${path.basename(testFile)}\\n`);

      // Test 2: Analyze the recording
      console.log('2️⃣ Running post-recording analysis...');
      const result = await this.analyzer.analyzeRecording('test-session-580', testFile);

      console.log('\\n📊 Analysis Results:');
      console.log(`   Analyzed: ${result.analyzed}`);
      console.log(`   Silence detected: ${result.silenceDetected || false}`);

      if (result.silenceDetected) {
        console.log(`   Meeting duration: ${Math.round(result.meetingDuration/60)} minutes`);
        console.log(`   Total silence: ${Math.round(result.totalSilenceDuration/60)} minutes`);
        console.log(`   Space saved: ${result.spaceSavedMB}MB`);
        console.log(`   Meeting file: ${path.basename(result.meetingPath)}`);
        console.log(`   Silence file: ${path.basename(result.silencePath)}`);
      }

      // Test 3: File utilities
      console.log('\\n3️⃣ Testing file utilities...');

      if (result.silenceDetected) {
        const isSilence = FileUtils.isSilenceFile(result.silencePath);
        const shouldProcess = FileUtils.shouldProcessAudioFile(result.silencePath);
        const splitInfo = await FileUtils.getSplitFileInfo(result.meetingPath);

        console.log(`   Is silence file: ${isSilence}`);
        console.log(`   Should process silence file: ${shouldProcess}`);
        console.log(`   Split info: Meeting ${Math.round(splitInfo.meetingSize/(1024*1024))}MB, Silence ${Math.round(splitInfo.silenceSize/(1024*1024))}MB`);
      }

      // Test 4: Processing guard
      console.log('\\n4️⃣ Testing processing guards...');
      const transcriptionGuard = FileUtils.createProcessingGuard('transcription');
      const uploadGuard = FileUtils.createProcessingGuard('upload');

      const testFiles = [
        './test-meeting.opus',
        './test-meeting.silence',
        './regular-audio.wav'
      ];

      testFiles.forEach(file => {
        const shouldTranscribe = transcriptionGuard(file);
        const shouldUpload = uploadGuard(file);
        console.log(`   ${path.basename(file)}: transcribe=${shouldTranscribe}, upload=${shouldUpload}`);
      });

      console.log('\\n✅ All tests completed successfully!');
      return result;

    } catch (error) {
      console.error('❌ Test failed:', error);
      throw error;
    }
  }

  async demonstrateIntegration() {
    console.log('\\n🔧 Integration Demo');
    console.log('===================\\n');

    console.log('Example integration in other services:\\n');

    // Example 1: Transcription service
    console.log('📝 Transcription Service Integration:');
    console.log(`
const FileUtils = require('./src/file-utils');

class TranscriptionService {
  async processRecording(filePath) {
    if (!FileUtils.shouldProcessAudioFile(filePath)) {
      return { skipped: true, reason: 'Silence file or invalid format' };
    }

    // Proceed with transcription...
    return await this.transcribeAudio(filePath);
  }
}
`);

    // Example 2: Upload service
    console.log('☁️ Upload Service Integration:');
    console.log(`
const { shouldProcessAudioFile } = require('./src/file-utils');

class UploadService {
  async uploadRecording(filePath) {
    if (!shouldProcessAudioFile(filePath)) {
      console.log('Skipping upload of .silence file');
      return { skipped: true };
    }

    // Proceed with upload...
    return await this.uploadToCloud(filePath);
  }
}
`);

    // Example 3: File listing
    console.log('📁 File Listing Integration:');
    console.log(`
const FileUtils = require('./src/file-utils');

async function getProcessableRecordings(directory) {
  const fs = require('fs').promises;
  const files = await fs.readdir(directory);
  const audioFiles = files.filter(f => f.endsWith('.opus') || f.endsWith('.wav'));

  // Filter out .silence files
  return FileUtils.filterProcessableAudioFiles(audioFiles);
}
`);
  }
}

// CLI usage
if (require.main === module) {
  const tester = new PostProcessingTester();

  async function runTests() {
    try {
      await tester.initialize();
      const result = await tester.testWithAllHandsRecording();
      await tester.demonstrateIntegration();

      console.log('\\n🎉 Post-processing test completed successfully!');

      if (result.silenceDetected) {
        console.log(`\\n💡 Your 1.7GB all hands recording has been split into:`);
        console.log(`   📹 Meeting content: ~${Math.round(result.meetingDuration/60)} minutes`);
        console.log(`   🔇 Silence content: ~${Math.round(result.totalSilenceDuration/60)} minutes`);
        console.log(`   💾 Space saved: ${result.spaceSavedMB}MB`);
      }

    } catch (error) {
      console.error('❌ Test suite failed:', error);
      process.exit(1);
    }
  }

  runTests();
}

module.exports = PostProcessingTester;