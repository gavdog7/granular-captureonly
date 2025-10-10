const fs = require('fs').promises;
const path = require('path');
const log = require('./logger');

/**
 * Convert a title to a filesystem-safe folder name
 * @param {string} title - The meeting title
 * @returns {string} - Safe folder name
 */
function generateSafeFolderName(title) {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
        .replace(/\s+/g, '-')        // Replace spaces with hyphens
        .replace(/-+/g, '-')         // Remove duplicate hyphens
        .substring(0, 50)            // Limit length
        .replace(/^-|-$/g, '');      // Remove leading/trailing hyphens
}

/**
 * Check if a folder name already exists and generate unique name if needed
 * @param {string} basePath - The base directory path
 * @param {string} folderName - Desired folder name
 * @returns {Promise<string>} - Unique folder name
 */
async function generateUniqueFolderName(basePath, folderName) {
    let uniqueName = folderName;
    let counter = 1;
    
    while (true) {
        try {
            const fullPath = path.join(basePath, uniqueName);
            await fs.access(fullPath);
            // If we get here, folder exists, try next number
            uniqueName = `${folderName}-${counter}`;
            counter++;
        } catch (error) {
            // Folder doesn't exist, we can use this name
            break;
        }
    }
    
    return uniqueName;
}

/**
 * Rename a meeting folder and update all associated files
 * @param {string} meetingDate - Date string (YYYY-MM-DD)
 * @param {string} oldFolderName - Current folder name
 * @param {string} newTitle - New meeting title
 * @returns {Promise<{success: boolean, newFolderName?: string, error?: string}>}
 */
async function renameNoteFolderAndFiles(meetingDate, oldFolderName, newTitle) {
    let meetingId = null; // Will be extracted if possible

    try {
        // Generate new folder name from title
        const baseFolderName = generateSafeFolderName(newTitle);

        if (!baseFolderName) {
            throw new Error('Title cannot be converted to a valid folder name');
        }

        const assetsPath = path.join(process.cwd(), 'assets', meetingDate);
        const oldFolderPath = path.join(assetsPath, oldFolderName);

        // Check if old folder exists
        try {
            await fs.access(oldFolderPath);
        } catch (error) {
            throw new Error(`Original folder not found: ${oldFolderPath}`);
        }

        // Get list of files before rename
        const files = await fs.readdir(oldFolderPath);

        // Generate unique folder name
        const newFolderName = await generateUniqueFolderName(assetsPath, baseFolderName);
        const newFolderPath = path.join(assetsPath, newFolderName);

        // Log folder rename
        log.info('[RENAME] Renaming folder on disk', {
            meetingId,
            oldPath: oldFolderPath,
            newPath: newFolderPath,
            filesInFolder: files.length,
            timestamp: Date.now()
        });

        // Rename the folder
        await fs.rename(oldFolderPath, newFolderPath);

        // Rename the notes.md file if it exists
        const oldNotesFile = path.join(newFolderPath, `${oldFolderName}-notes.md`);
        const newNotesFile = path.join(newFolderPath, `${newFolderName}-notes.md`);

        try {
            await fs.access(oldNotesFile);
            const oldStats = await fs.stat(oldNotesFile);

            // Log individual file rename
            log.debug('[RENAME] Renaming file', {
                meetingId,
                oldFilePath: oldNotesFile,
                newFilePath: newNotesFile,
                fileSize: oldStats.size,
                timestamp: Date.now()
            });

            await fs.rename(oldNotesFile, newNotesFile);
        } catch (error) {
            // Notes file doesn't exist yet, that's okay
        }

        return {
            success: true,
            newFolderName: newFolderName,
            filesRenamed: files.length
        };

    } catch (error) {
        // Log error
        log.error('[RENAME] Folder rename failed', {
            meetingId,
            error: error.message,
            timestamp: Date.now()
        });

        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Rollback a failed rename operation
 * @param {string} meetingDate - Date string (YYYY-MM-DD)
 * @param {string} newFolderName - New folder name to rollback
 * @param {string} originalFolderName - Original folder name to restore
 * @returns {Promise<boolean>} - Success status
 */
async function rollbackRename(meetingDate, newFolderName, originalFolderName) {
    try {
        const assetsPath = path.join(process.cwd(), 'assets', meetingDate);
        const newFolderPath = path.join(assetsPath, newFolderName);
        const originalFolderPath = path.join(assetsPath, originalFolderName);
        
        // Rename folder back
        await fs.rename(newFolderPath, originalFolderPath);
        
        // Rename notes file back if it exists
        const newNotesFile = path.join(originalFolderPath, `${newFolderName}-notes.md`);
        const originalNotesFile = path.join(originalFolderPath, `${originalFolderName}-notes.md`);
        
        try {
            await fs.access(newNotesFile);
            await fs.rename(newNotesFile, originalNotesFile);
        } catch (error) {
            // Notes file doesn't exist, that's okay
        }
        
        return true;
    } catch (error) {
        console.error('Rollback failed:', error);
        return false;
    }
}

module.exports = {
    generateSafeFolderName,
    generateUniqueFolderName,
    renameNoteFolderAndFiles,
    rollbackRename
};