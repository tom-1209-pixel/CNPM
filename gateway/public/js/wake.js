// Đánh thức các service đang ngủ (Render gói Free ngủ sau ~15 phút): trình duyệt gọi thẳng /health của từng service,
// vì gateway gọi thì không đánh thức được (đã đo ngày 2026-10-23). Địa chỉ lấy từ GET /api/wake.
// mode 'no-cors': chỉ cần gửi được yêu cầu, không đọc kết quả. Lỗi thì bỏ qua.
export function wakeServices() {
  return fetch('/api/wake')
    .then((res) => res.json())
    .then(({ urls }) => Promise.all(urls.map((url) => fetch(url, { mode: 'no-cors', cache: 'no-store' }).catch(() => {}))))
    .catch(() => {});
}
