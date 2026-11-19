// Hàm thuần về giọng đọc (không đụng tới trình duyệt) để test được bằng node:test.

// Một số máy Android ghi "vi_VN" thay cho "vi-VN".
export function matchesLang(voiceLang, lang) {
  const v = String(voiceLang).toLowerCase().replace('_', '-');
  const l = lang.toLowerCase();
  return v === l || v.startsWith(`${l}-`);
}

// 'unsupported': trình duyệt không có giọng đọc (voices = null).
// 'unknown': danh sách giọng trống. Nhiều máy Android nạp danh sách chậm hoặc để trống mà vẫn đọc được,
//            nên chưa kết luận là thiếu giọng.
// 'ok' / 'missing': có / không có giọng cho ngôn ngữ này.
export function voiceSupport(voices, lang) {
  if (voices === null) return 'unsupported';
  if (voices.length === 0) return 'unknown';
  return voices.some((v) => matchesLang(v.lang, lang)) ? 'ok' : 'missing';
}

// Lỗi khi đọc cho biết máy không đọc được ngôn ngữ này (khác lỗi do chính trang hủy giữa chừng).
export const NO_VOICE_ERRORS = new Set(['language-unavailable', 'voice-unavailable', 'synthesis-unavailable']);

// Mã đầy đủ để gán cho utterance.lang khi chưa tìm được giọng trong danh sách (Safari cũ hay trả danh sách rỗng).
// Chỉ có "vi" thì iPhone có thể đọc bằng giọng mặc định của máy (đã gặp: đọc tiếng Việt bằng giọng tiếng Trung).
// Mã không có trong bảng thì giữ nguyên: thêm ngôn ngữ vẫn không phải sửa mã.
const SPEECH_LOCALES = { vi: 'vi-VN', en: 'en-US', zh: 'zh-CN', ko: 'ko-KR', ja: 'ja-JP', th: 'th-TH', ru: 'ru-RU', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };
export function speechLang(lang) {
  return SPEECH_LOCALES[lang] ?? lang;
}

// Máy Apple (Safari, và mọi trình duyệt trên iPhone vì cùng dùng WebKit) liệt kê đủ giọng của máy:
// thiếu ngôn ngữ trong danh sách là thiếu thật, và Safari không báo lỗi mà đọc bằng giọng khác
// (đã gặp: iPhone không có giọng Tiếng Việt đọc bằng giọng tiếng Trung). Android thì không tin danh sách (xem trên).
export function voiceListIsComplete(vendor) {
  return String(vendor ?? '').startsWith('Apple');
}

// Có chuyển ngay sang "Đọc" không, theo kết quả voiceSupport.
export function shouldSwitchToRead(status, listIsComplete) {
  return status === 'unsupported' || (status === 'missing' && listIsComplete);
}

// Chọn giọng cho ngôn ngữ: máy có nhiều giọng thì ưu tiên giọng tự nhiên (Edge: "… Online (Natural)",
// Google), vì giọng đầu danh sách có thể là giọng máy cũ (ví dụ "Microsoft An"). Không có giọng nào thì null.
export function pickVoice(voices, lang) {
  const score = (v) => (/natural|neural|online/i.test(v.name) ? 2 : /google/i.test(v.name) ? 1 : 0);
  return (voices ?? []).filter((v) => matchesLang(v.lang, lang)).sort((a, b) => score(b) - score(a))[0] ?? null;
}
