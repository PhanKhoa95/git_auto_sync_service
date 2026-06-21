const activeChildProcesses = new Set();

function registerChildProcess(child) {
  if (!child) return;
  activeChildProcesses.add(child);
  const cleanup = () => {
    activeChildProcesses.delete(child);
  };
  child.on('close', cleanup);
  child.on('exit', cleanup);
  child.on('error', cleanup);
}

function killAllChildProcesses() {
  for (const child of activeChildProcesses) {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill('SIGTERM');
      } catch (err) {}
    }
  }
  activeChildProcesses.clear();
}

module.exports = {
  registerChildProcess,
  killAllChildProcesses,
  activeChildProcesses
};
