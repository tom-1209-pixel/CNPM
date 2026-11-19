import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesLang, voiceSupport, NO_VOICE_ERRORS, speechLang, voiceListIsComplete, shouldSwitchToRead, pickVoice } from '../public/js/voices.js';

test('matchesLang: nhận cả vi-VN, vi_VN, chữ hoa, và đúng mã', () => {
  assert.equal(matchesLang('vi-VN', 'vi'), true);
  assert.equal(matchesLang('vi_VN', 'vi'), true);
  assert.equal(matchesLang('VI-vn', 'vi'), true);
  assert.equal(matchesLang('vi', 'vi'), true);
});

test('matchesLang: không nhầm ngôn ngữ khác', () => {
  assert.equal(matchesLang('en-US', 'vi'), false);
  assert.equal(matchesLang('vie', 'vi'), false);
});

test('voiceSupport: trình duyệt không có giọng đọc', () => {
  assert.equal(voiceSupport(null, 'vi'), 'unsupported');
});

test('voiceSupport: danh sách trống thì chưa kết luận', () => {
  assert.equal(voiceSupport([], 'vi'), 'unknown');
});

test('voiceSupport: có danh sách nhưng thiếu ngôn ngữ đang chọn', () => {
  assert.equal(voiceSupport([{ lang: 'en-US' }, { lang: 'fr-FR' }], 'vi'), 'missing');
});

test('voiceSupport: có giọng cho ngôn ngữ đang chọn', () => {
  assert.equal(voiceSupport([{ lang: 'en-US' }, { lang: 'vi-VN' }], 'vi'), 'ok');
  assert.equal(voiceSupport([{ lang: 'vi_VN' }], 'vi'), 'ok');
});

test('NO_VOICE_ERRORS: chỉ gồm lỗi thiếu giọng, không gồm lỗi do tự hủy', () => {
  assert.equal(NO_VOICE_ERRORS.has('language-unavailable'), true);
  assert.equal(NO_VOICE_ERRORS.has('interrupted'), false);
  assert.equal(NO_VOICE_ERRORS.has('canceled'), false);
});

test('speechLang: mã ngắn đổi sang mã đầy đủ, mã lạ giữ nguyên', () => {
  assert.equal(speechLang('vi'), 'vi-VN');
  assert.equal(speechLang('en'), 'en-US');
  assert.equal(speechLang('xx'), 'xx');
});

test('voiceListIsComplete: chỉ tin danh sách giọng của máy Apple', () => {
  assert.equal(voiceListIsComplete('Apple Computer, Inc.'), true);
  assert.equal(voiceListIsComplete('Google Inc.'), false);
  assert.equal(voiceListIsComplete(''), false);
  assert.equal(voiceListIsComplete(undefined), false);
});

test('shouldSwitchToRead: thiếu giọng chỉ chuyển ngay khi tin được danh sách', () => {
  assert.equal(shouldSwitchToRead('unsupported', false), true);
  assert.equal(shouldSwitchToRead('missing', true), true);
  assert.equal(shouldSwitchToRead('missing', false), false);
  assert.equal(shouldSwitchToRead('unknown', true), false);
  assert.equal(shouldSwitchToRead('ok', true), false);
});

test('pickVoice: ưu tiên giọng tự nhiên, không có giọng thì null', () => {
  const voices = [
    { name: 'Microsoft Zira - English', lang: 'en-US' },
    { name: 'Microsoft An - Vietnamese (Vietnam)', lang: 'vi-VN' },
    { name: 'Microsoft HoaiMy Online (Natural) - Vietnamese (Vietnam)', lang: 'vi-VN' },
  ];
  assert.equal(pickVoice(voices, 'vi').name, 'Microsoft HoaiMy Online (Natural) - Vietnamese (Vietnam)');
  assert.equal(pickVoice([{ name: 'vi-vn-x-gft-local', lang: 'vi_VN' }], 'vi').name, 'vi-vn-x-gft-local');
  assert.equal(pickVoice(voices, 'ja'), null);
  assert.equal(pickVoice([], 'vi'), null);
});
