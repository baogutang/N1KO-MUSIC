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
        /*
          song_data 在新表上有 json_valid 约束，而**旧表没有**。只要历史上有一行
          存进过非 JSON（手工改过库、从半损坏的转储里恢复过、写到一半断电），
          这条 INSERT 就会抛 CHECK 失败 —— 整个迁移事务回滚，而迁移在启动时执行，
          于是服务从此每次启动都在同一个地方崩，且错误信息里没有表名也没有行号。
          用户看到的是「升级之后后端再也起不来了」。

          坏行不能丢（那是用户的歌单），也不能原样塞进去（约束不认）。
          包成 {"_recovered": "原始字节"}：行还在、原文一个字节没少、约束满足，
          客户端的 safeJsonObject 会把它当成一条缺元数据的曲目正常渲染。
        */
        INSERT INTO playlist_songs_new (playlist_id, song_id, server_id, song_data, position, added_at)
          SELECT playlist_id, song_id, server_id,
                 CASE WHEN json_valid(song_data)
                      THEN song_data
                      ELSE json_object('_recovered', song_data) END,
                 MAX(position, 0), added_at
          FROM playlist_songs;
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
  {
    /**
     * 让升级上来的库和全新安装的库收敛到同一份 schema，并给收藏加上墓碑。
     *
     * 两件事其实是一件事。此前 schema.sql 里逐步加上的 CHECK / NOT NULL / 外键
     * 只对全新安装生效——`CREATE TABLE IF NOT EXISTS` 遇到已有的表就整段跳过，
     * 而没有任何迁移去补。于是同一个版本号下跑着两种结构的库，
     * 谁也说不清线上那台到底是哪一种。
     *
     * 收藏的墓碑（deleted_at）必须靠重建表来加，正好一起做掉。
     */
    version: 4,
    name: 'converge-schema-and-favorite-tombstones',
    up: () => {
      rebuildFavoritesWithTombstones()
      rebuildPlayHistoryWithRequiredEventId()
      rebuildIfConstraintsMissing(
        'playlists',
        ['CHECK(is_public IN (0, 1))', 'FOREIGN KEY (user_id) REFERENCES users(id)'],
        `CREATE TABLE playlists_new (
           id          TEXT PRIMARY KEY,
           user_id     TEXT NOT NULL,
           name        TEXT NOT NULL,
           description TEXT,
           cover_url   TEXT,
           is_public   INTEGER NOT NULL DEFAULT 0 CHECK(is_public IN (0, 1)),
           created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
           updated_at  INTEGER NOT NULL DEFAULT (unixepoch()),
           FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
         )`,
        `INSERT INTO playlists_new (id, user_id, name, description, cover_url, is_public, created_at, updated_at)
           SELECT id, user_id, name, description, cover_url,
                  CASE WHEN is_public = 1 THEN 1 ELSE 0 END, created_at, updated_at
           FROM playlists`
      )
      rebuildIfConstraintsMissing(
        'servers',
        ["CHECK(type IN ('subsonic', 'navidrome', 'jellyfin', 'emby'))"],
        `CREATE TABLE servers_new (
           id         TEXT PRIMARY KEY,
           user_id    TEXT NOT NULL,
           name       TEXT NOT NULL,
           type       TEXT NOT NULL CHECK(type IN ('subsonic', 'navidrome', 'jellyfin', 'emby')),
           url        TEXT NOT NULL,
           username   TEXT,
           token      TEXT,
           salt       TEXT,
           is_active  INTEGER NOT NULL DEFAULT 0 CHECK(is_active IN (0, 1)),
           created_at INTEGER NOT NULL DEFAULT (unixepoch()),
           FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
         )`,
        `INSERT INTO servers_new (id, user_id, name, type, url, username, token, salt, is_active, created_at)
           SELECT id, user_id, name, type, url, username, token, salt,
                  CASE WHEN is_active = 1 THEN 1 ELSE 0 END, created_at
           FROM servers`
      )
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_favorites_user_updated
          ON favorites(user_id, updated_at DESC);
      `)
    },
  },
  {
    /**
     * 边注。
     *
     * 建表语句写在 schema.sql 里（CREATE TABLE IF NOT EXISTS 对老库也会执行，
     * 因为那张表本来就不存在）；索引必须放这里——schema.sql 的规矩是
     * 不能引用「后来才加的列」，而这整张表对老库来说都是新的。
     */
    version: 5,
    name: 'notes-index',
    up: () => {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_notes_user_updated
          ON notes(user_id, updated_at DESC);
      `)
    },
  },
]

/** 表定义里是否已经带上了某段约束文本（比较时忽略空白差异） */
function tableSqlHas(table: string, fragments: string[]): boolean {
  const row = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?"
  ).get(table) as { sql?: string } | undefined
  const sql = (row?.sql ?? '').replace(/\s+/g, ' ')
  const squash = (text: string) => text.replace(/\s+/g, ' ')
  return fragments.every(fragment => sql.includes(squash(fragment)))
}

/**
 * 按 SQLite 官方推荐的顺序重建一张表：建新表 → 拷数据 → 删旧表 → 改名。
 *
 * 只在约束确实缺失时才动，并且先用新表的约束试着把数据装进去；装不下就整张放弃
 * 并把原因打出来。宁可留着一张少几个 CHECK 的表，也不能为了对齐 schema
 * 丢掉用户的数据或者让服务起不来。
 */
function rebuildIfConstraintsMissing(
  table: string,
  requiredFragments: string[],
  createNewSql: string,
  copySql: string
): void {
  if (tableSqlHas(table, requiredFragments)) return
  try {
    db.exec(`
      ${createNewSql};
      ${copySql};
      DROP TABLE ${table};
      ALTER TABLE ${table}_new RENAME TO ${table};
    `)
  } catch (error) {
    db.exec(`DROP TABLE IF EXISTS ${table}_new`)
    console.warn(
      `[migrate] 跳过 ${table} 的结构对齐：现有数据不满足新约束（${(error as Error).message}）。` +
      '数据保持原样，功能不受影响。'
    )
  }
}

/**
 * 收藏改为墓碑删除。
 *
 * 取消收藏此前是 DELETE：一台离线设备下次同步时会拿着旧列表把这首歌重新 PUT
 * 回来，取消收藏在多设备之间因此永远生效不了。改成保留行 + deleted_at，
 * 客户端按 updated_at 增量拉取时就能看到「这条被删了」。
 */
function rebuildFavoritesWithTombstones(): void {
  const columns = db.prepare('PRAGMA table_info(favorites)').all() as Array<{ name: string }>
  const names = new Set(columns.map(column => column.name))
  if (names.has('deleted_at') && names.has('updated_at')) return

  const hasSongData = names.has('song_data')
  const hasFavoritedAt = names.has('favorited_at')
  db.exec(`
    CREATE TABLE favorites_new (
      user_id      TEXT NOT NULL,
      song_id      TEXT NOT NULL,
      server_id    TEXT NOT NULL,
      song_data    TEXT NOT NULL CHECK(json_valid(song_data)),
      favorited_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      deleted_at   INTEGER,
      PRIMARY KEY (user_id, song_id, server_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    INSERT OR IGNORE INTO favorites_new (user_id, song_id, server_id, song_data, favorited_at, updated_at)
      SELECT user_id, song_id, server_id,
             ${hasSongData
               ? "CASE WHEN json_valid(song_data) THEN song_data ELSE json_object('_recovered', song_data) END"
               : "'{}'"},
             ${hasFavoritedAt ? 'favorited_at' : 'unixepoch()'},
             ${hasFavoritedAt ? 'favorited_at' : 'unixepoch()'}
      FROM favorites
      WHERE user_id IS NOT NULL AND song_id IS NOT NULL AND server_id IS NOT NULL;
    DROP TABLE favorites;
    ALTER TABLE favorites_new RENAME TO favorites;
  `)
}

/**
 * play_history.event_id 补成 NOT NULL。
 *
 * event_id 是幂等键：为空的行没有任何东西拦得住重复同步把它再插一遍。
 * 老行按自增主键补一个稳定的合成 id，既保住数据又让幂等索引真正覆盖全表。
 */
function rebuildPlayHistoryWithRequiredEventId(): void {
  if (tableSqlHas('play_history', ['event_id TEXT NOT NULL'])) return
  db.exec("UPDATE play_history SET event_id = 'legacy-' || id WHERE event_id IS NULL OR event_id = ''")
  try {
    db.exec(`
      CREATE TABLE play_history_new (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    TEXT NOT NULL,
        event_id   TEXT NOT NULL,
        song_id    TEXT NOT NULL,
        server_id  TEXT NOT NULL,
        song_data  TEXT NOT NULL CHECK(json_valid(song_data)),
        played_at  INTEGER NOT NULL DEFAULT (unixepoch()),
        duration   INTEGER CHECK(duration IS NULL OR duration >= 0),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      INSERT INTO play_history_new (id, user_id, event_id, song_id, server_id, song_data, played_at, duration)
        SELECT id, user_id, event_id, song_id, server_id,
               -- 坏 JSON 包成 {"_recovered": …} 而不是换成 '{}'：
               -- 约束要满足，但用户的字节不该被悄悄抹掉
               CASE WHEN json_valid(song_data)
                    THEN song_data
                    ELSE json_object('_recovered', song_data) END,
               played_at,
               CASE WHEN duration < 0 THEN NULL ELSE duration END
        FROM play_history;
      DROP TABLE play_history;
      ALTER TABLE play_history_new RENAME TO play_history;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_play_history_user_event
        ON play_history(user_id, event_id) WHERE event_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_play_history_user_played
        ON play_history(user_id, played_at DESC);
      CREATE INDEX IF NOT EXISTS idx_play_history_user_server_song
        ON play_history(user_id, server_id, song_id);
      CREATE INDEX IF NOT EXISTS idx_play_history_user_server_played
        ON play_history(user_id, server_id, played_at DESC);
    `)
  } catch (error) {
    db.exec('DROP TABLE IF EXISTS play_history_new')
    console.warn(
      `[migrate] 跳过 play_history 的结构对齐：${(error as Error).message}。数据保持原样。`
    )
  }
}

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

if (pending.length > 0) {
  /**
   * 重建表期间必须关掉外键，这是 SQLite 官方给的顺序。
   *
   * 开着外键时 DROP TABLE playlists 会被当成一次隐式 DELETE，
   * playlist_songs 上的 ON DELETE CASCADE 会跟着把所有歌全删掉——
   * 一次「对齐 schema」的迁移就能把用户的歌单清空。
   *
   * PRAGMA 在事务里是空操作，所以只能在事务外开关。
   */
  db.pragma('foreign_keys = OFF')
  try {
    applyMigrations()
    const violations = db.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) {
      // 迁移已经提交，这里只能报警：留着数据让人工处理，好过自作主张删行
      console.warn(`[migrate] 迁移后检出 ${violations.length} 条外键悬挂记录，请检查数据。`)
    }
  } finally {
    db.pragma('foreign_keys = ON')
  }
}
db.pragma('optimize')

console.log(`Database initialized at ${DB_PATH}`)

export default db
