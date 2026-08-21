-- N1KO MUSIC - SQLite Schema
-- 本地持久化数据，用于跨设备同步和离线功能
--
-- 【本文件的唯一规矩】
-- 它在**每次启动**时整段执行一遍，老库也不例外。而 CREATE TABLE IF NOT EXISTS
-- 碰到已存在的表会整段跳过——于是这里写的新列、新约束对老库全都不生效。
-- 因此：
--   1. 任何引用「后来才加的列」的语句（尤其是 CREATE INDEX）都不能写在这里，
--      否则老库启动时会当场报 no such column 把服务顶死；
--   2. 表结构的演进一律写进 src/db/database.ts 的 migrations，迁移在全新库上
--      同样会跑，两条路径因此收敛到同一份 schema；
--   3. test/schema-drift.test.mjs 会把「全新安装」和「老库升级」两条路径跑出来
--      逐列逐索引对比，这条规矩一旦破了它就会红。

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ===================================================
-- 用户账号（本地单用户或多用户）
-- ===================================================
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  username   TEXT NOT NULL UNIQUE,
  password   TEXT NOT NULL,           -- bcrypt hash
  token_version INTEGER NOT NULL DEFAULT 0, -- 修改密码后递增，使旧令牌失效
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ===================================================
-- 服务器配置（支持多服务器）
-- ===================================================
CREATE TABLE IF NOT EXISTS servers (
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
);

-- ===================================================
-- 本地歌单（跨服务器）
-- ===================================================
CREATE TABLE IF NOT EXISTS playlists (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  cover_url   TEXT,
  is_public   INTEGER NOT NULL DEFAULT 0 CHECK(is_public IN (0, 1)),
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS playlist_songs (
  playlist_id TEXT NOT NULL,
  song_id     TEXT NOT NULL,
  server_id   TEXT NOT NULL,
  song_data   TEXT NOT NULL CHECK(json_valid(song_data)),
  position    INTEGER NOT NULL DEFAULT 0 CHECK(position >= 0),
  added_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (playlist_id, server_id, song_id), -- 含 server_id，避免不同服务器同 id 歌曲互相覆盖
  FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
);

-- ===================================================
-- 播放历史
-- ===================================================
CREATE TABLE IF NOT EXISTS play_history (
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

-- 幂等键 idx_play_history_user_event 故意**不**写在这里。
-- 本文件在每次启动时都会整段执行一遍，包括老库；而老库的 play_history 还没有
-- event_id 列，CREATE INDEX 会当场报 “no such column” 把服务顶死。
-- 该索引由迁移 3 建立（迁移在全新库上同样会跑），两条路径生成的索引完全一致。

CREATE INDEX IF NOT EXISTS idx_play_history_user_played ON play_history(user_id, played_at DESC);
CREATE INDEX IF NOT EXISTS idx_play_history_user_server_song ON play_history(user_id, server_id, song_id);
CREATE INDEX IF NOT EXISTS idx_play_history_user_server_played ON play_history(user_id, server_id, played_at DESC);

-- ===================================================
-- 收藏（本地缓存 + 同步标记）
-- ===================================================
-- deleted_at 是墓碑而不是真删除：取消收藏必须能同步出去。
-- 硬删除的话，一台离线的设备下次同步时会拿着它那份旧列表把这首歌重新 PUT 回来，
-- 于是取消收藏在多设备之间永远生效不了。
CREATE TABLE IF NOT EXISTS favorites (
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

-- 增量同步索引 idx_favorites_user_updated 同样只能建在迁移里：
-- 老库的 favorites 还没有 updated_at 列（原因见文件开头）。

-- ===================================================
-- 边注：你写在页边的东西
-- ===================================================
-- 服务器上的曲目元数据是别人写的，这张表存的是**你自己**写的：
-- 为什么留着这张专辑、这首歌是哪年夏天听的、这段间奏为什么好。
-- 它是这个软件里唯一不能从曲库或行为里重新算出来的数据，因此也是最该被
-- 同步和备份的那一份。
--
-- deleted_at 与 favorites 同理：删除本身也是一条要同步出去的事实。
CREATE TABLE IF NOT EXISTS notes (
  user_id     TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK(target_type IN ('song', 'album', 'artist')),
  target_id   TEXT NOT NULL,
  server_id   TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at  INTEGER,
  PRIMARY KEY (user_id, server_id, target_type, target_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
