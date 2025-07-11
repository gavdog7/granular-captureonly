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

  // DEPRECATED: Use upload-service.js folder structure instead
  // This method created conflicting folder structures

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
    if (!this.drive) {
      console.log('Google Drive not initialized, skipping calendar file search');
      return null;
    }

    try {
      const notesFolderId = await this.findNotesFolder();
      if (!notesFolderId) {
        console.log('Notes folder not found in Google Drive');
        return null;
      }

      // Search for calendar.xlsx in the Notes folder and all subfolders
      const query = `name='calendar.xlsx' and '${notesFolderId}' in parents and trashed=false`;
      
      const response = await this.drive.files.list({
        q: query,
        fields: 'files(id, name, modifiedTime, size)'
      });

      if (response.data.files.length > 0) {
        const file = response.data.files[0];
        console.log(`Found calendar.xlsx in Google Drive: ${file.name} (modified: ${file.modifiedTime})`);
        return file;
      }

      // Also search in date subfolders in case it's stored there
      const dateSubfoldersQuery = `mimeType='application/vnd.google-apps.folder' and '${notesFolderId}' in parents and trashed=false`;
      const dateFoldersResponse = await this.drive.files.list({
        q: dateSubfoldersQuery,
        fields: 'files(id, name)'
      });

      for (const dateFolder of dateFoldersResponse.data.files) {
        const calendarInDateFolder = `name='calendar.xlsx' and '${dateFolder.id}' in parents and trashed=false`;
        const calendarResponse = await this.drive.files.list({
          q: calendarInDateFolder,
          fields: 'files(id, name, modifiedTime, size)'
        });

        if (calendarResponse.data.files.length > 0) {
          const file = calendarResponse.data.files[0];
          console.log(`Found calendar.xlsx in Google Drive subfolder ${dateFolder.name}: ${file.name} (modified: ${file.modifiedTime})`);
          return file;
        }
      }

      console.log('No calendar.xlsx file found in Google Drive Notes folder');
      return null;

    } catch (error) {
      if (error.code === 401) {
        await this.refreshTokens();
        return this.findCalendarFileInDrive();
      }
      console.error('Error searching for calendar file in Google Drive:', error);
      return null;
    }
  }

  async downloadFile(fileId, localPath) {
    if (!this.drive) {
      throw new Error('Google Drive not initialized. Please authenticate first.');
    }

    try {
      // Ensure the directory exists
      await fs.ensureDir(path.dirname(localPath));

      const response = await this.drive.files.get({
        fileId: fileId,
        alt: 'media'
      }, {
        responseType: 'stream'
      });

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
    this.store.delete('googleTokens');
    this.oauth2Client.setCredentials({});
    this.drive = null;
  }
}

module.exports = GoogleDriveService;