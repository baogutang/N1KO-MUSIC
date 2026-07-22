import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'
import db from '../db/database'
import { signToken, authMiddleware } from '../middleware/auth'
import { BCRYPT_ROUNDS } from '../config'
import { parseRequest, passwordSchema, usernameSchema } from '../validation'
import { z } from 'zod'

const router = Router()
const existingPasswordSchema = z.string().min(1).max(128).refine(
  value => Buffer.byteLength(value, 'utf8') <= 72,
  'Password must not exceed 72 UTF-8 bytes',
)
const registerSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
}).strict()
const loginSchema = z.object({
  // Do not normalize here: legacy versions allowed surrounding whitespace in stored usernames.
  username: z.string().min(1).max(256),
  password: existingPasswordSchema,
}).strict()
const changePasswordSchema = z.object({
  currentPassword: existingPasswordSchema,
  newPassword: passwordSchema,
}).strict()
// Keep the expensive bcrypt path for unknown users to reduce username timing leakage.
const dummyPasswordHash = bcrypt.hashSync('n1ko-music-dummy-password', BCRYPT_ROUNDS)

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response) => {
  const parsed = parseRequest(registerSchema, req.body, res)
  if (!parsed.success) return
  const { username, password } = parsed.data

  try {
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username)
    if (existing) {
      return res.status(409).json({ error: 'Username already exists' })
    }

    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS)
    const userId = randomUUID()
    db.prepare('INSERT INTO users (id, username, password) VALUES (?, ?, ?)').run(
      userId, username, hashedPassword
    )

    const token = signToken({ userId, username, tokenVersion: 0 })
    return res.status(201).json({ token, userId, username })
  } catch (err) {
    // 并发注册同名用户时，两个请求可能都通过上面的存在性检查（bcrypt 为异步），
    // 第二个 INSERT 会触发 UNIQUE 约束，此处映射为 409 而非 500
    if ((err as { code?: string })?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Username already exists' })
    }
    console.error('Register error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  const parsed = parseRequest(loginSchema, req.body, res)
  if (!parsed.success) return
  const { username, password } = parsed.data

  try {
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as
      { id: string; username: string; password: string; token_version: number } | undefined

    const passwordMatches = await bcrypt.compare(password, user?.password ?? dummyPasswordHash)
    if (!user || !passwordMatches) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    const token = signToken({ userId: user.id, username: user.username, tokenVersion: user.token_version })
    return res.json({ token, userId: user.id, username: user.username })
  } catch (err) {
    console.error('Login error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /api/auth/me
router.get('/me', authMiddleware, (req: Request, res: Response) => {
  return res.json({ userId: req.user!.userId, username: req.user!.username })
})

// POST /api/auth/change-password
router.post('/change-password', authMiddleware, async (req: Request, res: Response) => {
  const parsed = parseRequest(changePasswordSchema, req.body, res)
  if (!parsed.success) return
  const { currentPassword, newPassword } = parsed.data
  if (currentPassword === newPassword) {
    return res.status(400).json({ error: 'New password must be different from current password' })
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.userId) as
      { id: string; password: string } | undefined

    if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
      return res.status(401).json({ error: 'Current password is incorrect' })
    }

    const hashed = await bcrypt.hash(newPassword, BCRYPT_ROUNDS)
    // 递增 token_version，使改密前签发的所有令牌立即失效
    db.prepare('UPDATE users SET password = ?, token_version = token_version + 1 WHERE id = ?')
      .run(hashed, user.id)
    const { token_version } = db.prepare('SELECT token_version FROM users WHERE id = ?').get(user.id) as
      { token_version: number }
    // 返回新令牌，当前会话可无缝续用
    const token = signToken({ userId: user.id, username: req.user!.username, tokenVersion: token_version })
    return res.json({ message: 'Password updated successfully', token })
  } catch (err) {
    console.error('Change password error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
