/**
 * 重置数据库（会清空全部动态 / 评论 / 用户，请谨慎执行）
 * 用法：npm run reset
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '..', 'data');
const targets = ['pyq.db', 'pyq.db-wal', 'pyq.db-shm'].map((f) => path.join(dataDir, f));

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('这会删除 data/pyq.db 中的全部数据，输入 yes 继续：', async (answer) => {
  rl.close();
  if (answer.trim().toLowerCase() !== 'yes') {
    console.log('已取消。');
    return;
  }
  for (const f of targets) {
    if (fs.existsSync(f)) {
      fs.rmSync(f);
      console.log('已删除', path.basename(f));
    }
  }
  const { seedIfEmpty } = await import('./seed.js');
  seedIfEmpty();
  console.log('数据库已重建。');
});
