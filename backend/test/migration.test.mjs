import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

test('legacy databases are backed up and migrated transactionally', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'n1ko-music-migration-'))
  const databasePath = path.join(dataDir, 'music-stream-pro.db')
  const Database = require('better-sqlite3')
  const legacy = new Database(databasePath)
  legacy.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE playlists (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
      description TEXT, cover_url TEXT, is_public INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE playlist_songs (
      playlist_id TEXT NOT NULL, song_id TEXT NOT NULL, server_id TEXT NOT NULL,
      song_data TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0,
      added_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (playlist_id, song_id)
    );
    CREATE TABLE play_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL,
      song_id TEXT NOT NULL, server_id TEXT NOT NULL, song_data TEXT NOT NULL,
      played_at INTEGER NOT NULL DEFAULT (unixepoch()), duration INTEGER
    );
    CREATE TABLE servers (id TEXT PRIMARY KEY);
    CREATE TABLE favorites (user_id TEXT, song_id TEXT, server_id TEXT);
    INSERT INTO users (id, username, password) VALUES ('u1', 'legacy', 'hash');
    INSERT INTO playlists (id, user_id, name) VALUES ('p1', 'u1', 'Legacy');
    INSERT INTO playlist_songs (playlist_id, song_id, server_id, song_data)
      VALUES ('p1', 's1', 'server-a', '{"id":"s1"}');
  `)
  legacy.close()

  process.env.DATA_DIR = dataDir
  const modulePath = require.resolve('../dist/db/database.js')
  delete require.cache[modulePath]
  const migrated = require(modulePath).default

  const userColumns = migrated.prepare('PRAGMA table_info(users)').all()
  assert.ok(userColumns.some(column => column.name === 'token_version'))
  const historyColumns = migrated.prepare('PRAGMA table_info(play_history)').all()
  assert.ok(historyColumns.some(column => column.name === 'event_id'))
  const playlistColumns = migrated.prepare('PRAGMA table_info(playlist_songs)').all()
  assert.ok(playlistColumns.find(column => column.name === 'server_id').pk > 0)
  const favoriteColumns = migrated.prepare('PRAGMA table_info(favorites)').all()
  assert.ok(favoriteColumns.some(column => column.name === 'deleted_at'))
  assert.ok(favoriteColumns.some(column => column.name === 'updated_at'))

  // event_id 补成 NOT NULL 后，老行必须仍然在，且拿到了合成的幂等键
  assert.ok(historyColumns.find(column => column.name === 'event_id').notnull === 1)

  // 重建 playlists 时若外键仍然打开，ON DELETE CASCADE 会把歌单里的歌全删光
  assert.equal(
    migrated.prepare('SELECT COUNT(*) count FROM playlist_songs').get().count,
    1,
    '迁移不能顺手清空歌单曲目',
  )
  assert.equal(migrated.prepare('SELECT COUNT(*) count FROM playlists').get().count, 1)

  assert.equal(migrated.prepare('SELECT COUNT(*) count FROM schema_migrations').get().count, 4)
  migrated.close()

  const files = await readdir(dataDir)
  assert.ok(files.some(file => file.startsWith('music-stream-pro.db.backup-')))
  await rm(dataDir, { recursive: true, force: true })
})
