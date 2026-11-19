import { voiceSupport, speechLang, pickVoice } from './voices.js';

const synth = 'speechSynthesis' in window && window.speechSynthesis ? window.speechSynthesis : null;

// 'unsupported' | 'unknown' | 'ok' | 'missing' (xem voices.js).
export function voiceStatus(lang) {
  return voiceSupport(synth ? synth.getVoices() : null, lang);
}

// Mã ngôn ngữ của các giọng máy đang có (null nếu trình duyệt không có giọng đọc). Dùng cho dòng chẩn đoán ở ?sim=1.
export function voiceList() {
  return synth ? synth.getVoices().map((v) => v.lang) : null;
}

// Tên giọng sẽ dùng cho ngôn ngữ này (null nếu danh sách không có): cho dòng chẩn đoán ở ?sim=1.
export function voiceName(lang) {
  return synth ? pickVoice(synth.getVoices(), lang)?.name ?? null : null;
}

// Safari cũ: speechSynthesis không có addEventListener (gọi là lỗi, cả trang dừng). Khi đó dùng onvoiceschanged.
const voiceListeners = new Set();
if (synth && typeof synth.addEventListener === 'function') {
  synth.addEventListener('voiceschanged', () => voiceListeners.forEach((cb) => cb()));
} else if (synth) {
  synth.onvoiceschanged = () => voiceListeners.forEach((cb) => cb());
}

// Danh sách giọng nạp bất đồng bộ: đợi voiceschanged, tối đa 4 giây (Android thường chậm).
export function voicesReady() {
  if (!synth || synth.getVoices().length > 0) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      voiceListeners.delete(done);
      resolve();
    };
    voiceListeners.add(done);
    setTimeout(done, 4000);
  });
}

// Danh sách giọng có thể về muộn hơn cả thời gian chờ ở trên: báo lại mỗi lần nó thay đổi.
export function onVoicesChanged(callback) {
  voiceListeners.add(callback);
}

// iPhone chặn âm thanh tự phát nếu chưa có lần chạm nào: đọc một câu rỗng trong lúc bấm nút.
export function unlockSpeech() {
  if (synth) synth.speak(new SpeechSynthesisUtterance(''));
}

// Đọc lần lượt từng câu. state: 'idle' | 'playing' | 'paused'.
// onError nhận mã lỗi khi máy không đọc được (ví dụ 'language-unavailable').
export function createPlayer(onChange, onError) {
  let poiId = null;
  let sentences = [];
  let index = 0;
  let lang = 'vi';
  let state = 'idle';
  let token = 0;
  let current = null; // giữ câu đang đọc: Chrome có thể dọn mất utterance nên onend không bao giờ chạy
  let lastError = null; // mã lỗi đọc gần nhất, để chẩn đoán

  // Chỉ cancel khi đang có câu đọc: Chrome Android đôi khi nuốt mất câu speak() gọi ngay sau cancel().
  function stopSynth() {
    if (!synth || !(synth.speaking || synth.pending || synth.paused)) return false;
    synth.cancel();
    return true;
  }

  function reset() {
    token++;
    stopSynth();
    current = null;
    poiId = null;
    sentences = [];
    index = 0;
    state = 'idle';
  }

  function speakCurrent() {
    const myToken = ++token;
    // Vừa cancel thì đợi một chút rồi mới speak (cùng lý do ở stopSynth).
    const delay = stopSynth() ? 120 : 0;
    const utterance = new SpeechSynthesisUtterance(sentences[index]);
    const voice = pickVoice(synth.getVoices(), lang);
    if (voice) utterance.voice = voice;
    utterance.lang = voice ? voice.lang : speechLang(lang);
    utterance.onend = () => {
      if (myToken !== token) return;
      index++;
      if (index < sentences.length) {
        speakCurrent();
      } else {
        reset();
        onChange();
      }
    };
    utterance.onerror = (event) => {
      if (myToken !== token) return; // lỗi của câu đã bị chính trang hủy (đổi bài, dừng)
      lastError = event.error;
      reset();
      onChange();
      if (onError) onError(event.error);
    };
    current = utterance;
    setTimeout(() => {
      if (myToken === token) synth.speak(current);
    }, delay);
  }

  return {
    get poiId() {
      return poiId;
    },
    get state() {
      return state;
    },
    get lastError() {
      return lastError;
    },
    play(id, newSentences, newLang) {
      reset();
      if (!synth || newSentences.length === 0) return onChange();
      poiId = id;
      sentences = newSentences;
      lang = newLang;
      state = 'playing';
      speakCurrent();
      onChange();
    },
    pause() {
      if (state !== 'playing') return;
      state = 'paused';
      if (typeof synth.pause === 'function') {
        synth.pause();
      } else {
        token++; // máy không hỗ trợ pause: dừng, lúc tiếp tục sẽ đọc lại từ câu hiện tại
        stopSynth();
      }
      onChange();
    },
    resume() {
      if (state !== 'paused') return;
      state = 'playing';
      if (typeof synth.resume === 'function' && synth.paused) {
        synth.resume();
      } else {
        speakCurrent();
      }
      onChange();
    },
    stop() {
      reset();
      onChange();
    },
  };
}
