# OpenNotes

A beautiful, modern, cross-platform productivity workspace and note-taking application designed to keep your tasks, projects, college notes, and habits organized.

## Features
- **Project & Task Tracker:** Organize your daily priorities, habits, and tasks.
- **College Notes Organizer:** Import PDF lecture notes and organize them into subject folders. 
- **Built-in Document Viewer:** View your PDFs or rich-text notes in a beautiful fullscreen experience.
- **Cross-Platform:** Available on Linux, Windows, and macOS.
- **Dark & Light Themes:** Premium glassmorphism design that adapts to your system preferences.

---

## Installation Guide: Which file should I download?

Go to the [Releases](../../releases) page to download the latest version. Depending on your operating system, download the corresponding file:

### 🐧 Linux Users
* **`.AppImage`**: The easiest option for most Linux distributions. Download it, make it executable (`chmod +x`), and double-click to run. No installation required.
* **`.deb`**: Download this if you are using **Debian, Ubuntu, Linux Mint**, or Pop!_OS.
* **`.rpm`**: Download this if you are using **Fedora, CentOS, RHEL**, or openSUSE.
* **`.pacman`**: Download this if you are using **Arch Linux, Manjaro**, or EndeavourOS.

### 🪟 Windows Users
* **`.exe` (Setup / Installer)**: Download this standard installer. Double-click it to install OpenNotes on your Windows PC.

### 🍎 macOS Users
* **`.zip` (macOS)**: Download and extract this file to get the macOS application. Drag it to your Applications folder.

---

## Development

If you want to build the project from source:

1. Clone the repository:
   ```bash
   git clone https://github.com/rajsriv/OpenNotes.git
   cd OpenNotes
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the development server:
   ```bash
   npm run electron:dev
   ```

4. Package for production (All Platforms):
   ```bash
   ./build-all.sh
   ```

## License
MIT
