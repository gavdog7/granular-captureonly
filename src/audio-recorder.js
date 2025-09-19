const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const { app } = require('electron');
const PostRecordingAnalyzer = require('./post-recording-analyzer');

class AudioRecorder {
  constructor(database, mainWindow = null) {
    this.database = database;
    this.mainWindow = mainWindow;
    this.activeRecordings = new Map(); // meetingId -> recording session
    this.binaryPath = path.join(__dirname, 'native', 'audio-capture', '.build', 'release', 'audio-capture');
    this.assetsPath = path.join(__dirname, '..', 'assets'); // Save in project assets folder
    this.lastStopTime = null; // Track when last recording stopped for audio session management

    // Initialize post-recording analyzer
    this.postAnalyzer = new PostRecordingAnalyzer(database, {
      minDurationForAnalysis: 3600, // 1 hour
      silenceThreshold: -40,
      minSilenceDuration: 600, // 10 minutes
      bufferTime: 120 // 2 minutes buffer
    });
  }

  /**
   * Start recording for a meeting with retry mechanism for macOS 26 audio session issues
   * @param {number} meetingId - The meeting ID
   * @param {number} attempt - Current attempt number (internal use)
   * @returns {Promise<Object>} Recording session info
   */
  async startRecording(meetingId, attempt = 1) {
    try {
      // Check if already recording for this meeting
      if (this.activeRecordings.has(meetingId)) {
        const existing = this.activeRecordings.get(meetingId);
        if (existing.isRecording) {
          throw new Error('Recording already in progress for this meeting');
        }
      }

      // Handle macOS 26 audio session management - add delay if starting too soon
      if (this.lastStopTime) {
        const timeSinceLastStop = Date.now() - this.lastStopTime;
        const minDelay = 1000; // Minimum 1 second between recordings

        if (timeSinceLastStop < minDelay) {
          const waitTime = minDelay - timeSinceLastStop;
          console.log(`🎙️ Audio session cleanup: waiting ${waitTime}ms before starting new recording`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }

      // Get meeting details for folder structure
      const meeting = await this.database.getMeetingById(meetingId);
      if (!meeting) {
        throw new Error('Meeting not found');
      }

      // Create recording directory
      const recordingDir = await this.createRecordingDirectory(meeting);
      
      // Generate unique filename with Opus extension
      const filename = this.generateFilename(meetingId);
      const finalPath = path.join(recordingDir, `${filename}.opus`);

      // Create recording session in database
      const sessionResult = await this.database.startRecordingSession(meetingId, finalPath);
      const sessionId = sessionResult.lastID;

      // Start native audio capture process
      const captureProcess = await this.startCaptureProcess(finalPath);

      // Create recording session object
      const recordingSession = {
        sessionId,
        meetingId,
        finalPath,
        filename,
        isRecording: true,
        isPaused: false,
        startTime: new Date(),
        duration: 0,
        partNumber: await this.getNextPartNumber(meetingId),
        process: captureProcess,
        error: null
      };

      // Store active recording
      this.activeRecordings.set(meetingId, recordingSession);

      // Set up process event handlers
      this.setupProcessHandlers(recordingSession);

      // Start duration timer
      this.startDurationTimer(recordingSession);

      console.log(`Started recording for meeting ${meetingId}, session ${sessionId}`);

      // Validate recording started successfully after a brief delay
      setTimeout(async () => {
        try {
          await this.validateRecordingStarted(recordingSession, attempt, meetingId);
        } catch (validationError) {
          console.error('Recording validation failed, will restart:', validationError);
          // If validation fails, restart the recording
          if (attempt <= 3) {
            try {
              console.log(`🔄 Restarting recording due to validation failure (attempt ${attempt + 1})`);
              await this.startRecording(meetingId, attempt + 1);
            } catch (retryError) {
              console.error('Failed to restart recording:', retryError);
            }
          }
        }
      }, 2000); // Check after 2 seconds

      return this.getRecordingStatus(meetingId);

    } catch (error) {
      console.error(`Error starting recording (attempt ${attempt}):`, error);

      // Retry logic for macOS 26 audio session issues
      if (attempt < 6) {
        const delay = Math.min(500 * Math.pow(2, attempt - 1), 4000); // Exponential backoff: 500ms, 1s, 2s, 4s, 4s, 4s
        console.log(`🔄 Retrying recording start in ${delay}ms (attempt ${attempt + 1}/6)`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.startRecording(meetingId, attempt + 1);
      }

      throw new Error(`Failed to start recording after 6 attempts: ${error.message}`);
    }
  }

  /**
   * Pause recording for a meeting
   * @param {number} meetingId - The meeting ID
   * @returns {Promise<Object>} Recording session info
   */
  async pauseRecording(meetingId) {
    const recording = this.activeRecordings.get(meetingId);
    if (!recording || !recording.isRecording) {
      throw new Error('No active recording to pause');
    }

    try {
      // Send pause signal to native process
      if (recording.process && !recording.process.killed) {
        recording.process.kill('SIGUSR1'); // Use signal for pause
      }

      recording.isPaused = true;
      console.log(`Paused recording for meeting ${meetingId}`);
      
      return this.getRecordingStatus(meetingId);
    } catch (error) {
      console.error('Error pausing recording:', error);
      throw error;
    }
  }

  /**
   * Resume recording for a meeting
   * @param {number} meetingId - The meeting ID
   * @returns {Promise<Object>} Recording session info
   */
  async resumeRecording(meetingId) {
    const recording = this.activeRecordings.get(meetingId);
    if (!recording || !recording.isRecording) {
      throw new Error('No active recording to resume');
    }

    try {
      // Send resume signal to native process
      if (recording.process && !recording.process.killed) {
        recording.process.kill('SIGUSR2'); // Use signal for resume
      }

      recording.isPaused = false;
      console.log(`Resumed recording for meeting ${meetingId}`);
      
      return this.getRecordingStatus(meetingId);
    } catch (error) {
      console.error('Error resuming recording:', error);
      throw error;
    }
  }

  /**
   * Stop recording for a meeting
   * @param {number} meetingId - The meeting ID
   * @param {boolean} isSync - Whether this is a synchronous call
   * @returns {Promise<Object>} Final recording session info
   */
  async stopRecording(meetingId, isSync = false) {
    const recording = this.activeRecordings.get(meetingId);
    if (!recording || !recording.isRecording) {
      throw new Error('No active recording to stop');
    }

    try {
      // Stop the native process
      if (recording.process && !recording.process.killed) {
        recording.process.kill('SIGTERM');
      }

      // Wait for process to fully terminate (macOS 26 audio session cleanup)
      if (recording.process && !recording.process.killed) {
        console.log('⏱️ Waiting for audio capture process to terminate...');
        await new Promise((resolve) => {
          const timeout = setTimeout(() => {
            console.log('⚠️ Audio process termination timeout, proceeding anyway');
            resolve();
          }, 3000); // 3 second max wait

          recording.process.on('exit', () => {
            console.log('✅ Audio capture process terminated cleanly');
            clearTimeout(timeout);
            resolve();
          });
        });
      }

      // Clear duration timer
      if (recording.durationTimer) {
        clearInterval(recording.durationTimer);
      }

      // Update database (file is already in final location)
      console.log(`📝 Updating database for recording session ${recording.sessionId}, path: ${recording.finalPath}`);
      await this.database.endRecordingSession(
        recording.sessionId,
        recording.finalPath,
        recording.duration
      );
      console.log(`✅ Database updated for recording session ${recording.sessionId}`);

      // Start post-processing analysis asynchronously (non-blocking)
      this.startPostProcessing(recording.sessionId, recording.finalPath, recording.duration);

      // Remove from active recordings
      this.activeRecordings.delete(meetingId);

      // Store last stop time for audio session cleanup tracking
      this.lastStopTime = Date.now();
      console.log('🎙️ Audio session marked as stopped for cleanup tracking');

      console.log(`Stopped recording for meeting ${meetingId}`);
      return this.getRecordingStatus(meetingId);

    } catch (error) {
      console.error('Error stopping recording:', error);
      recording.error = error.message;
      throw error;
    }
  }

  /**
   * Get recording status for a meeting
   * @param {number} meetingId - The meeting ID
   * @returns {Object} Recording status
   */
  getRecordingStatus(meetingId) {
    const recording = this.activeRecordings.get(meetingId);
    
    if (!recording) {
      return {
        sessionId: null,
        meetingId,
        isRecording: false,
        isPaused: false,
        duration: 0,
        fileName: null,
        partNumber: 0,
        error: null
      };
    }

    return {
      sessionId: recording.sessionId,
      meetingId: recording.meetingId,
      isRecording: recording.isRecording,
      isPaused: recording.isPaused,
      duration: recording.duration,
      fileName: recording.filename,
      partNumber: recording.partNumber,
      error: recording.error
    };
  }

  /**
   * Get all recording sessions for a meeting
   * @param {number} meetingId - The meeting ID
   * @returns {Promise<Array>} Array of recording sessions
   */
  async getRecordingSessions(meetingId) {
    return await this.database.getCompletedRecordings(meetingId);
  }

  /**
   * Stop recording synchronously (for page unload)
   * @param {number} meetingId - The meeting ID
   * @returns {Object} Final recording session info
   */
  stopRecordingSync(meetingId) {
    const recording = this.activeRecordings.get(meetingId);
    if (!recording || !recording.isRecording) {
      console.warn('No active recording to stop synchronously');
      return { success: false, error: 'No active recording' };
    }

    try {
      // Stop the native process
      if (recording.process && !recording.process.killed) {
        recording.process.kill('SIGTERM');
      }

      // Clear duration timer
      if (recording.durationTimer) {
        clearInterval(recording.durationTimer);
      }

      // Mark as stopped
      recording.isRecording = false;

      // Mark recording as completed in database
      if (recording.sessionId && recording.finalPath) {
        const endTime = Date.now();
        const duration = Math.floor((endTime - recording.startTime) / 1000);
        this.database.endRecordingSessionSync(recording.sessionId, recording.finalPath, duration);
        console.log(`Recording marked as completed in database for meeting ${meetingId}`);
      }

      // Remove from active recordings
      this.activeRecordings.delete(meetingId);

      console.log(`Recording stopped synchronously for meeting ${meetingId}`);
      return { success: true, meetingId };

    } catch (error) {
      console.error('Error stopping recording synchronously:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Create recording directory for a meeting
   * @param {Object} meeting - Meeting object
   * @returns {Promise<string>} Directory path
   */
  async createRecordingDirectory(meeting) {
    // Create directory structure: assets/date/meeting-folder/
    const dateStr = meeting.start_time.split('T')[0]; // YYYY-MM-DD
    // Use the folder_name from database instead of sanitizing title to ensure consistency
    const meetingFolder = meeting.folder_name || this.sanitizeFolderName(meeting.title);
    const recordingDir = path.join(this.assetsPath, dateStr, meetingFolder);

    await fs.mkdir(recordingDir, { recursive: true });
    return recordingDir;
  }

  /**
   * Generate unique filename for recording
   * @param {number} meetingId - Meeting ID
   * @returns {string} Filename without extension
   */
  generateFilename(meetingId) {
    const timestamp = new Date().toISOString()
      .replace(/[:.]/g, '-')
      .replace(/T/, '-')
      .replace(/\..+/, '');
    
    return `recording-${timestamp}-session${meetingId}`;
  }

  /**
   * Get next part number for a meeting
   * @param {number} meetingId - Meeting ID
   * @returns {Promise<number>} Next part number
   */
  async getNextPartNumber(meetingId) {
    const sessions = await this.database.getCompletedRecordings(meetingId);
    const partNumbers = sessions
      .map(s => s.part_number || 1)
      .filter(p => p > 0);
    
    return partNumbers.length > 0 ? Math.max(...partNumbers) + 1 : 1;
  }

  /**
   * Start native audio capture process
   * @param {string} outputPath - Output file path
   * @returns {Promise<ChildProcess>} Spawned process
   */
  async startCaptureProcess(outputPath) {
    return new Promise((resolve, reject) => {
      // Use the built Swift binary for real audio recording
      console.log(`Starting audio capture process: ${this.binaryPath}`);
      console.log(`Output path: ${outputPath}`);
      
      const process = spawn(this.binaryPath, [
        'start',
        '--output', outputPath,
        '--bitrate', '32000'
      ], { 
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: false
      });
      
      // Log stdout from the binary
      process.stdout.on('data', (data) => {
        console.log(`Audio capture stdout: ${data.toString().trim()}`);
      });
      
      // Log stderr from the binary
      process.stderr.on('data', (data) => {
        console.error(`Audio capture stderr: ${data.toString().trim()}`);
      });
      
      process.on('error', (error) => {
        console.error('Audio capture process error:', error);
        reject(new Error(`Failed to start audio capture: ${error.message}`));
      });

      process.on('spawn', () => {
        console.log(`Audio capture process spawned with PID: ${process.pid}`);
        resolve(process);
      });
    });
  }

  /**
   * Set up process event handlers
   * @param {Object} recordingSession - Recording session object
   */
  setupProcessHandlers(recordingSession) {
    const { process } = recordingSession;

    process.on('exit', (code) => {
      console.log(`Audio capture process exited with code ${code}`);
      recordingSession.isRecording = false;

      if (recordingSession.durationTimer) {
        clearInterval(recordingSession.durationTimer);
      }
    });

    process.on('error', (error) => {
      console.error('Audio capture process error:', error);
      recordingSession.error = error.message;
      recordingSession.isRecording = false;
    });
  }

  /**
   * Validate that recording started successfully by checking file size growth
   * @param {Object} recordingSession - The recording session
   * @param {number} attempt - Current attempt number
   * @param {number} meetingId - Meeting ID for retry
   */
  async validateRecordingStarted(recordingSession, attempt, meetingId) {
    if (!recordingSession.isRecording) {
      return; // Recording already stopped
    }

    try {
      const fs = require('fs').promises;
      const stats = await fs.stat(recordingSession.finalPath);

      // Check if file is growing (should be > 1KB after 2 seconds for active recording)
      if (stats.size < 1024) {
        console.warn(`⚠️ Recording file unexpectedly small (${stats.size} bytes), may indicate audio session failure`);

        // If this was an early attempt and file is tiny, trigger retry by throwing error
        if (attempt <= 3 && stats.size < 100) {
          console.log('🔄 Recording validation failed, will trigger retry mechanism...');
          try {
            await this.stopRecording(meetingId, true);
            // Trigger retry by throwing an error that startRecording can catch
            throw new Error(`Recording validation failed: file too small (${stats.size} bytes)`);
          } catch (stopError) {
            console.error('Error stopping failed recording:', stopError);
            throw new Error(`Recording validation failed: file too small (${stats.size} bytes)`);
          }
        }
      } else {
        console.log(`✅ Recording validation passed: file size ${stats.size} bytes`);
      }
    } catch (error) {
      console.warn('Could not validate recording file:', error.message);
    }
  }

  /**
   * Start duration timer for recording
   * @param {Object} recordingSession - Recording session object
   */
  startDurationTimer(recordingSession) {
    recordingSession.durationTimer = setInterval(() => {
      if (recordingSession.isRecording && !recordingSession.isPaused) {
        recordingSession.duration = Math.floor(
          (new Date() - recordingSession.startTime) / 1000
        );
      }
    }, 1000);
  }


  /**
   * Start post-processing analysis for a completed recording
   * @param {number} sessionId - Recording session ID
   * @param {string} filePath - Path to the recording file
   * @param {number} duration - Recording duration in seconds
   */
  startPostProcessing(sessionId, filePath, duration) {
    // Run asynchronously to not block the UI
    setImmediate(async () => {
      try {
        console.log(`🔍 Starting post-processing analysis for session ${sessionId}`);
        console.log(`📏 Duration: ${Math.round(duration/3600*100)/100} hours`);

        const result = await this.postAnalyzer.analyzeRecording(sessionId, filePath);

        if (result.silenceDetected) {
          console.log(`✂️ Recording split completed for session ${sessionId}`);
          console.log(`💾 Space saved: ${result.spaceSavedMB}MB`);
          console.log(`⏱️  Meeting duration: ${Math.round(result.meetingDuration/60)} minutes`);

          // Notify UI if available
          if (this.mainWindow && this.mainWindow.webContents) {
            this.mainWindow.webContents.send('recording-split', {
              sessionId,
              originalSize: result.originalSize,
              newSize: result.meetingSize,
              spaceSavedMB: result.spaceSavedMB,
              meetingDuration: Math.round(result.meetingDuration/60),
              silenceDuration: Math.round(result.totalSilenceDuration/60)
            });
          }
        } else if (result.analyzed) {
          console.log(`✅ Post-processing complete - no problematic silence detected in session ${sessionId}`);
        } else {
          console.log(`⏭️ Post-processing skipped for session ${sessionId}: ${result.reason}`);
        }
      } catch (error) {
        console.error(`❌ Post-processing failed for session ${sessionId}:`, error);

        // Notify UI of error if available
        if (this.mainWindow && this.mainWindow.webContents) {
          this.mainWindow.webContents.send('recording-split-error', {
            sessionId,
            error: error.message
          });
        }
      }
    });
  }

  /**
   * Clean up all active recordings (for app shutdown)
   */
  async cleanup() {
    console.log('Cleaning up audio recordings...');

    for (const [meetingId, recording] of this.activeRecordings.entries()) {
      try {
        await this.stopRecording(meetingId);
      } catch (error) {
        console.error(`Error stopping recording ${meetingId}:`, error);
      }
    }

    this.activeRecordings.clear();
  }

  /**
   * Sanitize folder name for file system
   * @param {string} name - Original name
   * @returns {string} Sanitized name
   */
  sanitizeFolderName(name) {
    return name
      .replace(/[^a-zA-Z0-9\s-]/g, '') // Remove special chars
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .toLowerCase()
      .substring(0, 50); // Limit length
  }
}

module.exports = AudioRecorder;