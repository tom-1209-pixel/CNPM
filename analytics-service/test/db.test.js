import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPool } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { createStore } from '../src/store.js';

// Chạy trên DB thật: chỉ khi có DATABASE_URL (CI luôn có; máy dev xem CLAUDE.md, mục "Lệnh thường dùng").
const url = process.env.DATABASE_URL;
const skip = url ? false : 'cần DATABASE_URL trỏ tới DB analytics';

describe('DB analytics', { skip }, () => {
  let pool;
  before(async () => {
    pool = createPool(url);
    await migrate(pool);
  });
  after(() => pool?.end());

  // Mỗi test chạy trong một transaction rồi hủy: không để lại lượt giả trong DB.
  async function inTransaction(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await fn(client, createStore(client));
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }

  test('migrate chạy lại không làm gì thêm', async () => {
    assert.deepEqual(await migrate(pool), []);
  });

  test('ghi lượt, ping đổi ngôn ngữ và kéo dài thời gian; lượt không có thì ping trả false', () =>
    inTransaction(async (client, store) => {
      const id = randomUUID();
      await store.recordVisit(id, 'vi');
      await store.recordVisit(id, 'vi');
      await client.query("UPDATE visits SET started_at = now() - interval '10 minutes', last_seen_at = now() - interval '10 minutes' WHERE id = $1", [id]);
      assert.equal(await store.ping(id, 'en'), true);
      const { rows } = await client.query('SELECT lang, extract(epoch FROM last_seen_at - started_at) AS seconds FROM visits WHERE id = $1', [id]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].lang, 'en');
      assert.ok(Number(rows[0].seconds) >= 590);
      assert.equal(await store.ping(randomUUID()), false);
    }));

  test('thống kê: đang online, đã rời, danh sách lượt theo khoảng thời gian', () =>
    inTransaction(async (client, store) => {
      const before = await store.stats('30d');
      const add = async (lang, startedAgo, lastSeenAgo) => {
        const id = randomUUID();
        await client.query(
          `INSERT INTO visits (id, lang, started_at, last_seen_at)
           VALUES ($1, $2, now() - $3::interval, now() - $4::interval)`,
          [id, lang, startedAgo, lastSeenAgo],
        );
        return id;
      };
      const online = await add('vi', '5 minutes', '30 seconds'); // còn báo "còn mở"
      const left = await add('en', '20 minutes', '10 seconds'); // sẽ báo rời
      const silent = await add('en', '30 minutes', '10 minutes'); // im quá 2 phút: coi là đã rời
      await add('vi', '40 days', '40 days'); // ngoài 30 ngày
      assert.equal(await store.leave(left), true);
      const s = await store.stats('30d');

      assert.equal(s.online - before.online, 1);
      assert.equal(s.last30Days - before.last30Days, 3);
      assert.equal(typeof s.avgMinutes, 'number');
      // mới nhất trước, mỗi lượt có code 5 ký tự, thời điểm, cờ online
      // (lọc theo mã: DB máy dev có thể có lượt thật mới hơn)
      const codes = [online, left, silent].map((id) => id.slice(0, 5));
      const mine = s.visits.filter((v) => codes.includes(v.code));
      assert.deepEqual(mine.map((v) => v.lang), ['vi', 'en', 'en']);
      assert.equal(mine[0].code, online.slice(0, 5));
      assert.deepEqual(mine.map((v) => v.online), [true, false, false]);
      assert.ok(mine[0].startedAt instanceof Date && mine[0].lastSeenAt instanceof Date);
      // khoảng 1 giờ không có lượt 40 ngày trước; ping lại sau khi rời thì online trở lại
      assert.ok(!(await store.stats('1h')).visits.some((v) => v.startedAt < new Date(Date.now() - 3600e3)));
      await store.ping(left);
      assert.equal((await store.stats('1h')).online - before.online, 2);
    }));

  test('DB chặn id không phải UUID', () =>
    inTransaction(async (client) => {
      await assert.rejects(client.query("INSERT INTO visits (id, lang) VALUES ('abc', 'vi')"), /invalid input syntax for type uuid/);
    }));

  test('thống kê theo điểm và nhật ký thay đổi (trong transaction rồi hủy)', () =>
    inTransaction(async (client, store) => {
      const before = await store.stats('1h');
      const visit = randomUUID();
      await store.recordEvent(visit, 'poi-zz', 'open');
      await store.recordEvent(visit, 'poi-zz', 'open');
      await store.recordEvent(visit, 'poi-zz', 'play');
      const zz = (await store.stats('1h')).byPoi.find((p) => p.poiId === 'poi-zz');
      assert.deepEqual(zz, { poiId: 'poi-zz', opens: 2, plays: 1 });
      assert.ok(before.byPoi.every((p) => p.poiId !== 'poi-zz'));
      await assert.rejects(client.query("INSERT INTO poi_events (visit_id, poi_id, kind) VALUES ($1, 'x', 'xem')", [visit]), /check constraint/);
    }));

  test('nhật ký thay đổi: ghi rồi đọc, mới nhất trước', () =>
    inTransaction(async (client, store) => {
      await store.recordChange('Thêm điểm', 'poi-zz', 'bán kính 40 m');
      const last = await store.recordChange('Xóa điểm', 'poi-zz', '');
      const list = await store.listChanges();
      assert.equal(list[0].id, last.id);
      assert.equal(list[1].action, 'Thêm điểm');
      await store.checkDb();
    }));
});
