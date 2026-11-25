// Phát file mp3 thuyết minh (tạo sẵn ở content-service) bằng một thẻ <audio> duy nhất.
// Một thẻ dùng chung cho mọi điểm: iPhone chỉ cho phát tiếng khi thẻ đã được "mở khóa" bằng một lần chạm.
const audio = new Audio();

// File wav im lặng 0 mẫu, chỉ để mở khóa âm thanh.
const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

// Gọi trong lúc xử lý lần chạm (nút "Bắt đầu tham quan"): sau đó đổi src sang file thật vẫn tự phát được.
export function unlockAudio() {
  audio.src = SILENCE;
  audio.play().catch(() => {});
}

// state: 'idle' | 'playing' | 'paused'. onError nhận mã lỗi khi không phát được:
// 'not-allowed' (trình duyệt chặn tự phát khi chưa chạm màn hình), 'media-N' (file lỗi hoặc tải không được), tên lỗi khác;
// kèm mã điểm đang phát lúc lỗi.
export function createPlayer(onChange, onError) {
  let poiId = null;
  let state = 'idle';
  let token = 0;
  let lastError = null; // mã lỗi gần nhất, để chẩn đoán

  function reset() {
    token++;
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    poiId = null;
    state = 'idle';
  }

  function fail(code) {
    const id = poiId;
    lastError = code;
    reset();
    onChange();
    onError(code, id);
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
    play(id, url) {
      reset();
      if (!url) return onChange();
      const myToken = token;
      poiId = id;
      state = 'playing';
      audio.onended = () => {
        reset();
        onChange();
      };
      audio.onerror = () => {
        if (myToken === token) fail(`media-${audio.error?.code ?? 0}`);
      };
      audio.src = url;
      audio.play().catch((err) => {
        if (myToken === token) fail(err.name === 'NotAllowedError' ? 'not-allowed' : err.name);
      });
      return onChange();
    },
    pause() {
      if (state !== 'playing') return;
      audio.pause();
      state = 'paused';
      onChange();
    },
    resume() {
      if (state !== 'paused') return;
      const myToken = token;
      state = 'playing';
      audio.play().catch((err) => {
        if (myToken === token) fail(err.name === 'NotAllowedError' ? 'not-allowed' : err.name);
      });
      onChange();
    },
    stop() {
      reset();
      onChange();
    },
  };
}
