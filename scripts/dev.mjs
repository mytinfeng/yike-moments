/**
 * 开发模式：同时启动 Vite(5173) 与 Express(3000)
 * 前端通过 vite proxy 把 /api 与 /uploads 转发到 3000
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const isWin = process.platform === 'win32';

const procs = [];

function run(name, cmd, args, cwd) {
  const child = spawn(cmd, args, { cwd, shell: isWin, stdio: 'inherit' });
  child.on('exit', (code) => {
    console.log(`[${name}] 退出，code=${code}`);
    shutdown();
  });
  procs.push(child);
  return child;
}

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  for (const p of procs) {
    try {
      p.kill();
    } catch {}
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

run('server', 'node', ['--watch', 'server/src/index.js'], root);
run('client', isWin ? 'npm.cmd' : 'npm', ['--prefix', 'client', 'run', 'dev'], root);
