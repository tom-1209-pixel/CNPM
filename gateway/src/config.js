// Render (fromService ... property: hostport) chỉ cho "host:port", không có "http://".
const withScheme = (url) => (/^https?:\/\//.test(url) ? url : `http://${url}`);

export function readConfig(env) {
  const timeoutMs = Number(env.UPSTREAM_TIMEOUT_MS);
  return {
    port: env.PORT || 3000,
    poiServiceUrl: withScheme(env.POI_SERVICE_URL || 'http://localhost:3001'),
    contentServiceUrl: withScheme(env.CONTENT_SERVICE_URL || 'http://localhost:3002'),
    analyticsServiceUrl: withScheme(env.ANALYTICS_SERVICE_URL || 'http://localhost:3003'),
    // Mật khẩu trang quản lý (gộp cả thống kê); STATS_PASSWORD là tên cũ, vẫn nhận. Để trống thì /api/admin/* trả 503
    adminPassword: env.ADMIN_PASSWORD || env.STATS_PASSWORD || '',
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 3000,
  };
}
