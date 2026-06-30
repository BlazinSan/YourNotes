<div align="center">
  <img src="icon.png" width="128" alt="YourNotes Icon">
  <h1>YourNotes</h1>
  <p>A beautiful, modern, cross-platform productivity workspace and note-taking application designed to keep your tasks, projects, college notes, and habits organized.</p>
  <p><i>YourNotes is a maintained fork of <a href="https://github.com/rajsriv/OpenNotes">OpenNotes</a> (MIT).</i></p>
  <p>
    <img src="https://img.shields.io/badge/Electron-191970?style=flat&logo=Electron&logoColor=white" alt="Electron" />
    <img src="https://img.shields.io/badge/Vite-B73BFE?style=flat&logo=vite&logoColor=FFD62E" alt="Vite" />
    <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=flat&logo=javascript&logoColor=black" alt="JavaScript" />
    <img src="https://img.shields.io/badge/HTML5-E34F26?style=flat&logo=html5&logoColor=white" alt="HTML5" />
    <img src="https://img.shields.io/badge/CSS3-1572B6?style=flat&logo=css3&logoColor=white" alt="CSS3" />
  </p>
</div>

## Features
- **Project & Task Tracker:** Organize your daily priorities, habits, and tasks.
- **College Notes Organizer:** Import PDF lecture notes and organize them into subject folders. 
- **Built-in Document Viewer:** View your PDFs or rich-text notes in a beautiful fullscreen experience.
- **Cross-Platform:** Available on Linux, Windows, and macOS.
- **Dark & Light Themes:** Premium design that adapts to your system preferences.
- **Multi-language UI:** English, Arabic (RTL), Chinese, and Malay.
- **All world currencies:** Full ISO 4217 list for the expense tracker.
- **Fahrenheit / Celsius** temperature toggle.
- **Lofi music player** beside the Focus Session (royalty-free streams or your own files).
- **Unified back navigation** on every panel.

## Gallery

Experience the premium design and powerful features of YourNotes:

<table align="center">
  <tr>
    <td align="center" width="50%">
      <img src="gallery/YN1_dashboard.png" width="100%">
      <br>
      <b>Dashboard & Overview</b><br>
      <i>Get a bird's-eye view of your notes and projects, with a graph map of links.</i>
    </td>
    <td align="center" width="50%">
      <img src="gallery/YN2_session.png" width="100%">
      <br>
      <b>Session + Lofi Player</b><br>
      <i>Focus timer, daily log, expenses, and a royalty-free lofi music player.</i>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="gallery/YN3_tasks.png" width="100%">
      <br>
      <b>Tasks, Calendar & Habits</b><br>
      <i>Plan deadlines, track habits and goals, and manage projects in one place.</i>
    </td>
    <td align="center">
      <img src="gallery/YN4_settings.png" width="100%">
      <br>
      <b>Settings</b><br>
      <i>Language (EN/AR/ZH/MS), °F/°C toggle, every world currency, and themes.</i>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="gallery/YN5_college.png" width="100%">
      <br>
      <b>College Notes Organizer</b><br>
      <i>Sort and manage your academic PDFs and notes using subject folders.</i>
    </td>
    <td align="center">
      <img src="gallery/YN6_dark.png" width="100%">
      <br>
      <b>Dark Mode</b><br>
      <i>A sleek, high-contrast dark theme designed to reduce eye strain.</i>
    </td>
  </tr>
</table>

---

## Installation Guide: Which file should I download?

Go to the [Releases](../../releases) page to download the latest version. Depending on your operating system, download the corresponding file:

### 🐧 Linux Users
* **`.AppImage`**: The easiest option for most Linux distributions. Download it, make it executable (`chmod +x`), and double-click to run. No installation required.
* **`.deb`**: Download this if you are using **Debian, Ubuntu, Linux Mint**, or Pop!_OS.
* **`.rpm`**: Download this if you are using **Fedora, CentOS, RHEL**, or openSUSE.
* **`.pacman`**: Download this if you are using **Arch Linux, Manjaro**, or EndeavourOS.

### 🪟 Windows Users
* **`.exe` (Setup / Installer)**: Download this standard installer. Double-click it to install YourNotes on your Windows PC. Build it yourself with `npm run package`.

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

## Reporting Issues

If you encounter a bug, have a feature request, or need help, please [open an issue](../../issues) on GitHub. 
When creating an issue, try to include:
- A clear and descriptive title
- Steps to reproduce the bug (if applicable)
- Your operating system and application version
- Screenshots or error logs

## License
MIT
