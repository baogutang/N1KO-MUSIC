/**
 * 「全新安装」和「老库升级」必须落到同一份 schema。
 *
 * 这两条路径此前是分开长的：schema.sql 里陆续加上的 CHECK / NOT NULL / 外键
 * 只对全新库生效，老库靠 migrations 单独演进，谁也没有对过账。结果就是同一个
 * 版本号下跑着两种结构的数据库，线上那台到底是哪一种，只能靠猜。
 *
 * 这个测试把两条路径都真的跑一遍，然后逐列、逐索引、逐外键、逐条 CHECK 比对。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/**
 * v1.5.0 之前真实发布过的 schema。
 *
 * 不是随手编的：CHECK 约束是在「杂志改版」那一版才加进 schema.sql 的，
 * 而 CREATE TABLE IF NOT EXISTS 对已存在的表整段跳过，所以那之前装的库
 * 至今仍是这个形状。升级路径必须从这里出发才算数。
 */
const LEGACY_SCHEMA = `
  CREATE TABLE users (
    id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE servers (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
    type TEXT NOT NULL, url TEXT NOT NULL, username TEXT, token TEXT, salt TEXT,
    is_active INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE playlists (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
    description TEXT, cover_url TEXT, is_public INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE playlist_songs (
    playlist_id TEXT NOT NULL, song_id TEXT NOT NULL, server_id TEXT NOT NULL,
    song_data TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0,
    added_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (playlist_id, song_id),
    FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
  );
  CREATE TABLE play_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL,
    song_id TEXT NOT NULL, server_id TEXT NOT NULL, song_data TEXT NOT NULL,
    played_at INTEGER NOT NULL DEFAULT (unixepoch()), duration INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX idx_play_history_user_played ON play_history(user_id, played_at DESC);
  CREATE TABLE favorites (
    user_id TEXT NOT NULL, song_id TEXT NOT NULL, server_id TEXT NOT NULL,
    song_data TEXT NOT NULL, favorited_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (user_id, song_id, server_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  INSERT INTO users (id, username, password) VALUES ('u1', 'legacy', 'hash');
  INSERT INTO playlists (id, user_id, name) VALUES ('p1', 'u1', 'Legacy');
  INSERT INTO playlist_songs (playlist_id, song_id, server_id, song_data)
    VALUES ('p1', 's1', 'server-a', '{"id":"s1"}');
  INSERT INTO play_history (user_id, song_id, server_id, song_data, played_at)
    VALUES ('u1', 's1', 'server-a', '{"id":"s1"}', 1700000000);
  INSERT INTO favorites (user_id, song_id, server_id, song_data)
    VALUES ('u1', 's1', 'server-a', '{"id":"s1"}');
`

/** 表名（含索引所属的表），schema_migrations 是运行时记账表，不参与比对 */
const TABLES = ['users', 'servers', 'playlists', 'playlist_songs', 'play_history', 'favorites']

async function buildDatabase(legacySql) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'n1ko-music-drift-'))
  if (legacySql) {
    const Database = require('better-sqlite3')
    const legacy = new Database(path.join(dataDir, 'music-stream-pro.db'))
    legacy.exec(legacySql)
    legacy.close()
  }
  process.env.DATA_DIR = dataDir
  const modulePath = require.resolve('../dist/db/database.js')
  delete require.cache[modulePath]
  return { db: require(modulePath).default, dataDir }
}

/** 列：按列名取值，忽略声明顺序——顺序不影响任何行为 */
function columnsOf(db, table) {
  return Object.fromEntries(
    db.prepare(`PRAGMA table_info(${table})`).all().map(column => [
      column.name,
      { type: column.type, notnull: column.notnull, dflt: column.dflt_value, pk: column.pk },
    ]),
  )
}

/** 索引：名字 → 唯一性 + 列序列 */
function indexesOf(db, table) {
  return Object.fromEntries(
    db.prepare(`PRAGMA index_list(${table})`).all()
      // 自动索引由 PRIMARY KEY / UNIQUE 派生，已经在列比对里覆盖过
      .filter(index => index.origin === 'c')
      .map(index => [
        index.name,
        {
          unique: index.unique,
          columns: db.prepare(`PRAGMA index_info(${index.name})`).all().map(c => c.name),
        },
      ]),
  )
}

function foreignKeysOf(db, table) {
  return db.prepare(`PRAGMA foreign_key_list(${table})`).all()
    .map(fk => `${fk.from}->${fk.table}.${fk.to} on_delete=${fk.on_delete}`)
    .sort()
}

/**
 * CHECK 约束。
 *
 * PRAGMA 不暴露它们，只能从建表语句里抠。比较前把空白压平、去掉注释和
 * RENAME 留下的引号——这些都不是语义。
 */
function checksOf(db, table) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)
  const sql = (row?.sql ?? '')
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
  return (sql.match(/CHECK\s*\((?:[^()]|\([^()]*\))*\)/gi) ?? [])
    .map(text => text.replace(/\s+/g, ' ').trim())
    .sort()
}

test('全新安装与老库升级收敛到同一份 schema', async () => {
  const fresh = await buildDatabase(null)
  const freshShape = Object.fromEntries(TABLES.map(table => [table, {
    columns: columnsOf(fresh.db, table),
    indexes: indexesOf(fresh.db, table),
    foreignKeys: foreignKeysOf(fresh.db, table),
    checks: checksOf(fresh.db, table),
  }]))
  fresh.db.close()
  await rm(fresh.dataDir, { recursive: true, force: true })

  const upgraded = await buildDatabase(LEGACY_SCHEMA)
  const upgradedShape = Object.fromEntries(TABLES.map(table => [table, {
    columns: columnsOf(upgraded.db, table),
    indexes: indexesOf(upgraded.db, table),
    foreignKeys: foreignKeysOf(upgraded.db, table),
    checks: checksOf(upgraded.db, table),
  }]))

  // 老库里的数据必须原样还在——对齐 schema 不能拿数据换
  assert.equal(upgraded.db.prepare('SELECT COUNT(*) c FROM playlist_songs').get().c, 1)
  assert.equal(upgraded.db.prepare('SELECT COUNT(*) c FROM play_history').get().c, 1)
  assert.equal(upgraded.db.prepare('SELECT COUNT(*) c FROM favorites').get().c, 1)
  // 老的历史行拿到了合成的幂等键，而不是被丢掉
  assert.match(upgraded.db.prepare('SELECT event_id FROM play_history').get().event_id, /^legacy-/)

  upgraded.db.close()
  await rm(upgraded.dataDir, { recursive: true, force: true })

  for (const table of TABLES) {
    assert.deepEqual(
      upgradedShape[table], freshShape[table],
      `${table} 的结构在两条路径上不一致`,
    )
  }
})
