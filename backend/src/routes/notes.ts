import { Router, Request, Response } from 'express'
import { z } from 'zod'
import db from '../db/database'
import { authMiddleware } from '../middleware/auth'
import {
  boundedId,
  parseBoundedInteger,
  parseRequest,
  serverIdSchema,
} from '../validation'

/**
 * 边注同步。
 *
 * 曲库里的元数据是别人写的，这里存的是**你自己**写的：为什么留着这张专辑、
 * 这首歌是哪年夏天听的。它是整个软件里唯一不能从曲库或行为重新算出来的数据，
 * 因此也是最该被同步和备份的那一份——丢了就是真的丢了。
 *
 * 接口形状与收藏一致（墓碑 + since 增量），两边共用同一套客户端逻辑。
 */
const router = Router()
router.use(authMiddleware)

/** 边注长度上限。够写一段话，又不至于让人把整篇乐评塞进来撑爆同步载荷。 */
const MAX_BODY_LENGTH = 2_000
/** 墓碑保留期，与收藏同口径 */
const TOMBSTONE_TTL_SECONDS = 90 * 24 * 60 * 60

const targetTypeSchema = z.enum(['song', 'album', 'artist'])

const noteSchema = z.object({
  targetType: targetTypeSchema,
  targetId: boundedId,
  serverId: serverIdSchema,
  body: z.string().trim().min(1).max(MAX_BODY_LENGTH),
}).strict()

interface NoteRow {
  target_type: string
  target_id: string
  server_id: string
  body: string
  created_at: number
  updated_at: number
  deleted_at: number | null
}

/**
 * 列出边注。
 *
 * 缺省只返回还活着的；带 since 进入增量模式，包含墓碑，
 * 客户端据此把本地那份也删掉。
 */
router.get('/', (req: Request, res: Response) => {
  const limit = parseBoundedInteger(req.query.limit, 200, 1, 500)
  const offset = parseBoundedInteger(req.query.offset, 0, 0, 1_000_000)
  if (limit === null || offset === null) {
    return res.status(400).json({ error: 'limit must be 1–500 and offset must be 0–1000000' })
  }

  let since: number | null = null
  if (req.query.since !== undefined) {
    since = parseBoundedInteger(req.query.since, 0, 0, 4_102_444_800)
    if (since === null) {
      return res.status(400).json({ error: 'since must be a unix timestamp in seconds' })
    }
  }

  let serverId: string | null = null
  if (req.query.serverId !== undefined) {
    const parsed = parseRequest(serverIdSchema, req.query.serverId, res)
    if (!parsed.success) return
    serverId = parsed.data
  }

  const conditions = ['user_id = ?']
  const params: Array<string | number> = [req.user!.userId]
  if (serverId) {
    conditions.push('server_id = ?')
    params.push(serverId)
  }
  if (since !== null) {
    conditions.push('updated_at > ?')
    params.push(since)
  } else {
    conditions.push('deleted_at IS NULL')
  }
  const where = conditions.join(' AND ')
  const order = since !== null ? 'updated_at ASC' : 'updated_at DESC'

  const rows = db.prepare(`
    SELECT target_type, target_id, server_id, body, created_at, updated_at, deleted_at
    FROM notes WHERE ${where}
    ORDER BY ${order}, target_id ASC LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as NoteRow[]

  const total = (db.prepare(`SELECT COUNT(*) AS count FROM notes WHERE ${where}`)
    .get(...params) as { count: number }).count

  return res.json({
    items: rows.map(row => ({
      targetType: row.target_type,
      targetId: row.target_id,
      serverId: row.server_id,
      // 墓碑不带正文：删掉的东西没必要再发一遍
      ...(row.deleted_at !== null
        ? { deleted: true }
        : { body: row.body, createdAt: row.created_at }),
      updatedAt: row.updated_at,
    })),
    total,
    offset,
    limit,
    /**
     * 下一次增量同步的游标。与收藏同理：取本批真正的最大值（全量模式按
     * updated_at DESC 排，最后一行是最旧的），且只有翻到最后一页才推进——
     * 增量查询用严格大于，分页边界切在同一时间戳中间时提前推进会丢记录。
     */
    cursor: offset + rows.length >= total
      ? rows.reduce((max, row) => Math.max(max, row.updated_at), since ?? 0)
      : since,
  })
})

router.put('/', (req: Request, res: Response) => {
  const parsed = parseRequest(noteSchema, req.body, res)
  if (!parsed.success) return
  const { targetType, targetId, serverId, body } = parsed.data
  const userId = req.user!.userId
  const now = Math.floor(Date.now() / 1000)

  const upsert = db.transaction((): boolean => {
    const existing = db.prepare(`
      SELECT deleted_at FROM notes
      WHERE user_id = ? AND server_id = ? AND target_type = ? AND target_id = ?
    `).get(userId, serverId, targetType, targetId) as { deleted_at: number | null } | undefined

    // 命中墓碑时复活，并把 created_at 重置为这一次：那是一条新写的边注，
    // 不是旧的那条又回来了
    db.prepare(`
      INSERT INTO notes (user_id, target_type, target_id, server_id, body, created_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(user_id, server_id, target_type, target_id)
      DO UPDATE SET
        body = excluded.body,
        updated_at = excluded.updated_at,
        created_at = CASE WHEN notes.deleted_at IS NULL
                          THEN notes.created_at
                          ELSE excluded.created_at END,
        deleted_at = NULL
    `).run(userId, targetType, targetId, serverId, body, now, now)

    return !existing || existing.deleted_at !== null
  })

  return res.status(upsert() ? 201 : 200).json({ message: 'Saved' })
})

router.delete('/', (req: Request, res: Response) => {
  const parsedType = parseRequest(targetTypeSchema, req.query.targetType, res)
  if (!parsedType.success) return
  const parsedTarget = parseRequest(boundedId, req.query.targetId, res)
  if (!parsedTarget.success) return
  const parsedServer = parseRequest(serverIdSchema, req.query.serverId, res)
  if (!parsedServer.success) return

  const now = Math.floor(Date.now() / 1000)
  const result = db.prepare(`
    UPDATE notes SET deleted_at = ?, updated_at = ?, body = ''
    WHERE user_id = ? AND server_id = ? AND target_type = ? AND target_id = ?
      AND deleted_at IS NULL
  `).run(now, now, req.user!.userId, parsedServer.data, parsedType.data, parsedTarget.data)

  if (!result.changes) return res.status(404).json({ error: 'Note not found' })
  return res.json({ message: 'Note removed' })
})

/** 过期墓碑清理，启动时跑一次即可（与收藏同理） */
export function purgeExpiredNoteTombstones(now = Math.floor(Date.now() / 1000)): number {
  return db.prepare('DELETE FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < ?')
    .run(now - TOMBSTONE_TTL_SECONDS).changes
}

export default router
