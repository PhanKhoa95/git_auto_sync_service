const fs = require('fs');
const path = require('path');
const { spawnSync, execSync } = require('child_process');

const BASE_DIR = 'E:\\';
const repos = [];

function runGit(repoPath, args) {
  const res = spawnSync('git', args, { cwd: repoPath, encoding: 'utf8' });
  if (res.status !== 0) {
    if (args[0] === 'commit' && res.status === 1) {
      return res.stdout;
    }
    throw new Error(`Command failed: git ${args.join(' ')}\nError: ${res.stderr}\nStdout: ${res.stdout}`);
  }
  return res.stdout;
}

function log(msg) {
  console.log(`[SIMULATOR] ${msg}`);
}

async function run() {
  log('Starting Autopilot Failure Scenarios Setup...');

  // Setup helper for repos
  function createRepo(name) {
    const repoPath = path.join(BASE_DIR, name);
    if (fs.existsSync(repoPath)) {
      try {
        fs.rmSync(repoPath, { recursive: true, force: true });
      } catch(e) {
        log(`Failed to delete ${name}: ${e.message}`);
      }
    }
    if (!fs.existsSync(repoPath)) {
      fs.mkdirSync(repoPath, { recursive: true });
    }
    try { runGit(repoPath, ['init']); } catch(e){}
    try {
      runGit(repoPath, ['config', 'user.name', 'E2ETester']);
      runGit(repoPath, ['config', 'user.email', 'tester@e2e.local']);
    } catch(e){}
    fs.writeFileSync(path.join(repoPath, 'README.md'), `# ${name}\n`);
    runGit(repoPath, ['add', '.']);
    runGit(repoPath, ['commit', '-m', 'Initial commit']);
    try { runGit(repoPath, ['branch', '-M', 'main']); } catch(e){}
    repos.push(repoPath);
    return repoPath;
  }
  function setupRemote(localPath, name) {
    const remotePath = path.join(BASE_DIR, 'temp_remotes', name + '.git');
    if (fs.existsSync(remotePath)) {
      try {
        fs.rmSync(remotePath, { recursive: true, force: true });
      } catch(e) {
        log(`Failed to delete remote ${name}, trying to clean git directory...`);
      }
    }
    if (!fs.existsSync(remotePath)) {
      fs.mkdirSync(remotePath, { recursive: true });
      execSync(`git init --bare`, { cwd: remotePath });
      try { execSync(`git symbolic-ref HEAD refs/heads/main`, { cwd: remotePath }); } catch(e){}
    }
    
    // Check if remote 'origin' already exists
    let hasRemote = false;
    try {
      runGit(localPath, ['remote', 'get-url', 'origin']);
      hasRemote = true;
    } catch(e) {}

    if (hasRemote) {
      runGit(localPath, ['remote', 'set-url', 'origin', remotePath]);
    } else {
      runGit(localPath, ['remote', 'add', 'origin', remotePath]);
    }
    
    // Force push to remote
    runGit(localPath, ['push', '-f', '-u', 'origin', 'main']);
    return remotePath;
  }

  try {
    fs.mkdirSync(path.join(BASE_DIR, 'temp_remotes'), { recursive: true });

    // 1. Missing Git Identity
    log('Setting up Scenario 1: Missing Git Identity...');
    const r1 = createRepo('sync_fail_1_no_identity');
    setupRemote(r1, 'sync_fail_1_no_identity');
    // Unset local config
    try { runGit(r1, ['config', '--local', '--unset', 'user.name']); } catch(e){}
    try { runGit(r1, ['config', '--local', '--unset', 'user.email']); } catch(e){}
    // Modify file to trigger sync
    fs.appendFileSync(path.join(r1, 'README.md'), 'Mod 1\n');

    // 2. Stale Lock File
    log('Setting up Scenario 2: Stale Lock File...');
    const r2 = createRepo('sync_fail_2_stale_lock');
    setupRemote(r2, 'sync_fail_2_stale_lock');
    // Create stale lock file and set its mtime to 20 seconds ago
    const lockPath = path.join(r2, '.git', 'index.lock');
    fs.writeFileSync(lockPath, 'lock content');
    const time = (Date.now() - 20000) / 1000;
    fs.utimesSync(lockPath, time, time);
    // Modify file
    fs.appendFileSync(path.join(r2, 'README.md'), 'Mod 2\n');

    // 3. Detached HEAD
    log('Setting up Scenario 3: Detached HEAD...');
    const r3 = createRepo('sync_fail_3_detached_head');
    setupRemote(r3, 'sync_fail_3_detached_head');
    fs.writeFileSync(path.join(r3, 'temp.txt'), 'temp');
    runGit(r3, ['add', '.']);
    runGit(r3, ['commit', '-m', 'temp commit']);
    const commitHash = runGit(r3, ['rev-parse', 'HEAD']).trim();
    runGit(r3, ['checkout', commitHash]); // detach HEAD
    // Modify file
    fs.appendFileSync(path.join(r3, 'README.md'), 'Mod 3\n');

    // 4. Merge Conflict on Pull
    log('Setting up Scenario 4: Merge Conflict...');
    const r4 = createRepo('sync_fail_4_merge_conflict');
    const rem4 = setupRemote(r4, 'sync_fail_4_merge_conflict');
    // Create remote commit on another cloned repo
    const r4Clone = path.join(BASE_DIR, 'temp_remotes', 'sync_fail_4_merge_conflict_clone');
    if (fs.existsSync(r4Clone)) fs.rmSync(r4Clone, { recursive: true, force: true });
    execSync(`git clone "${rem4}" "${r4Clone}"`);
    try { runGit(r4Clone, ['checkout', 'main']); } catch(e){
      try { runGit(r4Clone, ['checkout', '-b', 'main']); } catch(err){}
    }
    runGit(r4Clone, ['config', 'user.name', 'Tester']);
    runGit(r4Clone, ['config', 'user.email', 'tester@e2e.local']);
    fs.writeFileSync(path.join(r4Clone, 'conflict.txt'), 'Remote Content\n');
    runGit(r4Clone, ['add', '.']);
    runGit(r4Clone, ['commit', '-m', 'Remote conflicting commit']);
    runGit(r4Clone, ['push', 'origin', 'main']);
    // Create local conflicting change
    fs.writeFileSync(path.join(r4, 'conflict.txt'), 'Local Content\n');

    // 5. Non-Fast-Forward Push
    log('Setting up Scenario 5: Non-Fast-Forward Push...');
    const r5 = createRepo('sync_fail_5_non_ff');
    const rem5 = setupRemote(r5, 'sync_fail_5_non_ff');
    // Make remote move ahead
    const r5Clone = path.join(BASE_DIR, 'temp_remotes', 'sync_fail_5_non_ff_clone');
    if (fs.existsSync(r5Clone)) fs.rmSync(r5Clone, { recursive: true, force: true });
    execSync(`git clone "${rem5}" "${r5Clone}"`);
    try { runGit(r5Clone, ['checkout', 'main']); } catch(e){
      try { runGit(r5Clone, ['checkout', '-b', 'main']); } catch(err){}
    }
    runGit(r5Clone, ['config', 'user.name', 'Tester']);
    runGit(r5Clone, ['config', 'user.email', 'tester@e2e.local']);
    fs.writeFileSync(path.join(r5Clone, 'ff.txt'), 'Remote Content 2\n');
    runGit(r5Clone, ['add', '.']);
    runGit(r5Clone, ['commit', '-m', 'Remote commit']);
    runGit(r5Clone, ['push', 'origin', 'main']);
    // Make local change and commit locally first so push gets rejected
    fs.writeFileSync(path.join(r5, 'local.txt'), 'Local Content 2\n');
    runGit(r5, ['add', '.']);
    runGit(r5, ['commit', '-m', 'Local commit']);
    // Modify another file to trigger watcher
    fs.appendFileSync(path.join(r5, 'README.md'), 'Mod 5\n');

    // 6. Unrelated Histories
    log('Setting up Scenario 6: Unrelated Histories...');
    const r6 = createRepo('sync_fail_6_unrelated_histories');
    // Setup remote with completely unrelated history
    const rem6 = path.join(BASE_DIR, 'temp_remotes', 'sync_fail_6_unrelated_histories.git');
    if (fs.existsSync(rem6)) fs.rmSync(rem6, { recursive: true, force: true });
    fs.mkdirSync(rem6, { recursive: true });
    execSync(`git init --bare`, { cwd: rem6 });
    // Push unrelated commit from a temporary source
    const r6Temp = path.join(BASE_DIR, 'temp_remotes', 'r6_temp');
    if (fs.existsSync(r6Temp)) fs.rmSync(r6Temp, { recursive: true, force: true });
    fs.mkdirSync(r6Temp, { recursive: true });
    execSync(`git init`, { cwd: r6Temp });
    execSync(`git checkout -b main`, { cwd: r6Temp });
    fs.writeFileSync(path.join(r6Temp, 'unrelated.txt'), 'Unrelated root\n');
    execSync(`git add .`, { cwd: r6Temp });
    execSync(`git commit -m "Unrelated root commit"`, { cwd: r6Temp });
    execSync(`git remote add origin "${rem6}"`, { cwd: r6Temp });
    execSync(`git push -u origin main`, { cwd: r6Temp });
    // Connect original local repo to the remote
    let hasRemoteR6 = false;
    try { runGit(r6, ['remote', 'get-url', 'origin']); hasRemoteR6 = true; } catch(e){}
    if (hasRemoteR6) {
      runGit(r6, ['remote', 'set-url', 'origin', rem6]);
    } else {
      runGit(r6, ['remote', 'add', 'origin', rem6]);
    }
    // Modify file
    fs.appendFileSync(path.join(r6, 'README.md'), 'Mod 6\n');

    // 7. No Remote configured
    log('Setting up Scenario 7: No Remote...');
    const r7 = createRepo('sync_fail_7_no_remote');
    // Unlink remote origin if any
    try { runGit(r7, ['remote', 'remove', 'origin']); } catch(e){}
    // Just modify file
    fs.appendFileSync(path.join(r7, 'README.md'), 'Mod 7\n');

    // 8. Network Unreachable (Invalid Remote URL)
    log('Setting up Scenario 8: Network Unreachable...');
    const r8 = createRepo('sync_fail_8_network_unreachable');
    let hasRemoteR8 = false;
    try { runGit(r8, ['remote', 'get-url', 'origin']); hasRemoteR8 = true; } catch(e){}
    if (hasRemoteR8) {
      runGit(r8, ['remote', 'set-url', 'origin', 'https://invalid-host-name-for-testing.com/repo.git']);
    } else {
      runGit(r8, ['remote', 'add', 'origin', 'https://invalid-host-name-for-testing.com/repo.git']);
    }
    // Modify file
    fs.appendFileSync(path.join(r8, 'README.md'), 'Mod 8\n');

    // 9. Repository Deleted Mid-Sync
    log('Setting up Scenario 9: Repository Deleted Mid-Sync...');
    const r9 = createRepo('sync_fail_9_deleted_mid_sync');
    // Modify file
    fs.appendFileSync(path.join(r9, 'README.md'), 'Mod 9\n');
    // Delete immediately to simulate
    fs.rmSync(r9, { recursive: true, force: true });

    // 10. Circular Junction/Symlink
    log('Setting up Scenario 10: Circular Symlink...');
    const r10 = createRepo('sync_fail_10_circular_symlink');
    setupRemote(r10, 'sync_fail_10_circular_symlink');
    // Create symlink pointing to parent or another directory
    const linkPath = path.join(r10, 'circular_junction');
    if (!fs.existsSync(linkPath)) {
      try {
        fs.symlinkSync(r10, linkPath, 'junction');
      } catch(e) {
        log('Symlink creation bypassed/failed (permissions). Trying junction via cmd...');
        try {
          execSync(`mklink /j "${linkPath}" "${r10}"`);
        } catch(cmdErr) {
          log('Junction bypassed/failed.');
        }
      }
    }
    // Modify file
    fs.appendFileSync(path.join(r10, 'README.md'), 'Mod 10\n');

    log('All 10 failure scenarios initialized and changes triggered.');
    log('Please wait for the daemon to process them (debounce is active)...');

  } catch (err) {
    log(`Setup failed: ${err.message}`);
  }
}

run();
