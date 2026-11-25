import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { textHash } from '../src/tts.js';

// Store giả trong bộ nhớ: test API không cần DB (DB có test riêng ở db.test.js).
const PASSWORD = 'quanly';
let content;
let languages;
const fakeStore = {
  listLanguages: async () => languages.filter((l) => !l.hidden).map(({ code, name }) => ({ code, name })),
  listAllLanguages: async () => languages.map((l) => ({ ...l })),
  addLanguage: async (code, name) => {
    if (languages.some((l) => l.code === code)) return null;
    languages.push({ code, name, hidden: false });
    return { code, name, hidden: false };
  },
  updateLanguage: async (code, l) => Object.assign(languages.find((x) => x.code === code), l),
  listContent: async (lang) => content.filter((item) => item.lang === lang),
  listAllContent: async () => content,
  saveContent: async (poiId, lang, title, text) => {
    content = content.filter((c) => !(c.poiId === poiId && c.lang === lang));
    content.push({ poiId, lang, title, text });
    return { poiId, lang, title, text };
  },
  removeContent: async (poiId, lang) => {
    const before = content.length;
    content = content.filter((c) => !(c.poiId === poiId && (!lang || c.lang === lang)));
    return before - content.length;
  },
  getContent: async (poiId, lang) => content.find((c) => c.poiId === poiId && c.lang === lang) ?? null,
  saveAudio: async (poiId, lang, hash, mp3) => {
    audios.set(`${poiId}/${lang}`, { textHash: hash, mp3 });
  },
  getAudio: async (poiId, lang) => {
    const item = content.find((c) => c.poiId === poiId && c.lang === lang);
    const audio = audios.get(`${poiId}/${lang}`);
    return item && audio && audio.textHash === textHash(item.text) ? audio : null;
  },
  listMissingAudio: async () => content.filter((c) => audios.get(`${c.poiId}/${c.lang}`)?.textHash !== textHash(c.text)),
  checkDb: async () => {},
};
// Dịch vụ giọng đọc giả: không gọi mạng. ttsFails = true thì mọi lần tạo đều lỗi.
let audios;
let ttsFails;
const fakeTts = {
  hasVoice: (lang) => lang !== 'xx',
  synthesize: async (text, lang) => {
    if (ttsFails) throw new Error('edge-tts bị chặn');
    return Buffer.from(`mp3:${lang}:${text}`);
  },
};
const servers = [];
const listen = (store, options) => {
  const server = createApp(store, options).listen(0);
  servers.push(server);
  return `http://localhost:${server.address().port}`;
};
const send = (base, method, path, body, password = PASSWORD) =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(password && { 'X-Admin-Password': password }) },
    body: body && JSON.stringify(body),
  });

let base;
let ttsBase;
before(() => {
  base = listen(fakeStore, { adminPassword: PASSWORD });
  ttsBase = listen(fakeStore, { adminPassword: PASSWORD, tts: fakeTts });
});
beforeEach(() => {
  audios = new Map();
  ttsFails = false;
  content = [
    { poiId: 'poi-1', lang: 'vi', title: 'Điểm 1', text: 'Nội dung.' },
    { poiId: 'poi-1', lang: 'en', title: 'Stop 1', text: 'Content.' },
    { poiId: 'poi-2', lang: 'vi', title: 'Điểm 2', text: 'Nội dung.' },
  ];
  languages = [
    { code: 'vi', name: 'Tiếng Việt', hidden: false },
    { code: 'en', name: 'English', hidden: false },
  ];
});
after(() => servers.forEach((s) => s.close()));

test('GET /health trả status ok; ?db=1 cho biết DB đọc được không', async () => {
  assert.deepEqual(await (await fetch(`${base}/health`)).json(), { status: 'ok' });
  assert.deepEqual(await (await fetch(`${base}/health?db=1`)).json(), { status: 'ok', db: 'ok' });
});

test('GET /languages trả ngôn ngữ không ẩn; ?all=1 cần mật khẩu, trả cả ngôn ngữ ẩn', async () => {
  languages[1].hidden = true;
  assert.deepEqual(await (await fetch(`${base}/languages`)).json(), [{ code: 'vi', name: 'Tiếng Việt' }]);
  assert.equal((await fetch(`${base}/languages?all=1`)).status, 401);
  assert.equal((await (await send(base, 'GET', '/languages?all=1')).json()).length, 2);
});

test('GET /content?lang=vi chỉ trả nội dung tiếng Việt', async () => {
  const body = await (await fetch(`${base}/content?lang=vi`)).json();
  assert.equal(body.length, 2);
  assert.ok(body.every((item) => item.lang === 'vi'));
});

test('lang không có dữ liệu hoặc thiếu lang thì trả []', async () => {
  for (const q of ['?lang=xx', '']) {
    const res = await fetch(`${base}/content${q}`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), []);
  }
});

test('đường sửa dữ liệu: thiếu hoặc sai mật khẩu thì 401, service chưa đặt mật khẩu thì 503', async () => {
  assert.equal((await send(base, 'POST', '/languages', { code: 'zh', name: '中文' }, '')).status, 401);
  assert.equal((await send(base, 'GET', '/content/all', null, 'sai')).status, 401);
  assert.equal((await send(listen(fakeStore), 'PUT', '/content/poi-1/vi', { title: 'x', text: 'y' })).status, 503);
});

test('POST /languages thêm ngôn ngữ; mã sai thì 400; trùng thì 409', async () => {
  const res = await send(base, 'POST', '/languages', { code: 'zh', name: '中文' });
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { code: 'zh', name: '中文', hidden: false });
  assert.equal((await send(base, 'POST', '/languages', { code: 'Trung Quốc', name: 'x' })).status, 400);
  assert.equal((await send(base, 'POST', '/languages', { code: 'en', name: 'English' })).status, 409);
});

test('PUT /languages/:code đổi tên, ẩn; không ẩn được Tiếng Việt; không có thì 404', async () => {
  const res = await send(base, 'PUT', '/languages/en', { name: 'Tiếng Anh', hidden: true });
  assert.deepEqual(await res.json(), { code: 'en', name: 'Tiếng Anh', hidden: true });
  assert.equal((await send(base, 'PUT', '/languages/vi', { hidden: true })).status, 400);
  assert.equal((await send(base, 'PUT', '/languages/ko', { name: 'x' })).status, 404);
});

test('PUT /content/:poiId/:lang ghi đè hoặc thêm nội dung; thiếu tên hay ngôn ngữ chưa có thì 400', async () => {
  const res = await send(base, 'PUT', '/content/poi-2/en', { title: 'Stop 2', text: 'Content 2.' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { poiId: 'poi-2', lang: 'en', title: 'Stop 2', text: 'Content 2.' });
  assert.equal(content.length, 4);
  assert.equal((await send(base, 'PUT', '/content/poi-2/en', { title: '', text: 'x' })).status, 400);
  assert.equal((await send(base, 'PUT', '/content/poi-2/ko', { title: 'x', text: 'y' })).status, 400);
});

test('DELETE nội dung: một ngôn ngữ (không xóa riêng bản vi) hoặc cả điểm', async () => {
  assert.equal((await send(base, 'DELETE', '/content/poi-1/en')).status, 204);
  assert.equal((await send(base, 'DELETE', '/content/poi-1/vi')).status, 400);
  assert.equal((await send(base, 'DELETE', '/content/poi-1')).status, 204);
  assert.deepEqual(content.map((c) => c.poiId), ['poi-2']);
});

test('GET /content/all trả nội dung mọi điểm, mọi ngôn ngữ', async () => {
  assert.equal((await (await send(base, 'GET', '/content/all')).json()).length, 3);
});

test('DB lỗi thì /languages và /content trả 500, /health vẫn ok', async () => {
  const fail = async () => {
    throw new Error('DB không kết nối được');
  };
  const broken = listen({ listLanguages: fail, listContent: fail });
  for (const path of ['/languages', '/content?lang=vi']) {
    const res = await fetch(`${broken}${path}`);
    assert.equal(res.status, 500);
    assert.equal(typeof (await res.json()).error, 'string');
  }
  assert.equal((await fetch(`${broken}/health`)).status, 200);
});

test('PUT /content có tts: lưu chữ rồi tạo mp3; GET .../audio trả file; sửa chữ mà chưa tạo lại thì 404', async () => {
  const res = await send(ttsBase, 'PUT', '/content/poi-2/en', { title: 'Stop 2', text: 'Content 2.' });
  assert.deepEqual(await res.json(), { poiId: 'poi-2', lang: 'en', title: 'Stop 2', text: 'Content 2.', audio: true });
  const audio = await fetch(`${ttsBase}/content/poi-2/en/audio`);
  assert.equal(audio.status, 200);
  assert.equal(audio.headers.get('content-type'), 'audio/mpeg');
  assert.equal(Buffer.from(await audio.arrayBuffer()).toString(), 'mp3:en:Content 2.');
  assert.equal((await fetch(`${ttsBase}/content/poi-2/en/audio`, { headers: { 'If-None-Match': audio.headers.get('etag') } })).status, 304);
  ttsFails = true;
  await send(ttsBase, 'PUT', '/content/poi-2/en', { title: 'Stop 2', text: 'Đã sửa.' });
  assert.equal((await fetch(`${ttsBase}/content/poi-2/en/audio`)).status, 404, 'file cũ không còn khớp chữ');
});

test('PUT /content chỉ đổi tên (nội dung giữ nguyên) thì giữ mp3 cũ, không gọi edge-tts', async () => {
  await send(ttsBase, 'PUT', '/content/poi-2/en', { title: 'Stop 2', text: 'Content 2.' });
  ttsFails = true; // nếu còn gọi edge-tts thì sẽ báo audioError
  const body = await (await send(ttsBase, 'PUT', '/content/poi-2/en', { title: 'Tên mới', text: 'Content 2.' })).json();
  assert.equal(body.title, 'Tên mới');
  assert.equal(body.audio, true);
  assert.equal(body.audioError, undefined);
});

test('PUT /content: tạo mp3 lỗi vẫn lưu chữ và báo audioError', async () => {
  ttsFails = true;
  const res = await send(ttsBase, 'PUT', '/content/poi-2/en', { title: 'Stop 2', text: 'Content 2.' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.audio, false);
  assert.match(body.audioError, /bị chặn/);
  assert.ok(content.some((c) => c.poiId === 'poi-2' && c.lang === 'en'), 'chữ đã được lưu');
});

test('PUT /content không có tts thì giữ nguyên dạng cũ (không có trường audio)', async () => {
  const body = await (await send(base, 'PUT', '/content/poi-2/en', { title: 'Stop 2', text: 'Content 2.' })).json();
  assert.deepEqual(Object.keys(body), ['poiId', 'lang', 'title', 'text']);
});

test('GET .../audio không cần mật khẩu; chưa có thì 404', async () => {
  assert.equal((await fetch(`${ttsBase}/content/poi-1/vi/audio`)).status, 404);
});

test('POST .../audio tạo lại một nội dung; không có thì 404; tts lỗi thì 502; cần mật khẩu', async () => {
  assert.equal((await send(ttsBase, 'POST', '/content/poi-1/vi/audio', undefined, '')).status, 401);
  assert.equal((await send(ttsBase, 'POST', '/content/poi-9/vi/audio')).status, 404);
  assert.equal((await send(ttsBase, 'POST', '/content/poi-1/vi/audio')).status, 200);
  assert.equal((await fetch(`${ttsBase}/content/poi-1/vi/audio`)).status, 200);
  ttsFails = true;
  assert.equal((await send(ttsBase, 'POST', '/content/poi-2/vi/audio')).status, 502);
  assert.equal((await send(base, 'POST', '/content/poi-1/vi/audio')).status, 503, 'chưa bật tts');
});

test('POST /content/audio/rebuild chỉ tạo phần còn thiếu; ngôn ngữ chưa có giọng thì báo, không dừng', async () => {
  content.push({ poiId: 'poi-3', lang: 'xx', title: 'x', text: 'y' });
  await send(ttsBase, 'POST', '/content/poi-1/vi/audio');
  const body = await (await send(ttsBase, 'POST', '/content/audio/rebuild')).json();
  assert.deepEqual(body.created, ['poi-1/en', 'poi-2/vi']);
  assert.deepEqual(body.failed.map((f) => f.id), ['poi-3/xx']);
  assert.deepEqual((await (await send(ttsBase, 'POST', '/content/audio/rebuild')).json()).created, []);
});
