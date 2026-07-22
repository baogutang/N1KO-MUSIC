import { Response } from 'express'
import { z, ZodType } from 'zod'

export const boundedId = z.string().trim().min(1).max(512)
export const serverIdSchema = z.string().trim().min(1).max(256)
export const eventIdSchema = z.string().trim().min(8).max(128)

export const songDataSchema = z.record(z.string(), z.unknown()).superRefine((value, context) => {
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8')
  if (bytes > 256 * 1024) {
    context.addIssue({ code: 'custom', message: 'Song metadata must not exceed 256 KiB' })
  }
})

export const usernameSchema = z.string().trim().min(3).max(64)
export const passwordSchema = z.string().min(8).max(128).superRefine((value, context) => {
  if (Buffer.byteLength(value, 'utf8') > 72) {
    context.addIssue({ code: 'custom', message: 'Password must not exceed 72 UTF-8 bytes' })
  }
})

export type ParseResult<T> = { success: true; data: T } | { success: false }

export function parseRequest<T>(schema: ZodType<T>, value: unknown, res: Response): ParseResult<T> {
  const parsed = schema.safeParse(value)
  if (parsed.success) return { success: true, data: parsed.data }

  res.status(400).json({
    error: 'Invalid request',
    details: parsed.error.issues.map(issue => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  })
  return { success: false }
}

export function parseBoundedInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number | null {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) return null
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) return null
  return parsed
}

export function safeJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}
