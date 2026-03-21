import { Router, Request, Response } from 'express'
import db from '../db/database'
import { authMiddleware } from '../middleware/auth'

const router = Router()
router.use(authMiddleware)

// POST /api/stats/scrobble - 上报播放记录
router.post('/scrobble', (req: Request, res: Response) => {
  const { songId, serverId, songData, duration } = req.body
  if (!songId || !serverId || !songData) {
    return res.status(400).json({ error: 'songId, serverId, songData are required' })
  }

  const now = Math.floor(Date.now() / 1000)
  db.prepare(`
    INSERT INTO play_history (user_id, song_id, server_id, song_data, played_at, duration)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    req.user!.userId, songId, serverId,
    JSON.stringify(songData), now, duration ?? null
  )

  return res.status(201).json({ message: 'Scrobbled' })
})

// GET /api/stats/history - 获取播放历史
router.get('/history', (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit ?? 100), 500)
  const offset = Number(req.query.offset ?? 0)

  const rows = db.prepare(`
    SELECT * FROM play_history WHERE user_id = ?
    ORDER BY played_at DESC LIMIT ? OFFSET ?
  `).all(req.user!.userId, limit, offset) as Array<{ song_data: string; [key: string]: any }>

  const total = (db.prepare(
    'SELECT COUNT(*) as count FROM play_history WHERE user_id = ?'
  ).get(req.user!.userId) as { count: number }).count

  return res.json({
    items: rows.map(r => ({
      ...r,
      songData: JSON.parse(r.song_data),
    })),
    total,
    offset,
    limit,
  })
})

// GET /api/stats/summary - 获取统计摘要
router.get('/summary', (req: Request, res: Response) => {
  const userId = req.user!.userId

  const totalPlays = (db.prepare(
    'SELECT COUNT(*) as count FROM play_history WHERE user_id = ?'
  ).get(userId) as { count: number }).count

  const totalDuration = (db.prepare(
    'SELECT SUM(duration) as total FROM play_history WHERE user_id = ? AND duration IS NOT NULL'
  ).get(userId) as { total: number | null }).total ?? 0

  // Top songs
  const topSongs = db.prepare(`
    SELECT song_id, song_data, COUNT(*) as play_count
    FROM play_history WHERE user_id = ?
    GROUP BY song_id
    ORDER BY play_count DESC LIMIT 10
  `).all(userId) as Array<{ song_data: string; play_count: number }>

  // Top artists (extracted from song_data JSON)
  const artistCounts = new Map<string, number>()
  const allHistory = db.prepare(
    'SELECT song_data FROM play_history WHERE user_id = ?'
  ).all(userId) as Array<{ song_data: string }>

  allHistory.forEach(row => {
    try {
      const song = JSON.parse(row.song_data)
      const artist = song.artist ?? 'Unknown'
      artistCounts.set(artist, (artistCounts.get(artist) ?? 0) + 1)
    } catch { /* skip */ }
  })

  const topArtists = Array.from(artistCounts.entries())
    .map(([name, count]) => ({ name, playCount: count }))
    .sort((a, b) => b.playCount - a.playCount)
    .slice(0, 10)

  // Monthly data (last 12 months)
  const monthlyData = db.prepare(`
    SELECT
      strftime('%Y-%m', played_at, 'unixepoch') as month,
      COUNT(*) as plays,
      SUM(COALESCE(duration, 0)) as duration
    FROM play_history WHERE user_id = ?
    GROUP BY month ORDER BY month DESC LIMIT 12
  `).all(userId)

  return res.json({
    totalPlays,
    totalDuration,
    topSongs: topSongs.map(r => ({
      ...JSON.parse(r.song_data),
      playCount: r.play_count,
    })),
    topArtists,
    monthlyData,
  })
})

// DELETE /api/stats/history - 清除播放历史
router.delete('/history', (req: Request, res: Response) => {
  db.prepare('DELETE FROM play_history WHERE user_id = ?').run(req.user!.userId)
  return res.json({ message: 'History cleared' })
})

export default router
