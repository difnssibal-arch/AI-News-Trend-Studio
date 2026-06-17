const { Database } = require('node-sqlite3-wasm');
const path = require('path');
const fs = require('fs');

// OneDrive 폴더의 동기화 데몬이 핸들을 점유하므로 DB는 AppData(로컬)에 저장
const DB_DIR = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'AINewsTrendStudio')
  : __dirname;

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const DB_PATH = path.join(DB_DIR, 'trends.db');
const LOCK_PATH = DB_PATH + '.lock';

// node-sqlite3-wasm 은 Windows 에서 .lock 을 디렉토리로 생성하므로
// unlinkSync 가 아닌 rmSync(recursive) 로 제거해야 함
function removeLock() {
  if (!fs.existsSync(LOCK_PATH)) return;
  try {
    const stat = fs.statSync(LOCK_PATH);
    if (stat.isDirectory()) {
      fs.rmSync(LOCK_PATH, { recursive: true, force: true });
    } else {
      fs.unlinkSync(LOCK_PATH);
    }
    console.log('[db] 잠금 해제 완료');
  } catch (err) {
    console.warn('[db] 잠금 해제 실패 (다른 프로세스 사용 중일 수 있음):', err.message);
  }
}

// WAL 고아 파일 제거 (파일만, 디렉토리 아님)
for (const suffix of ['-wal', '-shm']) {
  const f = DB_PATH + suffix;
  if (fs.existsSync(f)) {
    try { fs.unlinkSync(f); } catch (_) {}
  }
}

removeLock();

const db = new Database(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  PRAGMA synchronous  = NORMAL;
  PRAGMA cache_size   = -8000;
  PRAGMA temp_store   = MEMORY;
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS articles (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    title          TEXT    NOT NULL,
    content        TEXT,
    source         TEXT,
    url            TEXT    UNIQUE,
    score          INTEGER DEFAULT 50,
    collected_date TEXT,
    is_processed   INTEGER DEFAULT 0,
    created_at     DATETIME DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS scripts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id INTEGER,
    type       TEXT CHECK(type IN ('shorts', 'longform')),
    title      TEXT,
    content    TEXT,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (article_id) REFERENCES articles(id)
  );

  CREATE TABLE IF NOT EXISTS api_usage (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    script_id     INTEGER REFERENCES scripts(id),
    model         TEXT,
    input_tokens  INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    created_at    DATETIME DEFAULT (datetime('now', 'localtime'))
  );

  CREATE INDEX IF NOT EXISTS idx_articles_created_at   ON articles(created_at);
  CREATE INDEX IF NOT EXISTS idx_articles_is_processed ON articles(is_processed);
  CREATE INDEX IF NOT EXISTS idx_scripts_article_id    ON scripts(article_id);
  CREATE INDEX IF NOT EXISTS idx_usage_script_id       ON api_usage(script_id);
`);

// Migrate: add columns to scripts and articles if they don't exist yet
for (const sql of [
  "ALTER TABLE scripts ADD COLUMN myCommentary TEXT DEFAULT ''",
  "ALTER TABLE scripts ADD COLUMN editingPreset TEXT DEFAULT 'A'",
  "ALTER TABLE scripts ADD COLUMN status TEXT DEFAULT 'draft'",
  "ALTER TABLE scripts ADD COLUMN narrationPath TEXT",
  "ALTER TABLE scripts ADD COLUMN renderStatus TEXT DEFAULT 'idle'",
  "ALTER TABLE scripts ADD COLUMN renderPath TEXT",
  "ALTER TABLE scripts ADD COLUMN renderProgress INTEGER DEFAULT 0",
  "ALTER TABLE articles ADD COLUMN imageUrls TEXT DEFAULT '[]'",
  "ALTER TABLE articles ADD COLUMN imageNeeded INTEGER DEFAULT 0",
]) {
  try { db.exec(sql); } catch (_) {}
}

console.log('[db] 초기화 완료 →', DB_PATH);

module.exports = db;
