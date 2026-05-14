import { Server as IOServer, Socket } from 'socket.io'
import jwt from 'jsonwebtoken'
import db from '../db'

const JWT_SECRET = process.env.JWT_SECRET || 'suwon-signal-secret-2024'

interface AuthSocket extends Socket {
  userId?: number
  nickname?: string
}

interface SeekingRoom {
  capacity: number
  teamGender: string
  memberCount: number
  deptSet: Set<string>
  allowDuplicate: boolean
  timestamp: number
}

type SoloUser = {
  userId: number
  nickname: string
  dept: string
  allowDuplicate: boolean
  timestamp: number
}

const seekingRooms = new Map<number, SeekingRoom>()
const soloQueue = new Map<string, SoloUser[]>()
// socketId → roomId: disconnect 시 유령 방 정리용
const socketSeekingRoom = new Map<string, number>()

function makeCode() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

function canMatch(
  a: { deptSet: Set<string>; allowDuplicate: boolean },
  b: { deptSet: Set<string>; allowDuplicate: boolean }
): boolean {
  if (a.allowDuplicate && b.allowDuplicate) return true
  for (const dept of a.deptSet) {
    if (b.deptSet.has(dept)) return false
  }
  return true
}

function findCompatibleRoom(
  capacity: number,
  myGender: string,
  myDeptSet: Set<string>,
  myAllowDuplicate: boolean
): number | null {
  const oppositeGender = myGender === '남' ? '여' : '남'
  const candidates: [number, SeekingRoom][] = []
  for (const [roomId, info] of seekingRooms.entries()) {
    if (info.capacity === capacity && info.teamGender === oppositeGender && info.memberCount >= capacity) {
      candidates.push([roomId, info])
    }
  }
  candidates.sort((a, b) => a[1].timestamp - b[1].timestamp)
  for (const [roomId, info] of candidates) {
    if (canMatch(
      { deptSet: myDeptSet, allowDuplicate: myAllowDuplicate },
      { deptSet: info.deptSet, allowDuplicate: info.allowDuplicate }
    )) return roomId
  }
  return null
}

function broadcastQueueStatus(io: IOServer, matchSize: number, gender: string) {
  const oppositeGender = gender === '남' ? '여' : '남'
  const myQueue = soloQueue.get(`${matchSize}-${gender}`) ?? []
  const theirQueue = soloQueue.get(`${matchSize}-${oppositeGender}`) ?? []
  for (const u of myQueue) {
    io.to(`user:${u.userId}`).emit('solo-queue-status', {
      myCount: myQueue.length,
      theirCount: theirQueue.length,
      needed: matchSize,
    })
  }
}

async function createMatchRoomAndNotify(
  io: IOServer,
  matchSize: number,
  gender: string,
  myTeam: { userId: number }[],
  theirTeam: { userId: number }[]
) {
  const allIds = [...myTeam, ...theirTeam].map(u => u.userId)
  const allDetails = (await Promise.all(
    allIds.map(id => db.get<{ id: number; nickname: string; gender: string; dept: string; email: string; student_id: string }>(
      'SELECT id, nickname, gender, dept, email, student_id FROM users WHERE id = ?', id
    ))
  )).filter(Boolean)

  const title = `${matchSize}v${matchSize} 과팅`
  let code = makeCode()
  while (await db.get('SELECT id FROM rooms WHERE code = ?', code)) code = makeCode()

  const result = await db.run(
    'INSERT INTO rooms (title, code, host_id, capacity, team_gender, status) VALUES (?, ?, ?, ?, ?, ?)',
    title, code, myTeam[0].userId, matchSize * 2, gender, 'active'
  )
  const matchRoomId = result.lastInsertRowid

  for (const id of allIds) {
    await db.run('INSERT OR IGNORE INTO room_members (room_id, user_id) VALUES (?, ?)', matchRoomId, id)
  }
  await db.run(
    'INSERT INTO messages (room_id, user_id, nickname, text, type) VALUES (?, ?, ?, ?, ?)',
    matchRoomId, null, '시스템', `🎉 ${matchSize}v${matchSize} 매칭이 완료되었어요!`, 'system'
  )

  const payload = { roomId: matchRoomId, members: allDetails, size: matchSize, teamGender: gender }
  for (const id of allIds) {
    io.to(`user:${id}`).emit('match-started', payload)
  }
  console.log(`[Socket] 빠른매칭 성사: ${matchSize}v${matchSize} → room${matchRoomId}`)
}

async function tryCreateSoloMatch(io: IOServer, matchSize: number, gender: string) {
  const oppositeGender = gender === '남' ? '여' : '남'
  const myKey = `${matchSize}-${gender}`
  const theirKey = `${matchSize}-${oppositeGender}`

  const myQueue = soloQueue.get(myKey) ?? []
  const theirQueue = soloQueue.get(theirKey) ?? []

  if (myQueue.length < matchSize || theirQueue.length < matchSize) return

  const myTeam = myQueue.slice(0, matchSize)
  const myDeptSet = new Set(myTeam.map(u => u.dept))
  const myAllowDuplicate = myTeam.every(u => u.allowDuplicate)

  for (let i = 0; i <= theirQueue.length - matchSize; i++) {
    const theirTeam = theirQueue.slice(i, i + matchSize)
    const theirDeptSet = new Set(theirTeam.map(u => u.dept))
    const theirAllowDuplicate = theirTeam.every(u => u.allowDuplicate)

    if (canMatch(
      { deptSet: myDeptSet, allowDuplicate: myAllowDuplicate },
      { deptSet: theirDeptSet, allowDuplicate: theirAllowDuplicate }
    )) {
      const myMatchedIds = new Set(myTeam.map(u => u.userId))
      const theirMatchedIds = new Set(theirTeam.map(u => u.userId))
      soloQueue.set(myKey, myQueue.filter(u => !myMatchedIds.has(u.userId)))
      soloQueue.set(theirKey, theirQueue.filter(u => !theirMatchedIds.has(u.userId)))

      await createMatchRoomAndNotify(io, matchSize, gender, myTeam, theirTeam)

      broadcastQueueStatus(io, matchSize, gender)
      broadcastQueueStatus(io, matchSize, oppositeGender)
      return
    }
  }
}

// 방만들기 팀 → 빠른매칭 솔로 크로스 매칭
async function tryMatchRoomWithSoloQueue(
  io: IOServer,
  roomId: number,
  roomCapacity: number,
  roomGender: string,
  roomAllowDuplicate: boolean,
  roomMembers: { id: number; dept: string }[]
): Promise<boolean> {
  const oppositeGender = roomGender === '남' ? '여' : '남'
  const key = `${roomCapacity}-${oppositeGender}`
  const queue = soloQueue.get(key) ?? []
  if (queue.length === 0) return false

  // 방 인원이 정원에 미달이면 매칭 불가
  if (roomMembers.length < roomCapacity) return false

  const roomDeptSet = new Set(roomMembers.map(m => m.dept))
  const matched: SoloUser[] = []
  for (const u of queue) {
    if (matched.length >= roomCapacity) break
    if (canMatch(
      { deptSet: roomDeptSet, allowDuplicate: roomAllowDuplicate },
      { deptSet: new Set([u.dept]), allowDuplicate: u.allowDuplicate }
    )) matched.push(u)
  }
  // 상대측도 정원만큼 모여야 매칭
  if (matched.length < roomCapacity) return false

  const matchedIds = new Set(matched.map(u => u.userId))
  soloQueue.set(key, queue.filter(u => !matchedIds.has(u.userId)))
  await db.run("UPDATE rooms SET status = 'closed' WHERE id = ?", roomId)

  await createMatchRoomAndNotify(io, roomCapacity, roomGender,
    roomMembers.map(m => ({ userId: m.id })),
    matched.map(u => ({ userId: u.userId }))
  )
  broadcastQueueStatus(io, roomCapacity, oppositeGender)
  console.log(`[Socket] 크로스매칭 (방→솔로): room${roomId} + 솔로 ${matched.length}명`)
  return true
}

// 정원 미달 방 + 같은 성별 솔로큐 → 팀 완성 후 매칭
async function tryFillAndMatchRoom(
  io: IOServer,
  roomId: number,
  capacity: number,
  roomGender: string,
  roomAllowDuplicate: boolean,
  roomMembers: { id: number; dept: string }[]
): Promise<boolean> {
  const needed = capacity - roomMembers.length
  if (needed <= 0) return false

  const sameKey = `${capacity}-${roomGender}`
  const sameQueue = soloQueue.get(sameKey) ?? []
  if (sameQueue.length < needed) return false

  const fillers = sameQueue.slice(0, needed)
  const combinedMembers = [
    ...roomMembers,
    ...fillers.map(u => ({ id: u.userId, dept: u.dept })),
  ]
  const combinedDeptSet = new Set(combinedMembers.map(m => m.dept))
  const combinedAllowDuplicate = roomAllowDuplicate && fillers.every(u => u.allowDuplicate)

  // 경로 1: 합쳐진 팀 vs 상대 방
  const compatibleRoomId = findCompatibleRoom(capacity, roomGender, combinedDeptSet, combinedAllowDuplicate)
  if (compatibleRoomId !== null) {
    const fillerIds = new Set(fillers.map(u => u.userId))
    soloQueue.set(sameKey, sameQueue.filter(u => !fillerIds.has(u.userId)))
    seekingRooms.delete(compatibleRoomId)
    seekingRooms.delete(roomId)

    const theirMembers = await db.all<{ id: number }>(
      'SELECT u.id FROM room_members rm JOIN users u ON u.id = rm.user_id WHERE rm.room_id = ?',
      compatibleRoomId
    )
    await db.run("UPDATE rooms SET status = 'closed' WHERE id = ? OR id = ?", roomId, compatibleRoomId)
    await createMatchRoomAndNotify(io, capacity, roomGender,
      combinedMembers.map(m => ({ userId: m.id })),
      theirMembers.map(m => ({ userId: m.id }))
    )
    broadcastQueueStatus(io, capacity, roomGender)
    console.log(`[Socket] 혼합매칭 (방+솔로→방): room${roomId} + 솔로${needed}명 vs room${compatibleRoomId}`)
    return true
  }

  // 경로 2: 합쳐진 팀 vs 상대 솔로큐
  const oppositeGender = roomGender === '남' ? '여' : '남'
  const oppositeKey = `${capacity}-${oppositeGender}`
  const oppositeQueue = soloQueue.get(oppositeKey) ?? []

  if (oppositeQueue.length >= capacity) {
    for (let i = 0; i <= oppositeQueue.length - capacity; i++) {
      const theirTeam = oppositeQueue.slice(i, i + capacity)
      const theirDeptSet = new Set(theirTeam.map(u => u.dept))
      const theirAllowDuplicate = theirTeam.every(u => u.allowDuplicate)

      if (canMatch(
        { deptSet: combinedDeptSet, allowDuplicate: combinedAllowDuplicate },
        { deptSet: theirDeptSet, allowDuplicate: theirAllowDuplicate }
      )) {
        const fillerIds = new Set(fillers.map(u => u.userId))
        const theirIds = new Set(theirTeam.map(u => u.userId))
        soloQueue.set(sameKey, sameQueue.filter(u => !fillerIds.has(u.userId)))
        soloQueue.set(oppositeKey, oppositeQueue.filter(u => !theirIds.has(u.userId)))
        seekingRooms.delete(roomId)

        await db.run("UPDATE rooms SET status = 'closed' WHERE id = ?", roomId)
        await createMatchRoomAndNotify(io, capacity, roomGender,
          combinedMembers.map(m => ({ userId: m.id })),
          theirTeam.map(u => ({ userId: u.userId }))
        )
        broadcastQueueStatus(io, capacity, roomGender)
        broadcastQueueStatus(io, capacity, oppositeGender)
        console.log(`[Socket] 혼합매칭 (방+솔로→솔로큐): room${roomId} + 솔로${needed}명 vs 솔로${capacity}명`)
        return true
      }
    }
  }

  return false
}

// 빠른매칭 솔로 → 방만들기 팀 크로스 매칭
async function tryMatchSoloQueueWithRoom(
  io: IOServer,
  matchSize: number,
  gender: string
): Promise<boolean> {
  const oppositeGender = gender === '남' ? '여' : '남'
  const key = `${matchSize}-${gender}`
  const myQueue = soloQueue.get(key) ?? []
  if (myQueue.length === 0) return false

  // 솔로 큐도 정원만큼 모여야 매칭 시도
  if (myQueue.length < matchSize) return false

  const candidates: [number, SeekingRoom][] = []
  for (const [roomId, info] of seekingRooms.entries()) {
    // 상대 팀방도 정원이 다 찬 경우만 매칭
    if (info.capacity === matchSize && info.teamGender === oppositeGender && info.memberCount >= matchSize) {
      candidates.push([roomId, info])
    }
  }
  candidates.sort((a, b) => a[1].timestamp - b[1].timestamp)

  for (const [roomId, roomInfo] of candidates) {
    const myDeptSet = new Set(myQueue.map(u => u.dept))
    const myAllowDuplicate = myQueue.every(u => u.allowDuplicate)
    if (!canMatch(
      { deptSet: myDeptSet, allowDuplicate: myAllowDuplicate },
      { deptSet: roomInfo.deptSet, allowDuplicate: roomInfo.allowDuplicate }
    )) continue

    const myTeam = myQueue.slice(0, Math.min(myQueue.length, matchSize))
    const matchedIds = new Set(myTeam.map(u => u.userId))
    soloQueue.set(key, myQueue.filter(u => !matchedIds.has(u.userId)))
    seekingRooms.delete(roomId)
    await db.run("UPDATE rooms SET status = 'closed' WHERE id = ?", roomId)

    const roomMemberIds = await db.all<{ id: number }>(
      'SELECT u.id FROM room_members rm JOIN users u ON u.id = rm.user_id WHERE rm.room_id = ?',
      roomId
    )
    await createMatchRoomAndNotify(io, matchSize, gender,
      myTeam.map(u => ({ userId: u.userId })),
      roomMemberIds.map(m => ({ userId: m.id }))
    )
    broadcastQueueStatus(io, matchSize, gender)
    console.log(`[Socket] 크로스매칭 (솔로→방): 솔로 ${myTeam.length}명 + room${roomId}`)
    return true
  }
  return false
}

export function setupSocket(io: IOServer) {
  io.use(async (socket: AuthSocket, next) => {
    const token = socket.handshake.auth?.token as string | undefined
    if (!token) return next(new Error('인증이 필요합니다.'))
    try {
      const payload = jwt.verify(token, JWT_SECRET) as { userId: number }
      socket.userId = payload.userId
      const user = await db.get<{ nickname: string }>('SELECT nickname FROM users WHERE id = ?', payload.userId)
      socket.nickname = user?.nickname ?? '알 수 없음'
      next()
    } catch {
      next(new Error('유효하지 않은 토큰입니다.'))
    }
  })

  io.on('connection', (socket: AuthSocket) => {
    console.log(`[Socket] 연결: ${socket.nickname} (${socket.userId})`)

    if (socket.userId) socket.join(`user:${socket.userId}`)

    socket.on('join-room', (roomId: number) => { socket.join(`room:${roomId}`) })
    socket.on('leave-room', (roomId: number) => { socket.leave(`room:${roomId}`) })

    // ── 팀 매칭 ────────────────────────────────────────────────

    socket.on('start-match', ({ roomId }: { roomId: number }) => {
      void (async () => {
        try {
          const room = await db.get<{
            id: number; capacity: number; team_gender: string; status: string; host_id: number; allow_duplicate: number
          }>('SELECT * FROM rooms WHERE id = ?', roomId)

          if (!room || room.host_id !== socket.userId) return

          const myGender = room.team_gender
          const capacity = room.capacity
          const myAllowDuplicate = room.allow_duplicate === 1

          const myMembers = await db.all<{ id: number; nickname: string; gender: string; dept: string; email: string; student_id: string }>(`
            SELECT u.id, u.nickname, u.gender, u.dept, u.email, u.student_id
            FROM room_members rm JOIN users u ON u.id = rm.user_id
            WHERE rm.room_id = ?
          `, roomId)

          const myMemberCount = myMembers.length
          const myDeptSet = new Set(myMembers.map(m => m.dept))

          const compatibleRoomId = findCompatibleRoom(capacity, myGender, myDeptSet, myAllowDuplicate)

          if (compatibleRoomId !== null && myMemberCount >= capacity) {
            seekingRooms.delete(compatibleRoomId)

            const theirMembers = await db.all<{ id: number; nickname: string; gender: string; dept: string; email: string; student_id: string }>(`
              SELECT u.id, u.nickname, u.gender, u.dept, u.email, u.student_id
              FROM room_members rm JOIN users u ON u.id = rm.user_id
              WHERE rm.room_id = ?
            `, compatibleRoomId)

            const allMembers = [...myMembers, ...theirMembers]

            const title = `${myMemberCount}v${myMemberCount} 과팅`
            let code = makeCode()
            while (await db.get('SELECT id FROM rooms WHERE code = ?', code)) code = makeCode()

            const result = await db.run(
              'INSERT INTO rooms (title, code, host_id, capacity, team_gender, status) VALUES (?, ?, ?, ?, ?, ?)',
              title, code, socket.userId, myMemberCount * 2, myGender, 'active'
            )
            const matchRoomId = result.lastInsertRowid

            for (const u of allMembers) {
              await db.run('INSERT OR IGNORE INTO room_members (room_id, user_id) VALUES (?, ?)', matchRoomId, u.id)
            }
            await db.run(
              'INSERT INTO messages (room_id, user_id, nickname, text, type) VALUES (?, ?, ?, ?, ?)',
              matchRoomId, null, '시스템', `🎉 ${myMemberCount}v${myMemberCount} 매칭이 완료되었어요!`, 'system'
            )
            await db.run("UPDATE rooms SET status = 'closed' WHERE id = ? OR id = ?", roomId, compatibleRoomId)

            const payload = { roomId: matchRoomId, members: allMembers, size: myMemberCount, teamGender: myGender }
            io.to(`room:${roomId}`).emit('match-started', payload)
            io.to(`room:${compatibleRoomId}`).emit('match-started', payload)

            console.log(`[Socket] 팀매칭 성사: room${roomId} + room${compatibleRoomId} → room${matchRoomId}`)
          } else {
            const crossMatched = await tryMatchRoomWithSoloQueue(
              io, roomId, capacity, myGender, myAllowDuplicate,
              myMembers.map(m => ({ id: m.id, dept: m.dept }))
            )
            if (!crossMatched) {
              const fillMatched = await tryFillAndMatchRoom(
                io, roomId, capacity, myGender, myAllowDuplicate,
                myMembers.map(m => ({ id: m.id, dept: m.dept }))
              )
              if (!fillMatched) {
                seekingRooms.set(roomId, {
                  capacity, teamGender: myGender, memberCount: myMemberCount,
                  deptSet: myDeptSet, allowDuplicate: myAllowDuplicate, timestamp: Date.now(),
                })
                socketSeekingRoom.set(socket.id, roomId)
                await db.run("UPDATE rooms SET status = 'seeking' WHERE id = ?", roomId)
                io.to(`room:${roomId}`).emit('match-seeking', { roomId, memberCount: myMemberCount })

                const reason = myMemberCount < capacity ? `정원 미달 (${myMemberCount}/${capacity}명)` : '상대팀 대기 없음'
                console.log(`[Socket] 팀매칭 대기: room${roomId} (${myGender} ${myMemberCount}/${capacity}명, 이유: ${reason})`)
              }
            }
          }
        } catch (err) {
          console.error('[Socket] start-match error:', err)
        }
      })()
    })

    socket.on('cancel-match', ({ roomId }: { roomId: number }) => {
      void (async () => {
        try {
          seekingRooms.delete(roomId)
          socketSeekingRoom.delete(socket.id)
          await db.run("UPDATE rooms SET status = 'waiting' WHERE id = ?", roomId)
          console.log(`[Socket] 팀매칭 취소: room${roomId}`)
        } catch (err) {
          console.error('[Socket] cancel-match error:', err)
        }
      })()
    })

    // ── 빠른 매칭 (솔로 큐) ────────────────────────────────────

    socket.on('solo-queue-join', ({ matchSize, allowDuplicate }: { matchSize: number; allowDuplicate: boolean }) => {
      void (async () => {
        try {
          if (![1, 2, 3, 4].includes(matchSize)) return

          const user = await db.get<{ id: number; nickname: string; gender: string; dept: string }>(
            'SELECT id, nickname, gender, dept FROM users WHERE id = ?', socket.userId
          )
          if (!user) return

          const key = `${matchSize}-${user.gender}`
          const queue = soloQueue.get(key) ?? []

          const existingIdx = queue.findIndex(u => u.userId === socket.userId)
          if (existingIdx >= 0) {
            // allowDuplicate 변경 시 큐 내 기존 항목 업데이트
            queue[existingIdx].allowDuplicate = allowDuplicate !== false
            const oppositeGender = user.gender === '남' ? '여' : '남'
            const theirQueue = soloQueue.get(`${matchSize}-${oppositeGender}`) ?? []
            socket.emit('solo-queue-status', { myCount: queue.length, theirCount: theirQueue.length, needed: matchSize })
            return
          }

          queue.push({
            userId: socket.userId!,
            nickname: user.nickname,
            dept: user.dept,
            allowDuplicate: allowDuplicate !== false,
            timestamp: Date.now(),
          })
          soloQueue.set(key, queue)

          const oppositeGender = user.gender === '남' ? '여' : '남'
          const theirQueue = soloQueue.get(`${matchSize}-${oppositeGender}`) ?? []
          socket.emit('solo-queue-status', { myCount: queue.length, theirCount: theirQueue.length, needed: matchSize })
          broadcastQueueStatus(io, matchSize, user.gender)

          console.log(`[Socket] 빠른매칭 대기: ${user.nickname} (${user.gender}, ${matchSize}v${matchSize})`)

          await tryCreateSoloMatch(io, matchSize, user.gender)
          await tryMatchSoloQueueWithRoom(io, matchSize, user.gender)

          // 같은 성별 정원 미달 방이 있으면 솔로 유입으로 팀 완성 후 매칭 시도
          for (const [seekRoomId, roomInfo] of seekingRooms.entries()) {
            if (roomInfo.teamGender === user.gender && roomInfo.capacity === matchSize && roomInfo.memberCount < roomInfo.capacity) {
              const roomMembers = await db.all<{ id: number; dept: string }>(
                'SELECT u.id, u.dept FROM room_members rm JOIN users u ON u.id = rm.user_id WHERE rm.room_id = ?',
                seekRoomId
              )
              const filled = await tryFillAndMatchRoom(io, seekRoomId, roomInfo.capacity, roomInfo.teamGender, roomInfo.allowDuplicate, roomMembers)
              if (filled) break
            }
          }
        } catch (err) {
          console.error('[Socket] solo-queue-join error:', err)
        }
      })()
    })

    socket.on('solo-queue-leave', ({ matchSize }: { matchSize: number }) => {
      void (async () => {
        try {
          const user = await db.get<{ gender: string }>('SELECT gender FROM users WHERE id = ?', socket.userId)
          if (!user) return
          const key = `${matchSize}-${user.gender}`
          const queue = soloQueue.get(key) ?? []
          soloQueue.set(key, queue.filter(u => u.userId !== socket.userId))
          broadcastQueueStatus(io, matchSize, user.gender)
        } catch (err) {
          console.error('[Socket] solo-queue-leave error:', err)
        }
      })()
    })

    // ── 채팅 / 약속 ────────────────────────────────────────────

    socket.on('send-message', (data: { roomId: number; text: string }) => {
      void (async () => {
        try {
          const { roomId, text } = data
          if (!text?.trim() || !roomId) return

          const freshUser = await db.get<{ nickname: string }>('SELECT nickname FROM users WHERE id = ?', socket.userId)
          const nickname = freshUser?.nickname ?? socket.nickname ?? '알 수 없음'
          socket.nickname = nickname

          const result = await db.run(
            'INSERT INTO messages (room_id, user_id, nickname, text, type) VALUES (?, ?, ?, ?, ?)',
            roomId, socket.userId, nickname, text.trim(), 'text'
          )

          const msg = await db.get<{
            id: number; room_id: number; user_id: number; nickname: string; text: string; type: string; created_at: string
          }>('SELECT * FROM messages WHERE id = ?', result.lastInsertRowid)

          if (!msg) return
          const now = new Date()
          const time = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`

          socket.broadcast.to(`room:${roomId}`).emit('new-message', {
            id: msg.id, roomId, text: msg.text, senderName: msg.nickname,
            userId: msg.user_id, time, type: msg.type,
          })
        } catch (err) {
          console.error('[Socket] send-message error:', err)
        }
      })()
    })

    socket.on('appointment-set', (data: { roomId: number; place: string; datetimeISO: string; lat?: number; lng?: number }) => {
      // 발신자 제외하고 나머지에게만 전송 (발신자는 낙관적 업데이트)
      socket.broadcast.to(`room:${data.roomId}`).emit('appointment-updated', { ...data, acceptedBy: [], verifiedBy: [], accepted: false, verified: false })
    })

    socket.on('disconnect', () => {
      // soloQueue에서 제거
      for (const [key, queue] of soloQueue.entries()) {
        const next = queue.filter(u => u.userId !== socket.userId)
        if (next.length !== queue.length) soloQueue.set(key, next)
      }
      // 이 소켓이 방장이었던 seekingRoom 제거 (유령 방 방지)
      const seekingRoomId = socketSeekingRoom.get(socket.id)
      if (seekingRoomId) {
        seekingRooms.delete(seekingRoomId)
        socketSeekingRoom.delete(socket.id)
        void db.run("UPDATE rooms SET status = 'closed' WHERE id = ?", seekingRoomId)
          .then(() => io.to(`room:${seekingRoomId}`).emit('room-closed'))
          .catch(() => {})
        console.log(`[Socket] 유령 방 정리: room${seekingRoomId} (방장 disconnect)`)
      }
      console.log(`[Socket] 해제: ${socket.nickname}`)
    })
  })
}
