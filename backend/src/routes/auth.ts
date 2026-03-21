import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'
import db from '../db/database'
import { signToken, authMiddleware } from '../middleware/auth'

const router = Router()

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response) => {
  const { username, password } = req.body
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' })
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' })
  }

  try {
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username)
    if (existing) {
      return res.status(409).json({ error: 'Username already exists' })
    }

    const hashedPassword = await bcrypt.hash(password, 10)
    const userId = uuidv4()
    db.prepare('INSERT INTO users (id, username, password) VALUES (?, ?, ?)').run(
      userId, username, hashedPassword
    )

    const token = signToken({ userId, username })
    return res.status(201).json({ token, userId, username })
  } catch (err) {
    console.error('Register error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  const { username, password } = req.body
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' })
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as
      { id: string; username: string; password: string } | undefined

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    const token = signToken({ userId: user.id, username: user.username })
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
  const { currentPassword, newPassword } = req.body
  if (!currentPassword || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'Invalid request' })
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.userId) as
      { id: string; password: string } | undefined

    if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
      return res.status(401).json({ error: 'Current password is incorrect' })
    }

    const hashed = await bcrypt.hash(newPassword, 10)
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashed, user.id)
    return res.json({ message: 'Password updated successfully' })
  } catch (err) {
    console.error('Change password error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
