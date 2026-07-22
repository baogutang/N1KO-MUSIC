import { Router, Request, Response } from 'express'
import { z } from 'zod'
import db from '../db/database'
import { authMiddleware } from '../middleware/auth'
import {
  boundedId,
  eventIdSchema,
  parseBoundedInteger,
  parseRequest,
  safeJsonObject,
  serverIdSchema,
  songDataSchema,
} from '../validation'

const router = Router()
router.use(authMiddleware)

const scrobbleSchema = z.object({
  eventId: eventIdSchema,
  songId: boundedId,
  serverId: serverIdSchema,
  songData: songDataSchema,
  duration: z.number().int().min(0).max(86_400).nullable().optional(),
  playedAt: z.number().int().min(946_684_800).optional(),
}).strict()

function optionalServerId(req: Request, res: Response): { valid: boolean; value: string | null } {
  if (req.query.serverId === undefined) return { valid: true, value: null }
  const parsed = parseRequest(serverIdSchema, req.query.serverId, res)
  return parsed.success
    ? { valid: true, value: parsed.data }
    : { valid: false, value: null }
}

function scopeSql(serverId: string | null): { where: string; params: string[] } {
  return serverId
    ? { where: 'user_id = ? AND server_id = ?', params: [serverId] }
    : { where: 'user_id = ?', params: [] }
}

router.post('/scrobble', (req: Request, res: Response) => {
  const parsed = parseRequest(scrobbleSchema, req.body, res)
  if (!parsed.success) return
  const { eventId, songId, serverId, songData, duration, playedAt } = parsed.data
  const now = Math.floor(Date.now() / 1000)
  if (playedAt !== undefined && playedAt > now + 300) {
    return res.status(400).json({ error: 'playedAt must not be more than 5 minutes in the future' })
  }

  const result = db.prepare(`
    INSERT INTO play_history (user_id, event_id, song_id, server_id, song_data, played_at, duration)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, event_id) WHERE event_id IS NOT NULL DO NOTHING
  `).run(
    req.user!.userId,
    eventId,
    songId,
    serverId,
    JSON.stringify(songData),
    playedAt ?? now,
    duration ?? null,
  )

  return res.status(result.changes ? 201 : 200).json({
    message: result.changes ? 'Scrobbled' : 'Already scrobbled',
    duplicate: result.changes === 0,
  })
})

router.get('/history', (req: Request, res: Response) => {
  const limit = parseBoundedInteger(req.query.limit, 100, 1, 500)
  const offset = parseBoundedInteger(req.query.offset, 0, 0, 1_000_000)
  if (limit === null || offset === null) {
    return res.status(400).json({ error: 'limit must be 1–500 and offset must be 0–1000000' })
  }
  const server = optionalServerId(req, res)
  if (!server.valid) return
  const scope = scopeSql(server.value)
  const params = [req.user!.userId, ...scope.params]

  const rows = db.prepare(`
    SELECT * FROM play_history WHERE ${scope.where}
    ORDER BY played_at DESC, id DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as Array<{ song_data: string; [key: string]: unknown }>
  const total = (db.prepare(
    `SELECT COUNT(*) AS count FROM play_history WHERE ${scope.where}`,
  ).get(...params) as { count: number }).count

  return res.json({
    items: rows.map(row => {
      const { song_data: songDataJson, ...fields } = row
      return { ...fields, songData: safeJsonObject(songDataJson) }
    }),
    total,
    offset,
    limit,
  })
})

router.get('/summary', (req: Request, res: Response) => {
  const userId = req.user!.userId
  const server = optionalServerId(req, res)
  if (!server.valid) return
  const scope = scopeSql(server.value)
  const params = [userId, ...scope.params]

  const totalPlays = (db.prepare(
    `SELECT COUNT(*) AS count FROM play_history WHERE ${scope.where}`,
  ).get(...params) as { count: number }).count
  const totalDuration = (db.prepare(`
    SELECT SUM(duration) AS total FROM play_history
    WHERE ${scope.where} AND duration IS NOT NULL
  `).get(...params) as { total: number | null }).total ?? 0

  const topSongs = db.prepare(`
    WITH ranked AS (
      SELECT
        server_id,
        song_id,
        song_data,
        COUNT(*) OVER (PARTITION BY server_id, song_id) AS play_count,
        ROW_NUMBER() OVER (
          PARTITION BY server_id, song_id ORDER BY played_at DESC, id DESC
        ) AS snapshot_rank
      FROM play_history
      WHERE ${scope.where}
    )
    SELECT server_id, song_id, song_data, play_count
    FROM ranked WHERE snapshot_rank = 1
    ORDER BY play_count DESC, song_id ASC LIMIT 10
  `).all(...params) as Array<{
    server_id: string
    song_id: string
    song_data: string
    play_count: number
  }>

  const topArtists = db.prepare(`
    SELECT
      CASE
        WHEN json_valid(song_data) AND json_type(song_data, '$.artist') = 'text'
          THEN COALESCE(NULLIF(json_extract(song_data, '$.artist'), ''), 'Unknown')
        ELSE 'Unknown'
      END AS name,
      COUNT(*) AS playCount
    FROM play_history
    WHERE ${scope.where}
    GROUP BY name
    ORDER BY playCount DESC, name ASC LIMIT 10
  `).all(...params)

  const tzOffsetMinutes = parseBoundedInteger(req.query.tzOffsetMinutes, 0, -840, 840)
  if (tzOffsetMinutes === null) {
    return res.status(400).json({ error: 'tzOffsetMinutes must be an integer between -840 and 840' })
  }
  const monthExpression = `strftime('%Y-%m', played_at + ?, 'unixepoch')`
  const monthlyData = db.prepare(`
    SELECT
      ${monthExpression} AS month,
      COUNT(*) AS plays,
      SUM(COALESCE(duration, 0)) AS duration
    FROM play_history WHERE ${scope.where}
    GROUP BY month ORDER BY month DESC LIMIT 12
  `).all(tzOffsetMinutes * 60, ...params)

  return res.json({
    totalPlays,
    totalDuration,
    topSongs: topSongs.flatMap(row => {
      const song = safeJsonObject(row.song_data)
      return song ? [{ ...song, serverId: row.server_id, playCount: row.play_count }] : []
    }),
    topArtists,
    monthlyData,
  })
})

router.delete('/history', (req: Request, res: Response) => {
  const server = optionalServerId(req, res)
  if (!server.valid) return
  const scope = scopeSql(server.value)
  const result = db.prepare(`DELETE FROM play_history WHERE ${scope.where}`)
    .run(req.user!.userId, ...scope.params)
  return res.json({ message: 'History cleared', deleted: result.changes })
})

export default router
