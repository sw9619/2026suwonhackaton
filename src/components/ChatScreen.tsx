import { useState, useEffect, useRef, useCallback } from 'react'

export interface ChatMessage {
  id: number
  text: string
  isMine: boolean
  senderName?: string
  time: string
  isAppointment?: boolean
  appointmentSnapshot?: Appointment  // 생성 시점의 약속 데이터
}

export interface Appointment {
  place: string
  datetimeISO: string
  acceptedBy: string[]
  verified: boolean
  isPending?: boolean  // 변경 제안 중 (전원 수락 전)
}

export interface ChatRoom {
  id: number
  title: string
  messages: ChatMessage[]
  appointment?: Appointment
  previousAppointment?: Appointment  // 변경 제안 중일 때 기존 약속 보존
  capacity: number
  memberCount: number
  members: string[]
  ratings: Record<string, number>
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
interface PlaceResult { name: string; address: string }

function AppointmentModal({ onClose, onSend }: {
  onClose: () => void
  onSend: (place: string, dt: Date) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PlaceResult[]>([])
  const [searching, setSearching] = useState(false)
  const [place, setPlace] = useState('')
  const [dateStr, setDateStr] = useState('')
  const [timeStr, setTimeStr] = useState('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const canSend = place.trim() && dateStr && timeStr

  const searchPlace = useCallback(async (q: string) => {
    const trimmed = q.trim()
    if (!trimmed) return
    setSearching(true)
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(trimmed + ' 수원')}&format=jsonv2&limit=10&countrycodes=kr&accept-language=ko&addressdetails=1`
      const resp = await fetch(url, { headers: { 'User-Agent': 'SuwonSignal/1.0' } })
      const data = await resp.json() as { name: string; display_name: string; class: string; type: string }[]
      const places = data
        .filter(d => d.name && d.class !== 'boundary' && d.type !== 'administrative')
        .map(d => {
          const parts = d.display_name.split(', ')
          const addr = parts.slice(1).filter(p => !p.match(/^\d+/) && p !== '대한민국' && p.length < 20).slice(0, 3).join(' ')
          return { name: d.name, address: addr }
        })
        .filter((p, i, arr) => arr.findIndex(x => x.name === p.name) === i)
      setResults(places)
    } catch {
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [])

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setQuery(val)
    setPlace('')
    if (timerRef.current) clearTimeout(timerRef.current)
    if (val.trim().length >= 2) {
      timerRef.current = setTimeout(() => searchPlace(val), 500)
    } else {
      setResults([])
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-box">
        <div className="modal-header">
          <h3 className="modal-title">약속 설정</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="input-group">
          <label>장소 검색</label>
          <div className="place-row">
            <input
              className="pw-input"
              placeholder="카페, 식당, 장소명 입력..."
              value={query}
              onChange={handleQueryChange}
              onKeyDown={e => e.key === 'Enter' && searchPlace(query)}
            />
            <button className="btn-map-icon" onClick={() => searchPlace(query)} disabled={searching}>
              {searching ? '⏳' : '🔍'}
            </button>
          </div>
          {results.length > 0 && (
            <div style={{ border: '1px solid #eee', borderRadius: 8, marginTop: 6, maxHeight: 180, overflowY: 'auto' }}>
              {results.map((r, i) => (
                <button key={i}
                  onClick={() => { setPlace(r.name); setQuery(r.name); setResults([]) }}
                  style={{ width: '100%', textAlign: 'left', padding: '10px 12px', background: 'none', border: 'none', borderBottom: i < results.length - 1 ? '1px solid #f0f0f0' : 'none', cursor: 'pointer' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{r.name}</div>
                  <div style={{ color: '#888', fontSize: '0.78rem', marginTop: 2 }}>{r.address}</div>
                </button>
              ))}
            </div>
          )}
          {place && (
            <div style={{ marginTop: 8, padding: '8px 12px', background: '#f0f9fa', borderRadius: 8, fontSize: '0.85rem' }}>
              📍 선택됨: <strong>{place}</strong>
            </div>
          )}
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
function PlusMenu({ hasAppointment, onAppt, onRate, onLeave, onClose }: {
  hasAppointment: boolean; onAppt: () => void; onRate: () => void; onLeave: () => void; onClose: () => void
}) {
  return (
    <>
      <div className="plus-menu-overlay" onClick={onClose} />
      <div className="plus-menu">
        <button className="plus-menu-item" onClick={() => { onAppt(); onClose() }}>
          <span>📍</span><span>{hasAppointment ? '약속장소 변경하기' : '약속장소 지정'}</span>
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
function AppointmentCard({ appt, totalMembers, currentNickname, isCurrent, onAccept, onReject }: {
  appt: Appointment
  totalMembers: number
  currentNickname: string
  isCurrent: boolean
  onAccept: () => void
  onReject: () => void
}) {
  const hasAccepted = appt.acceptedBy.includes(currentNickname)
  const isPending = isCurrent && appt.isPending
  return (
    <div className={`appt-card ${!isCurrent ? 'appt-card-old' : ''} ${isPending ? 'appt-card-pending' : ''}`}>
      <div className="appt-card-title">
        {!isCurrent ? '📅 이전 약속' : isPending ? '📍 약속장소 변경 제안' : '📅 약속 설정'}
      </div>
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
      {isCurrent && (
        <>
          <div className="appt-accept-row">
            <span className="appt-accept-count">✅ {appt.acceptedBy.length}/{totalMembers} 수락</span>
            {appt.acceptedBy.length > 0 && (
              <span className="appt-accept-names">{appt.acceptedBy.join(', ')}</span>
            )}
          </div>
          <div className="appt-btn-row">
            {!hasAccepted
              ? <button className="btn-accept" onClick={onAccept}>수락하기</button>
              : <div className="appt-accepted">내가 수락했어요!</div>}
            {isPending && (
              <button className="btn-reject" onClick={onReject}>거절하기</button>
            )}
          </div>
        </>
      )}
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
    const t = nowTime()
    const isChange = !!room.appointment
    const newAppt: Appointment = {
      place, datetimeISO: dt.toISOString(),
      acceptedBy: [currentUserNickname],
      verified: false,
      isPending: isChange,
    }
    const newMessages: ChatMessage[] = [...room.messages]
    if (isChange) {
      newMessages.push({ id: Date.now() - 1, text: '📍 약속장소 변경이 제안되었습니다. 모두가 수락하면 변경돼요.', isMine: false, senderName: '시스템', time: t })
    }
    newMessages.push({ id: Date.now(), text: '', isMine: true, time: t, isAppointment: true, appointmentSnapshot: newAppt })
    onUpdateRoom({
      ...room,
      messages: newMessages,
      appointment: newAppt,
      previousAppointment: isChange ? room.appointment : undefined,
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
  } else if (appt.isPending) {
    rightBtn = <span className="btn-accept-status pending">{appt.acceptedBy.length}/{room.members.length} 제안 중</span>
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
          hasAppointment={!!appt}
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
          msg.isAppointment && (msg.appointmentSnapshot ?? appt) ? (
            <div key={msg.id} className="appt-card-wrapper">
              {(() => {
                const msgAppt = msg.appointmentSnapshot ?? appt!
                const isCurrent = appt ? msgAppt.datetimeISO === appt.datetimeISO && msgAppt.place === appt.place : false
                const liveAppt = isCurrent ? appt! : msgAppt
                const t = nowTime()
                return (
                  <AppointmentCard
                    appt={liveAppt}
                    totalMembers={room.members.length}
                    currentNickname={currentUserNickname}
                    isCurrent={isCurrent}
                    onAccept={() => {
                      const newAcceptedBy = [...appt!.acceptedBy, currentUserNickname]
                      const allAccepted = newAcceptedBy.length >= room.members.length
                      const extraMsg: ChatMessage[] = allAccepted
                        ? [{ id: Date.now(), text: '✅ 모두가 약속장소 변경을 수락했어요!', isMine: false, senderName: '시스템', time: t }]
                        : []
                      onUpdateRoom({
                        ...room,
                        messages: [...room.messages, ...extraMsg],
                        appointment: { ...appt!, acceptedBy: newAcceptedBy, isPending: !allAccepted },
                        previousAppointment: allAccepted ? undefined : room.previousAppointment,
                      })
                    }}
                    onReject={() => {
                      onUpdateRoom({
                        ...room,
                        messages: [...room.messages, { id: Date.now(), text: '❌ 약속장소 변경이 거절되었습니다. 기존 약속장소로 유지돼요.', isMine: false, senderName: '시스템', time: t }],
                        appointment: room.previousAppointment,
                        previousAppointment: undefined,
                      })
                    }}
                  />
                )
              })()}
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
