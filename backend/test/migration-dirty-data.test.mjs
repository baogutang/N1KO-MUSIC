/**
 * 迁移必须扛得住脏数据。
 *
 * 迁移是在**启动时**跑的，跑在一个事务里。任何一条 INSERT 因为新约束失败，
 * 整个事务回滚，服务当场退出——而下一次启动会在同一个地方再崩一次。
 * 用户看到的是「升级之后后端再也起不来了」，日志里既没有表名也没有行号。
 *
 * 脏数据不是假想：手工改过库、从半损坏的转储恢复过、写到一半断电，
 * 都会在没有 CHECK 约束的老表里留下不合法的值。
 *
 * 这个测试造一个「哪儿哪儿都不干净」的老库，断言两件事：
 *   1. 服务起得来；
 *   2. 用户的数据一行不少，坏字节也原样留着而不是被悄悄换成空对象。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/** v1.5.0 之前的真实结构（没有任何 CHECK），塞满各种不合法的值 */
const DIRTY_LEGACY = `
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
  CREATE TABLE favorites (
    user_id TEXT NOT NULL, song_id TEXT NOT NULL, server_id TEXT NOT NULL,
    song_data TEXT NOT NULL, favorited_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (user_id, song_id, server_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  INSERT INTO users VALUES ('u1', 'n1ko', 'hash', 1700000000);
  -- type 不在新 CHECK 的白名单里（Airsonic 用户真实存在过）
  INSERT INTO servers VALUES ('s1','u1','Old','airsonic','http://x',NULL,NULL,NULL,1,1700000000);
  -- is_public 是 7，不是 0/1
  INSERT INTO playlists (id, user_id, name, is_public) VALUES ('p1', 'u1', '我的歌单', 7);
  INSERT INTO playlist_songs (playlist_id, song_id, server_id, song_data)
    VALUES ('p1', 'good', 'srv', '{"id":"good","title":"正常的一首"}');
  -- song_data 不是 JSON：新表上有 json_valid 约束，老表上没有
  INSERT INTO playlist_songs (playlist_id, song_id, server_id, song_data)
    VALUES ('p1', 'bad', 'srv', 'not-json-at-all');
  -- duration 是负数：新表上有 duration >= 0 约束
  INSERT INTO play_history (user_id, song_id, server_id, song_data, played_at, duration)
    VALUES ('u1', 'good', 'srv', 'also-not-json', 1700000000, -5);
  INSERT INTO favorites VALUES ('u1', 'good', 'srv', 'oops-not-json', 1700000000);
`

async function migrate(legacySql) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'n1ko-music-dirty-'))
  const Database = require('better-sqlite3')
  const legacy = new Database(path.join(dataDir, 'music-stream-pro.db'))
  legacy.exec(legacySql)
  legacy.close()

  process.env.DATA_DIR = dataDir
  const modulePath = require.resolve('../dist/db/database.js')
  delete require.cache[modulePath]
  return { db: require(modulePath).default, dataDir }
}

test('老库里全是脏数据时，迁移仍然跑得完、服务起得来', async () => {
  // migrate() 抛出就意味着服务启动失败——这一行本身就是断言
  const { db, dataDir } = await migrate(DIRTY_LEGACY)
  const one = sql => db.prepare(sql).get()

  // 一行都不能少
  assert.equal(one('SELECT COUNT(*) c FROM users').c, 1)
  assert.equal(one('SELECT COUNT(*) c FROM servers').c, 1)
  assert.equal(one('SELECT COUNT(*) c FROM playlists').c, 1)
  assert.equal(one('SELECT COUNT(*) c FROM playlist_songs').c, 2, '坏 JSON 的那一行不能被丢掉')
  assert.equal(one('SELECT COUNT(*) c FROM play_history').c, 1)
  assert.equal(one('SELECT COUNT(*) c FROM favorites').c, 1)

  // 合法的那一行原样不动
  assert.equal(
    one("SELECT song_data d FROM playlist_songs WHERE song_id = 'good'").d,
    '{"id":"good","title":"正常的一首"}',
  )

  // 坏行被包起来，原始字节一个不少——不是换成空对象抹掉
  for (const [sql, original] of [
    ["SELECT song_data d FROM playlist_songs WHERE song_id = 'bad'", 'not-json-at-all'],
    ['SELECT song_data d FROM play_history', 'also-not-json'],
    ['SELECT song_data d FROM favorites', 'oops-not-json'],
  ]) {
    const wrapped = JSON.parse(one(sql).d)
    assert.equal(wrapped._recovered, original, `${sql} 丢了原始字节`)
  }

  // 越界的值被归一化，而不是让整个迁移失败
  assert.equal(one('SELECT is_public p FROM playlists').p, 0, 'is_public=7 应当归一化成 0')
  assert.equal(one('SELECT duration d FROM play_history').d, null, '负数时长应当归一化成 NULL')

  // 老的历史行拿到了合成的幂等键
  assert.match(one('SELECT event_id e FROM play_history').e, /^legacy-/)

  /*
    servers 的 type 是 'airsonic'，不在新 CHECK 的白名单里。
    这时候的正确行为是**放弃这张表的结构对齐**，把数据原样留着并打一条日志——
    绝不能为了让 schema 好看而删掉用户的服务器配置，也不能让服务起不来。
  */
  assert.equal(one('SELECT type t FROM servers').t, 'airsonic')

  // 五个迁移全部记账完成
  assert.equal(one('SELECT COUNT(*) c FROM schema_migrations').c, 5)

  db.close()
  await rm(dataDir, { recursive: true, force: true })
})
