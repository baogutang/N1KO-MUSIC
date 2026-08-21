import { Router, Request, Response } from 'express'
import { z } from 'zod'
import db from '../db/database'
import { authMiddleware } from '../middleware/auth'
import {
  boundedId,
  parseBoundedInteger,
  parseRequest,
  safeJsonObject,
  serverIdSchema,
  songDataSchema,
} from '../validation'

/**
 * 收藏同步接口。
 *
 * favorites 表自建库起就存在，但一直没有对应路由，导致这份 schema 无法使用。
 * 收藏的权威数据仍在音乐服务器（Subsonic starred / Jellyfin UserData），
 * 这里保存的是跨服务器聚合与离线可读的镜像。
 */
const router = Router()
router.use(authMiddleware)

const favoriteSchema = z.object({
  songId: boundedId,
  serverId: serverIdSchema,
  songData: songDataSchema,
  favoritedAt: z.number().int().min(946_684_800).optional(),
}).strict()

function optionalServerId(req: Request, res: Response): { valid: boolean; value: string | null } {
  if (req.query.serverId === undefined) return { valid: true, value: null }
  const parsed = parseRequest(serverIdSchema, req.query.serverId, res)
  return parsed.success ? { valid: true, value: parsed.data } : { valid: false, value: null }
}

function scopeSql(serverId: string | null): { where: string; params: string[] } {
  return serverId
    ? { where: 'user_id = ? AND server_id = ?', params: [serverId] }
    : { where: 'user_id = ?', params: [] }
}

/**
 * 墓碑保留多久。
 *
 * 一台设备离线超过这个时长再回来，就有可能漏掉一条删除；但墓碑不能无限留着，
 * 90 天已经远超正常的离线时长，也和大多数同步协议的口径一致。
 */
const TOMBSTONE_TTL_SECONDS = 90 * 24 * 60 * 60

/**
 * 列出收藏。
 *
 * 缺省只返回仍然收藏着的（deleted_at IS NULL）。
 * 带上 `since` 则进入增量模式：返回该时刻之后所有变动过的行，**包含墓碑**，
 * 每条带 `deleted` 标记，客户端据此把本地那份也删掉。
 * 没有这一步的话，取消收藏在多设备之间根本同步不出去。
 */
router.get('/', (req: Request, res: Response) => {
  const limit = parseBoundedInteger(req.query.limit, 200, 1, 500)
  const offset = parseBoundedInteger(req.query.offset, 0, 0, 1_000_000)
  if (limit === null || offset === null) {
    return res.status(400).json({ error: 'limit must be 1–500 and offset must be 0–1000000' })
  }
  const server = optionalServerId(req, res)
  if (!server.valid) return

  let since: number | null = null
  if (req.query.since !== undefined) {
    since = parseBoundedInteger(req.query.since, 0, 0, 4_102_444_800)
    if (since === null) {
      return res.status(400).json({ error: 'since must be a unix timestamp in seconds' })
    }
  }

  const scope = scopeSql(server.value)
  // 增量模式按 updated_at 取全部变动（含墓碑）；全量模式只取还活着的
  const filter = since !== null ? 'updated_at > ?' : 'deleted_at IS NULL'
  const where = `${scope.where} AND ${filter}`
  const params = [req.user!.userId, ...scope.params, ...(since !== null ? [since] : [])]
  const order = since !== null ? 'updated_at ASC, song_id ASC' : 'favorited_at DESC, song_id ASC'

  const rows = db.prepare(`
    SELECT song_id, server_id, song_data, favorited_at, updated_at, deleted_at FROM favorites
    WHERE ${where}
    ORDER BY ${order} LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as Array<{
    song_id: string
    server_id: string
    song_data: string
    favorited_at: number
    updated_at: number
    deleted_at: number | null
  }>
  const total = (db.prepare(
    `SELECT COUNT(*) AS count FROM favorites WHERE ${where}`,
  ).get(...params) as { count: number }).count

  const items = rows.flatMap((row): Array<Record<string, unknown>> => {
    // 墓碑本身不需要元数据，song_data 解析失败也照样要发出去，
    // 否则这条删除就永远同步不到客户端
    if (row.deleted_at !== null) {
      return [{
        id: row.song_id,
        serverId: row.server_id,
        deleted: true,
        updatedAt: row.updated_at,
      }]
    }
    const song = safeJsonObject(row.song_data)
    return song
      ? [{
          ...song,
          id: row.song_id,
          serverId: row.server_id,
          favoritedAt: row.favorited_at,
          updatedAt: row.updated_at,
        }]
      : []
  })

  return res.json({
    items,
    total,
    offset,
    limit,
    /** 下一次增量同步的游标：本批里最大的 updated_at */
    cursor: rows.length ? rows[rows.length - 1].updated_at : since,
  })
})

router.put('/', (req: Request, res: Response) => {
  const parsed = parseRequest(favoriteSchema, req.body, res)
  if (!parsed.success) return
  const { songId, serverId, songData, favoritedAt } = parsed.data
  const now = Math.floor(Date.now() / 1000)
  if (favoritedAt !== undefined && favoritedAt > now + 300) {
    return res.status(400).json({ error: 'favoritedAt must not be more than 5 minutes in the future' })
  }

  const userId = req.user!.userId
  // ON CONFLICT DO UPDATE 时 changes 同样是 1，无法据此区分新增与更新，
  // 因此在同一事务里先探测是否已存在，用于决定 201 还是 200。
  const upsert = db.transaction((): boolean => {
    const existing = db.prepare(
      'SELECT deleted_at FROM favorites WHERE user_id = ? AND song_id = ? AND server_id = ?',
    ).get(userId, songId, serverId) as { deleted_at: number | null } | undefined

    // 重复收藏时刷新元数据快照，但保留最初的收藏时间；
    // 命中墓碑则复活（deleted_at 清空），并把收藏时间重置为这一次
    db.prepare(`
      INSERT INTO favorites (user_id, song_id, server_id, song_data, favorited_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(user_id, song_id, server_id)
      DO UPDATE SET
        song_data = excluded.song_data,
        updated_at = excluded.updated_at,
        favorited_at = CASE WHEN favorites.deleted_at IS NULL
                            THEN favorites.favorited_at
                            ELSE excluded.favorited_at END,
        deleted_at = NULL
    `).run(userId, songId, serverId, JSON.stringify(songData), favoritedAt ?? now, now)

    // 复活也算「新增」：客户端此前收到过删除，这次应当看到 201
    return !existing || existing.deleted_at !== null
  })

  return res.status(upsert() ? 201 : 200).json({ message: 'Favorited' })
})

router.delete('/', (req: Request, res: Response) => {
  const parsedSongId = parseRequest(boundedId, req.query.songId, res)
  if (!parsedSongId.success) return
  const parsedServerId = parseRequest(serverIdSchema, req.query.serverId, res)
  if (!parsedServerId.success) return

  // 立墓碑而不是删除：删除本身也是一条要同步出去的事实
  const now = Math.floor(Date.now() / 1000)
  const result = db.prepare(`
    UPDATE favorites SET deleted_at = ?, updated_at = ?
    WHERE user_id = ? AND song_id = ? AND server_id = ? AND deleted_at IS NULL
  `).run(now, now, req.user!.userId, parsedSongId.data, parsedServerId.data)
  if (!result.changes) return res.status(404).json({ error: 'Favorite not found' })
  return res.json({ message: 'Favorite removed' })
})

/**
 * 墓碑清理。
 *
 * 挂在启动时跑一次即可：删除是低频操作，过期墓碑不会在一天之内堆出问题，
 * 而每次请求都扫一遍表纯属浪费。
 */
export function purgeExpiredTombstones(now = Math.floor(Date.now() / 1000)): number {
  const result = db.prepare('DELETE FROM favorites WHERE deleted_at IS NOT NULL AND deleted_at < ?')
    .run(now - TOMBSTONE_TTL_SECONDS)
  return result.changes
}

export default router
