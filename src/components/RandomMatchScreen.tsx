import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../api/client'
import { getSocket } from '../api/socket'

export interface UserProfile {
  id?: number
  nickname: string
  studentId: string
  gender: '남' | '여'
  dept: string
}

export interface MockUser {
  id?: number
  nickname: string
  studentId: string
  gender: '남' | '여'
  dept: string
}

export interface AvailableRoom {
  id: number
  title: string
  capacity: number
  memberCount: number
  code: string
}

export interface TeamState {
  roomId: number
  roomCode: string
  matchSize: number
  isHost: boolean
  isSeeking: boolean
}

export interface SoloQueueState {
  matchSize: number
  allowDuplicate: boolean
}

type View = 'host-setup' | 'host-wait' | 'seeking' | 'join-input' | 'join-wait' | 'result' | 'quick-match'

interface MatchResult {
  myTeam: MockUser[]
  otherTeam: MockUser[]
  size: number
}

export interface MatchStartedPayload {
  roomId: number
  members: { id: number; nickname: string; gender: string; dept: string; email: string; student_id: string }[]
  size: number
  teamGender: string
}

interface Props {
  onBack: () => void
  onGoToMain: (state: TeamState) => void
  onGoToMainSolo?: (state: SoloQueueState) => void
  currentUser: UserProfile
  onMatchSuccess: (matchedUsers: MockUser[], size: number, roomId?: number) => void
  onRoomCreated?: (room: AvailableRoom) => void
  teamStateResume?: TeamState
  soloStateResume?: SoloQueueState
  initialView?: View
}

export default function RandomMatchScreen({
  onBack,
  onGoToMain,
  onGoToMainSolo,
  currentUser,
  onMatchSuccess,
  onRoomCreated,
  teamStateResume,
  soloStateResume,
  initialView = 'host-setup',
}: Props) {
  const getInitialView = (): View => {
    if (!teamStateResume) return initialView
    if (teamStateResume.isSeeking) return 'seeking'
    return teamStateResume.isHost ? 'host-wait' : 'join-wait'
  }

  const [view, setView]         = useState<View>(getInitialView)
  const [matchSize, setMatchSize] = useState(teamStateResume?.matchSize ?? 3)
  const [roomCode, setRoomCode] = useState(teamStateResume?.roomCode ?? '')
  const [roomId, setRoomId]     = useState(teamStateResume?.roomId ?? 0)
  const [isHostOfRoom, setIsHostOfRoom] = useState(teamStateResume?.isHost ?? true)
  const [myTeamMembers, setMyTeamMembers] = useState<string[]>([currentUser.nickname])
  const [hostId, setHostId]     = useState<number>(currentUser.id ?? 0)
  const [joinCode, setJoinCode] = useState(teamStateResume?.isHost === false ? (teamStateResume?.roomCode ?? '') : '')
  const [joinError, setJoinError] = useState('')
  const [joinRoomMembers, setJoinRoomMembers] = useState<string[]>([])
  const [joinRoomCapacity, setJoinRoomCapacity] = useState(teamStateResume?.matchSize ?? 0)
  const [joinRoomHostId, setJoinRoomHostId] = useState<number>(0)
  const [result, setResult]     = useState<MatchResult | null>(null)
  const [loading, setLoading]   = useState(false)
  const [kickingIdx, setKickingIdx] = useState<number | null>(null)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [joinWaitSeeking, setJoinWaitSeeking] = useState(false)

  // 빠른 매칭 상태 (soloStateResume이 있으면 복원)
  const [quickMatchSize, setQuickMatchSize] = useState(soloStateResume?.matchSize ?? 2)
  const [quickMatchActive, setQuickMatchActive] = useState(!!soloStateResume)
  const [queueStatus, setQueueStatus] = useState({ myCount: soloStateResume ? 1 : 0, theirCount: 0, needed: soloStateResume?.matchSize ?? 2 })

  // 학과 중복 옵션 (host-setup & quick-match 공통)
  const [allowDuplicate, setAllowDuplicate] = useState(soloStateResume?.allowDuplicate ?? true)

  // 최신 값을 effect 클로저 안에서 참조하기 위한 ref
  const goToMainRef = useRef(onGoToMain)
  useEffect(() => { goToMainRef.current = onGoToMain }, [onGoToMain])
  const roomIdRef    = useRef(roomId)
  const roomCodeRef  = useRef(roomCode)
  const joinCodeRef  = useRef(joinCode)
  const matchSizeRef = useRef(matchSize)
  const isHostRef    = useRef(isHostOfRoom)
  useEffect(() => { roomIdRef.current = roomId }, [roomId])
  useEffect(() => { roomCodeRef.current = roomCode }, [roomCode])
  useEffect(() => { joinCodeRef.current = joinCode }, [joinCode])
  useEffect(() => { matchSizeRef.current = matchSize }, [matchSize])
  useEffect(() => { isHostRef.current = isHostOfRoom }, [isHostOfRoom])

  const myGender = currentUser.gender
  const otherGender: '남' | '여' = myGender === '남' ? '여' : '남'

  const toMockUser = (m: MatchStartedPayload['members'][0]): MockUser => ({
    id: m.id,
    nickname: m.nickname,
    studentId: m.student_id || '',
    gender: m.gender as '남' | '여',
    dept: m.dept,
  })

  const processMatchResult = useCallback((data: MatchStartedPayload) => {
    // 브라우저 알림
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try { new Notification('💘 매칭 완료!', { body: '상대팀과 매칭되었어요! 채팅방을 확인해보세요.', icon: '/favicon.ico' }) } catch { /* ignore */ }
    }
    const myTeam    = data.members.filter(m => m.gender === myGender).map(toMockUser)
    const otherTeam = data.members.filter(m => m.gender !== myGender).map(toMockUser)
    setResult({ myTeam, otherTeam, size: data.size })
    setView('result')
    const others = data.members.filter(m => m.id !== currentUser.id).map(toMockUser)
    onMatchSuccess(others, data.size, data.roomId)
  }, [currentUser, onMatchSuccess, myGender])

  // 빠른 매칭 소켓
  useEffect(() => {
    if (view !== 'quick-match') return
    const socket = getSocket()

    const onStatus = (data: { myCount: number; theirCount: number; needed: number }) => {
      setQueueStatus(data)
    }
    const onMatchStarted = (data: MatchStartedPayload) => {
      setQuickMatchActive(false)
      processMatchResult(data)
    }

    socket.on('solo-queue-status', onStatus)
    socket.on('match-started', onMatchStarted)

    // 메인화면에서 복귀한 경우 서버에 재등록하여 현재 큐 상태 수신
    if (soloStateResume) {
      socket.emit('solo-queue-join', { matchSize: soloStateResume.matchSize, allowDuplicate: soloStateResume.allowDuplicate })
    }

    return () => {
      socket.off('solo-queue-status', onStatus)
      socket.off('match-started', onMatchStarted)
    }
  }, [view, processMatchResult])

  // host-wait 소켓
  useEffect(() => {
    if (view !== 'host-wait' || roomId === 0) return
    const socket = getSocket()
    socket.emit('join-room', roomId)

    api.get<{ room: { members: { nickname: string; id: number }[]; hostId: number } }>(`/rooms/${roomId}`, true)
      .then(data => {
        const names = data.room.members?.map(m => m.nickname) ?? [currentUser.nickname]
        setMyTeamMembers(names.length > 0 ? names : [currentUser.nickname])
        if (data.room.hostId) setHostId(data.room.hostId)
      })
      .catch(() => {})

    const onMemberJoined = (data: { members: string[]; memberCount: number; hostId?: number }) => {
      setMyTeamMembers(data.members)
      if (data.hostId) setHostId(data.hostId)
    }
    const onMatchStarted = (data: MatchStartedPayload) => processMatchResult(data)
    const onMatchSeeking = () => {
      // 매칭 시작되면 자동으로 메인화면으로 이동 (백그라운드에서 매칭 유지)
      goToMainRef.current({
        roomId: roomIdRef.current,
        roomCode: roomCodeRef.current,
        matchSize: matchSizeRef.current,
        isHost: isHostRef.current,
        isSeeking: true,
      })
    }
    const onKicked = () => { alert('방에서 추방되었습니다.'); onBack() }
    const onRoomClosed = () => { alert('방장이 방을 나갔습니다.'); onBack() }
    const onMatchError = (data: { message: string }) => { alert(data.message) }

    socket.on('member-joined', onMemberJoined)
    socket.on('match-started', onMatchStarted)
    socket.on('match-seeking', onMatchSeeking)
    socket.on('kicked-from-room', onKicked)
    socket.on('room-closed', onRoomClosed)
    socket.on('match-error', onMatchError)

    return () => {
      socket.off('member-joined', onMemberJoined)
      socket.off('match-started', onMatchStarted)
      socket.off('match-seeking', onMatchSeeking)
      socket.off('kicked-from-room', onKicked)
      socket.off('room-closed', onRoomClosed)
      socket.off('match-error', onMatchError)
      socket.emit('leave-room', roomId)
    }
  }, [view, roomId, processMatchResult, currentUser.nickname, onBack])

  // seeking 소켓 (host + 팀원 공통)
  useEffect(() => {
    if (view !== 'seeking' || roomId === 0) return
    const socket = getSocket()
    socket.emit('join-room', roomId)
    const onMatchStarted = (data: MatchStartedPayload) => processMatchResult(data)
    socket.on('match-started', onMatchStarted)
    return () => {
      socket.off('match-started', onMatchStarted)
    }
  }, [view, roomId, processMatchResult])

  // join-wait 소켓
  useEffect(() => {
    if (view !== 'join-wait' || roomId === 0) return
    const socket = getSocket()
    socket.emit('join-room', roomId)

    api.get<{ room: { members: { nickname: string }[]; capacity: number; hostId: number } }>(`/rooms/${roomId}`, true)
      .then(data => {
        setJoinRoomMembers(data.room.members?.map(m => m.nickname) ?? [])
        setJoinRoomCapacity(data.room.capacity)
        if (data.room.hostId) setJoinRoomHostId(data.room.hostId)
      })
      .catch(() => {})

    const onMemberJoined = (data: { members: string[]; hostId?: number }) => {
      setJoinRoomMembers(data.members)
      if (data.hostId) setJoinRoomHostId(data.hostId)
    }
    const onMatchStarted = (data: MatchStartedPayload) => processMatchResult(data)
    const onMatchSeeking = () => {
      setJoinWaitSeeking(true)
      setTimeout(() => {
        goToMainRef.current({
          roomId: roomIdRef.current,
          roomCode: joinCodeRef.current || roomCodeRef.current,
          matchSize: matchSizeRef.current,
          isHost: false,
          isSeeking: true,
        })
      }, 2000)
    }
    const onKicked = () => { alert('방에서 추방되었습니다.'); setView('join-input') }
    const onRoomClosed = () => { alert('방장이 방을 나갔습니다.'); setView('join-input') }

    socket.on('member-joined', onMemberJoined)
    socket.on('match-started', onMatchStarted)
    socket.on('match-seeking', onMatchSeeking)
    socket.on('kicked-from-room', onKicked)
    socket.on('room-closed', onRoomClosed)

    return () => {
      socket.off('member-joined', onMemberJoined)
      socket.off('match-started', onMatchStarted)
      socket.off('match-seeking', onMatchSeeking)
      socket.off('kicked-from-room', onKicked)
      socket.off('room-closed', onRoomClosed)
      socket.emit('leave-room', roomId)
    }
  }, [view, roomId, processMatchResult])

  const createRoom = async () => {
    setLoading(true)
    try {
      const data = await api.post<{ room: { id: number; title: string; code: string; capacity: number; teamGender: string; memberCount: number } }>(
        '/rooms', { capacity: matchSize, teamGender: myGender, allowDuplicate }, true
      )
      const { room } = data
      setRoomCode(room.code)
      setRoomId(room.id)
      setHostId(currentUser.id ?? 0)
      setIsHostOfRoom(true)
      setMyTeamMembers([currentUser.nickname])
      setView('host-wait')
      onRoomCreated?.({ id: room.id, title: room.title, capacity: room.capacity, memberCount: room.memberCount, code: room.code })
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : '방 만들기에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const joinRoom = async () => {
    if (joinCode.length !== 6) { setJoinError('방 번호는 6자리예요.'); return }
    setLoading(true)
    try {
      const data = await api.post<{ room: { id: number; capacity: number; hostId: number } }>('/rooms/join', { code: joinCode }, true)
      setRoomId(data.room.id)
      setJoinRoomCapacity(data.room.capacity)
      setMatchSize(data.room.capacity)
      setJoinRoomHostId(data.room.hostId)
      setRoomCode(joinCode)
      setIsHostOfRoom(false)
      setJoinError('')
      setView('join-wait')
    } catch (e: unknown) {
      setJoinError(e instanceof Error ? e.message : '입장에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const handleStartMatch = () => {
    const socket = getSocket()
    socket.emit('start-match', { roomId })
  }

  const handleCancelMatch = async () => {
    const socket = getSocket()
    socket.emit('cancel-match', { roomId })
    setView('host-wait')
  }

  const handleLeaveRoom = async () => {
    try {
      if (view === 'seeking' && isHostOfRoom) {
        getSocket().emit('cancel-match', { roomId })
      }
      await api.del(`/rooms/${roomId}/leave`, {}, true)
    } catch { /* ignore */ }
    onBack()
  }

  const handleGoToMain = () => {
    onGoToMain({
      roomId,
      roomCode: view === 'join-wait' ? joinCode : roomCode,
      matchSize,
      isHost: isHostOfRoom,
      isSeeking: view === 'seeking',
    })
  }

  const handleGoToMainSolo = () => {
    onGoToMainSolo?.({ matchSize: quickMatchSize, allowDuplicate })
  }

  const handleStartQuickMatch = () => {
    setQueueStatus({ myCount: 1, theirCount: 0, needed: quickMatchSize })
    setQuickMatchActive(true)
    getSocket().emit('solo-queue-join', { matchSize: quickMatchSize, allowDuplicate })
  }

  const handleLeaveQuickMatch = () => {
    const socket = getSocket()
    socket.emit('solo-queue-leave', { matchSize: quickMatchSize })
    setQuickMatchActive(false)
  }

  const handleKick = async (memberNickname: string, idx: number) => {
    try {
      setKickingIdx(idx)
      const data = await api.get<{ room: { members: { id: number; nickname: string }[] } }>(`/rooms/${roomId}`, true)
      const target = data.room.members.find(m => m.nickname === memberNickname)
      if (!target) return
      await api.del(`/rooms/${roomId}/members/${target.id}`, {}, true)
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : '추방에 실패했습니다.')
    } finally {
      setKickingIdx(null)
    }
  }

  // ─── Views ────────────────────────────────────────────────

  if (view === 'host-setup') return (
    <div className="match-wrap">
      <button className="btn-back" onClick={onBack}>← 뒤로</button>
      <h2 className="match-title">방 만들기</h2>

      <div className="input-group">
        <label>미팅 인원</label>
        <div className="match-size-row">
          {[1, 2, 3, 4].map(n => (
            <button key={n} className={`match-size-btn ${matchSize === n ? 'selected' : ''}`} onClick={() => setMatchSize(n)}>
              {n}v{n}
            </button>
          ))}
        </div>
        <p className="step-desc" style={{ marginTop: 8 }}>각 팀 {matchSize}명씩 총 {matchSize * 2}명이 매칭돼요.</p>
      </div>

      <div className="input-group">
        <label>우리 팀 성별</label>
        <div className="gender-row">
          <div className="btn-gender selected" style={{ cursor: 'default' }}>{myGender}자팀 (내 성별)</div>
        </div>
        <p className="step-desc" style={{ marginTop: 8 }}>
          우리 팀 {myGender}자 {matchSize}명 vs 상대팀 {otherGender}자 {matchSize}명
        </p>
      </div>

      <DuplicateToggle value={allowDuplicate} onChange={setAllowDuplicate} />

      <button className="btn-login" onClick={createRoom} disabled={loading}>
        {loading ? '생성 중...' : '방 만들기'}
      </button>
    </div>
  )

  if (view === 'host-wait') return (
    <div className="match-wrap">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <button className="btn-back" style={{ position: 'static', margin: 0 }} onClick={handleLeaveRoom}>← 방 나가기</button>
        <button
          style={{ background: 'none', border: 'none', color: '#888', fontSize: '0.82rem', cursor: 'pointer' }}
          onClick={handleGoToMain}
        >
          메인화면으로 →
        </button>
      </div>
      <h2 className="match-title">대기 중</h2>

      <div className="room-code-box">
        <p className="room-code-label">초대 코드</p>
        <p className="room-code">{roomCode}</p>
        <p className="room-code-hint">같은 팀 친구에게 이 번호를 공유하세요</p>
      </div>

      <div className="team-status-box">
        <p className="team-status-title">우리 팀 ({myGender}자) — {myTeamMembers.length}/{matchSize}명</p>
        <div className="member-dots">
          {Array.from({ length: matchSize }).map((_, i) => (
            <div key={i} className={`member-dot ${i < myTeamMembers.length ? 'filled' : 'auto'}`}>
              {myTeamMembers[i]
                ? (myTeamMembers[i] === currentUser.nickname ? '나' : myTeamMembers[i].slice(0, 2))
                : '?'}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {myTeamMembers.map((name, i) => {
            const isMe = name === currentUser.nickname
            const isThisHost = i === 0
            return (
              <div key={i} style={{ fontSize: '0.88rem', color: '#444', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>{isThisHost ? '👑' : '✓'}</span>
                <span style={{ flex: 1 }}>{name}{isMe ? ' (나)' : ''}</span>
                {isHostOfRoom && !isMe && (
                  <button
                    style={{ fontSize: '0.75rem', color: '#e55', background: 'none', border: '1px solid #e55', borderRadius: 4, padding: '2px 6px', cursor: 'pointer' }}
                    onClick={() => handleKick(name, i)}
                    disabled={kickingIdx === i}
                  >
                    {kickingIdx === i ? '...' : '추방'}
                  </button>
                )}
              </div>
            )
          })}
          {Array.from({ length: matchSize - myTeamMembers.length }).map((_, i) => (
            <div key={i} style={{ fontSize: '0.88rem', color: '#bbb', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>○</span><span>대기 중...</span>
            </div>
          ))}
        </div>
      </div>

      <div className="team-status-box other-team">
        <p className="team-status-title">상대팀 ({otherGender}자) — 매칭 대기</p>
        <div className="member-dots">
          {Array.from({ length: matchSize }).map((_, i) => (
            <div key={i} className="member-dot auto">?</div>
          ))}
        </div>
      </div>

      {isHostOfRoom ? (
        <button className="btn-login" onClick={handleStartMatch}>
          {myTeamMembers.length < matchSize
            ? `매칭 시작하기 💘 (${myTeamMembers.length}/${matchSize}명)`
            : '매칭 시작하기 💘'}
        </button>
      ) : (
        <p className="step-desc" style={{ textAlign: 'center', marginTop: 12 }}>
          방장이 매칭을 시작하면 자동으로 연결됩니다.
        </p>
      )}
    </div>
  )

  if (view === 'seeking') return (
    <>
      {showCancelConfirm && (
        <div className="modal-overlay">
          <div className="modal-box">
            <div className="modal-header">
              <h3 className="modal-title">매칭 취소</h3>
            </div>
            <p className="step-desc" style={{ textAlign: 'center' }}>매칭을 취소하시겠어요?</p>
            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button className="btn-signup" style={{ flex: 1 }} onClick={() => setShowCancelConfirm(false)}>아니오</button>
              <button className="btn-login" style={{ flex: 1, background: '#e74c3c' }} onClick={() => { setShowCancelConfirm(false); handleCancelMatch() }}>예</button>
            </div>
          </div>
        </div>
      )}
      <div className="match-wrap">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <button className="btn-back" style={{ position: 'static', margin: 0 }} onClick={handleLeaveRoom}>
            ← 방 나가기
          </button>
          <button
            style={{ background: 'none', border: 'none', color: '#888', fontSize: '0.82rem', cursor: 'pointer' }}
            onClick={handleGoToMain}
          >
            메인화면으로 →
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, flex: 1, paddingTop: 40 }}>
          <div style={{ fontSize: '3.5rem', animation: 'heartSpin 1s linear infinite' }}>💘</div>
          <h2 className="match-title" style={{ textAlign: 'center' }}>상대팀을 찾고 있어요...</h2>
          <p className="step-desc" style={{ textAlign: 'center' }}>
            {otherGender}자팀이 준비되면<br />자동으로 매칭돼요!
          </p>
          <p style={{ fontSize: '0.8rem', color: '#aaa', textAlign: 'center', marginTop: -8 }}>
            채팅방을 이용하려면 상단의 '메인화면으로'를 탭하세요
          </p>
          {isHostOfRoom && (
            <button className="btn-signup" onClick={() => setShowCancelConfirm(true)} style={{ marginTop: 8, width: '100%' }}>
              매칭 취소
            </button>
          )}
        </div>
      </div>
    </>
  )

  if (view === 'join-input') return (
    <div className="match-wrap">
      <button className="btn-back" onClick={onBack}>← 뒤로</button>
      <h2 className="match-title">방 참여하기</h2>
      <p className="step-desc">방장에게 받은 6자리 초대 코드를 입력해주세요.</p>
      <div className="input-group">
        <label>초대 코드</label>
        <input
          type="text"
          placeholder="6자리 코드 입력"
          value={joinCode}
          onChange={e => { setJoinCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setJoinError('') }}
          className={`pw-input ${joinError ? 'error' : ''}`}
          maxLength={6}
        />
        {joinError && <p className="error-msg">{joinError}</p>}
      </div>
      <button className="btn-login" onClick={joinRoom} disabled={joinCode.length !== 6 || loading}>
        {loading ? '입장 중...' : '입장하기'}
      </button>
    </div>
  )

  if (view === 'join-wait' && joinWaitSeeking) return (
    <div className="match-wrap">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, flex: 1, paddingTop: 60 }}>
        <div style={{ fontSize: '3.5rem', animation: 'heartSpin 1s linear infinite' }}>💘</div>
        <h2 className="match-title" style={{ textAlign: 'center' }}>매칭 중...</h2>
        <p className="step-desc" style={{ textAlign: 'center' }}>방장이 매칭을 시작했어요!<br />{otherGender}자팀을 찾고 있어요.</p>
        <p style={{ fontSize: '0.8rem', color: '#aaa', textAlign: 'center' }}>잠시 후 메인화면으로 이동합니다</p>
      </div>
    </div>
  )

  if (view === 'join-wait') return (
    <div className="match-wrap">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <button className="btn-back" style={{ position: 'static', margin: 0 }} onClick={handleLeaveRoom}>← 방 나가기</button>
        <button
          style={{ background: 'none', border: 'none', color: '#888', fontSize: '0.82rem', cursor: 'pointer' }}
          onClick={handleGoToMain}
        >
          메인화면으로 →
        </button>
      </div>
      <h2 className="match-title">입장 완료!</h2>

      <div className="room-code-box">
        <p className="room-code-label">입장한 방 코드</p>
        <p className="room-code">{joinCode || roomCode}</p>
      </div>

      <div className="team-status-box">
        <p className="team-status-title">현재 팀원 — {joinRoomMembers.length}/{joinRoomCapacity || '?'}명</p>
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {joinRoomMembers.length === 0 ? (
            <p style={{ color: '#aaa', fontSize: '0.85rem' }}>멤버 정보를 불러오는 중...</p>
          ) : (
            joinRoomMembers.map((name, i) => (
              <div key={i} style={{ fontSize: '0.88rem', color: '#444', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>{i === 0 ? '👑' : '✓'}</span>
                <span>{name}{name === currentUser.nickname ? ' (나)' : ''}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="waiting-spinner">
        <div className="spinner-dot" /><div className="spinner-dot" /><div className="spinner-dot" />
      </div>
      <p className="step-desc" style={{ textAlign: 'center' }}>
        방장이 매칭을 시작하면 자동으로 연결됩니다.
      </p>
    </div>
  )

  if (view === 'result' && result) return (
    <div className="match-wrap">
      <h2 className="match-title" style={{ textAlign: 'center' }}>🎉 매칭 완료!</h2>
      <p className="step-desc" style={{ textAlign: 'center' }}>
        {result.size}v{result.size} 과팅이 성사됐어요!
      </p>

      <div className="result-team-box my-team-box">
        <p className="result-team-label">우리 팀 ({myGender}자)</p>
        {result.myTeam.map((u, i) => (
          <div key={i} className="result-user-row">
            <span className="result-nickname">{u.nickname}</span>
            <span className="result-info">{u.studentId && `${u.studentId} · `}{u.dept}</span>
          </div>
        ))}
      </div>

      <div className="result-vs">VS</div>

      <div className="result-team-box other-team-box">
        <p className="result-team-label">상대팀 ({otherGender}자)</p>
        {result.otherTeam.map((u, i) => (
          <div key={i} className="result-user-row">
            <span className="result-nickname">{u.nickname}</span>
            <span className="result-info">{u.studentId && `${u.studentId} · `}{u.dept}</span>
          </div>
        ))}
      </div>

      <button className="btn-login" onClick={onBack}>채팅방 확인하기</button>
    </div>
  )

  if (view === 'quick-match') return (
    <>
      {showCancelConfirm && (
        <div className="modal-overlay">
          <div className="modal-box">
            <div className="modal-header">
              <h3 className="modal-title">매칭 취소</h3>
            </div>
            <p className="step-desc" style={{ textAlign: 'center' }}>빠른 매칭을 취소하시겠어요?</p>
            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button className="btn-signup" style={{ flex: 1 }} onClick={() => setShowCancelConfirm(false)}>아니오</button>
              <button className="btn-login" style={{ flex: 1, background: '#e74c3c' }} onClick={() => { setShowCancelConfirm(false); handleLeaveQuickMatch(); onBack() }}>예</button>
            </div>
          </div>
        </div>
      )}
    <div className="match-wrap">
      {quickMatchActive ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <button className="btn-back" style={{ position: 'static', margin: 0 }} onClick={() => setShowCancelConfirm(true)}>← 매칭 취소</button>
          <button style={{ background: 'none', border: 'none', color: '#888', fontSize: '0.82rem', cursor: 'pointer' }} onClick={handleGoToMainSolo}>
            메인화면으로 →
          </button>
        </div>
      ) : (
        <button className="btn-back" onClick={() => { handleLeaveQuickMatch(); onBack() }}>← 뒤로</button>
      )}
      <h2 className="match-title">빠른 매칭</h2>
      <p className="step-desc">혼자 참여해도 자동으로 팀이 구성돼요!</p>

      {!quickMatchActive ? (
        <>
          <div className="input-group">
            <label>미팅 인원</label>
            <div className="match-size-row">
              {[1, 2, 3, 4].map(n => (
                <button key={n}
                  className={`match-size-btn ${quickMatchSize === n ? 'selected' : ''}`}
                  onClick={() => setQuickMatchSize(n)}>
                  {n}v{n}
                </button>
              ))}
            </div>
            <p className="step-desc" style={{ marginTop: 8 }}>
              {myGender}자 {quickMatchSize}명 + {otherGender}자 {quickMatchSize}명이 모이면 자동 매칭
            </p>
          </div>
          <DuplicateToggle value={allowDuplicate} onChange={setAllowDuplicate} />

          <button className="btn-login" onClick={handleStartQuickMatch}>
            빠른 매칭 시작 💘
          </button>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, paddingTop: 24 }}>
            <div style={{ fontSize: '3rem', animation: 'heartSpin 1s linear infinite' }}>💘</div>
            <h3 style={{ margin: 0, fontWeight: 700 }}>매칭 대기 중...</h3>

            <p className="step-desc" style={{ textAlign: 'center' }}>
              {quickMatchSize}v{quickMatchSize} · 양쪽 모두 {quickMatchSize}명이 모이면 자동으로 매칭돼요
            </p>
          </div>
        </>
      )}
    </div>
    </>
  )

  return null
}

function DuplicateToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="input-group" style={{ marginTop: 4 }}>
      <label>상대팀 학과 중복</label>
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <button
          onClick={() => onChange(true)}
          style={{
            flex: 1, padding: '10px 0', borderRadius: 10, border: '1.5px solid',
            borderColor: value ? '#5b87ff' : '#ddd',
            background: value ? '#eef2ff' : '#fafafa',
            color: value ? '#3a5fcc' : '#888',
            fontWeight: value ? 700 : 400, cursor: 'pointer', fontSize: '0.88rem',
          }}>
          상관없음
        </button>
        <button
          onClick={() => onChange(false)}
          style={{
            flex: 1, padding: '10px 0', borderRadius: 10, border: '1.5px solid',
            borderColor: !value ? '#ff6b9d' : '#ddd',
            background: !value ? '#fff0f5' : '#fafafa',
            color: !value ? '#cc2255' : '#888',
            fontWeight: !value ? 700 : 400, cursor: 'pointer', fontSize: '0.88rem',
          }}>
          겹치면 안 됨
        </button>
      </div>
      <p className="step-desc" style={{ marginTop: 6, fontSize: '0.78rem' }}>
        {value
          ? '상대팀에 같은 학과가 있어도 매칭돼요.'
          : '상대팀에 같은 학과가 있으면 매칭이 반려돼요.'}
      </p>
    </div>
  )
}

function QueueBar({ label, count, needed, color }: { label: string; count: number; needed: number; color: string }) {
  const pct = Math.min((count / needed) * 100, 100)
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: '0.88rem', fontWeight: 600 }}>
        <span>{label}</span>
        <span style={{ color }}>{count} / {needed}명</span>
      </div>
      <div style={{ height: 10, borderRadius: 6, background: '#e0e0e0', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 6, transition: 'width 0.4s ease' }} />
      </div>
    </div>
  )
}
