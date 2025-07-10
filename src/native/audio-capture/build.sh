#!/bin/bash

# Build script for audio-capture Swift binary
# This script builds the Swift binary and copies it to the expected location

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/.build"
RELEASE_DIR="$BUILD_DIR/release"
TARGET_NAME="audio-capture"

echo "Building audio-capture Swift binary..."

# Clean previous builds
if [ -d "$BUILD_DIR" ]; then
    rm -rf "$BUILD_DIR"
fi

# Build the Swift package
cd "$SCRIPT_DIR"
swift build -c release

# Check if build succeeded
if [ ! -f "$RELEASE_DIR/$TARGET_NAME" ]; then
    echo "Error: Build failed - binary not found at $RELEASE_DIR/$TARGET_NAME"
    exit 1
fi

echo "Build successful!"
echo "Binary location: $RELEASE_DIR/$TARGET_NAME"

# Make the binary executable
chmod +x "$RELEASE_DIR/$TARGET_NAME"

# Optionally copy to a more convenient location
# cp "$RELEASE_DIR/$TARGET_NAME" "$SCRIPT_DIR/$TARGET_NAME"

echo "Audio capture binary is ready for use."
echo ""
echo "To test the binary:"
echo "  $RELEASE_DIR/$TARGET_NAME version"
echo ""
echo "To integrate with Electron, update the binaryPath in audio-recorder.js:"
echo "  this.binaryPath = path.join(__dirname, 'native', 'audio-capture', '.build', 'release', 'audio-capture');"