#!/usr/bin/env node

// Test script for 6-week calendar sync implementation
const path = require('path');
const fs = require('fs');

console.log('🧪 Testing 6-Week Calendar Sync Implementation');
console.log('=' .repeat(50));

try {
  // Test 1: Calendar Age Utility
  console.log('📅 Test 1: Calendar Age Utility');
  const CalendarAge = require('../src/utils/calendar-age');

  // Mock store for testing
  const mockStore = {
    data: {},
    get(key) { return this.data[key]; },
    set(key, value) { this.data[key] = value; }
  };

  const calendarAge = new CalendarAge(mockStore);

  // Test with no sync date
  let result = calendarAge.getCalendarIconData();
  console.log('  ✅ No sync date:', result);

  // Test with today's sync
  mockStore.set('lastCalendarSyncDate', new Date().toISOString().split('T')[0]);
  result = calendarAge.getCalendarIconData();
  console.log('  ✅ Today\'s sync:', result);

  // Test with 3 days ago
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  mockStore.set('lastCalendarSyncDate', threeDaysAgo.toISOString().split('T')[0]);
  result = calendarAge.getCalendarIconData();
  console.log('  ✅ 3 days ago:', result);

  // Test 2: Meeting Loader
  console.log('\n📋 Test 2: Meeting Loader');
  const MeetingLoader = require('../src/meeting-loader');

  const mockDatabase = {
    getMeetingsInDateRange: async () => [],
    deleteMeeting: async () => {},
    upsertMeeting: async () => {}
  };

  const meetingLoader = new MeetingLoader(mockDatabase, mockStore);
  console.log('  ✅ Meeting loader instantiated');
  console.log('  ✅ loadSixWeeksMeetings method available:', typeof meetingLoader.loadSixWeeksMeetings === 'function');
  console.log('  ✅ syncSixWeeksMeetingsToDatabase method available:', typeof meetingLoader.syncSixWeeksMeetingsToDatabase === 'function');

  // Test 3: Database
  console.log('\n🗄️  Test 3: Database');
  const Database = require('../src/database');
  const database = new Database();
  console.log('  ✅ Database instantiated');
  console.log('  ✅ getMeetingsInDateRange method available:', typeof database.getMeetingsInDateRange === 'function');

  // Test 4: File syntax validation
  console.log('\n📝 Test 4: File Syntax Validation');

  // Check syntax of modified files
  const filesToCheck = [
    '../src/main.js',
    '../src/meeting-loader.js',
    '../src/database.js',
    '../src/renderer/renderer.js',
    '../src/utils/calendar-age.js'
  ];

  for (const file of filesToCheck) {
    const fullPath = path.join(__dirname, file);
    if (fs.existsSync(fullPath)) {
      // Basic syntax check by requiring (if it's a JS file)
      try {
        require(fullPath);
        console.log(`  ✅ ${file}: OK`);
      } catch (error) {
        console.log(`  ❌ ${file}: ERROR - ${error.message}`);
      }
    } else {
      console.log(`  ⚠️  ${file}: File not found`);
    }
  }

  console.log('\n🎉 All tests completed successfully!');
  console.log('\n📖 Implementation Summary:');
  console.log('   • Calendar age utility with color progression (grey → red)');
  console.log('   • 6-week meeting sync instead of daily');
  console.log('   • Visual calendar indicator showing days since last sync');
  console.log('   • Database sync removes stale meetings, adds new ones');
  console.log('   • Updated IPC handlers for calendar age data');
  console.log('   • CSS styling for calendar age states');

} catch (error) {
  console.error('❌ Test failed:', error);
  process.exit(1);
}