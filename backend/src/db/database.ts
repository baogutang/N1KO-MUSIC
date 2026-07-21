import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'

export const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data')
const DB_PATH = path.join(DATA_DIR, 'music-stream-pro.db')

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

const db = new Database(DB_PATH)

// Initialize schema (support both ts-node/src and built dist runtime)
const schemaCandidates = [
  path.join(__dirname, 'schema.sql'),
  path.join(process.cwd(), 'src', 'db', 'schema.sql'),
]
const schemaPath = schemaCandidates.find(p => fs.existsSync(p))
if (!schemaPath) {
  throw new Error(`Schema file not found. Tried: ${schemaCandidates.join(', ')}`)
}
const schema = fs.readFileSync(schemaPath, 'utf-8')
db.exec(schema)

// ===================================================
// 迁移（针对已有数据库；新库由 schema.sql 直接建成最新结构）
// ===================================================

// users.token_version：修改密码后递增，使旧令牌失效
const userCols = db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>
if (!userCols.some(c => c.name === 'token_version')) {
  db.exec('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0')
}

// playlist_songs 主键需包含 server_id（否则不同服务器的同 id 歌曲互相覆盖）；
// sqlite 无法原地修改主键，只能建新表、拷贝、改名
const psCols = db.prepare('PRAGMA table_info(playlist_songs)').all() as Array<{ name: string; pk: number }>
if ((psCols.find(c => c.name === 'server_id')?.pk ?? 0) === 0) {
  db.exec(`
    BEGIN;
    CREATE TABLE playlist_songs_new (
      playlist_id TEXT NOT NULL,
      song_id     TEXT NOT NULL,
      server_id   TEXT NOT NULL,
      song_data   TEXT NOT NULL,
      position    INTEGER NOT NULL DEFAULT 0,
      added_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (playlist_id, server_id, song_id),
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
    );
    INSERT INTO playlist_songs_new (playlist_id, song_id, server_id, song_data, position, added_at)
      SELECT playlist_id, song_id, server_id, song_data, position, added_at FROM playlist_songs;
    DROP TABLE playlist_songs;
    ALTER TABLE playlist_songs_new RENAME TO playlist_songs;
    COMMIT;
  `)
}

console.log(`Database initialized at ${DB_PATH}`)

export default db
