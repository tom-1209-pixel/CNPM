import { createHash, timingSafeEqual } from 'node:crypto';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Service bên dưới đang "ngủ" (Render gói Free) có thể báo lỗi ngay trong lúc thức dậy: thử lại cho tới khi
// hết thời gian chờ thay vì trả 502 ngay. Lỗi 4xx thì thử lại cũng vậy nên dừng luôn, và mang theo mã lỗi
// cùng nội dung lỗi của service (err.status, err.body) để trang quản lý hiện đúng lý do (ví dụ chồng bán kính).
// init: dùng cho POST/PUT/DELETE (method, headers, body). Trả về null khi phản hồi không có nội dung (201, 204).
export async function getJson(url, timeoutMs, retryDelayMs, init = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastProblem = 'chưa có phản hồi';
  for (;;) {
    let res = null;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(Math.max(deadline - Date.now(), 1)) });
    } catch (err) {
      // không kết nối được hoặc hết thời gian chờ
      lastProblem = err.cause?.code ?? err.name;
    }
    if (res?.ok) {
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    }
    if (res && res.status < 500) {
      const body = await res.json().catch(() => null);
      throw Object.assign(new Error(`${url} trả về ${res.status}`), { status: res.status, body });
    }
    if (res) lastProblem = `HTTP ${res.status}`;
    await res?.body?.cancel();
    if (Date.now() + retryDelayMs >= deadline) throw new Error(`${url} không phản hồi (lần thử cuối: ${lastProblem})`);
    await sleep(retryDelayMs);
  }
}

// So mật khẩu không để lộ độ dài hay vị trí ký tự sai qua thời gian phản hồi.
export const sameSecret = (a, b) => {
  const hash = (s) => createHash('sha256').update(String(s)).digest();
  return timingSafeEqual(hash(a), hash(b));
};
