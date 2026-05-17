import { Router, Response } from 'express'
import db from '../db'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { getIo } from '../io'

const router = Router()
router.use(authMiddleware)

function makeCode() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

// 방 만들기
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { capacity, teamGender, allowDuplicate } = req.body as { capacity: number; teamGender: string; allowDuplicate?: boolean }
    if (!capacity || !teamGender) return res.status(400).json({ message: '인원수와 팀 성별이 필요합니다.' })

    const user = await db.get<{ nickname: string }>('SELECT nickname FROM users WHERE id = ?', req.userId)
    if (!user) return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' })

    const title = `${capacity}v${capacity} 과팅`
    let code = makeCode()
    while (await db.get('SELECT id FROM rooms WHERE code = ?', code)) code = makeCode()

    const result = await db.run(
      'INSERT INTO rooms (title, code, host_id, capacity, team_gender, allow_duplicate) VALUES (?, ?, ?, ?, ?, ?)',
      title, code, req.userId, capacity, teamGender, allowDuplicate !== false ? 1 : 0
    )

    const roomId = result.lastInsertRowid
    await db.run('INSERT INTO room_members (room_id, user_id) VALUES (?, ?)', roomId, req.userId)
    await db.run(
      'INSERT INTO messages (room_id, user_id, nickname, text, type) VALUES (?, ?, ?, ?, ?)',
      roomId, null, '시스템', `🏠 ${user.nickname}님이 방을 만들었어요!`, 'system'
    )

    return res.status(201).json({
      room: { id: roomId, title, code, capacity, teamGender, memberCount: 1 },
    })
  } catch (e) {
    console.error('[POST /rooms]', e)
    return res.status(500).json({ message: '방 만들기에 실패했습니다.' })
  }
})

// 공개 방 목록
router.get('/public', async (req: AuthRequest, res: Response) => {
  try {
    const rooms = await db.all(`
      SELECT r.id, r.title, r.code, r.capacity, r.team_gender AS "teamGender",
             COUNT(rm.id) AS "memberCount"
      FROM rooms r
      LEFT JOIN room_members rm ON rm.room_id = r.id
      WHERE r.status = 'waiting'
      GROUP BY r.id
      HAVING COUNT(rm.id) < r.capacity
      ORDER BY r.created_at DESC
      LIMIT 20
    `)
    return res.json({ rooms })
  } catch (e) {
    console.error('[GET /rooms/public]', e)
    return res.status(500).json({ message: '방 목록 조회에 실패했습니다.' })
  }
})

// 코드로 방 참여
router.post('/join', async (req: AuthRequest, res: Response) => {
  try {
    const { code } = req.body as { code: string }
    if (!code) return res.status(400).json({ message: '초대 코드가 필요합니다.' })

    const room = await db.get<{
      id: number; title: string; code: string; capacity: number; team_gender: string; status: string; host_id: number
    }>('SELECT * FROM rooms WHERE code = ?', code)

    if (!room) return res.status(404).json({ message: '존재하지 않는 방입니다.' })
    if (room.status !== 'waiting') return res.status(400).json({ message: '이미 시작된 방입니다.' })

    const me = await db.get<{ gender: string }>('SELECT gender FROM users WHERE id = ?', req.userId)
    if (me && room.team_gender !== me.gender) return res.status(403).json({ message: `이 방은 ${room.team_gender}자 전용이에요.` })

    const countRow = await db.get<{ cnt: string }>('SELECT COUNT(*) AS cnt FROM room_members WHERE room_id = ?', room.id)
    const memberCount = Number(countRow?.cnt ?? 0)
    if (memberCount >= room.capacity) return res.status(400).json({ message: '방이 가득 찼습니다.' })

    const wasKicked = await db.get('SELECT id FROM room_kicks WHERE room_id = ? AND user_id = ?', room.id, req.userId)
    if (wasKicked) return res.status(403).json({ message: '이 방에서 추방되어 다시 입장할 수 없습니다.' })

    const alreadyIn = await db.get('SELECT id FROM room_members WHERE room_id = ? AND user_id = ?', room.id, req.userId)
    if (!alreadyIn) {
      await db.run('INSERT INTO room_members (room_id, user_id) VALUES (?, ?)', room.id, req.userId)
      const user = await db.get<{ nickname: string }>('SELECT nickname FROM users WHERE id = ?', req.userId)
      await db.run(
        'INSERT INTO messages (room_id, user_id, nickname, text, type) VALUES (?, ?, ?, ?, ?)',
        room.id, null, '시스템', `👋 ${user?.nickname}님이 입장했어요!`, 'system'
      )
    }

    const updatedMembers = await db.all<{ nickname: string; id: number }>(`
      SELECT u.nickname, u.id
      FROM room_members rm JOIN users u ON u.id = rm.user_id
      WHERE rm.room_id = ?
      ORDER BY CASE WHEN u.id = ? THEN 0 ELSE 1 END, rm.id ASC
    `, room.id, room.host_id)

    const io = getIo()
    io.to(`room:${room.id}`).emit('member-joined', {
      members: updatedMembers.map(m => m.nickname),
      memberCount: updatedMembers.length,
      hostId: room.host_id,
    })

    return res.json({
      room: { id: room.id, title: room.title, code: room.code, capacity: room.capacity, teamGender: room.team_gender, memberCount: updatedMembers.length, hostId: room.host_id },
    })
  } catch (e) {
    console.error('[POST /rooms/join]', e)
    return res.status(500).json({ message: '방 참여에 실패했습니다.' })
  }
})

// 방 정보 조회
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const roomId = parseInt(req.params.id)

    const room = await db.get<{
      id: number; title: string; code: string; capacity: number; team_gender: string; status: string; host_id: number
    }>('SELECT * FROM rooms WHERE id = ?', roomId)

    if (!room) return res.status(404).json({ message: '방을 찾을 수 없습니다.' })

    const members = await db.all<{ id: number; nickname: string; gender: string; dept: string; email: string; student_id: string }>(`
      SELECT u.id, u.nickname, u.gender, u.dept, u.email, u.student_id
      FROM room_members rm
      JOIN users u ON u.id = rm.user_id
      WHERE rm.room_id = ?
      ORDER BY CASE WHEN u.id = ? THEN 0 ELSE 1 END, rm.id ASC
    `, roomId, room.host_id)

    const messages = await db.all('SELECT * FROM messages WHERE room_id = ? ORDER BY created_at ASC', roomId)
    const appointment = await db.get<{ id: number; place: string; datetime_iso: string; accepted: number; verified: number; lat?: number; lng?: number }>('SELECT * FROM appointments WHERE room_id = ?', roomId)
    const acceptedBy = appointment ? (await db.all<{ user_id: number }>('SELECT user_id FROM appointment_accepts WHERE room_id = ?', roomId)).map(r => r.user_id) : []
    const verifiedBy = appointment ? (await db.all<{ user_id: number }>('SELECT user_id FROM appointment_verifies WHERE room_id = ?', roomId)).map(r => r.user_id) : []
    const apptData = appointment ? { ...appointment, acceptedBy, verifiedBy } : undefined

    const pendingAppt = await db.get<{ place: string; datetime_iso: string; lat?: number; lng?: number; proposed_by: number }>(
      'SELECT place, datetime_iso, lat, lng, proposed_by FROM pending_appointments WHERE room_id = ?', roomId
    )
    const pendingAcceptedBy = pendingAppt
      ? (await db.all<{ user_id: number }>('SELECT user_id FROM pending_appointment_accepts WHERE room_id = ?', roomId)).map(r => r.user_id)
      : []
    const pendingApptData = pendingAppt
      ? { place: pendingAppt.place, datetimeISO: pendingAppt.datetime_iso, lat: pendingAppt.lat, lng: pendingAppt.lng, proposedBy: pendingAppt.proposed_by, acceptedBy: pendingAcceptedBy }
      : undefined

    const myLikeRow = await db.get<{ nickname: string }>(
      'SELECT u.nickname FROM likes l JOIN users u ON u.id = l.likee_id WHERE l.room_id = ? AND l.liker_id = ?',
      roomId, req.userId
    )
    const myRatingRows = await db.all<{ ratee_id: number; stars: number }>(
      'SELECT ratee_id, stars FROM ratings WHERE room_id = ? AND rater_id = ?', roomId, req.userId
    )
    const myRatings = myRatingRows.reduce((acc, r) => ({ ...acc, [r.ratee_id]: r.stars }), {} as Record<number, number>)

    return res.json({ room: { ...room, teamGender: room.team_gender, hostId: room.host_id, members, memberCount: members.length, messages, appointment: apptData, pendingAppointment: pendingApptData, myLikee: myLikeRow?.nickname, myRatings } })
  } catch (e) {
    console.error('[GET /rooms/:id]', e)
    return res.status(500).json({ message: '방 정보 조회에 실패했습니다.' })
  }
})

// 팀원 추방 (방장 전용)
router.delete('/:id/members/:userId', async (req: AuthRequest, res: Response) => {
  try {
    const roomId = parseInt(req.params.id)
    const targetUserId = parseInt(req.params.userId)

    const room = await db.get<{ host_id: number }>('SELECT host_id FROM rooms WHERE id = ?', roomId)
    if (!room) return res.status(404).json({ message: '방을 찾을 수 없습니다.' })
    if (room.host_id !== req.userId) return res.status(403).json({ message: '방장만 추방할 수 있습니다.' })
    if (targetUserId === req.userId) return res.status(400).json({ message: '자신을 추방할 수 없습니다.' })

    const target = await db.get<{ nickname: string }>('SELECT nickname FROM users WHERE id = ?', targetUserId)
    if (!target) return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' })

    await db.run('DELETE FROM room_members WHERE room_id = ? AND user_id = ?', roomId, targetUserId)
    await db.run('INSERT OR IGNORE INTO room_kicks (room_id, user_id) VALUES (?, ?)', roomId, targetUserId)
    await db.run(
      'INSERT INTO messages (room_id, user_id, nickname, text, type) VALUES (?, ?, ?, ?, ?)',
      roomId, null, '시스템', `🚫 ${target.nickname}님이 추방되었습니다.`, 'system'
    )

    const updatedMembers = await db.all<{ nickname: string; id: number }>(`
      SELECT u.nickname, u.id
      FROM room_members rm JOIN users u ON u.id = rm.user_id
      WHERE rm.room_id = ?
      ORDER BY CASE WHEN u.id = ? THEN 0 ELSE 1 END, rm.id ASC
    `, roomId, room.host_id)

    const io = getIo()
    io.to(`room:${roomId}`).emit('member-joined', {
      members: updatedMembers.map(m => m.nickname),
      memberCount: updatedMembers.length,
      hostId: room.host_id,
    })
    io.to(`user:${targetUserId}`).emit('kicked-from-room', { roomId })

    return res.json({ message: '추방되었습니다.' })
  } catch (e) {
    console.error('[DELETE /rooms/:id/members/:userId]', e)
    return res.status(500).json({ message: '추방에 실패했습니다.' })
  }
})

// 방 나가기
router.delete('/:id/leave', async (req: AuthRequest, res: Response) => {
  try {
    const roomId = parseInt(req.params.id)
    const userId = req.userId!
    const user = await db.get<{ nickname: string }>('SELECT nickname FROM users WHERE id = ?', userId)
    const room = await db.get<{ host_id: number; status: string }>('SELECT host_id, status FROM rooms WHERE id = ?', roomId)

    // 노쇼 여부 확인: 약속 수락 완료 + 인증 시간 초과 + 미인증
    const appt = await db.get<{ accepted: number; datetime_iso: string }>(
      'SELECT accepted, datetime_iso FROM appointments WHERE room_id = ?', roomId
    )
    if (appt?.accepted === 1) {
      const verified = await db.get(
        'SELECT id FROM appointment_verifies WHERE room_id = ? AND user_id = ?', roomId, userId
      )
      if (!verified) {
        const deadline = new Date(appt.datetime_iso).getTime() + 30 * 60 * 1000
        if (Date.now() > deadline) {
          // 노쇼 카운트 증가
          await db.run('UPDATE users SET noshow_count = noshow_count + 1 WHERE id = ?', userId)
          const updated = await db.get<{ noshow_count: number }>('SELECT noshow_count FROM users WHERE id = ?', userId)
          if ((updated?.noshow_count ?? 0) >= 3) {
            await db.run('UPDATE users SET is_suspended = 1 WHERE id = ?', userId)
          }
        }
      }
    }

    const io = getIo()

    if (room && room.host_id === req.userId && room.status === 'waiting') {
      await db.run('DELETE FROM room_members WHERE room_id = ?', roomId)
      await db.run("UPDATE rooms SET status = 'closed' WHERE id = ?", roomId)
      io.to(`room:${roomId}`).emit('room-closed', { roomId, reason: '방장이 방을 나갔습니다.' })
    } else {
      await db.run('DELETE FROM room_members WHERE room_id = ? AND user_id = ?', roomId, req.userId)
      await db.run(
        'INSERT INTO messages (room_id, user_id, nickname, text, type) VALUES (?, ?, ?, ?, ?)',
        roomId, null, '시스템', `🚪 ${user?.nickname}님이 퇴장했어요.`, 'system'
      )

      const updatedMembers = await db.all<{ nickname: string }>(`
        SELECT u.nickname FROM room_members rm JOIN users u ON u.id = rm.user_id
        WHERE rm.room_id = ?
        ORDER BY CASE WHEN u.id = ? THEN 0 ELSE 1 END, rm.id ASC
      `, roomId, room?.host_id ?? 0)

      io.to(`room:${roomId}`).emit('member-joined', {
        members: updatedMembers.map(m => m.nickname),
        memberCount: updatedMembers.length,
        hostId: room?.host_id,
      })

      if (updatedMembers.length === 0) {
        await db.run("UPDATE rooms SET status = 'closed' WHERE id = ?", roomId)
      }
    }

    return res.json({ message: '방을 나갔습니다.' })
  } catch (e) {
    console.error('[DELETE /rooms/:id/leave]', e)
    return res.status(500).json({ message: '방 나가기에 실패했습니다.' })
  }
})

// 약속 설정 (기존 약속 있으면 대기 제안으로 저장)
router.post('/:id/appointment', async (req: AuthRequest, res: Response) => {
  try {
    const roomId = parseInt(req.params.id)
    const { place, datetimeISO, lat, lng } = req.body as { place: string; datetimeISO: string; lat?: number; lng?: number }
    if (!place || !datetimeISO) return res.status(400).json({ message: '장소와 시간이 필요합니다.' })

    const existingAppt = await db.get('SELECT id FROM appointments WHERE room_id = ?', roomId)

    if (existingAppt) {
      // 기존 약속이 있으면 변경 제안(pending)으로 저장
      await db.run(`
        INSERT INTO pending_appointments (room_id, place, datetime_iso, lat, lng, proposed_by)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (room_id) DO UPDATE SET place = EXCLUDED.place, datetime_iso = EXCLUDED.datetime_iso, lat = EXCLUDED.lat, lng = EXCLUDED.lng, proposed_by = EXCLUDED.proposed_by
      `, roomId, place, datetimeISO, lat ?? null, lng ?? null, req.userId)

      await db.run('DELETE FROM pending_appointment_accepts WHERE room_id = ?', roomId)

      const user = await db.get<{ nickname: string }>('SELECT nickname FROM users WHERE id = ?', req.userId)
      await db.run(
        'INSERT INTO messages (room_id, user_id, nickname, text, type) VALUES (?, ?, ?, ?, ?)',
        roomId, null, '시스템', `📍 ${user?.nickname}님이 약속 장소 변경을 제안했어요.`, 'text'
      )

      const io = getIo()
      io.to(`room:${roomId}`).emit('pending-appointment-set', {
        roomId, place, datetimeISO, lat: lat ?? null, lng: lng ?? null, proposedBy: req.userId, acceptedBy: []
      })

      return res.json({ message: '약속 변경이 제안되었습니다.', pending: true })
    }

    // 새 약속 설정
    await db.run(`
      INSERT INTO appointments (room_id, place, datetime_iso, lat, lng)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (room_id) DO UPDATE SET place = EXCLUDED.place, datetime_iso = EXCLUDED.datetime_iso, lat = EXCLUDED.lat, lng = EXCLUDED.lng, accepted = 0, verified = 0
    `, roomId, place, datetimeISO, lat ?? null, lng ?? null)

    await db.run('DELETE FROM appointment_accepts WHERE room_id = ?', roomId)
    await db.run('DELETE FROM appointment_verifies WHERE room_id = ?', roomId)

    await db.run(
      'INSERT INTO messages (room_id, user_id, nickname, text, type) VALUES (?, ?, ?, ?, ?)',
      roomId, req.userId, null, '', 'appointment'
    )

    return res.json({ message: '약속이 설정되었습니다.', pending: false })
  } catch (e) {
    console.error('[POST /rooms/:id/appointment]', e)
    return res.status(500).json({ message: '약속 설정에 실패했습니다.' })
  }
})

// 약속 변경 제안 수락
router.put('/:id/appointment/pending/accept', async (req: AuthRequest, res: Response) => {
  try {
    const roomId = parseInt(req.params.id)
    const userId = req.userId!

    const pending = await db.get<{ place: string; datetime_iso: string; lat?: number; lng?: number }>(
      'SELECT * FROM pending_appointments WHERE room_id = ?', roomId
    )
    if (!pending) return res.status(404).json({ message: '제안된 약속 변경이 없습니다.' })

    await db.run('INSERT OR IGNORE INTO pending_appointment_accepts (room_id, user_id) VALUES (?, ?)', roomId, userId)

    const accepts = await db.all<{ user_id: number }>('SELECT user_id FROM pending_appointment_accepts WHERE room_id = ?', roomId)
    const room = await db.get<{ capacity: number }>('SELECT capacity FROM rooms WHERE id = ?', roomId)
    const acceptedBy = accepts.map(a => a.user_id)
    const isFullyAccepted = !!room && acceptedBy.length >= room.capacity

    const io = getIo()

    if (isFullyAccepted) {
      // 약속을 즉시 confirmed 상태로 설정
      await db.run(`
        INSERT INTO appointments (room_id, place, datetime_iso, lat, lng, accepted)
        VALUES (?, ?, ?, ?, ?, 1)
        ON CONFLICT (room_id) DO UPDATE SET place = EXCLUDED.place, datetime_iso = EXCLUDED.datetime_iso, lat = EXCLUDED.lat, lng = EXCLUDED.lng, accepted = 1, verified = 0
      `, roomId, pending.place, pending.datetime_iso, pending.lat ?? null, pending.lng ?? null)

      // 기존 수락/인증 초기화
      await db.run('DELETE FROM appointment_accepts WHERE room_id = ?', roomId)
      await db.run('DELETE FROM appointment_verifies WHERE room_id = ?', roomId)

      // 모든 멤버를 수락 처리
      const members = await db.all<{ user_id: number }>('SELECT user_id FROM room_members WHERE room_id = ?', roomId)
      const allMemberIds = members.map(m => m.user_id)
      for (const memberId of allMemberIds) {
        await db.run('INSERT OR IGNORE INTO appointment_accepts (room_id, user_id) VALUES (?, ?)', roomId, memberId)
      }

      await db.run('DELETE FROM pending_appointments WHERE room_id = ?', roomId)
      await db.run('DELETE FROM pending_appointment_accepts WHERE room_id = ?', roomId)

      await db.run(
        'INSERT INTO messages (room_id, user_id, nickname, text, type) VALUES (?, ?, ?, ?, ?)',
        roomId, null, '시스템', '', 'appointment'
      )

      io.to(`room:${roomId}`).emit('appointment-updated', {
        roomId, place: pending.place, datetimeISO: pending.datetime_iso,
        lat: pending.lat, lng: pending.lng, acceptedBy: allMemberIds, accepted: true, verified: false, verifiedBy: [],
        clearPending: true,
      })
    } else {
      io.to(`room:${roomId}`).emit('pending-appointment-accepted', { roomId, acceptedBy })
    }

    return res.json({ message: '수락되었습니다.', acceptedBy, isFullyAccepted })
  } catch (e) {
    console.error('[PUT /rooms/:id/appointment/pending/accept]', e)
    return res.status(500).json({ message: '수락에 실패했습니다.' })
  }
})

// 약속 변경 제안 취소
router.delete('/:id/appointment/pending', async (req: AuthRequest, res: Response) => {
  try {
    const roomId = parseInt(req.params.id)

    await db.run('DELETE FROM pending_appointments WHERE room_id = ?', roomId)
    await db.run('DELETE FROM pending_appointment_accepts WHERE room_id = ?', roomId)

    const io = getIo()
    io.to(`room:${roomId}`).emit('pending-appointment-cleared', { roomId })

    return res.json({ message: '약속 변경 제안이 취소되었습니다.' })
  } catch (e) {
    console.error('[DELETE /rooms/:id/appointment/pending]', e)
    return res.status(500).json({ message: '취소에 실패했습니다.' })
  }
})

// 약속 수락
router.put('/:id/appointment/accept', async (req: AuthRequest, res: Response) => {
  try {
    const roomId = parseInt(req.params.id)
    const userId = req.userId!

    await db.run('INSERT OR IGNORE INTO appointment_accepts (room_id, user_id) VALUES (?, ?)', roomId, userId)

    const accepts = await db.all<{ user_id: number }>('SELECT user_id FROM appointment_accepts WHERE room_id = ?', roomId)
    const room = await db.get<{ capacity: number }>('SELECT capacity FROM rooms WHERE id = ?', roomId)
    const acceptedBy = accepts.map(a => a.user_id)
    const isFullyAccepted = !!room && acceptedBy.length >= room.capacity

    if (isFullyAccepted) {
      await db.run('UPDATE appointments SET accepted = 1 WHERE room_id = ?', roomId)
    }

    const io = getIo()
    io.to(`room:${roomId}`).emit('appointment-accepted', { roomId, acceptedBy, isFullyAccepted })

    return res.json({ message: '수락되었습니다.', acceptedBy, isFullyAccepted })
  } catch (e) {
    console.error('[PUT /rooms/:id/appointment/accept]', e)
    return res.status(500).json({ message: '약속 수락에 실패했습니다.' })
  }
})

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// 만남 인증
router.put('/:id/appointment/verify', async (req: AuthRequest, res: Response) => {
  try {
    const roomId = parseInt(req.params.id)
    const userId = req.userId!
    const { lat, lng } = req.body as { lat?: number; lng?: number }

    const appointment = await db.get<{ lat?: number; lng?: number }>(
      'SELECT lat, lng FROM appointments WHERE room_id = ?', roomId
    )

    if (appointment?.lat && appointment?.lng) {
      if (lat == null || lng == null) {
        return res.status(400).json({ message: '위치 정보가 필요합니다. GPS를 허용해주세요.' })
      }
      const distKm = haversineKm(lat, lng, appointment.lat, appointment.lng)
      if (distKm > 0.5) {
        return res.status(400).json({ message: `약속 장소에서 너무 멀어요! (${Math.round(distKm * 1000)}m)` })
      }
    }

    await db.run('INSERT OR IGNORE INTO appointment_verifies (room_id, user_id) VALUES (?, ?)', roomId, userId)

    const verifies = await db.all<{ user_id: number }>('SELECT user_id FROM appointment_verifies WHERE room_id = ?', roomId)
    const verifiedBy = verifies.map(v => v.user_id)

    const io = getIo()
    io.to(`room:${roomId}`).emit('appointment-verified', { roomId, verifiedBy })

    return res.json({ message: '인증되었습니다.', verifiedBy })
  } catch (e) {
    console.error('[PUT /rooms/:id/appointment/verify]', e)
    return res.status(500).json({ message: '만남 인증에 실패했습니다.' })
  }
})

// 별점 저장
router.post('/:id/ratings', async (req: AuthRequest, res: Response) => {
  try {
    const roomId = parseInt(req.params.id)
    const raterId = req.userId!
    const { ratings } = req.body as { ratings: Array<{ rateeId: number; stars: number }> }
    if (!Array.isArray(ratings)) return res.status(400).json({ message: 'ratings 배열이 필요합니다.' })

    for (const { rateeId, stars } of ratings) {
      if (rateeId === raterId || stars < 1 || stars > 5) continue
      await db.run(
        `INSERT INTO ratings (room_id, rater_id, ratee_id, stars) VALUES (?, ?, ?, ?)
         ON CONFLICT (room_id, rater_id, ratee_id) DO UPDATE SET stars = EXCLUDED.stars`,
        roomId, raterId, rateeId, stars
      )
    }

    return res.json({ message: '별점이 저장되었습니다.' })
  } catch (e) {
    console.error('[POST /rooms/:id/ratings]', e)
    return res.status(500).json({ message: '별점 저장에 실패했습니다.' })
  }
})

// 맘에 드는 상대 선택 (mutual like → 1:1 DM방)
router.post('/:id/like', async (req: AuthRequest, res: Response) => {
  try {
    const roomId = parseInt(req.params.id)
    const { likeeId } = req.body as { likeeId: number }
    if (!likeeId) return res.status(400).json({ message: 'likeeId가 필요합니다.' })

    const likerId = req.userId!

    const existing = await db.get('SELECT id FROM likes WHERE room_id = ? AND liker_id = ?', roomId, likerId)
    if (existing) return res.status(409).json({ message: '이미 선택하셨습니다.' })

    await db.run('INSERT INTO likes (room_id, liker_id, likee_id) VALUES (?, ?, ?)', roomId, likerId, likeeId)

    const mutual = await db.get(
      'SELECT id FROM likes WHERE room_id = ? AND liker_id = ? AND likee_id = ?',
      roomId, likeeId, likerId
    )

    if (!mutual) {
      return res.json({ matched: false })
    }

    const liker = await db.get<{ id: number; nickname: string }>('SELECT id, nickname FROM users WHERE id = ?', likerId)
    const likee = await db.get<{ id: number; nickname: string }>('SELECT id, nickname FROM users WHERE id = ?', likeeId)

    const title = `💌 ${liker!.nickname} & ${likee!.nickname}`
    const genCode = () => String(Math.floor(100000 + Math.random() * 900000))
    let code = genCode()
    while (await db.get('SELECT id FROM rooms WHERE code = ?', code)) code = genCode()

    const result = await db.run(
      'INSERT INTO rooms (title, code, host_id, capacity, team_gender, status) VALUES (?, ?, ?, ?, ?, ?)',
      title, code, likerId, 2, '혼성', 'active'
    )

    const dmRoomId = result.lastInsertRowid
    await db.run('INSERT OR IGNORE INTO room_members (room_id, user_id) VALUES (?, ?)', dmRoomId, likerId)
    await db.run('INSERT OR IGNORE INTO room_members (room_id, user_id) VALUES (?, ?)', dmRoomId, likeeId)

    const io = getIo()
    io.to(`user:${likerId}`).emit('mutual-match-found', {
      dmRoomId, title, otherUser: { id: likee!.id, nickname: likee!.nickname },
    })
    io.to(`user:${likeeId}`).emit('mutual-match-found', {
      dmRoomId, title, otherUser: { id: liker!.id, nickname: liker!.nickname },
    })

    return res.json({ matched: true, dmRoomId, title })
  } catch (e) {
    console.error('[POST /rooms/:id/like]', e)
    return res.status(500).json({ message: '좋아요에 실패했습니다.' })
  }
})

export default router
