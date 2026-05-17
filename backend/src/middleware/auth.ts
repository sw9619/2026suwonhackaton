import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import db from '../db'

const JWT_SECRET = process.env.JWT_SECRET || 'suwon-signal-secret-2024'

export interface AuthRequest extends Request {
  userId?: number
  userEmail?: string
}

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ message: '인증이 필요합니다.' })
  }
  const token = header.slice(7)
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: number; email: string }
    const user = await db.get<{ is_suspended: number }>('SELECT is_suspended FROM users WHERE id = ?', payload.userId)
    if (user?.is_suspended) {
      return res.status(403).json({ message: '계정이 정지되었습니다. (만남인증 미이행 3회 누적)' })
    }
    req.userId = payload.userId
    req.userEmail = payload.email
    next()
  } catch {
    return res.status(401).json({ message: '유효하지 않은 토큰입니다.' })
  }
}

export function signToken(userId: number, email: string) {
  return jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: '7d' })
}
