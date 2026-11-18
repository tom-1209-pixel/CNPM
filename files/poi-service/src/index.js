import { createApp } from './app.js';
import { createPool } from './db.js';
import { migrateOnStartup } from './migrate.js';
import { createStore } from './store.js';

const port = process.env.PORT || 3001;
const pool = createPool();

// Mật khẩu trang quản lý (STATS_PASSWORD là tên cũ, vẫn nhận để không hỏng bản đang chạy).
const adminPassword = process.env.ADMIN_PASSWORD || process.env.STATS_PASSWORD || '';

createApp(createStore(pool), { adminPassword }).listen(port, () => console.log(`poi-service listening on ${port}`));
migrateOnStartup(pool);
