// Chia văn bản thành từng câu để đọc lần lượt. Dấu chấm kiểu Latin chỉ ngắt khi theo sau là khoảng trắng
// (không cắt "3.5"); dấu câu CJK ngắt ngay vì không có khoảng trắng.
// Không dùng regex lookbehind: Safari trước iOS 16.4 báo lỗi cú pháp và cả trang không chạy.
export function splitSentences(text) {
  return String(text ?? '')
    .replace(/([.!?…])\s+/g, '$1\n')
    .replace(/([。！？])/g, '$1\n')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}
