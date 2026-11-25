import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPool } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { createStore } from '../src/store.js';
import { textHash } from '../src/tts.js';

// Chạy trên DB thật: chỉ khi có DATABASE_URL (CI luôn có; máy dev xem CLAUDE.md, mục "Lệnh thường dùng").
const url = process.env.DATABASE_URL;
const skip = url ? false : 'cần DATABASE_URL trỏ tới DB content';

describe('DB content', { skip }, () => {
  let pool;
  let store;
  before(async () => {
    pool = createPool(url);
    await migrate(pool);
    store = createStore(pool);
  });
  after(() => pool?.end());

  // Mỗi câu lệnh sai phải bị DB từ chối; chạy trong transaction rồi hủy để không đổi dữ liệu.
  async function assertRejected(sql, params, pattern) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await assert.rejects(client.query(sql, params), pattern);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }

  test('migrate chạy lại không làm gì thêm', async () => {
    assert.deepEqual(await migrate(pool), []);
  });

  test('có tiếng Việt, tiếng Việt đứng đầu, mỗi ngôn ngữ có code và name', async () => {
    const languages = await store.listLanguages();
    assert.equal(languages[0]?.code, 'vi');
    for (const l of languages) {
      assert.equal(typeof l.code, 'string');
      assert.equal(typeof l.name, 'string');
    }
  });

  test('nội dung trả về đúng dạng { poiId, lang, title, text }', async () => {
    const vi = await store.listContent('vi');
    assert.ok(vi.length > 0);
    for (const item of vi) assert.deepEqual(Object.keys(item), ['poiId', 'lang', 'title', 'text', 'audio']);
    assert.deepEqual(await store.listContent('xx'), []);
  });

  test('DB chặn trùng (poi_id, lang) và ngôn ngữ chưa khai báo', async () => {
    const [first] = await store.listContent('vi');
    await assertRejected('INSERT INTO contents VALUES ($1, $2, $3, $4)', [first.poiId, 'vi', 'x', 'x'], /duplicate key/);
    await assertRejected('INSERT INTO contents VALUES ($1, $2, $3, $4)', ['poi-test', 'xx', 'x', 'x'], /foreign key/);
  });

  test('ngôn ngữ: thêm, ẩn; nội dung: ghi đè, xóa (trong transaction rồi hủy)', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const s = createStore(client);
      assert.deepEqual(await s.addLanguage('zz', 'Thử'), { code: 'zz', name: 'Thử', hidden: false });
      assert.equal(await s.addLanguage('zz', 'Trùng'), null);
      assert.ok((await s.listLanguages()).some((l) => l.code === 'zz'));
      await s.updateLanguage('zz', { name: 'Thử 2', hidden: true });
      assert.ok(!(await s.listLanguages()).some((l) => l.code === 'zz'), 'ngôn ngữ ẩn không hiện cho du khách');
      assert.equal((await s.listAllLanguages()).find((l) => l.code === 'zz').name, 'Thử 2');
      await s.saveContent('poi-test', 'zz', 'A', 'B');
      assert.deepEqual(await s.saveContent('poi-test', 'zz', 'A2', 'B2'), { poiId: 'poi-test', lang: 'zz', title: 'A2', text: 'B2' });
      assert.equal((await s.listContent('zz')).length, 1);
      assert.equal((await s.listContent('zz'))[0].audio, false);
      assert.equal(await s.getAudio('poi-test', 'zz'), null);
      assert.ok((await s.listMissingAudio()).some((c) => c.poiId === 'poi-test'));
      await s.saveAudio('poi-test', 'zz', textHash('B2'), Buffer.from('mp3'));
      assert.equal((await s.listContent('zz'))[0].audio, true);
      assert.equal((await s.getAudio('poi-test', 'zz')).mp3.toString(), 'mp3');
      await s.saveContent('poi-test', 'zz', 'A2', 'B3');
      assert.equal(await s.getAudio('poi-test', 'zz'), null, 'sửa chữ thì file cũ không còn khớp');
      assert.equal((await s.listContent('zz'))[0].audio, false);
      assert.equal(await s.removeContent('poi-test'), 1);
      assert.equal((await client.query('SELECT count(*) FROM audios WHERE poi_id = $1', ['poi-test'])).rows[0].count, '0', 'xóa nội dung xóa luôn mp3');
      await s.checkDb();
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
