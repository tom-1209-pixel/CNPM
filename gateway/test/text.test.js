import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { splitSentences } from '../public/js/text.js';

test('chia theo dấu chấm, hỏi, than', () => {
  assert.deepEqual(splitSentences('Xin chào. Bạn khỏe không? Tuyệt vời!'), ['Xin chào.', 'Bạn khỏe không?', 'Tuyệt vời!']);
});

test('không cắt số thập phân', () => {
  assert.deepEqual(splitSentences('Cao 3.5 mét. Rộng 2 mét.'), ['Cao 3.5 mét.', 'Rộng 2 mét.']);
});

test('chia câu tiếng Trung không có khoảng trắng', () => {
  assert.deepEqual(splitSentences('你好。欢迎光临！'), ['你好。', '欢迎光临！']);
});

test('câu cuối không có dấu chấm vẫn giữ', () => {
  assert.deepEqual(splitSentences('Một câu. Câu cuối'), ['Một câu.', 'Câu cuối']);
});

test('chuỗi rỗng, khoảng trắng hoặc null trả []', () => {
  assert.deepEqual(splitSentences(''), []);
  assert.deepEqual(splitSentences('   '), []);
  assert.deepEqual(splitSentences(null), []);
});

test('nhiều dấu liền nhau và dấu ba chấm', () => {
  assert.deepEqual(splitSentences('Thật sao?! Đúng vậy… Tiếp nhé.'), ['Thật sao?!', 'Đúng vậy…', 'Tiếp nhé.']);
});

// Safari trước iOS 16.4 không hiểu regex lookbehind: một chỗ dùng là cả trang không chạy (đã gặp trên iPhone).
test('mã chạy trên trình duyệt không dùng regex lookbehind', () => {
  const dir = new URL('../public/js/', import.meta.url);
  for (const name of readdirSync(dir)) {
    const source = readFileSync(new URL(name, dir), 'utf8');
    assert.ok(!/\(\?<[=!]/.test(source), `${name} dùng (?<= hoặc (?<!`);
  }
});
