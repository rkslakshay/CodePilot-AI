// CodePilot AI — isolated code runner process.
//
// This script is spawned as a SEPARATE Node.js process for every execution request.
// It never runs inside the Express server process. It receives a job description
// on stdin (JSON), compiles/runs the user's program inside a throw-away working
// directory with a stripped environment, and prints a single JSON result line.
//
// IMPORTANT: this is defence-in-depth, NOT a security sandbox. See ARCHITECTURE.md.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const PY_GUARD = `
import sys, os
_BLOCK = ('subprocess.Popen', 'os.system', 'os.exec', 'os.spawn', 'os.posix_spawn', 'os.fork', 'os.forkpty',
          'socket.connect', 'socket.bind', 'socket.getaddrinfo', 'os.remove', 'os.unlink', 'os.rmdir', 'os.rename',
          'os.replace', 'shutil.rmtree', 'shutil.move', 'shutil.copyfile', 'os.mkdir', 'os.chmod', 'ctypes.dlopen',
          'ctypes.dlsym', 'os.startfile', 'urllib.Request', 'os.kill', 'os.truncate', 'os.putenv', 'os.chdir', 'winreg.OpenKey',
          'winreg.CreateKey', 'winreg.SetValue', 'webbrowser.open', 'sys.addaudithook')
def _cp_hook(event, args):
    if event == 'open':
        mode = args[1] if len(args) > 1 else None
        flags = args[2] if len(args) > 2 else 0
        if (isinstance(mode, str) and any(c in mode for c in 'wax+')) or (mode is None and isinstance(flags, int) and flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_APPEND)):
            raise PermissionError('CodePilot execution guard: writing files is disabled')
    elif event in _BLOCK or event.startswith('os.exec') or event.startswith('os.spawn'):
        raise PermissionError('CodePilot execution guard: operation "' + event + '" is blocked')
_src = open(sys.argv[1], encoding='utf-8').read()
sys.argv = ['main.py']
sys.addaudithook(_cp_hook)
del _cp_hook
_code = compile(_src, 'main.py', 'exec')
del _src
exec(_code, {'__name__': '__main__', '__builtins__': __builtins__})
`;

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
  });
}

function killTree(child) {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  }
}

/** Run a command with timeout + output cap. */
function run(cmd, args, { cwd, env, input, timeoutMs, maxOutput }) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    let stdout = '';
    let stderr = '';
    let truncated = false;
    let timedOut = false;
    let child;
    try {
      child = spawn(cmd, args, { cwd, env, windowsHide: true, detached: process.platform !== 'win32' });
    } catch (e) {
      resolve({ exitCode: -1, stdout: '', stderr: String(e.message || e), timedOut: false, truncated: false, timeMs: 0, spawnError: true });
      return;
    }
    const cap = (cur, chunk) => {
      if (cur.length + chunk.length > maxOutput) {
        truncated = true;
        killTree(child);
        return cur + chunk.slice(0, Math.max(0, maxOutput - cur.length));
      }
      return cur + chunk;
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (c) => (stdout = cap(stdout, c)));
    child.stderr.on('data', (c) => (stderr = cap(stderr, c)));
    child.stdin.on('error', () => {});
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ exitCode: -1, stdout, stderr: stderr + String(e.message || e), timedOut, truncated, timeMs: 0, spawnError: true });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const timeMs = Number(process.hrtime.bigint() - started) / 1e6;
      resolve({ exitCode: code ?? -1, stdout, stderr, timedOut, truncated, timeMs: Math.round(timeMs) });
    });
    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}

async function main() {
  const job = JSON.parse(await readStdin());
  const { language, code, stdin = '', timeoutMs = 5000, compileTimeoutMs = 20000, maxOutput = 65536, tools } = job;
  const dir = mkdtempSync(join(tmpdir(), 'codepilot-run-'));
  // Minimal environment: no application variables, secrets or database paths are passed on.
  const env = {
    PATH: job.path || '',
    SYSTEMROOT: process.env.SYSTEMROOT || 'C:\\Windows',
    TEMP: dir,
    TMP: dir,
    TMPDIR: dir,
    HOME: dir,
    USERPROFILE: dir,
    PYTHONIOENCODING: 'utf-8',
    PYTHONDONTWRITEBYTECODE: '1',
    LANG: 'C.UTF-8',
  };
  const opts = { cwd: dir, env, timeoutMs: compileTimeoutMs, maxOutput, input: '' };
  const result = { phase: 'run', compile: null, run: null };
  try {
    let runCmd;
    let runArgs;
    if (language === 'c' || language === 'cpp') {
      const src = join(dir, language === 'c' ? 'main.c' : 'main.cpp');
      writeFileSync(src, code);
      const exe = join(dir, process.platform === 'win32' ? 'main.exe' : 'main');
      result.phase = 'compile';
      if (language === 'c' && tools.linker) {
        // Compile as C, then link with g++. Some MinGW builds produce C executables that crash
        // (0xC0000409) when started by Node/libuv with redirected stdio; linking through g++ avoids it.
        const obj = join(dir, 'main.o');
        result.compile = await run(tools.compiler, ['-c', src, '-o', obj, '-std=gnu11', '-O1', '-Wall'], opts);
        if (result.compile.exitCode !== 0 || result.compile.timedOut) return finish();
        const link = await run(tools.linker, [obj, '-o', exe], opts);
        result.compile.stdout += link.stdout;
        result.compile.stderr += link.stderr;
        result.compile.exitCode = link.exitCode;
        result.compile.timeMs += link.timeMs;
      } else {
        const args = language === 'c' ? [src, '-o', exe, '-std=gnu11', '-O1', '-Wall', '-lm'] : [src, '-o', exe, '-std=c++17', '-O1', '-Wall'];
        result.compile = await run(tools.compiler, args, opts);
      }
      if (result.compile.exitCode !== 0 || result.compile.timedOut) return finish();
      result.phase = 'run';
      runCmd = exe;
      runArgs = [];
    } else if (language === 'java') {
      const cls = job.className || 'Main';
      const src = join(dir, `${cls}.java`);
      writeFileSync(src, code);
      result.phase = 'compile';
      result.compile = await run(tools.compiler, ['-J-Xmx256m', '-encoding', 'UTF-8', `${cls}.java`], opts);
      if (result.compile.exitCode !== 0 || result.compile.timedOut) return finish();
      result.phase = 'run';
      runCmd = tools.runtime;
      runArgs = ['-Xmx256m', '-Xss16m', '-XX:+UseSerialGC', '-XX:-UsePerfData', '-Xshare:auto', '-Dfile.encoding=UTF-8', '-cp', '.', cls];
    } else if (language === 'python') {
      writeFileSync(join(dir, 'main.py'), code);
      writeFileSync(join(dir, '_guard.py'), PY_GUARD);
      runCmd = tools.runtime;
      runArgs = [...(tools.runtimeArgs || []), '-I', '-B', '-X', 'utf8', '_guard.py', 'main.py'];
    } else if (language === 'javascript') {
      writeFileSync(join(dir, 'main.js'), code);
      runCmd = tools.runtime;
      runArgs = ['--permission', `--allow-fs-read=${dir}`, '--max-old-space-size=256', '--disallow-code-generation-from-strings', 'main.js'];
    } else throw new Error('Unsupported language');
    if (job.sandbox) {
      // OS-enforced isolation: Job Object limits + Low integrity token (see sandbox/cpsandbox.cs)
      const memMb = language === 'java' ? 768 : 512;
      runArgs = ['run', '--mem', String(memMb), '--cpu', String(timeoutMs + 1000), '--procs', '1', '--', runCmd, ...runArgs];
      runCmd = job.sandbox;
    }
    result.run = await run(runCmd, runArgs, { cwd: dir, env, input: stdin, timeoutMs, maxOutput });
    result.isolation = job.sandbox ? 'job+lowil' : 'process';
    if (language === 'python' && result.run.stderr) {
      // hide wrapper frames from tracebacks
      result.run.stderr = result.run.stderr
        .split('\n')
        .filter((l, i, arr) => !(l.includes('_guard.py') || (i > 0 && arr[i - 1].includes('_guard.py') && /^\s{4}/.test(l)) || (i > 1 && arr[i - 2].includes('_guard.py') && /^\s*[~^]+\s*$/.test(l))))
        .join('\n');
    }
  } catch (e) {
    result.error = String(e.message || e);
  }
  return finish();

  function finish() {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      /* best effort cleanup */
    }
    process.stdout.write(JSON.stringify(result));
  }
}

main().catch((e) => {
  process.stdout.write(JSON.stringify({ phase: 'run', error: String(e?.message || e) }));
});
