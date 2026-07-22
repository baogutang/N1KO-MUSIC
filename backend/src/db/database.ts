import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'

export const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data')
export const DB_PATH = path.join(DATA_DIR, 'music-stream-pro.db')

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

const db = new Database(DB_PATH)
db.pragma('foreign_keys = ON')
db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')
db.pragma('busy_timeout = 5000')

const hadExistingData = Boolean(db.prepare(`
  SELECT 1 FROM sqlite_master
  WHERE type = 'table' AND name = 'users'
`).get())

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

interface Migration {
  version: number
  name: string
  up: () => void
}

const migrations: Migration[] = [
  {
    version: 1,
    name: 'users-token-version',
    up: () => {
      const columns = db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>
      if (!columns.some(column => column.name === 'token_version')) {
        db.exec('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0')
      }
    },
  },
  {
    version: 2,
    name: 'playlist-song-server-primary-key',
    up: () => {
      const columns = db.prepare('PRAGMA table_info(playlist_songs)').all() as Array<{ name: string; pk: number }>
      if ((columns.find(column => column.name === 'server_id')?.pk ?? 0) > 0) return
      db.exec(`
        CREATE TABLE playlist_songs_new (
          playlist_id TEXT NOT NULL,
          song_id     TEXT NOT NULL,
          server_id   TEXT NOT NULL,
          song_data   TEXT NOT NULL CHECK(json_valid(song_data)),
          position    INTEGER NOT NULL DEFAULT 0 CHECK(position >= 0),
          added_at    INTEGER NOT NULL DEFAULT (unixepoch()),
          PRIMARY KEY (playlist_id, server_id, song_id),
          FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
        );
        INSERT INTO playlist_songs_new (playlist_id, song_id, server_id, song_data, position, added_at)
          SELECT playlist_id, song_id, server_id, song_data, MAX(position, 0), added_at FROM playlist_songs;
        DROP TABLE playlist_songs;
        ALTER TABLE playlist_songs_new RENAME TO playlist_songs;
      `)
    },
  },
  {
    version: 3,
    name: 'play-history-idempotency-and-indexes',
    up: () => {
      const columns = db.prepare('PRAGMA table_info(play_history)').all() as Array<{ name: string }>
      if (!columns.some(column => column.name === 'event_id')) {
        // Existing history remains readable; all new API writes require event_id.
        db.exec('ALTER TABLE play_history ADD COLUMN event_id TEXT')
      }
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_play_history_user_event
          ON play_history(user_id, event_id) WHERE event_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_play_history_user_server_played
          ON play_history(user_id, server_id, played_at DESC);
        CREATE INDEX IF NOT EXISTS idx_play_history_user_server_song
          ON play_history(user_id, server_id, song_id);
      `)
    },
  },
]

const applied = new Set(
  (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>)
    .map(row => row.version),
)
const pending = migrations.filter(migration => !applied.has(migration.version))

if (hadExistingData && pending.length > 0) {
  const backupPath = `${DB_PATH}.backup-${Date.now()}`
  const escapedPath = backupPath.replace(/'/g, "''")
  db.exec(`VACUUM INTO '${escapedPath}'`)
  console.log(`Database backup created at ${backupPath}`)
}

const applyMigrations = db.transaction(() => {
  const record = db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)')
  for (const migration of pending) {
    migration.up()
    record.run(migration.version, migration.name)
  }
})
applyMigrations()
db.pragma('optimize')

console.log(`Database initialized at ${DB_PATH}`)

export default db
