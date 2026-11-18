import { readdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createPool } from './db.js';

const dbDir = new URL('../db/', import.meta.url);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Chạy lần lượt các file db/*.sql chưa chạy (theo tên), mỗi file trong một transaction,
// rồi ghi tên file vào schema_migrations. Trả về danh sách file vừa chạy.
export async function migrate(pool) {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const { rows } = await pool.query('SELECT name FROM schema_migrations');
  const done = new Set(rows.map((r) => r.name));
  const applied = [];
  for (const name of readdirSync(dbDir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(name)) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(readFileSync(new URL(name, dbDir), 'utf8'));
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
      await client.query('COMMIT');
      applied.push(name);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`${name}: ${err.message}`);
    } finally {
      client.release();
    }
  }
  return applied;
}

// Lúc khởi động DB có thể chưa sẵn sàng (Neon đang ngủ, container DB đang bật) nên thử lại vài lần.
// Vẫn lỗi thì chỉ ghi log: service vẫn chạy và trả 500 cho tới khi DB dùng được.
export async function migrateOnStartup(pool, { attempts = 5, delayMs = 2000 } = {}) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const applied = await migrate(pool);
      console.log(applied.length ? `migrate: đã chạy ${applied.join(', ')}` : 'migrate: không có gì mới');
      return;
    } catch (err) {
      console.error(`migrate lần ${i}/${attempts}: ${err.message}`);
      if (i < attempts) await sleep(delayMs);
    }
  }
}

// npm run migrate
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pool = createPool();
  try {
    const applied = await migrate(pool);
    console.log(applied.length ? `Đã chạy: ${applied.join(', ')}` : 'Không có gì mới');
  } finally {
    await pool.end();
  }
}
