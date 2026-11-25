import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

// Kiểm tra chéo dữ liệu của 2 service. Hai DB tách riêng nên không có khóa ngoại giữa chúng: test này thay cho khóa ngoại.
// Chỉ chạy khi có địa chỉ cả 2 DB (CI luôn có; máy dev xem CLAUDE.md, mục "Lệnh thường dùng").
const poiUrl = process.env.POI_DATABASE_URL;
const contentUrl = process.env.CONTENT_DATABASE_URL;
const skip = poiUrl && contentUrl ? false : 'cần POI_DATABASE_URL và CONTENT_DATABASE_URL';

describe('dữ liệu 2 DB khớp nhau', { skip }, () => {
  let pois;
  let content;
  before(async () => {
    const read = async (connectionString, sql) => {
      const client = new pg.Client({ connectionString });
      await client.connect();
      try {
        return (await client.query(sql)).rows;
      } finally {
        await client.end();
      }
    };
    pois = await read(poiUrl, 'SELECT id FROM pois');
    content = await read(contentUrl, 'SELECT poi_id AS "poiId", lang FROM contents');
  });

  test('mọi POI đều có nội dung tiếng Việt', () => {
    for (const poi of pois) {
      assert.ok(content.some((c) => c.poiId === poi.id && c.lang === 'vi'), `${poi.id} thiếu nội dung vi`);
    }
  });

  test('mọi nội dung đều trỏ tới POI có thật', () => {
    const ids = new Set(pois.map((p) => p.id));
    for (const c of content) assert.ok(ids.has(c.poiId), `nội dung trỏ tới ${c.poiId} không tồn tại`);
  });
});
