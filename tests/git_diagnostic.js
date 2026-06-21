const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const tmpDir = path.join(os.tmpdir(), 'git-diag-static-4');
if (fs.existsSync(tmpDir)) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
fs.mkdirSync(tmpDir);

const localPath = path.join(tmpDir, 'local');
const remotePath = path.join(tmpDir, 'remote.git');
fs.mkdirSync(localPath);
fs.mkdirSync(remotePath);

function run(cmd, cwd) {
  console.log(`Running: ${cmd} in ${cwd}`);
  try {
    const stdout = execSync(cmd, { cwd, encoding: 'utf8', stdio: 'pipe' });
    console.log(`  -> SUCCESS. Stdout: ${stdout.trim()}`);
    return true;
  } catch (err) {
    console.log(`  -> FAILED (status ${err.status}). Stderr: ${err.stderr ? err.stderr.trim() : ''} Stdout: ${err.stdout ? err.stdout.trim() : ''}`);
    return false;
  }
}

run('git init --bare', remotePath);
run('git init', localPath);
run('git checkout -b master', localPath);
run('git config user.name "Tester"', localPath);
run('git config user.email "tester@test.com"', localPath);

fs.writeFileSync(path.join(localPath, 'init.txt'), 'Initial');
run('git add init.txt', localPath);
run('git commit -m "Initial commit"', localPath);
run(`git remote add origin "${remotePath}"`, localPath);

console.log('--- FIRST PUSH ---');
run('git push -u origin master', localPath);

console.log('--- SECOND PUSH ---');
run('git push -u origin master', localPath);

// Clean up
try {
  fs.rmSync(tmpDir, { recursive: true, force: true });
} catch (e) {}
