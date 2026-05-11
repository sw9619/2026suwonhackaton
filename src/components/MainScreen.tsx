import { useState } from 'react'
import SettingsTab from './SettingsTab'
import { ChatList, ChatRoomView, ChatRoom, ChatMessage } from './ChatScreen'
import RandomMatchScreen, { UserProfile, MockUser } from './RandomMatchScreen'

type Tab = '과팅' | '채팅방' | '설정'
type SubScreen = null | 'random-create' | 'random-join' | 'random-instant' | 'chatroom'

// 공개 방 목록 (방 만들기로 생성된 방)
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
  darkMode: boolean
  onToggleDarkMode: () => void
}

function nowTime() {
  const d = new Date()
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function MainScreen({ onLogout, onAccountDeleted, onPasswordReset, currentUser, darkMode, onToggleDarkMode }: Props) {
  const [tab, setTab]           = useState<Tab>('과팅')
  const [sub, setSub]           = useState<SubScreen>(null)
  const [chatRooms, setChatRooms]   = useState<ChatRoom[]>([])
  const [activeRoom, setActiveRoom] = useState<ChatRoom | null>(null)
  const [publicRooms, setPublicRooms] = useState<PublicRoom[]>([])

  // ── 매칭 완료 시 채팅방 생성 ──
  const handleMatchSuccess = (matchedUsers: MockUser[], size: number) => {
    const t = nowTime()
    const members = [currentUser.nickname, ...matchedUsers.map(u => u.nickname)]
    const systemMsg: ChatMessage = {
      id: Date.now(),
      text: `🎉 ${size}v${size} 매칭이 완료되었어요!`,
      isMine: false,
      senderName: '시스템',
      time: t,
    }
    const introMsgs: ChatMessage[] = matchedUsers.map((u, i) => ({
      id: Date.now() + i + 1,
      text: `안녕하세요! 저는 ${u.nickname}이에요 😊`,
      isMine: false,
      senderName: u.nickname,
      time: t,
    }))
    const newRoom: ChatRoom = {
      id: Date.now() + 1000,
      title: `${size}v${size} 매칭`,
      messages: [systemMsg, ...introMsgs],
      capacity: size * 2,
      memberCount: size * 2,
      members,
      ratings: {},
    }
    setChatRooms(prev => [...prev, newRoom])
    setActiveRoom(newRoom)
    setSub('chatroom')
    setTab('채팅방')
  }

  // ── 방 만들기 완료 시 공개방 등록 ──
  const handleRoomCreated = (room: PublicRoom) => {
    setPublicRooms(prev => [...prev, room])
  }

  // ── 방 참여 (공개방 목록에서) ──
  const handleJoinPublicRoom = (pubRoom: PublicRoom) => {
    const t = nowTime()
    const members = [currentUser.nickname]
    const newRoom: ChatRoom = {
      id: pubRoom.id,
      title: pubRoom.title,
      messages: [{ id: Date.now(), text: '채팅방에 참여했어요! 인사를 건네보세요 👋', isMine: false, time: t }],
      capacity: pubRoom.capacity,
      memberCount: pubRoom.memberCount + 1,
      members,
      ratings: {},
    }
    // 공개방 인원 증가, 꽉 차면 목록에서 제거
    setPublicRooms(prev => prev.map(r =>
      r.id === pubRoom.id
        ? { ...r, memberCount: r.memberCount + 1 }
        : r
    ).filter(r => r.memberCount < r.capacity))
    setChatRooms(prev => [...prev, newRoom])
    setActiveRoom(newRoom)
    setSub('chatroom')
    setTab('채팅방')
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

  const handleLeave = () => {
    if (!activeRoom) return
    // 공개방이었으면 인원 감소 후 다시 목록에 추가
    setPublicRooms(prev => {
      const existing = prev.find(r => r.id === activeRoom.id)
      if (existing) {
        return prev.map(r => r.id === activeRoom.id ? { ...r, memberCount: r.memberCount - 1 } : r)
      }
      // 나가서 인원 줄면 다시 공개방에 등장할 수 있도록 (capacity가 있는 방만)
      if (activeRoom.capacity > 0 && activeRoom.memberCount - 1 < activeRoom.capacity) {
        return [...prev, {
          id: activeRoom.id,
          title: activeRoom.title,
          capacity: activeRoom.capacity,
          memberCount: activeRoom.memberCount - 1,
          code: String(activeRoom.id).slice(-6),
        }]
      }
      return prev
    })
    setChatRooms(prev => prev.filter(r => r.id !== activeRoom.id))
    setActiveRoom(null)
    setSub(null)
    setTab('채팅방')
  }

  // ── 서브스크린 ──
  if (sub === 'random-create') return (
    <RandomMatchScreen
      onBack={() => setSub(null)}
      currentUser={currentUser}
      onMatchSuccess={handleMatchSuccess}
      onRoomCreated={handleRoomCreated}
      initialView="host-setup"
    />
  )
  if (sub === 'random-join') return (
    <RandomMatchScreen
      onBack={() => setSub(null)}
      currentUser={currentUser}
      onMatchSuccess={handleMatchSuccess}
      onRoomCreated={handleRoomCreated}
      publicRooms={publicRooms}
      onJoinPublicRoom={handleJoinPublicRoom}
      initialView="join-input"
    />
  )
  if (sub === 'chatroom' && activeRoom) return (
    <ChatRoomView
      room={activeRoom}
      onBack={() => { setSub(null); setTab('채팅방') }}
      onSend={handleSend}
      onUpdateRoom={handleUpdateRoom}
      onLeave={handleLeave}
      currentUserNickname={currentUser.nickname}
    />
  )

  return (
    <div className="main-wrap">
      <div className="main-topbar">
        <span className="main-topbar-title">수원시그널</span>
      </div>

      <div className="main-content">
        {tab === '과팅'  && <GatingTab onCreate={() => setSub('random-create')} onJoin={() => setSub('random-join')} />}
        {tab === '채팅방' && <ChatList rooms={chatRooms} onOpenRoom={handleOpenRoom} />}
        {tab === '설정'  && (
          <SettingsTab
            onLogout={onLogout}
            onAccountDeleted={onAccountDeleted}
            onPasswordReset={onPasswordReset}
            darkMode={darkMode}
            onToggleDarkMode={onToggleDarkMode}
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
    </div>
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

function GatingTab({ onCreate, onJoin }: { onCreate: () => void; onJoin: () => void }) {
  return (
    <div className="gating-tab">
      <div className="gating-header">
        <p className="gating-subtitle">설레는 과팅을 시작해보세요 💙</p>
      </div>
      <div className="gating-cards">
        <button className="gating-card card-notice" onClick={onCreate}>
          <div className="card-icon">🏠</div>
          <div className="card-text">
            <span className="card-title">매칭하기</span>
            <span className="card-desc">친구랑 함께 또는 혼자서<br />매칭해보세요.</span>
          </div>
          <span className="card-arrow">›</span>
        </button>
        <button className="gating-card card-random" onClick={onJoin}>
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
