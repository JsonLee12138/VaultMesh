import { spawn } from 'node:child_process';

export function startManagedProcess(command, args, {
  cwd,
  environment = process.env,
  label = command,
} = {}) {
  const child = spawn(command, args, {
    cwd,
    env: environment,
    stdio: 'inherit',
  });
  let exited = false;
  const completion = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      exited = true;
      resolve({ code, signal });
    });
  });

  return {
    completion,
    get exited() { return exited; },
    async stop() {
      if (exited) return;
      signalProcess(child, 'SIGTERM');
      await Promise.race([
        completion.catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, 3_000)),
      ]);
      if (!exited) signalProcess(child, 'SIGKILL');
      await completion.catch(() => undefined);
    },
    label,
  };
}

export function runOneShot(command, args, {
  cwd,
  environment = process.env,
  ignoreFailure = false,
  stdio = 'inherit',
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: environment,
      stdio,
    });
    child.once('error', ignoreFailure ? () => resolve(1) : reject);
    child.once('exit', (code, signal) => {
      if (code === 0 || ignoreFailure) resolve(code ?? 1);
      else reject(new Error(`${command} ${signal ? `被 ${signal} 终止` : `退出码 ${code ?? 1}`}`));
    });
  });
}

function signalProcess(child, signal) {
  try {
    child.kill(signal);
  } catch {}
}
