const { google } = require('googleapis');
const path = require('path');
const fs = require('fs-extra');

class GoogleDriveService {
  constructor(store) {
    this.store = store;
    this.oauth2Client = null;
    this.drive = null;
  }

  async initializeOAuth() {
    const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
    const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
    const REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob';

    if (!CLIENT_ID || !CLIENT_SECRET) {
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
    }
  }

  generateAuthUrl() {
    const scopes = [
      'https://www.googleapis.com/auth/drive.file'
    ];

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes
    });
  }

  async exchangeCodeForTokens(code) {
    try {
      const { tokens } = await this.oauth2Client.getToken(code);
      this.oauth2Client.setCredentials(tokens);
      this.store.set('googleTokens', tokens);
      this.drive = google.drive({ version: 'v3', auth: this.oauth2Client });
      return true;
    } catch (error) {
      console.error('Error exchanging code for tokens:', error);
      throw error;
    }
  }

  async refreshTokens() {
    try {
      const { credentials } = await this.oauth2Client.refreshAccessToken();
      this.oauth2Client.setCredentials(credentials);
      this.store.set('googleTokens', credentials);
      return true;
    } catch (error) {
      console.error('Error refreshing tokens:', error);
      this.store.delete('googleTokens');
      this.oauth2Client.setCredentials({});
      this.drive = null;
      throw error;
    }
  }

  isAuthenticated() {
    return this.oauth2Client && this.oauth2Client.credentials.access_token;
  }

  async ensureFolderStructure(date) {
    if (!this.drive) {
      throw new Error('Google Drive not initialized. Please authenticate first.');
    }

    const year = date.getFullYear().toString();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    
    let folderId = await this.findOrCreateFolder('Granular-CaptureOnly', 'root');
    folderId = await this.findOrCreateFolder(year, folderId);
    folderId = await this.findOrCreateFolder(month, folderId);
    
    return folderId;
  }

  async findOrCreateFolder(name, parentId) {
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

  logout() {
    this.store.delete('googleTokens');
    this.oauth2Client.setCredentials({});
    this.drive = null;
  }
}

module.exports = GoogleDriveService;