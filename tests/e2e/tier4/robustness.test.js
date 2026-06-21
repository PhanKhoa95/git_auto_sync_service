const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const child_process = require('child_process');
const E2ETestHarness = require('../harness');

describe('Tier 4 Robustness & Failure Recovery Tests', function () {
  this.timeout(45000);
  let harness;

  beforeEach(() => {
    harness = new E2ETestHarness();
    harness.setupSandbox();
  });

  afterEach(async function () {
    if (this.currentTest.state === 'failed') {
      console.log('--- DAEMON OUTPUT FOR FAILED TEST ---');
      console.log(harness.daemonOutput);
      console.log('--- SYNC.LOG FOR FAILED TEST ---');
      console.log(harness.readLog());
    }
    await harness.stopDaemon();
    harness.cleanSandbox();
  });

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Helper to wait for a commit matching pattern in the remote repo
  const waitForRemoteCommit = async (remotePath, pattern, timeoutMs = 8000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const commitMsg = harness.gitCmd(remotePath, ['log', '-1', '--pretty=%B']).stdout.trim();
        if (pattern.test(commitMsg)) {
          return commitMsg;
        }
      } catch (e) {}
      await delay(200);
    }
    return harness.gitCmd(remotePath, ['log', '-1', '--pretty=%B']).stdout.trim();
  };

  // TC-T4-01: Git executable missing recovery
  it('TC-T4-01: Git executable missing recovery', async () => {
    harness.createMockRepo('repo1', true);

    // Find real git path
    let realGitPath;
    try {
      realGitPath = child_process.execSync('where git', { encoding: 'utf8' }).trim().split(/\r?\n/)[0].trim();
    } catch (e) {
      // fallback path
      realGitPath = 'C:\\Program Files\\Git\\cmd\\git.exe';
    }

    const gitCsPath = path.join(harness.sandboxRoot, 'git.cs');
    const gitExePath = path.join(harness.sandboxRoot, 'git.exe');
    const gitRealFile = path.join(harness.sandboxRoot, 'git_real.txt');
    const gitStatusFile = path.join(harness.sandboxRoot, 'git_status.txt');

    // 1. Set git wrapper to fail
    fs.writeFileSync(gitStatusFile, 'fail');
    fs.writeFileSync(gitRealFile, realGitPath);

    // Write git.cs source code
    fs.writeFileSync(gitCsPath, `using System;
using System.IO;
using System.Diagnostics;

class GitWrapper
{
    static int Main(string[] args)
    {
        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        string statusFile = Path.Combine(baseDir, "git_status.txt");
        string realGitFile = Path.Combine(baseDir, "git_real.txt");

        if (File.Exists(statusFile))
        {
            string status = File.ReadAllText(statusFile).Trim();
            if (status == "fail")
            {
                Console.Error.WriteLine("git command is temporarily missing");
                return 127;
            }
        }

        string realGitPath = "C:\\\\Program Files\\\\Git\\\\cmd\\\\git.exe";
        if (File.Exists(realGitFile))
        {
            realGitPath = File.ReadAllText(realGitFile).Trim();
        }

        ProcessStartInfo psi = new ProcessStartInfo();
        psi.FileName = realGitPath;
        
        string arguments = "";
        for (int i = 0; i < args.Length; i++)
        {
            string arg = args[i];
            if (arg.Contains(" ") || arg.Contains("\\""))
            {
                arg = "\\"" + arg.Replace("\\"", "\\\\\\"") + "\\"";
            }
            arguments += (i > 0 ? " " : "") + arg;
        }
        psi.Arguments = arguments;
        psi.UseShellExecute = false;

        try
        {
            using (Process process = Process.Start(psi))
            {
                process.WaitForExit();
                return process.ExitCode;
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("Error executing real git: " + ex.Message);
            return 1;
        }
    }
}`);

    // Compile git.cs to git.exe
    let cscPath = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
    if (!fs.existsSync(cscPath)) {
      cscPath = 'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe';
    }
    child_process.execSync(`"${cscPath}" /nologo /out:"${gitExePath}" "${gitCsPath}"`, { stdio: 'ignore' });

    // Add wrapper directory to the beginning of PATH
    const customPath = harness.sandboxRoot + path.delimiter + process.env.PATH;

    // Start daemon with wrapper
    harness.startDaemon({
      PATH: customPath,
      DEBOUNCE_DELAY: '500'
    });
    await delay(500);

    // 2. Modify file - should fail since git fails
    harness.createFile('repo1', 'git_missing_test.txt', 'fail run');
    await delay(3500);

    const log = harness.readLog();
    expect(log.toLowerCase()).to.satisfy(
      (out) => out.includes('error') || out.includes('missing') || out.includes('fail')
    );

    // Daemon must remain alive
    expect(harness.daemonProcess).to.not.be.null;

    // 3. Restore git wrapper to pass
    fs.writeFileSync(gitStatusFile, 'pass');

    // 4. Modify file again - should now sync successfully
    harness.createFile('repo1', 'git_missing_test.txt', 'success run');
    await delay(4500); // Wait for new sync

    // Verify remote has the commit
    const remotePath = path.join(harness.remotesPath, 'repo1.git');
    const commitMsg = harness.gitCmd(remotePath, ['log', '-1', '--pretty=%B']).stdout.trim();
    expect(commitMsg).to.match(/Auto-sync:/);
  });

  // TC-T4-02: Corrupted .git directory
  it('TC-T4-02: Corrupted .git directory', async () => {
    const repo1 = harness.createMockRepo('repo1', true);
    harness.createMockRepo('repo2', true);

    harness.startDaemon({ DEBOUNCE_DELAY: '500' });
    await harness.waitForDaemonReady();

    // Corrupt repo1/.git/HEAD
    const headPath = path.join(repo1, '.git', 'HEAD');
    fs.writeFileSync(headPath, 'CORRUPTED');

    // Modify file in corrupted repo1
    harness.createFile('repo1', 'corrupt_test.txt', 'should fail');
    
    // Modify file in healthy repo2
    harness.createFile('repo2', 'healthy_test.txt', 'should pass');

    // Verify repo2 remote has the commit via dynamic polling
    const remotePath2 = path.join(harness.remotesPath, 'repo2.git');
    const commitMsg2 = await waitForRemoteCommit(remotePath2, /Auto-sync:/);
    expect(commitMsg2).to.match(/Auto-sync:/);

    // repo1 sync should fail/log error, repo2 should succeed
    const log = harness.readLog();
    expect(log).to.include('repo2'); // repo2 synced
    expect(harness.daemonProcess).to.not.be.null; // stays alive
  });

  // TC-T4-03: Disk full condition
  it('TC-T4-03: Disk full condition', async () => {
    harness.createMockRepo('repo1', true);
    harness.startDaemon({ DEBOUNCE_DELAY: '500' });
    await delay(500);

    // Simulate write failure/disk full by denying write permissions to log directory/file
    try {
      child_process.execSync(`icacls "${harness.logPath}" /deny *S-1-1-0:(W)`, { stdio: 'ignore' });
    } catch (e) {
      // fallback or fs.chmodSync
      try {
        fs.chmodSync(harness.logPath, 0o444);
      } catch (err) {}
    }

    harness.createFile('repo1', 'disk_full_test.txt', 'write during disk full');
    await delay(3500);

    // Restore permissions
    try {
      child_process.execSync(`icacls "${harness.logPath}" /remove:d *S-1-1-0`, { stdio: 'ignore' });
    } catch (e) {
      try {
        fs.chmodSync(harness.logPath, 0o666);
      } catch (err) {}
    }

    // Process should not crash
    expect(harness.daemonProcess).to.not.be.null;
  });

  // TC-T4-04: Concurrent launcher prevention
  it('TC-T4-04: Concurrent launcher prevention', async () => {
    harness.createMockRepo('repo1', true);
    
    // Start first daemon
    harness.startDaemon({ DEBOUNCE_DELAY: '1000' });
    
    // Wait for the lock file to be created by the first daemon
    const lockFilePath = path.join(harness.virtualDrivePath, '.sync.lock');
    let lockCreated = false;
    for (let i = 0; i < 25; i++) {
      if (fs.existsSync(lockFilePath)) {
        lockCreated = true;
        break;
      }
      await delay(200);
    }
    expect(lockCreated).to.be.true;

    // Try to start a second daemon
    const secondHarness = new E2ETestHarness();
    secondHarness.sandboxRoot = harness.sandboxRoot;
    secondHarness.virtualDrivePath = harness.virtualDrivePath;
    secondHarness.remotesPath = harness.remotesPath;
    secondHarness.logPath = harness.logPath;

    // Start second daemon
    secondHarness.startDaemon({ DEBOUNCE_DELAY: '1000' });
    
    // Wait for the second daemon to exit (since it should fail to acquire lock)
    let exited = false;
    for (let i = 0; i < 25; i++) {
      if (secondHarness.daemonProcess.exitCode !== null) {
        exited = true;
        break;
      }
      await delay(200);
    }
    
    try {
      expect(exited).to.be.true;
      // The first daemon should still be running
      expect(harness.daemonProcess.exitCode).to.be.null;
    } finally {
      // Ensure second daemon is stopped to release any handles
      await secondHarness.stopDaemon();
    }
  });

  // TC-T4-05: Recovery from sudden shutdown
  it('TC-T4-05: Recovery from sudden shutdown', async () => {
    harness.createMockRepo('repo1', true);
    
    harness.startDaemon({ DEBOUNCE_DELAY: '5000' }); // long debounce so we can kill it before sync
    await delay(500);

    // Modify file
    harness.createFile('repo1', 'shutdown_test.txt', 'pending change');
    await delay(1000); // Wait briefly but not enough to trigger sync

    // Kill daemon process suddenly
    await harness.stopDaemon();

    // Restart daemon with short debounce
    harness.startDaemon({ DEBOUNCE_DELAY: '500' });
    await delay(4500); // Wait for startup checks and sync

    // Check remote git log to verify the pending change got synced on startup
    const remotePath = path.join(harness.remotesPath, 'repo1.git');
    const commitMsg = harness.gitCmd(remotePath, ['log', '-1', '--pretty=%B']).stdout.trim();
    expect(commitMsg).to.match(/Auto-sync:/);

    const files = harness.gitCmd(remotePath, ['ls-tree', '-r', 'master', '--name-only']).stdout;
    expect(files).to.include('shutdown_test.txt');
  });
});
