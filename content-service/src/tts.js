import { createHash } from 'node:crypto';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

// Giọng Microsoft Edge theo mã ngôn ngữ. Ngôn ngữ chưa có ở đây thì chưa tạo được âm thanh (điểm đó chỉ hiện chữ).
const VOICES = {
  vi: 'vi-VN-HoaiMyNeural',
  en: 'en-US-AriaNeural',
  zh: 'zh-CN-XiaoxiaoNeural',
  ko: 'ko-KR-SunHiNeural',
  ja: 'ja-JP-NanamiNeural',
  th: 'th-TH-PremwadeeNeural',
  ru: 'ru-RU-SvetlanaNeural',
  fr: 'fr-FR-DeniseNeural',
  de: 'de-DE-KatjaNeural',
  es: 'es-ES-ElviraNeural',
};

export const textHash = (text) => createHash('md5').update(text).digest('hex');

const escapeXml = (s) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);

// edge-tts là dịch vụ không chính thức. Đã đo (2026-11-18): gọi liền nhau thì lỗi "Stream closed before the synthesis completed"
// (cùng câu, nghỉ 1,5–4 giây rồi gọi lại thì chạy). Nên mọi lần gọi xếp hàng một, cách nhau tối thiểu MIN_GAP_MS;
// mỗi lần chờ tối đa 15 giây và thử lại tối đa ATTEMPTS lần rồi mới báo lỗi.
const ATTEMPTS = 3;
const MIN_GAP_MS = 2500;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let queue = Promise.resolve();
let lastEnd = 0;
function enqueue(task) {
  const run = queue.then(async () => {
    await sleep(Math.max(lastEnd + MIN_GAP_MS - Date.now(), 0));
    try {
      return await task();
    } finally {
      lastEnd = Date.now();
    }
  });
  queue = run.catch(() => {});
  return run;
}

async function synthesizeOnce(text, voice) {
  const tts = new MsEdgeTTS({ connectionTimeoutMs: 10000, synthesisTimeoutMs: 15000 });
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(escapeXml(text));
    const chunks = [];
    for await (const chunk of audioStream) chunks.push(chunk);
    const mp3 = Buffer.concat(chunks);
    if (mp3.length === 0) throw new Error('Dịch vụ giọng đọc không trả âm thanh');
    return mp3;
  } finally {
    tts.close();
  }
}

// synthesize(text, lang) trả Buffer mp3, hoặc ném lỗi (mạng, bị chặn, ngôn ngữ chưa có giọng).
export function createTts() {
  return {
    hasVoice: (lang) => lang in VOICES,
    async synthesize(text, lang) {
      if (!(lang in VOICES)) throw new Error(`Chưa có giọng đọc cho ngôn ngữ ${lang}`);
      let lastError;
      for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
        try {
          return await enqueue(() => synthesizeOnce(text, VOICES[lang]));
        } catch (err) {
          lastError = err;
          console.error(`edge-tts lần ${attempt}/${ATTEMPTS} (${lang}): ${err.message}`);
        }
      }
      throw lastError;
    },
  };
}
