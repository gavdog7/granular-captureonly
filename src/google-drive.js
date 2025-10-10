const { google } = require('googleapis');
const path = require('path');
const fs = require('fs-extra');
const log = require('./utils/logger');

class GoogleDriveService {
  constructor(store, mainWindow) {
    this.store = store;
    this.mainWindow = mainWindow;
    this.oauth2Client = null;
    this.drive = null;
  }

  async initializeOAuth() {
    const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
    const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
    const REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob';

    if (!CLIENT_ID || !CLIENT_SECRET) {
      log.error('[UPLOAD] Google OAuth credentials not configured', {
        error: 'Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET',
        requiresUserAction: true
      });
      throw new Error('Google OAuth credentials not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.');
    }

    this.oauth2Client = new google.auth.OAuth2(
      CLIENT_ID,
      CLIENT_SECRET,
      REDIRECT_URI
    );

    const tokens = this.store.get('googleTokens');
    if (tokens) {
      this.oauth2Client.setCredentials(tokens);
      this.drive = google.drive({ version: 'v3', auth: this.oauth2Client });

      log.info('[UPLOAD] Google OAuth initialized with existing tokens', {
        hasRefreshToken: !!tokens.refresh_token,
        hasAccessToken: !!tokens.access_token
      });
    } else {
      log.warn('[UPLOAD] Google OAuth initialized without tokens', {
        requiresUserAction: true
      });
    }
  }

  generateAuthUrl() {
    const scopes = [
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/drive.readonly'
    ];

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes
    });
  }

  async exchangeCodeForTokens(code) {
    try {
      log.info('[UPLOAD] Exchanging OAuth code for tokens', {
        codeLength: code ? code.length : 0
      });

      const { tokens } = await this.oauth2Client.getToken(code);
      this.oauth2Client.setCredentials(tokens);
      this.store.set('googleTokens', tokens);
      this.drive = google.drive({ version: 'v3', auth: this.oauth2Client });

      log.info('[UPLOAD] Authentication successful', {
        hasRefreshToken: !!tokens.refresh_token,
        hasAccessToken: !!tokens.access_token
      });

      return true;
    } catch (error) {
      console.error('Error exchanging code for tokens:', error);

      log.error('[UPLOAD] Authentication failed', {
        error: error.message,
        errorType: 'auth',
        requiresUserAction: true
      });

      throw error;
    }
  }

  async refreshTokens() {
    try {
      log.info('[UPLOAD] Refreshing Google OAuth tokens');

      const { credentials } = await this.oauth2Client.refreshAccessToken();
      this.oauth2Client.setCredentials(credentials);
      this.store.set('googleTokens', credentials);

      log.info('[UPLOAD] Token refresh successful');

      return true;
    } catch (error) {
      console.error('Error refreshing tokens:', error);

      log.error('[UPLOAD] Token refresh failed', {
        error: error.message,
        errorType: 'auth',
        requiresUserAction: true
      });

      this.store.delete('googleTokens');
      this.oauth2Client.setCredentials({});
      this.drive = null;
      throw error;
    }
  }

  isAuthenticated() {
    return this.oauth2Client && this.oauth2Client.credentials.access_token;
  }

  async handleAuthError(error) {
    // Check if error is due to expired/revoked token
    if (error.message && (error.message.includes('invalid_grant') ||
        error.message.includes('Token has been expired or revoked'))) {
      console.error('🔐 Google OAuth token expired or revoked');

      log.error('[UPLOAD] Google OAuth token expired or revoked', {
        error: error.message,
        errorType: 'auth',
        requiresUserAction: true
      });

      // Clear stored tokens
      this.store.delete('googleTokens');
      this.drive = null;

      // Notify the UI
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('google-auth-expired');
      }

      // Return a specific error that upload service can handle
      throw new Error('AUTH_EXPIRED');
    }

    // Re-throw other errors
    throw error;
  }

  // DEPRECATED: Use upload-service.js folder structure instead
  // This method created conflicting folder structures

  async findOrCreateFolder(name, parentId) {
    try {
      const query = `name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents`;
      
      const response = await this.drive.files.list({
        q: query,
        fields: 'files(id, name)'
      });

      if (response.data.files.length > 0) {
        return response.data.files[0].id;
      }

      const folderResponse = await this.drive.files.create({
        requestBody: {
          name,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [parentId]
        },
        fields: 'id'
      });

      return folderResponse.data.id;
    } catch (error) {
      return this.handleAuthError(error);
    }
  }

  async uploadFile(filePath, fileName, parentFolderId) {
    if (!this.drive) {
      throw new Error('Google Drive not initialized. Please authenticate first.');
    }

    const fileMetadata = {
      name: fileName,
      parents: [parentFolderId]
    };

    const media = {
      body: fs.createReadStream(filePath)
    };

    try {
      const response = await this.drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: 'id,name'
      });

      return response.data;
    } catch (error) {
      if (error.code === 401) {
        await this.refreshTokens();
        return this.uploadFile(filePath, fileName, parentFolderId);
      }
      throw error;
    }
  }

  async updateFile(fileId, filePath) {
    if (!this.drive) {
      throw new Error('Google Drive not initialized. Please authenticate first.');
    }

    const media = {
      body: fs.createReadStream(filePath)
    };

    try {
      const response = await this.drive.files.update({
        fileId,
        media: media,
        fields: 'id,name'
      });

      return response.data;
    } catch (error) {
      if (error.code === 401) {
        await this.refreshTokens();
        return this.updateFile(fileId, filePath);
      }
      throw error;
    }
  }

  async checkFileExists(fileName, parentFolderId) {
    if (!this.drive) {
      throw new Error('Google Drive not initialized. Please authenticate first.');
    }

    const query = `name='${fileName}' and '${parentFolderId}' in parents`;
    
    const response = await this.drive.files.list({
      q: query,
      fields: 'files(id, name)'
    });

    return response.data.files.length > 0 ? response.data.files[0] : null;
  }

  async findNotesFolder() {
    if (!this.drive) {
      throw new Error('Google Drive not initialized. Please authenticate first.');
    }

    const query = `name='Notes' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    
    try {
      const response = await this.drive.files.list({
        q: query,
        fields: 'files(id, name)'
      });

      if (response.data.files.length > 0) {
        return response.data.files[0].id;
      }
      
      return null;
    } catch (error) {
      if (error.code === 401) {
        await this.refreshTokens();
        return this.findNotesFolder();
      }
      throw error;
    }
  }

  async findCalendarFileInDrive() {
    // Removed - no longer searching for calendar files in Google Drive
    return null;
  }

  async downloadFile(fileId, localPath, mimeType = null) {
    if (!this.drive) {
      throw new Error('Google Drive not initialized. Please authenticate first.');
    }

    try {
      // Ensure the directory exists
      await fs.ensureDir(path.dirname(localPath));

      let response;
      
      // For Google Sheets, we need to export as Excel
      if (mimeType === 'application/vnd.google-apps.spreadsheet') {
        console.log('📊 Exporting Google Sheets as Excel format...');
        response = await this.drive.files.export({
          fileId: fileId,
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        }, {
          responseType: 'stream'
        });
      } else {
        // For regular files, download as-is
        response = await this.drive.files.get({
          fileId: fileId,
          alt: 'media'
        }, {
          responseType: 'stream'
        });
      }

      const writer = fs.createWriteStream(localPath);
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
          console.log(`Downloaded calendar.xlsx from Google Drive to: ${localPath}`);
          resolve(localPath);
        });
        writer.on('error', reject);
        response.data.on('error', reject);
      });

    } catch (error) {
      if (error.code === 401) {
        await this.refreshTokens();
        return this.downloadFile(fileId, localPath);
      }
      throw error;
    }
  }

  async deleteFolder(folderId) {
    if (!this.drive) {
      throw new Error('Google Drive not initialized. Please authenticate first.');
    }

    try {
      console.log(`🗑️ Deleting Google Drive folder: ${folderId}`);
      
      // Delete the folder and all its contents
      await this.drive.files.delete({
        fileId: folderId
      });
      
      console.log(`✅ Successfully deleted Google Drive folder: ${folderId}`);
      return { success: true };
    } catch (error) {
      if (error.code === 401) {
        await this.refreshTokens();
        return this.deleteFolder(folderId);
      }
      
      console.error('Error deleting Google Drive folder:', error);
      throw new Error(`Failed to delete Google Drive folder: ${error.message}`);
    }
  }

  logout() {
    log.info('[UPLOAD] Google Drive logout');

    this.store.delete('googleTokens');
    this.oauth2Client.setCredentials({});
    this.drive = null;
  }
}

module.exports = GoogleDriveService;