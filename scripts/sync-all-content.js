const path = require('path');
const fs = require('fs-extra');
const sqlite3 = require('sqlite3').verbose();

// Simple database wrapper for standalone scripts
class StandaloneDatabase {
  constructor() {
    this.db = null;
  }

  async initialize() {
    // Use the actual database file in Electron app data
    const os = require('os');
    this.dbPath = path.join(os.homedir(), 'Library', 'Application Support', 'Electron', 'granular-captureonly.db');
    
    if (!await fs.pathExists(this.dbPath)) {
      throw new Error(`Database not found at ${this.dbPath}`);
    }
    
    this.db = new sqlite3.Database(this.dbPath);
    console.log(`✅ Connected to database: ${this.dbPath}`);
  }

  async all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  async run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve({ changes: this.changes, lastID: this.lastID });
      });
    });
  }

  async close() {
    return new Promise((resolve) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) console.error('Error closing database:', err);
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

// Mock upload service for analysis
class AnalysisService {
  constructor(database) {
    this.database = database;
  }

  async hasContentToUpload(meetingId, meeting) {
    try {
      const dateStr = meeting.start_time.split('T')[0];
      const projectRoot = path.dirname(__dirname);
      
      // Try multiple directory strategies
      const possibleDirs = await this.findMeetingDirectories(meeting, dateStr, projectRoot);
      
      // Check all possible directories for content
      for (const meetingDir of possibleDirs) {
        if (await fs.pathExists(meetingDir)) {
          const files = await fs.readdir(meetingDir);
          const contentFiles = files.filter(file => 
            file.endsWith('.md') || 
            file.endsWith('.opus') || 
            file.endsWith('.wav') || 
            file.endsWith('.m4a') ||
            file.endsWith('.mp3')
          );
          
          if (contentFiles.length > 0) {
            return { hasContent: true, files: contentFiles, directory: meetingDir };
          }
        }
      }

      // Check database notes
      if (meeting.notes_content && 
          meeting.notes_content.trim() !== '' && 
          meeting.notes_content !== '{}' &&
          meeting.notes_content !== '[]') {
        return { hasContent: true, files: ['notes in database'] };
      }

      return { hasContent: false, files: [] };
    } catch (error) {
      console.error(`Error checking content for meeting ${meetingId}:`, error);
      return { hasContent: false, files: [] };
    }
  }

  async findMeetingDirectories(meeting, dateStr, projectRoot) {
    const basePath = path.join(projectRoot, 'assets', dateStr);
    const possibleDirs = [];
    
    // Strategy 1: Use database folder_name
    possibleDirs.push(path.join(basePath, meeting.folder_name));
    
    // Strategy 2: Look for directories that might match this meeting
    try {
      if (await fs.pathExists(basePath)) {
        const allDirs = await fs.readdir(basePath);
        const meetingDirs = allDirs.filter(dir => {
          // Look for directories that contain meeting title words
          const titleWords = meeting.title.toLowerCase().split(/\s+/).filter(word => word.length > 3);
          const dirName = dir.toLowerCase();
          
          // Check if directory name contains any significant words from the title
          return titleWords.some(word => dirName.includes(word));
        });
        
        // Add these potential matches
        meetingDirs.forEach(dir => {
          possibleDirs.push(path.join(basePath, dir));
        });
      }
    } catch (error) {
      console.warn(`Could not scan directory ${basePath}:`, error.message);
    }
    
    return possibleDirs;
  }
}

async function syncAllContent() {
  const db = new StandaloneDatabase();
  const analysisService = new AnalysisService(db);

  try {
    console.log('🚀 Starting comprehensive sync analysis...\n');
    
    await db.initialize();
    
    // 1. Reset all false "no_content" statuses
    console.log('📝 Resetting false "no_content" statuses...');
    const resetResult = await db.run(`
      UPDATE meetings 
      SET upload_status = 'pending' 
      WHERE upload_status = 'no_content'
    `);
    console.log(`✅ Reset ${resetResult.changes} meetings from no_content to pending\n`);
    
    // 2. Get all meetings that need checking
    const meetings = await db.all(`
      SELECT * FROM meetings 
      WHERE upload_status != 'completed' OR upload_status IS NULL
      ORDER BY start_time DESC
    `);
    
    console.log(`📋 Found ${meetings.length} meetings to analyze\n`);
    
    // 3. Analyze meetings and report what would be uploaded
    let meetingsWithContent = 0;
    let meetingsSkipped = 0;
    let totalFiles = 0;
    
    for (const meeting of meetings) {
      try {
        const result = await analysisService.hasContentToUpload(meeting.id, meeting);
        if (result.hasContent) {
          meetingsWithContent++;
          totalFiles += result.files.length;
          const dirInfo = result.directory ? ` in ${path.basename(result.directory)}` : '';
          console.log(`📤 HAS CONTENT: ${meeting.title} (${result.files.length} files)${dirInfo}`);
          console.log(`   Files: ${result.files.join(', ')}`);
        } else {
          meetingsSkipped++;
          console.log(`⏭️  NO CONTENT: ${meeting.title}`);
        }
      } catch (error) {
        console.error(`❌ Error analyzing meeting ${meeting.id} (${meeting.title}):`, error.message);
        meetingsSkipped++;
      }
    }
    
    console.log(`\n📊 Analysis Summary:`);
    console.log(`   - Meetings with content: ${meetingsWithContent}`);
    console.log(`   - Meetings without content: ${meetingsSkipped}`);
    console.log(`   - Total files to sync: ${totalFiles}`);
    console.log(`   - Total meetings analyzed: ${meetings.length}\n`);
    
    console.log('🎉 Analysis complete!');
    console.log('\n💡 Next step: The upload service has been updated with directory-first file discovery.');
    console.log('   When the main app runs, it will automatically upload all discovered content.');
    
  } catch (error) {
    console.error('\n❌ Sync failed:', error);
    console.error('Stack trace:', error.stack);
  } finally {
    try {
      await db.close();
      console.log('✅ Database connection closed');
    } catch (closeError) {
      console.error('Error closing database:', closeError);
    }
  }
}

// Handle command line execution
if (require.main === module) {
  console.log('='.repeat(60));
  console.log('🔍 SYNC ANALYSIS - CONTENT DISCOVERY');
  console.log('='.repeat(60));
  
  syncAllContent()
    .then(() => {
      console.log('\n' + '='.repeat(60));
      console.log('✅ ANALYSIS COMPLETED SUCCESSFULLY');
      console.log('='.repeat(60));
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n' + '='.repeat(60));
      console.error('❌ ANALYSIS FAILED:', error.message);
      console.error('='.repeat(60));
      process.exit(1);
    });
}

module.exports = syncAllContent;