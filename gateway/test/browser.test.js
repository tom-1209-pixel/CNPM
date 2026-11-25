import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

// Safari trước iOS 16.4 không hiểu regex lookbehind: một chỗ dùng là cả trang không chạy (đã gặp trên iPhone).
test('mã chạy trên trình duyệt không dùng regex lookbehind', () => {
  const dir = new URL('../public/js/', import.meta.url);
  for (const name of readdirSync(dir)) {
    const source = readFileSync(new URL(name, dir), 'utf8');
    assert.ok(!/\(\?<[=!]/.test(source), `${name} dùng (?<= hoặc (?<!`);
  }
});
