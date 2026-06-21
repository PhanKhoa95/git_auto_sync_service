const fs = require('fs');
const path = require('path');
const child_process = require('child_process');
const E2ETestHarness = require('./tests/e2e/harness');

const harness = new E2ETestHarness();
harness.setupSandbox();

console.log('Sandbox root:', harness.sandboxRoot);
console.log('Remotes path:', harness.remotesPath);
console.log('Virtual drive path:', harness.virtualDrivePath);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  try {
    console.log('Step 1: Creating mock repo...');
    harness.createMockRepo('repo1', true);

    const remotePath = path.join(harness.remotesPath, 'repo1.git');
    console.log('Remote path exists initially:', fs.existsSync(remotePath));

    console.log('Compiling C# wrapper...');
    let cscPath = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
    if (!fs.existsSync(cscPath)) {
      cscPath = 'C:\\Windows\\Microsoft.NET\\v4.0.30319\\csc.exe';
    }
    const gitCsPath = path.join(harness.sandboxRoot, 'git.cs');
    const gitExePath = path.join(harness.sandboxRoot, 'git.exe');
    const gitRealFile = path.join(harness.sandboxRoot, 'git_real.txt');
    const gitStatusFile = path.join(harness.sandboxRoot, 'git_status.txt');

    fs.writeFileSync(gitStatusFile, 'fail');
    let realGitPath = 'C:\\Program Files\\Git\\cmd\\git.exe';
    fs.writeFileSync(gitRealFile, realGitPath);

    fs.writeFileSync(gitCsPath, `using System;
using System.IO;
using System.Diagnostics;
class GitWrapper {
    static int Main(string[] args) {
        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        string statusFile = Path.Combine(baseDir, "git_status.txt");
        string realGitFile = Path.Combine(baseDir, "git_real.txt");

        if (File.Exists(statusFile)) {
            string status = File.ReadAllText(statusFile).Trim();
            if (status == "fail") {
                Console.Error.WriteLine("git command is temporarily missing");
                return 127;
            }
        }

        string realGitPath = "C:\\\\Program Files\\\\Git\\\\cmd\\\\git.exe";
        if (File.Exists(realGitFile)) {
            realGitPath = File.ReadAllText(realGitFile).Trim();
        }

        ProcessStartInfo psi = new ProcessStartInfo();
        psi.FileName = realGitPath;
        string arguments = "";
        for (int i = 0; i < args.Length; i++) {
            string arg = args[i];
            if (arg.Contains(" ") || arg.Contains("\\"")) {
                arg = "\\"" + arg.Replace("\\"", "\\\\\\"") + "\\"";
            }
            arguments += (i > 0 ? " " : "") + arg;
        }
        psi.Arguments = arguments;
        psi.UseShellExecute = false;

        try {
            using (Process process = Process.Start(psi)) {
                process.WaitForExit();
                return process.ExitCode;
            }
        } catch (Exception ex) {
            Console.Error.WriteLine("Error executing real git: " + ex.Message);
            return 1;
        }
    }
}`);

    child_process.execSync('"' + cscPath + '" /nologo /out:"' + gitExePath + '" "' + gitCsPath + '"', { stdio: 'ignore' });
    console.log('C# wrapper compiled. git.exe exists:', fs.existsSync(gitExePath));

    const customPath = harness.sandboxRoot + path.delimiter + process.env.PATH;
    console.log('Starting daemon...');
    harness.startDaemon({
      PATH: customPath,
      DEBOUNCE_DELAY: '500'
    });
    await delay(500);

    console.log('Modifying file - should fail since git fails...');
    harness.createFile('repo1', 'git_missing_test.txt', 'fail run');
    await delay(3500);

    const log = harness.readLog();
    console.log('Log contains error/missing/fail:', log.toLowerCase().includes('error') || log.toLowerCase().includes('missing') || log.toLowerCase().includes('fail'));

    console.log('Restoring git wrapper to pass...');
    fs.writeFileSync(gitStatusFile, 'pass');

    console.log('Modifying file again - should sync successfully...');
    harness.createFile('repo1', 'git_missing_test.txt', 'success run');
    await delay(4500);

    console.log('Remote path exists now:', fs.existsSync(remotePath));
    console.log('Running git log check in remotePath...');
    const res = harness.gitCmd(remotePath, ['log', '-1', '--pretty=%B']);
    console.log('harness.gitCmd succeeded. Output:', res.stdout.trim());

  } catch (err) {
    console.error('Error during run:', err);
  } finally {
    await harness.stopDaemon();
    harness.cleanSandbox();
    console.log('Sandbox cleaned.');
  }
}

run();
