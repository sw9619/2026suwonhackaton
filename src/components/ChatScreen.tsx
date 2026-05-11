import { useState, useEffect, useRef } from 'react'

export interface ChatMessage {
  id: number
  text: string
  isMine: boolean
  senderName?: string
  time: string
  isAppointment?: boolean
}

export interface Appointment {
  place: string
  datetimeISO: string
  acceptedBy: string[]  // 수락한 멤버 닉네임 목록
  verified: boolean
}

export interface ChatRoom {
  id: number
  title: string
  messages: ChatMessage[]
  appointment?: Appointment
  capacity: number        // 최대 인원
  memberCount: number     // 현재 인원
  members: string[]       // 닉네임 목록
  ratings: Record<string, number> // 내가 준 별점 { nickname: stars }
}

function nowTime() {
  const d = new Date()
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

function formatDatetime(iso: string) {
  const d = new Date(iso)
  return (
    d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' }) +
    ' ' + d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
  )
}

function isWithinWindow(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  return diff >= -30 * 60 * 1000 && diff <= 30 * 60 * 1000
}

function timeUntilText(iso: string) {
  const diff = new Date(iso).getTime() - Date.now()
  if (diff <= 0) return null
  const h = Math.floor(diff / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`
}

function canRate(appt?: Appointment) {
  if (!appt || appt.acceptedBy.length === 0) return false
  return Date.now() - new Date(appt.datetimeISO).getTime() >= 4 * 60 * 60 * 1000
}

// ── 약속 설정 모달 ──
function AppointmentModal({ onClose, onSend }: {
  onClose: () => void
  onSend: (place: string, dt: Date) => void
}) {
  const [place, setPlace] = useState('')
  const [dateStr, setDateStr] = useState('')
  const [timeStr, setTimeStr] = useState('')
  const canSend = place.trim() && dateStr && timeStr

  return (
    <div className="modal-overlay">
      <div className="modal-box">
        <div className="modal-header">
          <h3 className="modal-title">약속 설정</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="input-group">
          <label>장소</label>
          <div className="place-row">
            <input className="pw-input" placeholder="장소 이름 입력" value={place} onChange={e => setPlace(e.target.value)} />
            <button className="btn-map-icon"
              onClick={() => place.trim() && window.open(`https://map.kakao.com/?q=${encodeURIComponent(place.trim())}`, '_blank')}>
              🗺️
            </button>
          </div>
        </div>
        <div className="input-group">
          <label>날짜</label>
          <input type="date" className="pw-input" value={dateStr} onChange={e => setDateStr(e.target.value)} />
        </div>
        <div className="input-group">
          <label>시간</label>
          <input type="time" className="pw-input" value={timeStr} onChange={e => setTimeStr(e.target.value)} />
        </div>
        <button className="btn-login" disabled={!canSend}
          onClick={() => canSend && onSend(place.trim(), new Date(`${dateStr}T${timeStr}`))}>
          보내기
        </button>
      </div>
    </div>
  )
}

// ── 만남인증 모달 ──
function VerifyModal({ appointment, onVerify, onClose }: {
  appointment: Appointment; onVerify: () => void; onClose: () => void
}) {
  const [step, setStep] = useState<'checking' | 'ready' | 'early' | 'done'>('checking')

  useEffect(() => {
    if (!isWithinWindow(appointment.datetimeISO)) { setStep('early'); return }
    if (!navigator.geolocation) { setStep('ready'); return }
    navigator.geolocation.getCurrentPosition(() => setStep('ready'), () => setStep('ready'), { timeout: 5000 })
  }, [])

  const remaining = timeUntilText(appointment.datetimeISO)

  return (
    <div className="modal-overlay">
      <div className="modal-box">
        <div className="modal-header">
          <h3 className="modal-title">만난 인증</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="verify-info-box">
          <div className="verify-info-row">
            <span className="verify-info-label">📍 약속 장소</span>
            <span className="verify-info-value">{appointment.place}</span>
          </div>
          <div className="verify-info-row">
            <span className="verify-info-label">🕐 약속 시간</span>
            <span className="verify-info-value">{formatDatetime(appointment.datetimeISO)}</span>
          </div>
        </div>
        {step === 'checking' && <div className="verify-status">📡 위치를 확인하고 있어요...</div>}
        {step === 'early' && (
          <div className="verify-status error">
            {remaining ? `아직 약속 시간이 아니에요!\n${remaining} 후에 다시 시도해주세요.`
              : '약속 시간이 지났어요. (약속 시간 ±30분 이내에 인증 가능해요)'}
          </div>
        )}
        {step === 'ready' && (
          <>
            <div className="verify-status ok">📍 위치 확인 완료! 인증할 수 있어요.</div>
            <button className="btn-login" onClick={() => { onVerify(); setStep('done') }}>인증하기</button>
          </>
        )}
        {step === 'done' && <div className="verify-done">✅ 인증되었습니다!</div>}
      </div>
    </div>
  )
}

// ── 별점 주기 모달 ──
function RatingModal({ members, ratings, appt, currentUserNickname, onRate, onClose }: {
  members: string[]
  ratings: Record<string, number>
  appt?: Appointment
  currentUserNickname: string
  onRate: (nickname: string, stars: number) => void
  onClose: () => void
}) {
  const [local, setLocal] = useState<Record<string, number>>(ratings)
  const ratable = canRate(appt)
  const hoursLeft = appt && appt.acceptedBy.length > 0
    ? Math.max(0, Math.ceil((new Date(appt.datetimeISO).getTime() + 4 * 3600000 - Date.now()) / 3600000))
    : null

  return (
    <div className="modal-overlay">
      <div className="modal-box">
        <div className="modal-header">
          <h3 className="modal-title">⭐ 별점 주기</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="rating-notice">
          🔒 별점은 상대방에게 공개되지 않아요
        </div>

        {!ratable && (
          <div className="rating-locked">
            {!appt || appt.acceptedBy.length === 0
              ? '약속이 확정된 후 4시간이 지나면\n별점을 줄 수 있어요.'
              : `약속 후 약 ${hoursLeft}시간이 지나면\n별점을 줄 수 있어요.`}
          </div>
        )}

        {ratable && members.filter(m => m !== currentUserNickname).map(nickname => (
          <div key={nickname} className="rating-row">
            <span className="rating-name">{nickname}</span>
            <div className="star-row">
              {[1, 2, 3, 4, 5].map(s => (
                <button
                  key={s}
                  className={`star-btn ${(local[nickname] ?? 0) >= s ? 'filled' : ''}`}
                  onClick={() => {
                    const updated = { ...local, [nickname]: s }
                    setLocal(updated)
                    onRate(nickname, s)
                  }}
                >★</button>
              ))}
            </div>
          </div>
        ))}

        <button className="btn-login" onClick={onClose}>완료</button>
      </div>
    </div>
  )
}

// ── + 메뉴 ──
function PlusMenu({ onAppt, onRate, onLeave, onClose }: {
  onAppt: () => void; onRate: () => void; onLeave: () => void; onClose: () => void
}) {
  return (
    <>
      <div className="plus-menu-overlay" onClick={onClose} />
      <div className="plus-menu">
        <button className="plus-menu-item" onClick={() => { onAppt(); onClose() }}>
          <span>📍</span><span>약속장소 지정</span>
        </button>
        <button className="plus-menu-item" onClick={() => { onRate(); onClose() }}>
          <span>⭐</span><span>별점 주기</span>
        </button>
        <button className="plus-menu-item danger" onClick={() => { onLeave(); onClose() }}>
          <span>🚪</span><span>채팅방 나가기</span>
        </button>
      </div>
    </>
  )
}

// ── 채팅방 나가기 확인 모달 ──
function LeaveModal({ onClose, onLeave }: { onClose: () => void; onLeave: () => void }) {
  return (
    <div className="modal-overlay">
      <div className="modal-box">
        <div className="modal-header">
          <h3 className="modal-title">채팅방 나가기</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <p className="step-desc" style={{ textAlign: 'center' }}>
          채팅방을 나가면 대화 내용이<br />모두 삭제돼요.
        </p>
        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          <button className="btn-signup" style={{ flex: 1 }} onClick={onClose}>취소</button>
          <button className="btn-login" style={{ flex: 1, background: '#e74c3c' }} onClick={onLeave}>나가기</button>
        </div>
      </div>
    </div>
  )
}

// ── 약속 카드 ──
function AppointmentCard({ appt, totalMembers, currentNickname, onAccept }: {
  appt: Appointment
  totalMembers: number
  currentNickname: string
  onAccept: () => void
}) {
  const hasAccepted = appt.acceptedBy.includes(currentNickname)
  return (
    <div className="appt-card">
      <div className="appt-card-title">📅 약속 설정</div>
      <div className="appt-card-row">
        <span className="appt-card-icon">📍</span>
        <span className="appt-card-text">{appt.place}</span>
        <button className="btn-map-small"
          onClick={() => window.open(`https://map.kakao.com/?q=${encodeURIComponent(appt.place)}`, '_blank')}>
          지도
        </button>
      </div>
      <div className="appt-card-row">
        <span className="appt-card-icon">🕐</span>
        <span className="appt-card-text">{formatDatetime(appt.datetimeISO)}</span>
      </div>
      <div className="appt-accept-row">
        <span className="appt-accept-count">✅ {appt.acceptedBy.length}/{totalMembers} 수락</span>
        {appt.acceptedBy.length > 0 && (
          <span className="appt-accept-names">{appt.acceptedBy.join(', ')}</span>
        )}
      </div>
      {!hasAccepted
        ? <button className="btn-accept" onClick={onAccept}>수락하기</button>
        : <div className="appt-accepted">내가 수락했어요!</div>}
    </div>
  )
}

// ── 채팅방 목록 ──
export function ChatList({ rooms, onOpenRoom }: { rooms: ChatRoom[]; onOpenRoom: (room: ChatRoom) => void }) {
  return (
    <div className="chat-list-wrap">
      <h2 className="chat-list-title">채팅방</h2>
      {rooms.length === 0 ? (
        <div className="chat-empty">참여한 채팅방이 없어요.<br />채팅방을 만들거나 참여해보세요!</div>
      ) : (
        <div className="chat-rooms">
          {rooms.map(room => {
            const last = room.messages[room.messages.length - 1]
            const preview = last?.isAppointment ? '📅 약속이 설정되었어요' : (last?.text ?? '채팅을 시작해보세요!')
            return (
              <button key={room.id} className="chat-room-item" onClick={() => onOpenRoom(room)}>
                <div className="chat-room-icon">💬</div>
                <div className="chat-room-info">
                  <span className="chat-room-name">{room.title}</span>
                  <span className="chat-room-last">{preview}</span>
                </div>
                <span className="chat-room-arrow">›</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── 채팅방 뷰 ──
interface RoomProps {
  room: ChatRoom
  onBack: () => void
  onSend: (text: string) => void
  onUpdateRoom: (room: ChatRoom) => void
  onLeave: () => void
  currentUserNickname: string
}

export function ChatRoomView({ room, onBack, onSend, onUpdateRoom, onLeave, currentUserNickname }: RoomProps) {
  const [input, setInput]               = useState('')
  const [showPlus, setShowPlus]         = useState(false)
  const [showAppModal, setShowAppModal] = useState(false)
  const [showVerify, setShowVerify]     = useState(false)
  const [showRating, setShowRating]     = useState(false)
  const [showLeave, setShowLeave]       = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [room.messages.length])

  const appt = room.appointment

  const handleSetAppointment = (place: string, dt: Date) => {
    const apptMsg: ChatMessage = { id: Date.now(), text: '', isMine: true, time: nowTime(), isAppointment: true }
    onUpdateRoom({
      ...room,
      messages: [...room.messages, apptMsg],
      appointment: { place, datetimeISO: dt.toISOString(), acceptedBy: [currentUserNickname], verified: false },
    })
    setShowAppModal(false)
  }

  const handleRate = (nickname: string, stars: number) => {
    onUpdateRoom({ ...room, ratings: { ...room.ratings, [nickname]: stars } })
  }

  const handleSend = () => {
    if (!input.trim()) return
    onSend(input.trim())
    setInput('')
  }

  // 우상단 버튼
  const allAccepted = appt && appt.acceptedBy.length >= room.members.length
  let rightBtn: React.ReactNode
  if (!appt) {
    rightBtn = <button className="btn-appt-header" onClick={() => setShowAppModal(true)}>📍 약속장소 지정</button>
  } else if (!allAccepted) {
    rightBtn = <span className="btn-accept-status">{appt.acceptedBy.length}/{room.members.length} 수락</span>
  } else if (!appt.verified) {
    rightBtn = <button className="btn-verify-header" onClick={() => setShowVerify(true)}>✅ 만남인증</button>
  } else {
    rightBtn = <span className="btn-verified-header">✓ 인증완료</span>
  }

  return (
    <div className="chat-room-wrap">
      {showPlus && (
        <PlusMenu
          onAppt={() => setShowAppModal(true)}
          onRate={() => setShowRating(true)}
          onLeave={() => setShowLeave(true)}
          onClose={() => setShowPlus(false)}
        />
      )}
      {showAppModal && <AppointmentModal onClose={() => setShowAppModal(false)} onSend={handleSetAppointment} />}
      {showVerify && appt && (
        <VerifyModal appointment={appt} onVerify={() => onUpdateRoom({ ...room, appointment: { ...appt, verified: true } })} onClose={() => setShowVerify(false)} />
      )}

      {showRating && (
        <RatingModal
          members={room.members}
          ratings={room.ratings}
          appt={appt}
          currentUserNickname={currentUserNickname}
          onRate={handleRate}
          onClose={() => setShowRating(false)}
        />
      )}
      {showLeave && <LeaveModal onClose={() => setShowLeave(false)} onLeave={onLeave} />}

      <div className="chat-room-header">
        <button className="btn-back" onClick={onBack}>← 뒤로</button>
        <h2 className="chat-room-title">{room.title}</h2>
        {rightBtn}
      </div>

      <div className="chat-messages">
        {room.messages.map(msg =>
          msg.isAppointment && appt ? (
            <div key={msg.id} className="appt-card-wrapper">
              <AppointmentCard
                appt={appt}
                totalMembers={room.members.length}
                currentNickname={currentUserNickname}
                onAccept={() => onUpdateRoom({
                  ...room,
                  appointment: { ...appt, acceptedBy: [...appt.acceptedBy, currentUserNickname] }
                })}
              />
            </div>
          ) : (
            <div key={msg.id} className={`chat-bubble-wrap ${msg.isMine ? 'mine' : 'theirs'}`}>
              {!msg.isMine && msg.senderName && <span className="chat-sender-name">{msg.senderName}</span>}
              <div className={`chat-bubble ${msg.isMine ? 'bubble-mine' : 'bubble-theirs'}`}>{msg.text}</div>
              <span className="chat-time">{msg.time}</span>
            </div>
          )
        )}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-bar">
        <button className="btn-plus" onClick={() => setShowPlus(p => !p)}>+</button>
        <input
          className="chat-input"
          placeholder="메시지를 입력하세요"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
        />
        <button className="chat-send-btn" onClick={handleSend}>전송</button>
      </div>
    </div>
  )
}
