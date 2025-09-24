/**
 * Utility functions for date handling with proper timezone support
 */

/**
 * Extract local date string (YYYY-MM-DD) from an ISO datetime string
 * This avoids timezone issues where evening meetings appear in the next day's folder
 *
 * @param {string} isoString - ISO format datetime string
 * @returns {string} Local date in YYYY-MM-DD format
 */
function getLocalDateString(isoString) {
  const date = new Date(isoString);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

module.exports = {
  getLocalDateString
};