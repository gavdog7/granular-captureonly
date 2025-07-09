# Granular CaptureOnly

An Electron application for capturing meeting data from Excel files and recording system audio during meetings with note-taking capabilities.

## Features

- Automatic Excel file import for meeting data
- Meeting selection interface
- System audio recording during meetings
- Markdown note-taking
- File attachment support
- Daily folder organization for assets
- Resume recording functionality

## Project Structure

```
granular-captureonly/
├── docs/
│   └── plans/           # Implementation plans
├── src/                 # Source code
├── assets/             # Meeting recordings and files (gitignored)
├── Planning/           # Excel files and mockups
└── README.md
```

## Development

See [Implementation Plan](docs/plans/GRANULAR-CAPTUREONLY-REVISED.md) for detailed development milestones and architecture.

## Requirements

- macOS 10.15+ (for system audio capture)
- Node.js 16+
- Electron 22+

## License

MIT