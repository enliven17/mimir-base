/** Stop the complete fleet if a child dies; wait for both children on deploys. */
/** @param {{ runtime?: { on: (event: string, listener: () => void) => unknown, exit: (code: number) => unknown }, graceMs?: number }} options */
export function superviseProcesses({ runtime = process, graceMs = 25_000 } = {}) {
  const children = new Set();
  let stopping = false;
  let exitCode = 0;
  let timer;
  const finish = () => {
    if (stopping && children.size === 0) {
      clearTimeout(timer);
      runtime.exit(exitCode);
    }
  };
  const stop = (code = 0, signal = 'SIGTERM') => {
    if (stopping) return;
    stopping = true;
    exitCode = code;
    timer = setTimeout(() => {
      for (const child of children) child.kill('SIGKILL');
      runtime.exit(exitCode || 1);
    }, graceMs);
    for (const child of children) child.kill(signal);
    finish();
  };
  runtime.on('SIGTERM', () => stop(0));
  runtime.on('SIGINT', () => stop(0, 'SIGINT'));
  return {
    stop,
    add(child, label) {
      children.add(child);
      child.once('error', () => {
        console.error(`[workers] ${label} failed to start`);
        stop(1);
      });
      child.once('exit', (code, signal) => {
        if (!stopping) {
          console.error(`[workers] unexpected ${label} exit: code=${code} signal=${signal ?? ''}`);
          stop(code || 1);
        }
      });
      child.once('close', () => { children.delete(child); finish(); });
      if (stopping) child.kill('SIGTERM');
    },
  };
}
