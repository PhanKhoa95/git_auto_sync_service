# Original User Request

## Initial Request — 2026-06-21T00:07:12+07:00

Build a 100% automated background Git synchronization service for Windows that monitors all Git repositories in the E:\ drive (root and level-1 subfolders) and performs instant synchronization (pull, add, commit, push) whenever files are modified.

Working directory: E:\git_auto_sync_service
Integrity mode: development

## Requirements

### R1. Background File Watcher & Sync Daemon
- The system must run as a background service/process on Windows.
- It must monitor the root `E:\` and all its level-1 subdirectories. If a directory is a Git repository, it must watch for file creations, modifications, and deletions.
- It must implement a debouncing mechanism (e.g., wait 5-10 seconds after the last change before triggering synchronization) to prevent continuous sync triggers during active coding.

### R2. Git Synchronization Logic
- For each monitored repository with changes, the service must automatically:
  1. Pull updates from the remote repository (if origin is configured).
  2. Stage all changes (`git add -A`).
  3. Commit changes with a timestamp-based message (e.g., `Auto-sync: YYYY-MM-DD HH:MM:SS`) or a generic message.
  4. Push the commit to the current branch on origin.
- If a conflict or error occurs during pull/push, it should log the error and skip the repository gracefully without crashing the daemon.

### R3. Autopilot Configuration & Windows Startup
- Ensure Git Credential Manager (`credential.helper manager`) is enabled so push/pull operations don't get blocked by password prompts.
- Ensure the background daemon is configured to start automatically when Windows starts.
- Provide a setup script/installer (e.g., a `.bat` or PowerShell script) to register the service and configure everything automatically.

## Acceptance Criteria

### Automation and Verification
- [ ] **Daemon Operation**: The background daemon runs successfully without displaying a command prompt window constantly (runs silently).
- [ ] **Hot-Reload Sync**: Modifying, adding, or deleting a file inside a Git repository under `E:\` triggers a git commit and push automatically within 15 seconds.
- [ ] **Windows Startup**: The daemon registers itself to start automatically on Windows startup.
- [ ] **Robustness**: The daemon does not crash when a repository lacks a remote, has conflicts, or when the internet connection is lost.
- [ ] **Programmatic Verification**: A verification script `verify_sync.ps1` must be provided to test creating a temp git repo, modifying a file, and verifying that a commit is automatically made.
