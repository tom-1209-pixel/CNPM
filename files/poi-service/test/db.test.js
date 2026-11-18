import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPool } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { createStore } from '../src/store.js';
import { distanceMeters } from '../src/geo.js';

// Chạy trên DB thật: chỉ khi có DATABASE_URL (CI luôn có; máy dev xem README.md, mục "Chạy kiểm thử").
const url = process.env.DATABASE_URL;
const skip = url ? false : 'cần DATABASE_URL trỏ tới DB poi';

describe('DB poi', { skip }, () => {
  let pool;
  let pois;
  before(async () => {
    pool = createPool(url);
    await migrate(pool);
    pois = await createStore(pool).listPois();
  });
  after(() => pool?.end());

  test('migrate chạy lại không làm gì thêm', async () => {
    assert.deepEqual(await migrate(pool), []);
  });

  test('có dữ liệu, mỗi POI có đủ id, lat, lng, radius là số', () => {
    assert.ok(pois.length > 0);
    for (const p of pois) {
      assert.equal(typeof p.id, 'string');
      assert.ok(Number.isFinite(p.lat) && Number.isFinite(p.lng) && Number.isFinite(p.radius));
    }
  });

  test('không có hai POI chồng bán kính', () => {
    for (let i = 0; i < pois.length; i++) {
      for (let j = i + 1; j < pois.length; j++) {
        const d = distanceMeters(pois[i], pois[j]);
        const sum = pois[i].radius + pois[j].radius;
        assert.ok(d > sum, `${pois[i].id} và ${pois[j].id} cách ${d.toFixed(1)} m, tổng bán kính ${sum} m`);
      }
    }
  });

  test('DB chặn bán kính âm và id trùng', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await assert.rejects(client.query("INSERT INTO pois VALUES ('poi-test', 10, 106, -1)"), /check constraint/);
      await client.query('ROLLBACK');
      await client.query('BEGIN');
      await assert.rejects(client.query('INSERT INTO pois VALUES ($1, 10, 106, 30)', [pois[0].id]), /duplicate key/);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  test('thêm, sửa, ẩn, dời, xóa điểm (trong transaction rồi hủy)', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const store = createStore(client);
      const before = await store.listAll();
      const created = await store.create({ lat: 11, lng: 107, radius: 40 });
      const maxNumber = Math.max(0, ...before.map((p) => Number(/^poi-(\d+)$/.exec(p.id)?.[1] ?? 0)));
      assert.equal(created.id, `poi-${maxNumber + 1}`);
      assert.equal(created.hidden, false);
      const hidden = await store.update(created.id, { lat: 11, lng: 107, radius: 50, hidden: true });
      assert.equal(hidden.radius, 50);
      assert.ok(!(await store.listPois()).some((p) => p.id === created.id), 'điểm ẩn không có trong danh sách du khách');
      assert.ok((await store.listAll()).some((p) => p.id === created.id));
      const moved = await store.moveAll([{ id: created.id, lat: 11.001, lng: 106.998 }]);
      assert.deepEqual(moved.map((p) => [p.id, p.lat, p.lng]), [[created.id, 11.001, 106.998]]);
      assert.equal(await store.remove(created.id), true);
      assert.equal(await store.remove(created.id), false);
      await store.checkDb();
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
