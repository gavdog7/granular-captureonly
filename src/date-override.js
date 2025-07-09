// Date Override System for Testing
// This module provides a configurable way to override the current date for testing purposes

class DateOverride {
  constructor() {
    this.overrideDate = null;
    this.enabled = false;
  }

  // Enable date override with a specific date
  enable(dateString) {
    this.overrideDate = new Date(dateString);
    this.enabled = true;
    console.log(`🕐 Date override enabled: ${this.overrideDate.toDateString()}`);
  }

  // Disable date override and return to system date
  disable() {
    this.enabled = false;
    this.overrideDate = null;
    console.log('🕐 Date override disabled - using system date');
  }

  // Get the current date (either overridden or system)
  now() {
    if (this.enabled && this.overrideDate) {
      return new Date(this.overrideDate);
    }
    return new Date();
  }

  // Get today's date string in ISO format (YYYY-MM-DD)
  today() {
    return this.now().toISOString().split('T')[0];
  }

  // Check if override is currently active
  isActive() {
    return this.enabled && this.overrideDate !== null;
  }

  // Get status for debugging
  getStatus() {
    if (this.enabled && this.overrideDate) {
      return {
        active: true,
        overrideDate: this.overrideDate.toDateString(),
        overrideDateISO: this.overrideDate.toISOString(),
        todayString: this.today()
      };
    }
    return {
      active: false,
      systemDate: new Date().toDateString(),
      todayString: new Date().toISOString().split('T')[0]
    };
  }
}

// Create a singleton instance
const dateOverride = new DateOverride();

// Quick setup function for testing
function setupTestDate(dateString) {
  dateOverride.enable(dateString);
  console.log('Test date setup:', dateOverride.getStatus());
}

// Quick disable function
function disableTestDate() {
  dateOverride.disable();
  console.log('Test date disabled:', dateOverride.getStatus());
}

module.exports = {
  dateOverride,
  setupTestDate,
  disableTestDate
};