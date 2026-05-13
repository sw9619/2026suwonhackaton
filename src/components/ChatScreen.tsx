import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { getSocket } from '../api/socket'
import { api } from '../api/client'

export interface ChatMessage {
  id: number
  text: string
  isMine: boolean
  senderName?: string
  time: string
  isAppointment?: boolean
  userId?: number
}

export interface Appointment {
  place: string
  datetimeISO: string
  accepted: boolean
  acceptedBy: number[]
  verified: boolean
  verifiedBy: number[]
  lat?: number
  lng?: number
  isPending?: boolean
}

export interface MemberDetail {
  id: number
  nickname: string
  gender: string
  dept: string
}

export interface ChatRoom {
  id: number
  title: string
  messages: ChatMessage[]
  appointment?: Appointment
  capacity: number
  memberCount: number
  members: string[]
  memberIds?: Record<string, number>
  memberDetails?: MemberDetail[]
  ratings: Record<string, number>
  myLike?: string
}

export function nowTime() {
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

function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ── 약속 설정 모달 ─────────────────────────────────────────────

function AppointmentModal({ onClose, onSend }: {
  onClose: () => void
  onSend: (place: string, dt: Date, lat?: number, lng?: number) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ name: string; address: string; category?: string; lat?: number; lng?: number; distance?: number }[]>([])
  const [searching, setSearching] = useState(false)
  const [place, setPlace] = useState('')
  const [selectedLat, setSelectedLat] = useState<number | undefined>()
  const [selectedLng, setSelectedLng] = useState<number | undefined>()
  const [dateStr, setDateStr] = useState('')
  const [timeStr, setTimeStr] = useState('')
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null)
  const canSend = place.trim() && dateStr && timeStr
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {}
      )
    }
  }, [])

  const searchPlace = useCallback(async (q?: string) => {
    const searchQ = (q ?? query).trim()
    if (!searchQ) return
    setSearching(true)
    try {
      let url = `/places/search?q=${encodeURIComponent(searchQ)}`
      if (userPos) url += `&lat=${userPos.lat}&lng=${userPos.lng}`
      const data = await api.get<{ places: { name: string; address: string; category?: string; lat?: number; lng?: number; distance?: number }[] }>(url)
      setResults(data.places)
    } catch {
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [query, userPos])

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setQuery(val)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (val.trim().length >= 2) {
      searchTimer.current = setTimeout(() => searchPlace(val), 500)
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
              onKeyDown={e => e.key === 'Enter' && searchPlace()}
            />
            <button className="btn-map-icon" onClick={() => searchPlace()} disabled={searching}>
              {searching ? '⏳' : '🔍'}
            </button>
          </div>
          {results.length > 0 && (
            <div className="search-results-list">
              {results.map((r, i) => (
                <button key={i}
                  onClick={() => { setPlace(r.name); setQuery(r.name); setSelectedLat(r.lat); setSelectedLng(r.lng); setResults([]) }}
                  className="search-result-item"
                  style={{ borderBottom: i < results.length - 1 ? undefined : 'none' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                      {r.category && <span className="search-category-badge">{r.category}</span>}
                      {r.distance !== undefined && (
                        <span className="search-distance-badge">
                          {r.distance < 1 ? `${Math.round(r.distance * 1000)}m` : `${r.distance.toFixed(1)}km`}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="search-address">{r.address}</div>
                </button>
              ))}
            </div>
          )}
          {place && (
            <div className="place-selected-box">
              📍 선택됨: <strong>{place}</strong>
              <button className="place-map-link"
                onClick={() => window.open(`https://map.kakao.com/?q=${encodeURIComponent(place)}`, '_blank')}>
                지도 보기 →
              </button>
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
          onClick={() => canSend && onSend(place.trim(), new Date(`${dateStr}T${timeStr}`), selectedLat, selectedLng)}>
          보내기
        </button>
      </div>
    </div>
  )
}

// ── 만남 인증 모달 ─────────────────────────────────────────────

function VerifyModal({ appointment, onVerify, onClose }: {
  appointment: Appointment; onVerify: () => void; onClose: () => void
}) {
  const [step, setStep] = useState<'checking' | 'ready' | 'early' | 'far' | 'done'>('checking')
  const [distanceM, setDistanceM] = useState<number | null>(null)

  useEffect(() => {
    if (!isWithinWindow(appointment.datetimeISO)) { setStep('early'); return }

    if (!navigator.geolocation) { setStep('ready'); return }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: userLat, longitude: userLng } = pos.coords
        if (appointment.lat && appointment.lng) {
          const distKm = distanceKm(userLat, userLng, appointment.lat, appointment.lng)
          const dm = Math.round(distKm * 1000)
          setDistanceM(dm)
          setStep(distKm <= 0.5 ? 'ready' : 'far')
        } else {
          setStep('ready')
        }
      },
      () => setStep('ready'),
      { timeout: 5000 }
    )
  }, [])

  const remaining = timeUntilText(appointment.datetimeISO)

  return (
    <div className="modal-overlay">
      <div className="modal-box">
        <div className="modal-header">
          <h3 className="modal-title">만남 인증</h3>
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
        {step === 'far' && (
          <>
            <div className="verify-status error">
              📍 약속 장소에서 너무 멀어요! ({distanceM}m)<br />
              500m 이내에서 인증할 수 있어요.
            </div>
            <button className="btn-login" style={{ background: '#aaa', marginTop: 8 }} onClick={() => window.open(`https://map.kakao.com/?q=${encodeURIComponent(appointment.place)}`, '_blank')}>
              지도로 보기
            </button>
          </>
        )}
        {step === 'ready' && (
          <>
            <div className="verify-status ok">
              {distanceM !== null ? `📍 약속 장소 ${distanceM}m 근처에 있어요!` : '📍 위치 확인 완료! 인증할 수 있어요.'}
            </div>
            <button className="btn-login" onClick={() => { onVerify(); setStep('done') }}>인증하기</button>
          </>
        )}
        {step === 'done' && <div className="verify-done">✅ 인증되었습니다!</div>}
      </div>
    </div>
  )
}

// ── 좋아요 선택 모달 ────────────────────────────────────────────

function PickFavoriteModal({ roomId, memberDetails, currentUserId, currentNickname, currentGender, myLike, onClose, onPicked }: {
  roomId: number
  memberDetails?: MemberDetail[]
  currentUserId?: number
  currentNickname?: string
  currentGender?: string
  myLike?: string
  onClose: () => void
  onPicked: (nickname: string) => void
}) {
  const [selected, setSelected] = useState(myLike ?? '')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(!!myLike)

  const candidates = (memberDetails ?? []).filter(m =>
    m.id !== currentUserId && (!currentGender || m.gender !== currentGender)
  )

  const handleConfirm = async () => {
    const detail = candidates.find(d => d.nickname === selected)
    if (!detail) return
    setLoading(true)
    try {
      const res = await api.post<{ matched: boolean; dmRoomId?: number; title?: string }>(
        `/rooms/${roomId}/like`, { likeeId: detail.id }, true
      )
      setDone(true)
      onPicked(selected)
      if (res.matched && res.dmRoomId) {
        setTimeout(() => alert(`💌 서로 선택했어요! "${res.title}" 채팅방이 열렸어요.`), 100)
      }
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : '실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-box">
        <div className="modal-header">
          <h3 className="modal-title">❤️ 맘에 드는 상대</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        {done ? (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <p style={{ fontSize: '2rem' }}>💌</p>
            <p style={{ fontWeight: 600, marginTop: 8 }}>{selected}님에게 전달됐어요!</p>
            <p className="modal-sub-text" style={{ fontSize: '0.85rem', marginTop: 4 }}>상대방도 선택하면 1:1 대화방이 열려요.</p>
            <button className="btn-login" style={{ marginTop: 16 }} onClick={onClose}>확인</button>
          </div>
        ) : (
          <>
            <p className="modal-sub-text" style={{ fontSize: '0.85rem', marginBottom: 12 }}>한 명만 선택할 수 있어요. 서로 선택하면 1:1 대화방이 열려요!</p>
            {candidates.length === 0 && (
              <p className="modal-empty-text">선택 가능한 상대가 없어요.</p>
            )}
            {candidates.map(m => (
              <button key={m.id}
                onClick={() => setSelected(m.nickname)}
                className={`pick-candidate-btn${selected === m.nickname ? ' selected' : ''}`}>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontWeight: 600 }}>{m.nickname}</div>
                  <div className="pick-candidate-dept">{m.dept}</div>
                </div>
                {selected === m.nickname && <span style={{ fontSize: '1.2rem' }}>❤️</span>}
              </button>
            ))}
            <button className="btn-login" disabled={!selected || loading} onClick={handleConfirm} style={{ marginTop: 4 }}>
              {loading ? '처리 중...' : '선택 완료'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function PlusMenu({ hasAppointment, onAppt, onLeave, onClose }: {
  hasAppointment: boolean; onAppt: () => void; onLeave: () => void; onClose: () => void
}) {
  return (
    <>
      <div className="plus-menu-overlay" onClick={onClose} />
      <div className="plus-menu">
        <button className="plus-menu-item" onClick={() => { onAppt(); onClose() }}>
          <span>📍</span><span>{hasAppointment ? '약속장소 변경하기' : '약속장소 지정'}</span>
        </button>
        <button className="plus-menu-item danger" onClick={() => { onLeave(); onClose() }}>
          <span>🚪</span><span>채팅방 나가기</span>
        </button>
      </div>
    </>
  )
}

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

// ── 약속 카드 ───────────────────────────────────────────────────

function AppointmentCard({ appt, currentUserId, totalCapacity, onAccept, isCurrent = true }: {
  appt: Appointment
  currentUserId?: number
  totalCapacity: number
  onAccept: () => void
  isCurrent?: boolean
}) {
  const myAccepted = currentUserId ? appt.acceptedBy.includes(currentUserId) : false
  const acceptCount = appt.acceptedBy.length
  const isPending = isCurrent && !!appt.isPending

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
      {!appt.accepted ? (
        <div>
          <div className="appt-accept-count">
            수락 {acceptCount}/{totalCapacity}명
          </div>
          {myAccepted
            ? <div className="appt-accepted">✅ 수락 완료 ({acceptCount}/{totalCapacity}명 수락)</div>
            : <button className="btn-accept" onClick={onAccept}>수락하기</button>
          }
        </div>
      ) : (
        <div className="appt-accepted">✅ 약속이 확정되었어요!</div>
      )}
    </div>
  )
}

// ── 채팅방 목록 ─────────────────────────────────────────────────

function getRoomDisplayTitle(room: ChatRoom, currentUserId?: number, currentGender?: string): string {
  if (room.memberDetails && room.memberDetails.length > 0) {
    const opponents = room.memberDetails.filter(m => m.gender !== currentGender && m.id !== currentUserId)
    if (opponents.length > 0) return opponents.map(m => m.nickname).join(', ')
    const others = room.memberDetails.filter(m => m.id !== currentUserId)
    if (others.length > 0) return others.map(m => m.nickname).join(', ')
  }
  return room.title
}

export function ChatList({ rooms, onOpenRoom, currentUserId, currentGender, unreadCounts }: {
  rooms: ChatRoom[]
  onOpenRoom: (room: ChatRoom) => void
  currentUserId?: number
  currentGender?: string
  unreadCounts?: Record<number, number>
}) {
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
            const unread = unreadCounts?.[room.id] ?? 0
            return (
              <button key={room.id} className="chat-room-item" onClick={() => onOpenRoom(room)}>
                <div className="chat-room-icon">💬</div>
                <div className="chat-room-info">
                  <span className="chat-room-name">{getRoomDisplayTitle(room, currentUserId, currentGender)}</span>
                  <span className="chat-room-last">{preview}</span>
                </div>
                {unread > 0 && <span className="chat-unread-badge">{unread > 99 ? '99+' : unread}</span>}
                <span className="chat-room-arrow">›</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── 채팅방 뷰 ──────────────────────────────────────────────────

interface RoomProps {
  room: ChatRoom
  currentUserId?: number
  currentNickname?: string
  currentGender?: string
  onBack: () => void
  onSend: (text: string) => void
  onUpdateRoom: (room: ChatRoom) => void
  onLeave: () => void
  onMutualMatch?: (dmRoomId: number, title: string, otherNickname: string) => void
}

export function ChatRoomView({ room, currentUserId, currentNickname, currentGender, onBack, onSend, onUpdateRoom, onLeave, onMutualMatch }: RoomProps) {
  const [input, setInput]               = useState('')
  const [showPlus, setShowPlus]         = useState(false)
  const [showAppModal, setShowAppModal] = useState(false)
  const [showVerify, setShowVerify]     = useState(false)
  const [showPick, setShowPick]         = useState(false)
  const [showLeave, setShowLeave]       = useState(false)
  const [showMembers, setShowMembers]   = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const roomRef = useRef(room)
  useEffect(() => { roomRef.current = room })

  // 상대방 이름으로 타이틀 표시
  const displayTitle = useMemo(() => {
    if (!currentGender || !room.memberDetails || room.memberDetails.length === 0) return room.title
    const opponents = room.memberDetails.filter(m => m.gender !== currentGender && m.id !== currentUserId)
    if (opponents.length === 0) return room.title
    return opponents.map(m => m.nickname).join(', ')
  }, [room.memberDetails, currentGender, currentUserId, room.title])

  const appt = room.appointment
  const myVerified = currentUserId ? (appt?.verifiedBy ?? []).includes(currentUserId) : false
  const lastApptMsgId = useMemo(() =>
    [...room.messages].reverse().find(m => m.isAppointment)?.id
  , [room.messages])

  // 약속 시간 + 4시간 이후에만 마음에 드는 상태 선택 가능
  const pickUnlockTime = appt ? new Date(new Date(appt.datetimeISO).getTime() + 4 * 60 * 60 * 1000) : null
  const canPick = pickUnlockTime ? Date.now() >= pickUnlockTime.getTime() : false
  const pickCountdown = pickUnlockTime ? timeUntilText(pickUnlockTime.toISOString()) : null

  useEffect(() => {
    bottomRef.current?.scrollIntoView()
  }, [])

  useEffect(() => {
    const socket = getSocket()
    socket.emit('join-room', room.id)

    const onAppointmentUpdated = (data: { place: string; datetimeISO: string; acceptedBy: number[]; verifiedBy: number[]; accepted: boolean; verified: boolean }) => {
      const apptMsg: ChatMessage = { id: Date.now(), text: '', isMine: false, time: nowTime(), isAppointment: true }
      const cur = roomRef.current
      onUpdateRoom({
        ...cur,
        messages: [...cur.messages, apptMsg],
        appointment: { place: data.place, datetimeISO: data.datetimeISO, accepted: false, acceptedBy: [], verified: false, verifiedBy: [] },
      })
    }

    const onAppointmentAccepted = (data: { roomId: number; acceptedBy: number[]; isFullyAccepted: boolean }) => {
      const cur = roomRef.current
      if (cur.appointment) {
        onUpdateRoom({ ...cur, appointment: { ...cur.appointment, accepted: data.isFullyAccepted, acceptedBy: data.acceptedBy } })
      }
    }

    const onAppointmentVerified = (data: { roomId: number; verifiedBy: number[] }) => {
      const cur = roomRef.current
      if (cur.appointment) {
        onUpdateRoom({ ...cur, appointment: { ...cur.appointment, verifiedBy: data.verifiedBy, verified: data.verifiedBy.length > 0 } })
      }
    }

    const onMutualMatchFound = (data: { dmRoomId: number; title: string; otherUser: { id: number; nickname: string } }) => {
      onMutualMatch?.(data.dmRoomId, data.title, data.otherUser.nickname)
    }

    const onNicknameChanged = (data: { userId: number; nickname: string }) => {
      const cur = roomRef.current
      const updatedDetails = cur.memberDetails?.map(m =>
        m.id === data.userId ? { ...m, nickname: data.nickname } : m
      )
      const updatedMembers = cur.members.map((name, i) => {
        const detail = cur.memberDetails?.[i]
        return detail?.id === data.userId ? data.nickname : name
      })
      onUpdateRoom({ ...cur, memberDetails: updatedDetails, members: updatedMembers })
    }

    socket.on('appointment-updated', onAppointmentUpdated)
    socket.on('appointment-accepted', onAppointmentAccepted)
    socket.on('appointment-verified', onAppointmentVerified)
    socket.on('mutual-match-found', onMutualMatchFound)
    socket.on('nickname-changed', onNicknameChanged)

    return () => {
      socket.off('appointment-updated', onAppointmentUpdated)
      socket.off('appointment-accepted', onAppointmentAccepted)
      socket.off('appointment-verified', onAppointmentVerified)
      socket.off('mutual-match-found', onMutualMatchFound)
      socket.off('nickname-changed', onNicknameChanged)
      // leave-room은 MainScreen이 관리하므로 여기서는 emit하지 않음
    }
  }, [room.id])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [room.messages.length])

  const handleSetAppointment = async (place: string, dt: Date, lat?: number, lng?: number) => {
    const datetimeISO = dt.toISOString()
    try {
      await api.post(`/rooms/${room.id}/appointment`, { place, datetimeISO, lat, lng }, true)
      const socket = getSocket()
      socket.emit('appointment-set', { roomId: room.id, place, datetimeISO })
      // 발신자 낙관적 업데이트 (다른 사람들은 소켓 이벤트로 수신)
      const apptMsg: ChatMessage = { id: Date.now(), text: '', isMine: true, time: nowTime(), isAppointment: true }
      onUpdateRoom({
        ...room,
        messages: [...room.messages, apptMsg],
        appointment: { place, datetimeISO, accepted: false, acceptedBy: [], verified: false, verifiedBy: [], lat, lng },
      })
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : '약속 설정에 실패했습니다.')
    }
    setShowAppModal(false)
  }

  const handleAcceptAppointment = async () => {
    try {
      const result = await api.put<{ acceptedBy: number[]; isFullyAccepted: boolean }>(
        `/rooms/${room.id}/appointment/accept`, {}, true
      )
      if (appt) onUpdateRoom({ ...room, appointment: { ...appt, accepted: result.isFullyAccepted, acceptedBy: result.acceptedBy } })
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : '수락에 실패했습니다.')
    }
  }

  const handleVerify = async () => {
    try {
      const result = await api.put<{ verifiedBy: number[] }>(
        `/rooms/${room.id}/appointment/verify`, {}, true
      )
      if (appt) onUpdateRoom({ ...room, appointment: { ...appt, verifiedBy: result.verifiedBy, verified: true } })
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : '인증에 실패했습니다.')
    }
  }

  const handlePicked = (nickname: string) => {
    onUpdateRoom({ ...room, myLike: nickname })
  }

  const handleSend = () => {
    if (!input.trim()) return
    const socket = getSocket()
    socket.emit('send-message', { roomId: room.id, text: input.trim() })
    onSend(input.trim())  // MainScreen의 최신 activeRoom으로 optimistic update
    setInput('')
  }

  let rightBtn: React.ReactNode
  if (!appt) {
    rightBtn = <button className="btn-appt-header" onClick={() => setShowAppModal(true)}>📍 약속장소 지정</button>
  } else if (!myVerified) {
    rightBtn = <button className="btn-verify-header" onClick={() => setShowVerify(true)}>✅ 만남 인증</button>
  } else {
    rightBtn = (
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span className="btn-verified-header">✓ 인증완료</span>
        {!room.myLike && (canPick
          ? <button className="btn-verify-header" style={{ fontSize: '0.75rem', padding: '4px 8px' }} onClick={() => setShowPick(true)}>❤️ 선택</button>
          : pickCountdown && <span style={{ fontSize: '0.68rem', color: '#aaa', whiteSpace: 'nowrap' }}>{pickCountdown} 후 선택</span>
        )}
        {room.myLike && <span style={{ fontSize: '0.75rem', color: '#ff6b9d' }}>❤️ 선택완료</span>}
      </div>
    )
  }

  return (
    <div className="chat-room-wrap">
      {showPlus && (
        <PlusMenu
          hasAppointment={!!appt}
          onAppt={() => setShowAppModal(true)}
          onLeave={() => setShowLeave(true)}
          onClose={() => setShowPlus(false)}
        />
      )}
      {showAppModal && <AppointmentModal onClose={() => setShowAppModal(false)} onSend={handleSetAppointment} />}
      {showVerify && appt && (
        <VerifyModal appointment={appt} onVerify={handleVerify} onClose={() => setShowVerify(false)} />
      )}
      {showPick && (
        <PickFavoriteModal
          roomId={room.id}
          memberDetails={room.memberDetails}
          currentUserId={currentUserId}
          currentNickname={currentNickname}
          currentGender={currentGender}
          myLike={room.myLike}
          onClose={() => setShowPick(false)}
          onPicked={handlePicked}
        />
      )}
      {showLeave && <LeaveModal onClose={() => setShowLeave(false)} onLeave={onLeave} />}

      {showMembers && (
        <div className="modal-overlay" onClick={() => setShowMembers(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">멤버 목록</h3>
              <button className="modal-close" onClick={() => setShowMembers(false)}>✕</button>
            </div>
            <div style={{ marginTop: 8 }}>
              {(room.memberDetails && room.memberDetails.length > 0
                ? room.memberDetails.map(m => ({ nickname: m.nickname, dept: m.dept, gender: m.gender }))
                : room.members.map(name => ({ nickname: name, dept: '', gender: '' }))
              ).map((m, i) => (
                <div key={i} className="member-list-item">
                  <div className={`member-avatar ${m.gender === '여' ? 'female' : m.gender === '남' ? 'male' : ''}`}>
                    {m.gender === '여' ? '👧' : m.gender === '남' ? '👦' : '👤'}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.92rem' }}>
                      {m.nickname}{m.nickname === currentNickname ? ' (나)' : ''}
                    </div>
                    {m.dept && <div className="member-dept">{m.dept}</div>}
                  </div>
                </div>
              ))}
            </div>
            <button className="btn-login" style={{ marginTop: 16 }} onClick={() => setShowMembers(false)}>닫기</button>
          </div>
        </div>
      )}

      <div className="chat-room-header">
        <button className="btn-back" onClick={onBack}>← 뒤로</button>
        <h2 className="chat-room-title" style={{ cursor: 'pointer' }} onClick={() => setShowMembers(true)}>
          {displayTitle} <span style={{ fontSize: '0.7rem', color: '#aaa' }}>👥</span>
        </h2>
        {rightBtn}
      </div>

      <div className="chat-messages">
        {room.messages.map(msg =>
          msg.isAppointment ? (
            msg.id === lastApptMsgId && appt ? (
              <div key={msg.id} className="appt-card-wrapper">
                <AppointmentCard appt={appt} currentUserId={currentUserId} totalCapacity={room.capacity} onAccept={handleAcceptAppointment} />
              </div>
            ) : (
              <div key={msg.id} className="chat-bubble-wrap theirs">
                <div className="chat-bubble bubble-theirs" style={{ background: '#f0f0f0', color: '#999', fontSize: '0.82rem' }}>📍 약속이 변경되었습니다</div>
                <span className="chat-time">{msg.time}</span>
              </div>
            )
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
