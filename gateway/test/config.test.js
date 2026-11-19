import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../src/config.js';

test('mặc định cho chạy cục bộ', () => {
  assert.deepEqual(readConfig({}), {
    port: 3000,
    poiServiceUrl: 'http://localhost:3001',
    contentServiceUrl: 'http://localhost:3002',
    analyticsServiceUrl: 'http://localhost:3003',
    adminPassword: '',
    timeoutMs: 3000,
  });
});

test('địa chỉ dạng host:port (Render) được thêm http://', () => {
  const config = readConfig({ POI_SERVICE_URL: 'poi-service:10000', CONTENT_SERVICE_URL: 'content-service:10000' });
  assert.equal(config.poiServiceUrl, 'http://poi-service:10000');
  assert.equal(config.contentServiceUrl, 'http://content-service:10000');
});

test('địa chỉ đã có http:// hoặc https:// giữ nguyên', () => {
  const config = readConfig({ POI_SERVICE_URL: 'http://poi-service:3001', CONTENT_SERVICE_URL: 'https://example.com' });
  assert.equal(config.poiServiceUrl, 'http://poi-service:3001');
  assert.equal(config.contentServiceUrl, 'https://example.com');
});

test('UPSTREAM_TIMEOUT_MS hợp lệ thì dùng, không hợp lệ thì về 3000', () => {
  assert.equal(readConfig({ UPSTREAM_TIMEOUT_MS: '25000' }).timeoutMs, 25000);
  assert.equal(readConfig({ UPSTREAM_TIMEOUT_MS: 'abc' }).timeoutMs, 3000);
  assert.equal(readConfig({ UPSTREAM_TIMEOUT_MS: '0' }).timeoutMs, 3000);
});
