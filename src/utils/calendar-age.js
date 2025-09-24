// Calendar Age System for Visual Indicator
// This module calculates days since last Excel sync and provides visual styling data

const { dateOverride } = require('../date-override');

class CalendarAge {
  constructor(store) {
    this.store = store;
  }

  getDaysSinceLastSync() {
    try {
      const lastSyncDate = this.store.get('lastCalendarSyncDate');
      if (!lastSyncDate) return null;

      const today = dateOverride.today();
      const syncDate = new Date(lastSyncDate);
      const currentDate = new Date(today);

      const timeDiff = currentDate.getTime() - syncDate.getTime();
      const daysDiff = Math.floor(timeDiff / (1000 * 3600 * 24));

      return Math.max(0, daysDiff); // Don't return negative days
    } catch (error) {
      console.error('Error calculating calendar age:', error);
      return null;
    }
  }

  getCalendarIconData() {
    const days = this.getDaysSinceLastSync();

    if (days === null || days === 0) {
      return {
        type: 'calendar',
        days: 0,
        color: '#666666', // Default grey
        isStale: false
      };
    }

    if (days >= 7) {
      return {
        type: 'number',
        days: Math.min(days, 99), // Cap at 99 for display
        color: '#ff0000', // Red
        isStale: true
      };
    }

    // Calculate color transition from grey (#666666) to red (#ff0000)
    const intensity = days / 7; // 0 to 1 scale
    const red = Math.floor(102 + (255 - 102) * intensity); // 66 to FF (102 to 255)
    const green = Math.floor(102 * (1 - intensity)); // 66 to 00 (102 to 0)
    const blue = Math.floor(102 * (1 - intensity)); // 66 to 00 (102 to 0)

    const color = `#${red.toString(16).padStart(2, '0')}${green.toString(16).padStart(2, '0')}${blue.toString(16).padStart(2, '0')}`;

    return {
      type: 'number',
      days,
      color,
      isStale: days >= 7
    };
  }

  // Get a descriptive status message
  getStatusMessage() {
    const days = this.getDaysSinceLastSync();

    if (days === null) {
      return 'Calendar has never been synced';
    }

    if (days === 0) {
      return 'Calendar synced today';
    }

    const dayWord = days === 1 ? 'day' : 'days';
    const freshness = days >= 7 ? ' (stale data)' : '';

    return `Calendar last synced ${days} ${dayWord} ago${freshness}`;
  }

  // Debug method to see color progression
  static getColorProgression() {
    const progression = [];
    for (let day = 0; day <= 7; day++) {
      const mockStore = { get: () => {
        const date = new Date();
        date.setDate(date.getDate() - day);
        return date.toISOString().split('T')[0];
      }};

      const age = new CalendarAge(mockStore);
      const data = age.getCalendarIconData();
      progression.push({
        day,
        ...data,
        message: age.getStatusMessage()
      });
    }
    return progression;
  }
}

module.exports = CalendarAge;