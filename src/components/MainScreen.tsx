import { useState, useEffect, useCallback } from 'react'
import SettingsTab from './SettingsTab'
import { ChatList, ChatRoomView, ChatRoom, ChatMessage, Appointment } from './ChatScreen'
import RandomMatchScreen, { UserProfile, MockUser, TeamState, SoloQueueState, MatchStartedPayload } from './RandomMatchScreen'
import { api } from '../api/client'
import { getSocket } from '../api/socket'

// 서버 방 데이터 타입
interface ServerMessage {
  id: number; room_id: number; user_id: number | null; nickname: string | null
  text: string; type: string; created_at: string
}
interface ServerAppointment {
  id: number; room_id: number; place: string; datetime_iso: string; accepted: number; verified: number
  lat?: number; lng?: number; acceptedBy?: number[]; verifiedBy?: number[]
}
interface ServerRoom {
  id: number; title: string; capacity: number; teamGender: string; status: string; hostId: number
  members: { id: number; nickname: string; gender: string; dept: string; email: string; student_id: string }[]
  memberCount: number; messages: ServerMessage[]; appointment?: ServerAppointment
}

function serverRoomToChatRoom(r: ServerRoom, currentUserId: number): ChatRoom {
  const appointment: Appointment | undefined = r.appointment ? {
    place: r.appointment.place,
    datetimeISO: r.appointment.datetime_iso,
    accepted: r.appointment.accepted === 1,
    acceptedBy: r.appointment.acceptedBy ?? [],
    verified: r.appointment.verified === 1,
    verifiedBy: r.appointment.verifiedBy ?? [],
    lat: r.appointment.lat,
    lng: r.appointment.lng,
  } : undefined
  return {
    id: r.id,
    title: r.title,
    messages: r.messages.map(m => ({
      id: m.id,
      text: m.text,
      isMine: m.user_id === currentUserId,
      senderName: m.nickname ?? undefined,
      time: new Date(m.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
      userId: m.user_id ?? undefined,
      isAppointment: m.type === 'appointment',
    })),
    capacity: r.capacity,
    memberCount: r.memberCount,
    members: r.members.map(m => m.nickname),
    memberDetails: r.members,
    ratings: {},
    appointment,
  }
}

function showMatchNotification() {
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      new Notification('💘 매칭 완료!', {
        body: '상대팀과 매칭되었어요! 채팅방을 확인해보세요.',
        icon: '/favicon.ico',
      })
    } catch { /* 알림 권한 없음 */ }
  }
}

type Tab = '과팅' | '채팅방' | '설정'
type SubScreen = null | 'random-create' | 'random-join' | 'quick-match' | 'chatroom'

export interface PublicRoom {
  id: number
  title: string
  capacity: number
  memberCount: number
  code: string
}

interface Props {
  onLogout: () => void
  onAccountDeleted: () => void
  onPasswordReset: () => void
  currentUser: UserProfile
  setCurrentUser: (user: UserProfile) => void
  darkMode: boolean
  onToggleDarkMode: () => void
}

function nowTime() {
  const d = new Date()
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function MainScreen({ onLogout, onAccountDeleted, onPasswordReset, currentUser, setCurrentUser, darkMode, onToggleDarkMode }: Props) {
  const [tab, setTab]           = useState<Tab>('과팅')
  const [sub, setSub]           = useState<SubScreen>(null)
  const [chatRooms, setChatRooms]   = useState<ChatRoom[]>([])
  const [activeRoom, setActiveRoom] = useState<ChatRoom | null>(null)
  const [teamState, setTeamState]     = useState<TeamState | null>(null)
  const [soloQueueState, setSoloQueueState] = useState<SoloQueueState | null>(null)
  const [showSoloCancelConfirm, setShowSoloCancelConfirm] = useState(false)
  const [showTeamCancelConfirm, setShowTeamCancelConfirm] = useState(false)

  const handleMatchSuccess = (matchedUsers: MockUser[], size: number, roomId?: number) => {
    showMatchNotification()
    const t = nowTime()
    const members = [currentUser.nickname, ...matchedUsers.map(u => u.nickname)]
    const memberIds: Record<string, number> = {}
    matchedUsers.forEach(u => { if (u.id) memberIds[u.nickname] = u.id })

    const memberDetails = [
      { id: currentUser.id!, nickname: currentUser.nickname, gender: currentUser.gender, dept: currentUser.dept },
      ...matchedUsers.map(u => ({ id: u.id!, nickname: u.nickname, gender: u.gender, dept: u.dept })),
    ]

    const systemMsg: ChatMessage = {
      id: Date.now(),
      text: `🎉 ${size}v${size} 매칭이 완료되었어요!`,
      isMine: false,
      senderName: '시스템',
      time: t,
    }
    const newRoom: ChatRoom = {
      id: roomId ?? Date.now() + 1000,
      title: `${size}v${size} 매칭`,
      messages: [systemMsg],
      capacity: size * 2,
      memberCount: size * 2,
      members,
      memberIds,
      memberDetails,
      ratings: {},
    }
    setChatRooms(prev => [...prev, newRoom])
    setActiveRoom(newRoom)
    setTeamState(null)
    setSub('chatroom')
    setTab('채팅방')
  }

  // 앱 초기화: 알림 권한 요청, 상태 복원, 채팅방 로드
  useEffect(() => {
    // 브라우저 알림 권한 요청
    if ('Notification' in window) Notification.requestPermission()

    // 매칭 상태 localStorage 복원
    try {
      const t = localStorage.getItem('sws_teamState')
      if (t) setTeamState(JSON.parse(t))
      const s = localStorage.getItem('sws_soloState')
      if (s) setSoloQueueState(JSON.parse(s))
    } catch { /* ignore */ }

    // 백엔드에서 내 채팅방 목록 로드
    api.get<{ rooms: ServerRoom[] }>('/users/me/rooms', true)
      .then(data => {
        const loaded = data.rooms.map(r => serverRoomToChatRoom(r, currentUser.id!))
        setChatRooms(prev => {
          const merged = [...loaded]
          for (const r of prev) {
            if (!merged.some(m => m.id === r.id)) merged.push(r)
          }
          return merged
        })
      })
      .catch(() => {})
  }, [])

  // teamState 변경 시 localStorage 동기화
  useEffect(() => {
    if (teamState) localStorage.setItem('sws_teamState', JSON.stringify(teamState))
    else localStorage.removeItem('sws_teamState')
  }, [teamState])

  // soloQueueState 변경 시 localStorage 동기화
  useEffect(() => {
    if (soloQueueState) localStorage.setItem('sws_soloState', JSON.stringify(soloQueueState))
    else localStorage.removeItem('sws_soloState')
  }, [soloQueueState])

  // 백그라운드에서 매칭 이벤트 수신 (RandomMatchScreen이 unmount된 상태일 때)
  useEffect(() => {
    if (!teamState) return
    if (sub === 'random-create' || sub === 'random-join') return

    const socket = getSocket()
    socket.emit('join-room', teamState.roomId)

    const onMatchStarted = (data: MatchStartedPayload) => {
      const myGender = currentUser.gender
      const matchedUsers = data.members
        .filter(m => m.id !== currentUser.id)
        .map(m => ({
          id: m.id,
          nickname: m.nickname,
          studentId: m.student_id || '',
          gender: m.gender as '남' | '여',
          dept: m.dept,
        }))
      handleMatchSuccess(matchedUsers, data.size, data.roomId)
    }

    const onMatchSeeking = () => {
      setTeamState(prev => prev ? { ...prev, isSeeking: true } : prev)
    }
    const onRoomClosed = () => {
      setTeamState(null)
    }

    socket.on('match-started', onMatchStarted)
    socket.on('match-seeking', onMatchSeeking)
    socket.on('room-closed', onRoomClosed)

    return () => {
      socket.off('match-started', onMatchStarted)
      socket.off('match-seeking', onMatchSeeking)
      socket.off('room-closed', onRoomClosed)
    }
  }, [teamState?.roomId, sub])

  // 빠른 매칭 백그라운드 처리
  useEffect(() => {
    if (!soloQueueState) return
    if (sub === 'quick-match') return

    const socket = getSocket()
    // 앱 재시작 후 복원 시 큐 재등록
    socket.emit('solo-queue-join', { matchSize: soloQueueState.matchSize, allowDuplicate: soloQueueState.allowDuplicate })

    const onMatchStarted = (data: MatchStartedPayload) => {
      const myGender = currentUser.gender
      const matchedUsers = data.members
        .filter(m => m.id !== currentUser.id)
        .map(m => ({
          id: m.id,
          nickname: m.nickname,
          studentId: m.student_id || '',
          gender: m.gender as '남' | '여',
          dept: m.dept,
        }))
      handleMatchSuccess(matchedUsers, data.size, data.roomId)
      setSoloQueueState(null)
    }

    socket.on('match-started', onMatchStarted)
    return () => { socket.off('match-started', onMatchStarted) }
  }, [soloQueueState, sub])

  const handleGoToMainSolo = useCallback((state: SoloQueueState) => {
    setSoloQueueState(state)
    setSub(null)
  }, [])

  const handleCancelSoloQueue = () => {
    if (!soloQueueState) return
    getSocket().emit('solo-queue-leave', { matchSize: soloQueueState.matchSize })
    setSoloQueueState(null)
  }

  const handleResumeSoloQueue = () => {
    if (!soloQueueState) return
    setSub('quick-match')
  }

  const handleOpenRoom = (room: ChatRoom) => {
    setActiveRoom(room)
    setSub('chatroom')
  }

  const handleSend = (text: string) => {
    if (!activeRoom) return
    const msg: ChatMessage = {
      id: Date.now(), text, isMine: true,
      senderName: currentUser.nickname, time: nowTime(),
    }
    const updated = { ...activeRoom, messages: [...activeRoom.messages, msg] }
    setChatRooms(prev => prev.map(r => r.id === updated.id ? updated : r))
    setActiveRoom(updated)
  }

  const handleUpdateRoom = (updatedRoom: ChatRoom) => {
    setChatRooms(prev => prev.map(r => r.id === updatedRoom.id ? updatedRoom : r))
    setActiveRoom(updatedRoom)
  }

  const handleLeave = async () => {
    if (!activeRoom) return
    try {
      await api.del(`/rooms/${activeRoom.id}/leave`, {}, true)
    } catch { /* ignore */ }
    setChatRooms(prev => prev.filter(r => r.id !== activeRoom.id))
    setActiveRoom(null)
    setSub(null)
    setTab('채팅방')
  }

  const handleUpdateUser = (nickname: string) => {
    setCurrentUser({ ...currentUser, nickname })
  }

  const handleMutualMatch = (dmRoomId: number, title: string, otherNickname: string) => {
    const newRoom: ChatRoom = {
      id: dmRoomId,
      title,
      messages: [],
      capacity: 2,
      memberCount: 2,
      members: [currentUser.nickname, otherNickname],
      ratings: {},
    }
    setChatRooms(prev => {
      if (prev.some(r => r.id === dmRoomId)) return prev
      return [...prev, newRoom]
    })
    setActiveRoom(newRoom)
    setSub('chatroom')
    setTab('채팅방')
  }

  const handleGoToMain = useCallback((state: TeamState) => {
    setTeamState(state)
    setSub(null)
  }, [])

  const handleCancelTeam = async () => {
    if (!teamState) return
    const socket = getSocket()
    if (teamState.isSeeking && teamState.isHost) {
      socket.emit('cancel-match', { roomId: teamState.roomId })
    }
    try {
      await api.del(`/rooms/${teamState.roomId}/leave`, {}, true)
    } catch { /* ignore */ }
    setTeamState(null)
  }

  const handleResumeTeam = () => {
    if (!teamState) return
    setSub('random-create')
  }

  if (sub === 'random-create') return (
    <RandomMatchScreen
      onBack={() => { setTeamState(null); setSub(null) }}
      onGoToMain={handleGoToMain}
      currentUser={currentUser}
      onMatchSuccess={handleMatchSuccess}
      teamStateResume={teamState ?? undefined}
      initialView="host-setup"
    />
  )
  if (sub === 'random-join') return (
    <RandomMatchScreen
      onBack={() => setSub(null)}
      onGoToMain={handleGoToMain}
      currentUser={currentUser}
      onMatchSuccess={handleMatchSuccess}
      initialView="join-input"
    />
  )
  if (sub === 'quick-match') return (
    <RandomMatchScreen
      onBack={() => { setSoloQueueState(null); setSub(null) }}
      onGoToMain={handleGoToMain}
      onGoToMainSolo={handleGoToMainSolo}
      currentUser={currentUser}
      onMatchSuccess={handleMatchSuccess}
      soloStateResume={soloQueueState ?? undefined}
      initialView="quick-match"
    />
  )
  const renderMatchingModals = () => (
    <>
      {showSoloCancelConfirm && (
        <div className="modal-overlay">
          <div className="modal-box">
            <div className="modal-header"><h3 className="modal-title">빠른 매칭 취소</h3></div>
            <p className="step-desc" style={{ textAlign: 'center' }}>빠른 매칭을 취소하시겠어요?</p>
            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button className="btn-signup" style={{ flex: 1 }} onClick={() => setShowSoloCancelConfirm(false)}>아니오</button>
              <button className="btn-login" style={{ flex: 1, background: '#e74c3c' }} onClick={() => { setShowSoloCancelConfirm(false); handleCancelSoloQueue() }}>예</button>
            </div>
          </div>
        </div>
      )}
      {showTeamCancelConfirm && (
        <div className="modal-overlay">
          <div className="modal-box">
            <div className="modal-header"><h3 className="modal-title">매칭 취소</h3></div>
            <p className="step-desc" style={{ textAlign: 'center' }}>팀 매칭을 취소하고 방을 나가시겠어요?</p>
            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button className="btn-signup" style={{ flex: 1 }} onClick={() => setShowTeamCancelConfirm(false)}>아니오</button>
              <button className="btn-login" style={{ flex: 1, background: '#e74c3c' }} onClick={() => { setShowTeamCancelConfirm(false); handleCancelTeam() }}>예</button>
            </div>
          </div>
        </div>
      )}
    </>
  )

  const renderMatchingPopup = () => (
    <>
      {soloQueueState && !teamState && (
        <div onClick={handleResumeSoloQueue} style={{ position: 'absolute', bottom: 90, left: '50%', transform: 'translateX(-50%)', width: 'calc(100% - 32px)', maxWidth: 390, background: 'linear-gradient(135deg, #ff6b9d, #ff8c69)', borderRadius: 16, padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', boxShadow: '0 4px 20px rgba(0,0,0,0.18)', zIndex: 300 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '1.5rem', animation: 'heartSpin 1s linear infinite' }}>💘</span>
            <div>
              <p style={{ margin: 0, fontWeight: 700, color: '#fff', fontSize: '0.95rem' }}>빠른 매칭 중...</p>
              <p style={{ margin: 0, color: 'rgba(255,255,255,0.85)', fontSize: '0.78rem' }}>{soloQueueState.matchSize}v{soloQueueState.matchSize} · 탭해서 돌아가기</p>
            </div>
          </div>
          <button style={{ background: 'rgba(255,255,255,0.22)', border: 'none', color: '#fff', borderRadius: 8, padding: '5px 12px', fontSize: '0.78rem', cursor: 'pointer', flexShrink: 0 }} onClick={e => { e.stopPropagation(); setShowSoloCancelConfirm(true) }}>취소</button>
        </div>
      )}
      {teamState && (
        <div onClick={handleResumeTeam} style={{ position: 'absolute', bottom: 90, left: '50%', transform: 'translateX(-50%)', width: 'calc(100% - 32px)', maxWidth: 390, background: teamState.isSeeking ? 'linear-gradient(135deg, #ff6b9d, #ff8c69)' : 'linear-gradient(135deg, #5b87ff, #7b6fff)', borderRadius: 16, padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', boxShadow: '0 4px 20px rgba(0,0,0,0.18)', zIndex: 300 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '1.5rem', animation: teamState.isSeeking ? 'heartSpin 1s linear infinite' : 'none' }}>{teamState.isSeeking ? '💘' : '🏠'}</span>
            <div>
              <p style={{ margin: 0, fontWeight: 700, color: '#fff', fontSize: '0.95rem' }}>{teamState.isSeeking ? '매칭 중...' : '팀 대기 중'}</p>
              <p style={{ margin: 0, color: 'rgba(255,255,255,0.85)', fontSize: '0.78rem' }}>코드 {teamState.roomCode} · {teamState.matchSize}v{teamState.matchSize} · 탭해서 돌아가기</p>
            </div>
          </div>
          <button style={{ background: 'rgba(255,255,255,0.22)', border: 'none', color: '#fff', borderRadius: 8, padding: '5px 12px', fontSize: '0.78rem', cursor: 'pointer', flexShrink: 0 }} onClick={e => { e.stopPropagation(); setShowTeamCancelConfirm(true) }}>나가기</button>
        </div>
      )}
    </>
  )

  if (sub === 'chatroom' && activeRoom) return (
    <>
      <ChatRoomView
        room={activeRoom}
        currentUserId={currentUser.id}
        currentNickname={currentUser.nickname}
        currentGender={currentUser.gender}
        onBack={() => { setSub(null); setTab('채팅방') }}
        onSend={handleSend}
        onUpdateRoom={handleUpdateRoom}
        onLeave={handleLeave}
        onMutualMatch={handleMutualMatch}
      />
      {renderMatchingModals()}
      {renderMatchingPopup()}
    </>
  )

  return (
    <>
    <div className="main-wrap">
      <div className="main-topbar">
        <span className="main-topbar-title">수원시그널</span>
      </div>

      <div className="main-content">
        {tab === '과팅'  && (
          <GatingTab
            onQuick={() => setSub('quick-match')}
            onCreate={() => { setTeamState(null); setSub('random-create') }}
            onJoin={() => setSub('random-join')}
          />
        )}
        {tab === '채팅방' && <ChatList rooms={chatRooms} onOpenRoom={handleOpenRoom} />}
        {tab === '설정'  && (
          <SettingsTab
            onLogout={onLogout}
            onAccountDeleted={onAccountDeleted}
            onPasswordReset={onPasswordReset}
            darkMode={darkMode}
            onToggleDarkMode={onToggleDarkMode}
            currentUser={currentUser}
            onUpdateUser={handleUpdateUser}
          />
        )}
      </div>

      <nav className="bottom-nav">
        {(['과팅', '채팅방', '설정'] as Tab[]).map(t => (
          <button key={t} className={`nav-item ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            <span className="nav-icon">{navIcon(t)}</span>
            <span className="nav-label">{t}</span>
          </button>
        ))}
      </nav>

      {renderMatchingModals()}
    </div>
    {renderMatchingPopup()}
    </>
  )
}

function navIcon(tab: Tab) {
  if (tab === '과팅') return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
  if (tab === '채팅방') return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l-.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

function GatingTab({ onCreate, onJoin, onQuick }: { onCreate: () => void; onJoin: () => void; onQuick: () => void }) {
  return (
    <div className="gating-tab">
      <div className="gating-header">
        <p className="gating-subtitle">설레는 과팅을 시작해보세요 💙</p>
      </div>
      <div className="gating-cards">
        <button className="gating-card card-random" onClick={onQuick}>
          <div className="card-icon">💘</div>
          <div className="card-text">
            <span className="card-title">빠른 매칭</span>
            <span className="card-desc">혼자 참여해도 OK!<br />자동으로 팀이 구성돼요</span>
          </div>
          <span className="card-arrow">›</span>
        </button>
        <button className="gating-card card-notice" onClick={onCreate}>
          <div className="card-icon">🏠</div>
          <div className="card-text">
            <span className="card-title">방 만들기</span>
            <span className="card-desc">친구와 함께 팀을 만들고<br />코드로 초대하세요</span>
          </div>
          <span className="card-arrow">›</span>
        </button>
        <button className="gating-card card-notice" onClick={onJoin}>
          <div className="card-icon">🚪</div>
          <div className="card-text">
            <span className="card-title">방 참여하기</span>
            <span className="card-desc">방 번호를 입력해서<br />과팅방에 입장하세요</span>
          </div>
          <span className="card-arrow">›</span>
        </button>
      </div>
    </div>
  )
}
