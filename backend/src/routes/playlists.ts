import { Router, Request, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import db from '../db/database'
import { authMiddleware } from '../middleware/auth'

const router = Router()
router.use(authMiddleware)

// GET /api/playlists
router.get('/', (req: Request, res: Response) => {
  const playlists = db.prepare(`
    SELECT p.*, COUNT(ps.song_id) as song_count
    FROM playlists p
    LEFT JOIN playlist_songs ps ON p.id = ps.playlist_id
    WHERE p.user_id = ?
    GROUP BY p.id
    ORDER BY p.updated_at DESC
  `).all(req.user!.userId)
  return res.json(playlists)
})

// GET /api/playlists/:id
router.get('/:id', (req: Request, res: Response) => {
  const playlist = db.prepare(
    'SELECT * FROM playlists WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.user!.userId) as { id: string } | undefined

  if (!playlist) return res.status(404).json({ error: 'Playlist not found' })

  const songs = db.prepare(`
    SELECT * FROM playlist_songs WHERE playlist_id = ? ORDER BY position ASC
  `).all(req.params.id) as Array<{ song_data: string }>

  return res.json({
    ...playlist,
    songs: songs.map(s => JSON.parse(s.song_data)),
  })
})

// POST /api/playlists
router.post('/', (req: Request, res: Response) => {
  const { name, description, coverUrl } = req.body
  if (!name) return res.status(400).json({ error: 'Name is required' })

  const id = uuidv4()
  const now = Math.floor(Date.now() / 1000)
  db.prepare(`
    INSERT INTO playlists (id, user_id, name, description, cover_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.user!.userId, name, description ?? null, coverUrl ?? null, now, now)

  const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id)
  return res.status(201).json(playlist)
})

// PUT /api/playlists/:id
router.put('/:id', (req: Request, res: Response) => {
  const { name, description, coverUrl } = req.body
  const playlist = db.prepare(
    'SELECT * FROM playlists WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.user!.userId)

  if (!playlist) return res.status(404).json({ error: 'Playlist not found' })

  const now = Math.floor(Date.now() / 1000)
  db.prepare(`
    UPDATE playlists SET name = ?, description = ?, cover_url = ?, updated_at = ?
    WHERE id = ? AND user_id = ?
  `).run(
    name ?? (playlist as any).name,
    description ?? (playlist as any).description,
    coverUrl ?? (playlist as any).cover_url,
    now,
    req.params.id,
    req.user!.userId
  )

  return res.json(db.prepare('SELECT * FROM playlists WHERE id = ?').get(req.params.id))
})

// DELETE /api/playlists/:id
router.delete('/:id', (req: Request, res: Response) => {
  const result = db.prepare(
    'DELETE FROM playlists WHERE id = ? AND user_id = ?'
  ).run(req.params.id, req.user!.userId)

  if (!result.changes) return res.status(404).json({ error: 'Playlist not found' })
  return res.json({ message: 'Playlist deleted' })
})

// POST /api/playlists/:id/songs
router.post('/:id/songs', (req: Request, res: Response) => {
  const { songs, serverId } = req.body  // songs: Array<Song object>
  if (!Array.isArray(songs) || !serverId) {
    return res.status(400).json({ error: 'songs (array) and serverId are required' })
  }

  const playlist = db.prepare(
    'SELECT * FROM playlists WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.user!.userId)

  if (!playlist) return res.status(404).json({ error: 'Playlist not found' })

  // Get current max position
  const maxPos = (db.prepare(
    'SELECT MAX(position) as max_pos FROM playlist_songs WHERE playlist_id = ?'
  ).get(req.params.id) as { max_pos: number | null })?.max_pos ?? -1

  const insertSong = db.prepare(`
    INSERT OR REPLACE INTO playlist_songs (playlist_id, song_id, server_id, song_data, position, added_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  const now = Math.floor(Date.now() / 1000)
  const insertMany = db.transaction((songs: any[]) => {
    songs.forEach((song, i) => {
      insertSong.run(
        req.params.id, song.id, serverId,
        JSON.stringify(song), maxPos + 1 + i, now
      )
    })
  })

  insertMany(songs)

  // Update playlist updated_at
  db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ? AND user_id = ?')
    .run(now, req.params.id, req.user!.userId)

  return res.json({ message: `Added ${songs.length} songs` })
})

// DELETE /api/playlists/:id/songs/:songId
router.delete('/:id/songs/:songId', (req: Request, res: Response) => {
  const now = Math.floor(Date.now() / 1000)
  const result = db.prepare(`
    DELETE FROM playlist_songs
    WHERE playlist_id = ? AND song_id = ?
      AND EXISTS (
        SELECT 1 FROM playlists p
        WHERE p.id = ? AND p.user_id = ?
      )
  `).run(req.params.id, req.params.songId, req.params.id, req.user!.userId)

  if (!result.changes) {
    return res.status(404).json({ error: 'Playlist or song not found' })
  }

  db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ? AND user_id = ?')
    .run(now, req.params.id, req.user!.userId)

  return res.json({ message: 'Song removed' })
})

export default router
