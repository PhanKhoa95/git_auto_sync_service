# Environment Investigation & Daemon Runtime Recommendation Report

## Executive Summary
This report analyzes the user's Windows system environment and proposes Node.js v24.15.0 as the most reliable, native, and dependency-free runtime for implementing the Git Auto-Sync Service as a background daemon. By utilizing Windows Script Host (WScript) and Registry Run keys, the service can run invisibly within the user's active session, satisfying all Git credential helper constraints without Session 0 isolation issues.

---

## 1. System Environment Analysis

The following table summarizes the status of the requested runtimes/tools on the user's system:

| Runtime / Tool | Installed Version | Availability / Path | Suitability for Background Daemon |
| :--- | :--- | :--- | :--- |
| **Git** | `2.44.0.windows.1` | `E:\` (in PATH) | **Yes** (Requires configured Credential Manager / SSH) |
| **PowerShell** | `5.1.19041.6456` | Native Cmdlet | **Low** (Heavy memory, lacks native file watching, prone to console flashes) |
| **Python** | `3.12.10` | `E:\` (in PATH) | **Medium** (Good scripting, but requires `pip` virtualenv or heavy PyInstaller packing) |
| **Node.js** | `v24.15.0` | `E:\` (in PATH) | **High (Recommended)** (Very fast, native recursive watching in v20+, zero-dependency) |
| **.NET Runtime**| `6.0.21` | `C:\Program Files\dotnet` | **Low** (.NET Runtime is present, but **.NET SDK is missing**, preventing local builds) |

---

## 2. Windows Background Daemon Constraints & Challenges

Implementing a background daemon on Windows that interacts with Git faces two primary structural challenges:

### Challenge A: The "Session 0" Credential Manager Lockout
*   **The Issue:** A native Windows Service registered via Service Control Manager (SCM) runs under system accounts (`LocalSystem`, `LocalService`, or `NetworkService`) in Session 0 (non-interactive).
*   **The Problem:** Git on Windows relies on **Git Credential Manager (GCM)**, which encrypts and stores credentials in the logged-in user's Credential Manager via DPAPI (Data Protection API). DPAPI is cryptographically tied to the user's credentials. Session 0 processes cannot access the user's credential store or SSH keys (`%USERPROFILE%\.ssh`). Any `git pull` or `git push` commands run by a Session 0 service will fail with access denied or hang indefinitely waiting for interactive authentication.
*   **The Solution:** The background daemon **must** run in the user's active interactive session.

### Challenge B: Startup Registration Requirements
To run within the user's session automatically and invisibly, we cannot use a standard SCM Service (due to Session 0). Instead, the most reliable startup registrations are:
1.  **Registry Run Key (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`):** Registers the daemon to run immediately when the current user logs in. Extremely reliable, does not require administrative privileges.
2.  **Windows Task Scheduler:** Register a task with the setting `"Run only when user is logged on"` and `"Run with highest privileges"` if admin capabilities are needed.

To prevent the daemon from displaying a command prompt window, we can launch the runtime using a lightweight, native Windows Script Host wrapper (`wscript.exe` running a 3-line VBScript launcher).

---

## 3. Language & Runtime Comparison

### PowerShell 5.1
*   *Verdict:* **Not Recommended.**
*   *Analysis:* PowerShell 5.1 is built-in but uses significant CPU and RAM when running continuously. Creating a folder watcher event in PowerShell is complex and prone to terminating on unhandled shell exceptions. Hiding the window via `-WindowStyle Hidden` still briefly flashes a blue console window on user logon.

### Python 3.12.10
*   *Verdict:* **Medium Suitability.**
*   *Analysis:* Python is fully capable, but monitoring directories requires the external `watchdog` library. Distributing a Python daemon either requires setting up a local virtual environment (`venv`) and installing dependencies (introducing failure points during installation), or packaging it into an executable using PyInstaller (which increases startup time, creates a 10MB+ binary, and frequently triggers antivirus heuristic warnings).

### .NET 6.0 (C#)
*   *Verdict:* **Not Feasible (No SDK).**
*   *Analysis:* Although C# is the most native language for Windows daemons, only the .NET 6.0 *Runtime* is installed. The .NET SDK is not present. This prevents compile-on-machine capability, meaning we cannot build or easily modify the daemon locally without setting up the SDK first.

### Node.js v24.15.0
*   *Verdict:* **Recommended Option.**
*   *Analysis:* Node.js v24.15.0 is modern and powerful.
    *   **Native Recursive Watching:** Node.js `fs.watch()` supports recursive directory watching on Windows natively: `fs.watch(dir, { recursive: true }, callback)`. This allows event-driven synchronization without any external NPM packages (zero dependencies).
    *   **Resource Efficient:** A simple background Node.js file watcher uses negligible CPU and minimal memory.
    *   **Easy Git Control:** Spawning Git child processes via Node's `child_process` API is clean and robust.
    *   **No Compilation Needed:** The code is run directly from source files, simplifying debugging and modifications.

---

## 4. Proposed Architecture & Credential Helper Settings

We propose the following architecture for the Git Auto-Sync Service using Node.js:

### 1. Windowless Execution Launcher (`launcher.vbs`)
To run Node.js in the background without displaying a cmd/terminal window, we use a native VBScript wrapper:
```vbscript
Set WshShell = CreateObject("WScript.Shell")
' The 0 parameter hides the window; false means do not wait for the script to exit
WshShell.Run "node E:\git_auto_sync_service\src\index.js", 0, false
```

### 2. Registry Startup Registration
We can automate startup registration via a simple PowerShell command run during service installation:
```powershell
Set-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "GitAutoSync" -Value 'wscript.exe "E:\git_auto_sync_service\launcher.vbs"'
```

### 3. Safe Credential Helper Git Configuration
To prevent Git from hanging the background service if credentials expire or need authentication, the daemon should inject the following environment variables into the Git process context during execution:
*   `GIT_TERMINAL_PROMPT=0` — Disables Git from prompting for input on stdin (causing it to fail immediately instead of hanging).
*   `GCM_INTERACTIVE=never` — Tells Git Credential Manager to fail immediately if credentials are not cached, instead of showing a GUI login window in the background.

---

## 5. Next Steps for Implementer
1.  **Repository Watcher Structure:** Create the file watcher loop in Node.js, scanning E:\ for `.git` folders (similar to the logic in `git-sync.bat` but monitoring changes in real-time).
2.  **Debounce Logic:** Implement a 5-to-10 minute debounce timer on file changes to prevent spamming Git commits and pushes while a user is actively typing.
3.  **VBS Launcher & Installer script:** Write `launcher.vbs` and a setup PowerShell script to configure the Registry Run key.
