import { Router, Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import db from '../db/database'
import { authMiddleware } from '../middleware/auth'
import { boundedId, parseRequest, safeJsonObject, serverIdSchema } from '../validation'

const router = Router()
router.use(authMiddleware)
const hasOwn = (value: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(value, key)

const nameSchema = z.string().trim().min(1).max(200)
const createPlaylistSchema = z.object({
  name: nameSchema,
  description: z.string().max(2_000).nullable().optional(),
  coverUrl: z.string().max(2_048).nullable().optional(),
}).strict()
const updatePlaylistSchema = z.object({
  name: nameSchema.optional(),
  description: z.string().max(2_000).nullable().optional(),
  coverUrl: z.string().max(2_048).nullable().optional(),
}).strict().refine(value => Object.keys(value).length > 0, 'At least one field is required')
const songSchema = z.object({ id: boundedId }).passthrough().superRefine((song, context) => {
  if (Buffer.byteLength(JSON.stringify(song), 'utf8') > 256 * 1024) {
    context.addIssue({ code: 'custom', message: 'Song metadata must not exceed 256 KiB' })
  }
})
const addSongsSchema = z.object({
  songs: z.array(songSchema).min(1).max(500),
  serverId: serverIdSchema,
}).strict()

interface PlaylistRow {
  id: string
  user_id: string
  name: string
  description: string | null
  cover_url: string | null
  created_at: number
  updated_at: number
}

function pathId(req: Request, res: Response): string | null {
  const parsed = parseRequest(boundedId, req.params.id, res)
  return parsed.success ? parsed.data : null
}

function findOwnedPlaylist(id: string, userId: string): PlaylistRow | undefined {
  return db.prepare('SELECT * FROM playlists WHERE id = ? AND user_id = ?')
    .get(id, userId) as PlaylistRow | undefined
}

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

router.get('/:id', (req: Request, res: Response) => {
  const id = pathId(req, res)
  if (!id) return
  const playlist = findOwnedPlaylist(id, req.user!.userId)
  if (!playlist) return res.status(404).json({ error: 'Playlist not found' })

  const rows = db.prepare(`
    SELECT song_data, server_id FROM playlist_songs
    WHERE playlist_id = ? ORDER BY position ASC, added_at ASC
  `).all(id) as Array<{ song_data: string; server_id: string }>

  const songs = rows.flatMap(row => {
    const song = safeJsonObject(row.song_data)
    return song ? [{ ...song, serverId: row.server_id }] : []
  })
  return res.json({ ...playlist, songs })
})

router.post('/', (req: Request, res: Response) => {
  const parsed = parseRequest(createPlaylistSchema, req.body, res)
  if (!parsed.success) return
  const { name, description, coverUrl } = parsed.data
  const id = randomUUID()
  const now = Math.floor(Date.now() / 1000)

  db.prepare(`
    INSERT INTO playlists (id, user_id, name, description, cover_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.user!.userId, name, description ?? null, coverUrl ?? null, now, now)

  return res.status(201).json(findOwnedPlaylist(id, req.user!.userId))
})

router.put('/:id', (req: Request, res: Response) => {
  const id = pathId(req, res)
  if (!id) return
  const parsed = parseRequest(updatePlaylistSchema, req.body, res)
  if (!parsed.success) return
  const playlist = findOwnedPlaylist(id, req.user!.userId)
  if (!playlist) return res.status(404).json({ error: 'Playlist not found' })

  const update = parsed.data
  const name = hasOwn(update, 'name') ? update.name! : playlist.name
  const description = hasOwn(update, 'description') ? update.description! : playlist.description
  const coverUrl = hasOwn(update, 'coverUrl') ? update.coverUrl! : playlist.cover_url
  const now = Math.floor(Date.now() / 1000)

  db.prepare(`
    UPDATE playlists SET name = ?, description = ?, cover_url = ?, updated_at = ?
    WHERE id = ? AND user_id = ?
  `).run(name, description, coverUrl, now, id, req.user!.userId)

  return res.json(findOwnedPlaylist(id, req.user!.userId))
})

router.delete('/:id', (req: Request, res: Response) => {
  const id = pathId(req, res)
  if (!id) return
  const result = db.prepare('DELETE FROM playlists WHERE id = ? AND user_id = ?')
    .run(id, req.user!.userId)
  if (!result.changes) return res.status(404).json({ error: 'Playlist not found' })
  return res.json({ message: 'Playlist deleted' })
})

router.post('/:id/songs', (req: Request, res: Response) => {
  const id = pathId(req, res)
  if (!id) return
  const parsed = parseRequest(addSongsSchema, req.body, res)
  if (!parsed.success) return
  if (!findOwnedPlaylist(id, req.user!.userId)) {
    return res.status(404).json({ error: 'Playlist not found' })
  }

  const { songs, serverId } = parsed.data
  const now = Math.floor(Date.now() / 1000)
  const insertSong = db.prepare(`
    INSERT INTO playlist_songs (playlist_id, song_id, server_id, song_data, position, added_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(playlist_id, server_id, song_id) DO NOTHING
  `)

  const insertMany = db.transaction(() => {
    const maxPosition = (db.prepare(
      'SELECT MAX(position) AS max_position FROM playlist_songs WHERE playlist_id = ?',
    ).get(id) as { max_position: number | null }).max_position ?? -1
    let inserted = 0
    let position = maxPosition + 1
    for (const song of songs) {
      const result = insertSong.run(id, song.id, serverId, JSON.stringify(song), position, now)
      if (result.changes) {
        inserted++
        position++
      }
    }
    if (inserted > 0) {
      db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ? AND user_id = ?')
        .run(now, id, req.user!.userId)
    }
    return inserted
  })

  const inserted = insertMany()
  return res.json({ message: `Added ${inserted} songs`, inserted })
})

router.delete('/:id/songs/:songId', (req: Request, res: Response) => {
  const id = pathId(req, res)
  if (!id) return
  const parsedSongId = parseRequest(boundedId, req.params.songId, res)
  if (!parsedSongId.success) return
  if (!findOwnedPlaylist(id, req.user!.userId)) {
    return res.status(404).json({ error: 'Playlist not found' })
  }

  let requestedServerId: string | null = null
  if (req.query.serverId !== undefined) {
    const parsedServerId = parseRequest(serverIdSchema, req.query.serverId, res)
    if (!parsedServerId.success) return
    requestedServerId = parsedServerId.data
  }

  if (!requestedServerId) {
    const matches = db.prepare(`
      SELECT server_id FROM playlist_songs
      WHERE playlist_id = ? AND song_id = ?
    `).all(id, parsedSongId.data) as Array<{ server_id: string }>
    if (matches.length > 1) {
      return res.status(409).json({ error: 'serverId is required because this song id exists on multiple servers' })
    }
  }

  const result = db.prepare(`
    DELETE FROM playlist_songs
    WHERE playlist_id = ? AND song_id = ? AND (? IS NULL OR server_id = ?)
  `).run(id, parsedSongId.data, requestedServerId, requestedServerId)
  if (!result.changes) return res.status(404).json({ error: 'Song not found' })

  db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ? AND user_id = ?')
    .run(Math.floor(Date.now() / 1000), id, req.user!.userId)
  return res.json({ message: 'Song removed' })
})

export default router
