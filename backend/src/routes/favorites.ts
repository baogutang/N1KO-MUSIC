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

router.get('/', (req: Request, res: Response) => {
  const limit = parseBoundedInteger(req.query.limit, 200, 1, 500)
  const offset = parseBoundedInteger(req.query.offset, 0, 0, 1_000_000)
  if (limit === null || offset === null) {
    return res.status(400).json({ error: 'limit must be 1–500 and offset must be 0–1000000' })
  }
  const server = optionalServerId(req, res)
  if (!server.valid) return
  const scope = scopeSql(server.value)
  const params = [req.user!.userId, ...scope.params]

  const rows = db.prepare(`
    SELECT song_id, server_id, song_data, favorited_at FROM favorites
    WHERE ${scope.where}
    ORDER BY favorited_at DESC, song_id ASC LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as Array<{
    song_id: string
    server_id: string
    song_data: string
    favorited_at: number
  }>
  const total = (db.prepare(
    `SELECT COUNT(*) AS count FROM favorites WHERE ${scope.where}`,
  ).get(...params) as { count: number }).count

  return res.json({
    items: rows.flatMap(row => {
      const song = safeJsonObject(row.song_data)
      return song
        ? [{ ...song, id: row.song_id, serverId: row.server_id, favoritedAt: row.favorited_at }]
        : []
    }),
    total,
    offset,
    limit,
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
      'SELECT 1 FROM favorites WHERE user_id = ? AND song_id = ? AND server_id = ?',
    ).get(userId, songId, serverId)

    // 重复收藏时刷新元数据快照，但保留最初的收藏时间
    db.prepare(`
      INSERT INTO favorites (user_id, song_id, server_id, song_data, favorited_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, song_id, server_id)
      DO UPDATE SET song_data = excluded.song_data
    `).run(userId, songId, serverId, JSON.stringify(songData), favoritedAt ?? now)

    return !existing
  })

  return res.status(upsert() ? 201 : 200).json({ message: 'Favorited' })
})

router.delete('/', (req: Request, res: Response) => {
  const parsedSongId = parseRequest(boundedId, req.query.songId, res)
  if (!parsedSongId.success) return
  const parsedServerId = parseRequest(serverIdSchema, req.query.serverId, res)
  if (!parsedServerId.success) return

  const result = db.prepare(
    'DELETE FROM favorites WHERE user_id = ? AND song_id = ? AND server_id = ?',
  ).run(req.user!.userId, parsedSongId.data, parsedServerId.data)
  if (!result.changes) return res.status(404).json({ error: 'Favorite not found' })
  return res.json({ message: 'Favorite removed' })
})

export default router
