const CONTENT = 'poi_id AS "poiId", lang, title, text';
const CONTENT_AUDIO = 'c.poi_id AS "poiId", c.lang, c.title, c.text, (a.poi_id IS NOT NULL) AS audio';
const FROM_AUDIO = 'FROM contents c LEFT JOIN audios a ON a.poi_id = c.poi_id AND a.lang = c.lang AND a.text_hash = md5(c.text)';

export function createStore(pool) {
  return {
    // Trang du khách: chỉ ngôn ngữ không ẩn.
    async listLanguages() {
      const { rows } = await pool.query('SELECT code, name FROM languages WHERE NOT hidden ORDER BY sort_order');
      return rows;
    },
    // Trang quản lý: mọi ngôn ngữ kèm cột hidden.
    async listAllLanguages() {
      const { rows } = await pool.query('SELECT code, name, hidden FROM languages ORDER BY sort_order');
      return rows;
    },
    // Thêm vào cuối danh sách. Trả null nếu mã đã có.
    async addLanguage(code, name) {
      const { rows } = await pool.query(
        `INSERT INTO languages (code, name, sort_order)
         SELECT $1, $2, coalesce(max(sort_order), 0) + 1 FROM languages
         ON CONFLICT (code) DO NOTHING RETURNING code, name, hidden`,
        [code, name],
      );
      return rows[0] ?? null;
    },
    async updateLanguage(code, { name, hidden }) {
      const { rows } = await pool.query(
        'UPDATE languages SET name = $2, hidden = $3 WHERE code = $1 RETURNING code, name, hidden',
        [code, name, hidden],
      );
      return rows[0] ?? null;
    },
    // audio: có file mp3 khớp với chữ hiện tại (text_hash = md5 của text).
    async listContent(lang) {
      const { rows } = await pool.query(`SELECT ${CONTENT_AUDIO} ${FROM_AUDIO} WHERE c.lang = $1 ORDER BY c.poi_id`, [lang]);
      return rows;
    },
    async listAllContent() {
      const { rows } = await pool.query(`SELECT ${CONTENT_AUDIO} ${FROM_AUDIO} ORDER BY c.poi_id, c.lang`);
      return rows;
    },
    // Nội dung chưa có mp3 hoặc mp3 đã cũ (chữ đã sửa).
    async listMissingAudio() {
      const { rows } = await pool.query(`SELECT ${CONTENT_AUDIO} ${FROM_AUDIO} WHERE a.poi_id IS NULL ORDER BY c.poi_id, c.lang`);
      return rows;
    },
    async getContent(poiId, lang) {
      const { rows } = await pool.query(`SELECT ${CONTENT} FROM contents WHERE poi_id = $1 AND lang = $2`, [poiId, lang]);
      return rows[0] ?? null;
    },
    // Ghi đè mp3 của một nội dung (nội dung phải có sẵn: khóa ngoại).
    async saveAudio(poiId, lang, textHash, mp3) {
      await pool.query(
        `INSERT INTO audios (poi_id, lang, text_hash, mp3) VALUES ($1, $2, $3, $4)
         ON CONFLICT (poi_id, lang) DO UPDATE SET text_hash = EXCLUDED.text_hash, mp3 = EXCLUDED.mp3`,
        [poiId, lang, textHash, mp3],
      );
    },
    // mp3 còn khớp chữ hiện tại, hoặc null.
    async getAudio(poiId, lang) {
      const { rows } = await pool.query(
        `SELECT a.mp3, a.text_hash AS "textHash" FROM audios a JOIN contents c USING (poi_id, lang)
         WHERE a.poi_id = $1 AND a.lang = $2 AND a.text_hash = md5(c.text)`,
        [poiId, lang],
      );
      return rows[0] ?? null;
    },
    // Thêm mới hoặc ghi đè nội dung một điểm ở một ngôn ngữ.
    async saveContent(poiId, lang, title, text) {
      const { rows } = await pool.query(
        `INSERT INTO contents (poi_id, lang, title, text) VALUES ($1, $2, $3, $4)
         ON CONFLICT (poi_id, lang) DO UPDATE SET title = EXCLUDED.title, text = EXCLUDED.text
         RETURNING ${CONTENT}`,
        [poiId, lang, title, text],
      );
      return rows[0];
    },
    // lang bỏ trống: xóa nội dung mọi ngôn ngữ của điểm (khi xóa điểm). Trả số dòng đã xóa.
    async removeContent(poiId, lang) {
      const { rowCount } = lang
        ? await pool.query('DELETE FROM contents WHERE poi_id = $1 AND lang = $2', [poiId, lang])
        : await pool.query('DELETE FROM contents WHERE poi_id = $1', [poiId]);
      return rowCount;
    },
    async checkDb() {
      await pool.query('SELECT 1');
    },
  };
}
