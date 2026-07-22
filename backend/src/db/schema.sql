-- N1KO MUSIC - SQLite Schema
-- 本地持久化数据，用于跨设备同步和离线功能

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

CREATE INDEX IF NOT EXISTS idx_play_history_user_played ON play_history(user_id, played_at DESC);
CREATE INDEX IF NOT EXISTS idx_play_history_user_server_song ON play_history(user_id, server_id, song_id);
CREATE INDEX IF NOT EXISTS idx_play_history_user_server_played ON play_history(user_id, server_id, played_at DESC);

-- ===================================================
-- 收藏（本地缓存 + 同步标记）
-- ===================================================
CREATE TABLE IF NOT EXISTS favorites (
  user_id      TEXT NOT NULL,
  song_id      TEXT NOT NULL,
  server_id    TEXT NOT NULL,
  song_data    TEXT NOT NULL CHECK(json_valid(song_data)),
  favorited_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, song_id, server_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
