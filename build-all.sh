#!/bin/bash

echo "========================================"
echo "   🚀 Building OpenNotes All Platforms"
echo "========================================"

# Step 1: Build the Vite frontend payload
echo -e "\n[1/4] Compiling frontend source code..."
npm run build
if [ $? -ne 0 ]; then
    echo "❌ Frontend build failed. Exiting."
    exit 1
fi

# Step 2: Build Linux (Native)
echo -e "\n[2/4] Packaging Linux binaries (.AppImage, .deb, .rpm, .pacman)..."
npx electron-builder --linux
if [ $? -ne 0 ]; then
    echo "⚠️ Linux build encountered an issue."
else
    echo "✅ Linux build successful."
fi

# Step 3: Build Windows
echo -e "\n[3/4] Packaging Windows binaries (.exe)..."
npx electron-builder --win
if [ $? -ne 0 ]; then
    echo "⚠️ Windows build encountered an issue."
else
    echo "✅ Windows build successful."
fi

# Step 4: Build macOS
echo -e "\n[4/4] Packaging macOS binaries (.zip)..."
echo "Note: Building macOS .dmg files normally strictly requires being on an Apple machine."
npx electron-builder --mac
if [ $? -ne 0 ]; then
    echo "⚠️ macOS build failed (Expected if not running on macOS)."
else
    echo "✅ macOS build successful."
fi

echo -e "\n========================================"
echo "🎉 Build Script Finished!"
echo "Check the 'release' directory for your compiled packages."
echo "========================================"
