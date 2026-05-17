import { Router, Response } from 'express'
import bcrypt from 'bcryptjs'
import db from '../db'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { getIo } from '../io'

const router = Router()
router.use(authMiddleware)

// 내 정보 조회
router.get('/me', async (req: AuthRequest, res: Response) => {
  const user = await db.get<{
    id: number; email: string; nickname: string; gender: string; dept: string; student_id: string; created_at: string; noshow_count: number
  }>('SELECT id, email, nickname, gender, dept, student_id, created_at, noshow_count FROM users WHERE id = ?', req.userId)

  if (!user) return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' })
  return res.json({ user })
})

// 닉네임 수정
router.put('/profile', async (req: AuthRequest, res: Response) => {
  const { nickname } = req.body as { nickname: string }
  if (!nickname) return res.status(400).json({ message: '닉네임을 입력해주세요.' })
  if (nickname.length > 10) return res.status(400).json({ message: '닉네임은 10자 이하여야 합니다.' })

  await db.run('UPDATE users SET nickname = ? WHERE id = ?', nickname, req.userId)

  const rooms = await db.all<{ room_id: number }>('SELECT room_id FROM room_members WHERE user_id = ?', req.userId)
  const io = getIo()
  for (const room of rooms) {
    io.to(`room:${room.room_id}`).emit('nickname-changed', { userId: req.userId, nickname })
  }

  return res.json({ message: '닉네임이 수정되었습니다.', nickname })
})

// 비밀번호 변경 (로그인 상태에서)
router.put('/password', async (req: AuthRequest, res: Response) => {
  const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string }
  if (!currentPassword || !newPassword) return res.status(400).json({ message: '필수 항목이 누락되었습니다.' })
  if (newPassword.length < 8) return res.status(400).json({ message: '비밀번호는 8자 이상이어야 합니다.' })

  const user = await db.get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', req.userId)
  if (!user) return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' })

  const valid = await bcrypt.compare(currentPassword, user.password_hash)
  if (!valid) return res.status(401).json({ message: '현재 비밀번호가 올바르지 않습니다.' })

  const hash = await bcrypt.hash(newPassword, 10)
  await db.run('UPDATE users SET password_hash = ? WHERE id = ?', hash, req.userId)
  return res.json({ message: '비밀번호가 변경되었습니다.' })
})

// 계정 삭제
router.delete('/me', async (req: AuthRequest, res: Response) => {
  const { password } = req.body as { password: string }
  if (!password) return res.status(400).json({ message: '비밀번호를 입력해주세요.' })

  try {
    const user = await db.get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', req.userId)
    if (!user) return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' })

    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) return res.status(401).json({ message: '비밀번호가 올바르지 않습니다.' })

    const uid = req.userId!

    await db.run('DELETE FROM likes WHERE liker_id = ? OR likee_id = ?', uid, uid)

    const hostedRooms = await db.all<{ id: number }>('SELECT id FROM rooms WHERE host_id = ?', uid)
    for (const room of hostedRooms) {
      await db.run('DELETE FROM pending_appointment_accepts WHERE room_id = ?', room.id)
      await db.run('DELETE FROM pending_appointments WHERE room_id = ?', room.id)
      await db.run('DELETE FROM appointment_accepts WHERE room_id = ?', room.id)
      await db.run('DELETE FROM appointment_verifies WHERE room_id = ?', room.id)
      await db.run('DELETE FROM likes WHERE room_id = ?', room.id)
      await db.run('DELETE FROM ratings WHERE room_id = ?', room.id)
      await db.run('DELETE FROM appointments WHERE room_id = ?', room.id)
      await db.run('DELETE FROM messages WHERE room_id = ?', room.id)
      await db.run('DELETE FROM room_members WHERE room_id = ?', room.id)
    }
    const memberRooms = await db.all<{ room_id: number }>('SELECT room_id FROM room_members WHERE user_id = ?', uid)
    for (const r of memberRooms) {
      await db.run('DELETE FROM pending_appointment_accepts WHERE room_id = ? AND user_id = ?', r.room_id, uid)
      await db.run('DELETE FROM appointment_accepts WHERE room_id = ? AND user_id = ?', r.room_id, uid)
      await db.run('DELETE FROM appointment_verifies WHERE room_id = ? AND user_id = ?', r.room_id, uid)
    }
    await db.run('DELETE FROM rooms WHERE host_id = ?', uid)
    await db.run('DELETE FROM room_members WHERE user_id = ?', uid)
    await db.run('DELETE FROM match_queue WHERE user_id = ?', uid)
    await db.run('DELETE FROM users WHERE id = ?', uid)

    return res.json({ message: '계정이 삭제되었습니다.' })
  } catch (e) {
    console.error('[DELETE /users/me]', e)
    return res.status(500).json({ message: '계정 삭제에 실패했습니다.' })
  }
})

// 내가 참여한 활성 채팅방 목록 조회
router.get('/me/rooms', async (req: AuthRequest, res: Response) => {
  try {
    const rooms = await db.all<{
      id: number; title: string; capacity: number; teamGender: string; status: string; hostId: number
    }>(`
      SELECT r.id, r.title, r.capacity, r.team_gender AS "teamGender", r.status, r.host_id AS "hostId"
      FROM rooms r
      JOIN room_members rm ON rm.room_id = r.id
      WHERE rm.user_id = ? AND r.status IN ('active', 'waiting', 'seeking')
      ORDER BY r.created_at DESC
    `, req.userId)

    const result = await Promise.all(rooms.map(async room => {
      const members = await db.all<{
        id: number; nickname: string; gender: string; dept: string; email: string; student_id: string
      }>(`
        SELECT u.id, u.nickname, u.gender, u.dept, u.email, u.student_id
        FROM room_members rm JOIN users u ON u.id = rm.user_id
        WHERE rm.room_id = ?
        ORDER BY CASE WHEN u.id = ? THEN 0 ELSE 1 END, rm.id ASC
      `, room.id, room.hostId)

      const messages = await db.all('SELECT * FROM messages WHERE room_id = ? ORDER BY created_at ASC', room.id)
      const appointment = await db.get<{ id: number; place: string; datetime_iso: string; accepted: number; verified: number; lat?: number; lng?: number }>('SELECT * FROM appointments WHERE room_id = ?', room.id)
      const acceptedBy = appointment ? (await db.all<{ user_id: number }>('SELECT user_id FROM appointment_accepts WHERE room_id = ?', room.id)).map(r => r.user_id) : []
      const verifiedBy = appointment ? (await db.all<{ user_id: number }>('SELECT user_id FROM appointment_verifies WHERE room_id = ?', room.id)).map(r => r.user_id) : []
      const apptData = appointment ? { ...appointment, acceptedBy, verifiedBy } : undefined

      const pendingAppt = await db.get<{ place: string; datetime_iso: string; lat?: number; lng?: number; proposed_by: number }>(
        'SELECT place, datetime_iso, lat, lng, proposed_by FROM pending_appointments WHERE room_id = ?', room.id
      )
      const pendingAcceptedBy = pendingAppt
        ? (await db.all<{ user_id: number }>('SELECT user_id FROM pending_appointment_accepts WHERE room_id = ?', room.id)).map(r => r.user_id)
        : []
      const pendingApptData = pendingAppt
        ? { place: pendingAppt.place, datetimeISO: pendingAppt.datetime_iso, lat: pendingAppt.lat, lng: pendingAppt.lng, proposedBy: pendingAppt.proposed_by, acceptedBy: pendingAcceptedBy }
        : undefined

      const myLikeRow = await db.get<{ nickname: string }>(
        'SELECT u.nickname FROM likes l JOIN users u ON u.id = l.likee_id WHERE l.room_id = ? AND l.liker_id = ?',
        room.id, req.userId
      )
      const myRatingRows = await db.all<{ ratee_id: number; stars: number }>(
        'SELECT ratee_id, stars FROM ratings WHERE room_id = ? AND rater_id = ?', room.id, req.userId
      )
      const myRatings = myRatingRows.reduce((acc, r) => ({ ...acc, [r.ratee_id]: r.stars }), {} as Record<number, number>)

      return { ...room, members, memberCount: members.length, messages, appointment: apptData, pendingAppointment: pendingApptData, myLikee: myLikeRow?.nickname, myRatings }
    }))

    return res.json({ rooms: result })
  } catch (e) {
    console.error('[GET /users/me/rooms]', e)
    return res.status(500).json({ message: '채팅방 조회에 실패했습니다.' })
  }
})

export default router
