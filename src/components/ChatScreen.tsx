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
}

export interface PendingAppointment {
  place: string
  datetimeISO: string
  lat?: number
  lng?: number
  proposedBy: number
  acceptedBy: number[]
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
  pendingAppointment?: PendingAppointment
  capacity: number
  memberCount: number
  members: string[]
  memberIds?: Record<string, number>
  memberDetails?: MemberDetail[]
  ratings: Record<string, number>
  myLike?: string
  myRatings?: Record<number, number>
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
  const [results, setResults] = useState<{ name: string; address: string; category?: string; categoryDetail?: string; phone?: string; lat?: number; lng?: number; distance?: number }[]>([])
  const [searching, setSearching] = useState(false)
  const [place, setPlace] = useState('')
  const [selectedLat, setSelectedLat] = useState<number | undefined>()
  const [selectedLng, setSelectedLng] = useState<number | undefined>()
  const [dateStr, setDateStr] = useState('')
  const [timeStr, setTimeStr] = useState('')
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null)
  const canSend = place.trim() && dateStr && timeStr
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const queryRef = useRef(query)
  const userPosRef = useRef(userPos)
  useEffect(() => { queryRef.current = query }, [query])
  useEffect(() => { userPosRef.current = userPos }, [userPos])

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {}
      )
    }
  }, [])

  const searchPlace = useCallback(async (q?: string) => {
    const searchQ = (q ?? queryRef.current).trim()
    if (!searchQ) return
    setSearching(true)
    try {
      let url = `/places/search?q=${encodeURIComponent(searchQ)}`
      const pos = userPosRef.current
      if (pos) url += `&lat=${pos.lat}&lng=${pos.lng}`
      const data = await api.get<{ places: { name: string; address: string; category?: string; categoryDetail?: string; phone?: string; lat?: number; lng?: number; distance?: number }[] }>(url)
      setResults(data.places)
    } catch {
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [])

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setQuery(val)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (val.trim().length >= 2) {
      searchTimer.current = setTimeout(() => searchPlace(val), 300)
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
                      {(r.categoryDetail || r.category) && (
                        <span className="search-category-badge">{r.categoryDetail || r.category}</span>
                      )}
                      {r.distance !== undefined && (
                        <span className="search-distance-badge">
                          {r.distance < 1 ? `${Math.round(r.distance * 1000)}m` : `${r.distance.toFixed(1)}km`}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="search-address">{r.address}</div>
                  {r.phone && <div className="search-phone">📞 {r.phone}</div>}
                </button>
              ))}
            </div>
          )}
          {!place && query.trim().length >= 2 && !searching && (
            <button
              className="search-result-item"
              style={{ marginTop: 4, color: '#888', fontSize: '0.85rem', borderRadius: 8, border: '1px dashed #ccc', background: 'none', width: '100%', textAlign: 'left', padding: '8px 10px' }}
              onClick={() => { setPlace(query.trim()); setSelectedLat(undefined); setSelectedLng(undefined); setResults([]) }}
            >
              ✏️ "{query.trim()}" 직접 입력하기
            </button>
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
          <input type="date" className="pw-input" value={dateStr}
            min={new Date().toISOString().split('T')[0]}
            onChange={e => setDateStr(e.target.value)} />
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
  appointment: Appointment; onVerify: (pos: { lat: number; lng: number }) => void; onClose: () => void
}) {
  const [step, setStep] = useState<'checking' | 'ready' | 'early' | 'far' | 'done' | 'gps-denied' | 'gps-blocked' | 'no-coords'>('checking')
  const [distanceM, setDistanceM] = useState<number | null>(null)
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null)

  const checkGPS = () => {
    if (!isWithinWindow(appointment.datetimeISO)) { setStep('early'); return }
    if (!navigator.geolocation) { setStep('gps-blocked'); return }
    setStep('checking')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: userLat, longitude: userLng } = pos.coords
        setUserPos({ lat: userLat, lng: userLng })
        if (appointment.lat && appointment.lng) {
          const distKm = distanceKm(userLat, userLng, appointment.lat, appointment.lng)
          const dm = Math.round(distKm * 1000)
          setDistanceM(dm)
          setStep(distKm <= 0.5 ? 'ready' : 'far')
        } else {
          setStep('no-coords')
        }
      },
      () => setStep('gps-denied'),
      { timeout: 8000 }
    )
  }

  const requestPermission = async () => {
    if (navigator.permissions) {
      const result = await navigator.permissions.query({ name: 'geolocation' })
      if (result.state === 'denied') { setStep('gps-blocked'); return }
    }
    checkGPS()
  }

  useEffect(() => { checkGPS() }, [])

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
        {step === 'gps-denied' && (
          <>
            <div className="verify-status error">
              📵 위치 권한이 거부되었어요.<br />
              만남 인증을 위해 위치 권한이 필요해요.
            </div>
            <button className="btn-login" style={{ marginTop: 12 }} onClick={requestPermission}>
              위치 권한 허용하기
            </button>
          </>
        )}
        {step === 'gps-blocked' && (
          <div className="verify-status error">
            📵 위치 권한이 차단되어 있어요.<br />
            브라우저 설정에서 위치 권한을 허용한 후<br />
            다시 시도해주세요.
          </div>
        )}
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
        {step === 'no-coords' && (
          <div className="verify-status error">
            📍 약속 장소 좌표 정보가 없어요.<br />
            약속 장소를 다시 설정해주세요.
          </div>
        )}
        {step === 'ready' && (
          <>
            <div className="verify-status ok">
              📍 약속 장소 {distanceM}m 근처에 있어요!
            </div>
            <button className="btn-login" onClick={() => { if (userPos) { onVerify(userPos); setStep('done') } }}>인증하기</button>
          </>
        )}
        {step === 'done' && <div className="verify-done">✅ 인증되었습니다!</div>}
      </div>
    </div>
  )
}

// ── 좋아요 선택 모달 ────────────────────────────────────────────

function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} onClick={() => onChange(n)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.4rem', padding: 0, color: n <= value ? '#f5a623' : '#ccc' }}>
          {n <= value ? '★' : '☆'}
        </button>
      ))}
    </div>
  )
}

function PickFavoriteModal({ roomId, memberDetails, currentUserId, currentGender, myLike, myRatings, canRate, onClose, onPicked }: {
  roomId: number
  memberDetails?: MemberDetail[]
  currentUserId?: number
  currentGender?: string
  myLike?: string
  myRatings?: Record<number, number>
  canRate: boolean
  onClose: () => void
  onPicked: (nickname: string, ratings: Record<number, number>) => void
}) {
  const [selected, setSelected] = useState(myLike ?? '')
  const [liked, setLiked] = useState(!!myLike)
  const [ratings, setRatings] = useState<Record<number, number>>(myRatings ?? {})
  const [loading, setLoading] = useState(false)

  const likeCandidates = (memberDetails ?? []).filter(m =>
    m.id !== currentUserId && (!currentGender || m.gender !== currentGender)
  )
  const ratingCandidates = (memberDetails ?? []).filter(m => m.id !== currentUserId)

  const handleConfirm = async () => {
    setLoading(true)
    try {
      if (selected && !liked) {
        const detail = likeCandidates.find(d => d.nickname === selected)
        if (detail) {
          const res = await api.post<{ matched: boolean; dmRoomId?: number; title?: string }>(
            `/rooms/${roomId}/like`, { likeeId: detail.id }, true
          )
          setLiked(true)
          if (res.matched && res.dmRoomId) {
            setTimeout(() => alert(`💌 서로 선택했어요! "${res.title}" 채팅방이 열렸어요.`), 100)
          }
        }
      }

      if (canRate) {
        const ratingPayload = Object.entries(ratings).map(([id, stars]) => ({ rateeId: Number(id), stars }))
        if (ratingPayload.length > 0) {
          await api.post(`/rooms/${roomId}/ratings`, { ratings: ratingPayload }, true)
        }
      }

      onPicked(selected, ratings)
      onClose()
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
          <h3 className="modal-title">❤️ 맘에 드는 상대 & ⭐ 별점</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {likeCandidates.length > 0 && (
          <>
            <p className="modal-sub-text" style={{ fontSize: '0.85rem', marginBottom: 8 }}>
              {liked ? `💌 ${selected}님에게 전달됐어요!` : '한 명만 선택할 수 있어요. 서로 선택하면 1:1 대화방이 열려요!'}
            </p>
            {!liked && likeCandidates.map(m => (
              <button key={m.id} onClick={() => setSelected(m.nickname)}
                className={`pick-candidate-btn${selected === m.nickname ? ' selected' : ''}`}>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontWeight: 600 }}>{m.nickname}</div>
                  <div className="pick-candidate-dept">{m.dept}</div>
                </div>
                {selected === m.nickname && <span style={{ fontSize: '1.2rem' }}>❤️</span>}
              </button>
            ))}
          </>
        )}

        <p className="modal-sub-text" style={{ fontSize: '0.85rem', margin: '12px 0 8px' }}>⭐ 멤버 별점 주기</p>
        {!canRate ? (
          <p style={{ fontSize: '0.85rem', color: '#aaa', textAlign: 'center', padding: '8px 0' }}>별점 기한이 지났어요. (미팅 후 3일 이내)</p>
        ) : ratingCandidates.map(m => (
          <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{m.nickname}</div>
              <div style={{ fontSize: '0.75rem', color: '#aaa' }}>{m.dept}</div>
            </div>
            <StarRating value={ratings[m.id] ?? 0} onChange={v => setRatings(prev => ({ ...prev, [m.id]: v }))} />
          </div>
        ))}

        <button className="btn-login" disabled={loading} onClick={handleConfirm} style={{ marginTop: 8 }}>
          {loading ? '처리 중...' : '완료'}
        </button>
      </div>
    </div>
  )
}

function PlusMenu({ hasAppointment, canLeave, onAppt, onLeave, onClose }: {
  hasAppointment: boolean; canLeave: boolean; onAppt: () => void; onLeave: () => void; onClose: () => void
}) {
  return (
    <>
      <div className="plus-menu-overlay" onClick={onClose} />
      <div className="plus-menu">
        <button className="plus-menu-item" onClick={() => { onAppt(); onClose() }}>
          <span>📍</span><span>{hasAppointment ? '약속장소 변경하기' : '약속장소 지정'}</span>
        </button>
        {canLeave ? (
          <button className="plus-menu-item danger" onClick={() => { onLeave(); onClose() }}>
            <span>🚪</span><span>채팅방 나가기</span>
          </button>
        ) : (
          <div className="plus-menu-item disabled">
            <span>🔒</span><span>채팅방 나가기 (약속 수락 후 불가)</span>
          </div>
        )}
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

  return (
    <div className={`appt-card ${!isCurrent ? 'appt-card-old' : ''}`}>
      <div className="appt-card-title">
        {!isCurrent ? '📅 이전 약속' : '📅 약속 설정'}
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

// ── 약속 변경 제안 배너 ──────────────────────────────────────────

function PendingApptBar({ pending, currentUserId, totalCapacity, onAccept }: {
  pending: PendingAppointment
  currentUserId?: number
  totalCapacity: number
  onAccept: () => void
}) {
  const myAccepted = currentUserId ? pending.acceptedBy.includes(currentUserId) : false
  const acceptCount = pending.acceptedBy.length

  return (
    <div className="pending-appt-bar">
      <div className="pending-appt-bar-top">
        <span className="pending-appt-bar-title">📍 약속장소 변경 제안</span>
        <span className="pending-appt-bar-count">{acceptCount}/{totalCapacity}명 수락</span>
      </div>
      <div className="pending-appt-bar-place">{pending.place}</div>
      <div className="pending-appt-bar-time">{formatDatetime(pending.datetimeISO)}</div>
      {myAccepted
        ? <div className="appt-accepted" style={{ fontSize: '0.82rem', padding: '4px 0' }}>✅ 수락 완료</div>
        : <button className="btn-accept" style={{ marginTop: 6 }} onClick={onAccept}>수락하기</button>
      }
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

export function ChatList({ rooms, onOpenRoom, currentUserId, currentGender, unreadCounts, bannerVisible }: {
  rooms: ChatRoom[]
  onOpenRoom: (room: ChatRoom) => void
  currentUserId?: number
  currentGender?: string
  unreadCounts?: Record<number, number>
  bannerVisible?: boolean
}) {
  return (
    <div className="chat-list-wrap" style={bannerVisible ? { paddingBottom: 88 } : {}}>
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

  // 만남 인증 제재: 약속 수락 완료 + 인증 창(약속 시각 +30분) 지남 + 미인증
  const verifyDeadline = appt ? new Date(new Date(appt.datetimeISO).getTime() + 30 * 60 * 1000) : null
  const isPenalized = !!(appt?.accepted && !myVerified && verifyDeadline && Date.now() > verifyDeadline.getTime())

  // 약속 시간 + 4시간 이후에만 마음에 드는 상태 선택 가능
  const pickUnlockTime = appt ? new Date(new Date(appt.datetimeISO).getTime() + 4 * 60 * 60 * 1000) : null
  const canPick = pickUnlockTime ? Date.now() >= pickUnlockTime.getTime() : false
  const pickCountdown = pickUnlockTime ? timeUntilText(pickUnlockTime.toISOString()) : null

  // 별점은 약속 시간 + 3일까지만 가능
  const ratingDeadline = appt ? new Date(new Date(appt.datetimeISO).getTime() + 3 * 24 * 60 * 60 * 1000) : null
  const canRate = canPick && (ratingDeadline ? Date.now() < ratingDeadline.getTime() : false)

  useEffect(() => {
    bottomRef.current?.scrollIntoView()
  }, [])

  useEffect(() => {
    const socket = getSocket()
    socket.emit('join-room', room.id)

    const onAppointmentUpdated = (data: { roomId: number; place: string; datetimeISO: string; acceptedBy: number[]; verifiedBy: number[]; accepted: boolean; verified: boolean; lat?: number; lng?: number; clearPending?: boolean }) => {
      if (data.roomId !== room.id) return
      const apptMsg: ChatMessage = { id: Date.now(), text: '', isMine: false, time: nowTime(), isAppointment: true }
      const cur = roomRef.current
      onUpdateRoom({
        ...cur,
        messages: [...cur.messages, apptMsg],
        appointment: { place: data.place, datetimeISO: data.datetimeISO, accepted: data.accepted, acceptedBy: data.acceptedBy, verified: false, verifiedBy: [], lat: data.lat, lng: data.lng },
        pendingAppointment: data.clearPending ? undefined : cur.pendingAppointment,
      })
    }

    const onAppointmentAccepted = (data: { roomId: number; acceptedBy: number[]; isFullyAccepted: boolean }) => {
      if (data.roomId !== room.id) return
      const cur = roomRef.current
      if (cur.appointment) {
        onUpdateRoom({ ...cur, appointment: { ...cur.appointment, accepted: data.isFullyAccepted, acceptedBy: data.acceptedBy } })
      }
    }

    const onAppointmentVerified = (data: { roomId: number; verifiedBy: number[] }) => {
      if (data.roomId !== room.id) return
      const cur = roomRef.current
      if (cur.appointment) {
        onUpdateRoom({ ...cur, appointment: { ...cur.appointment, verifiedBy: data.verifiedBy, verified: data.verifiedBy.length > 0 } })
      }
    }

    const onPendingAppointmentSet = (data: { roomId: number; place: string; datetimeISO: string; lat?: number; lng?: number; proposedBy: number; acceptedBy: number[] }) => {
      if (data.roomId !== room.id) return
      const cur = roomRef.current
      onUpdateRoom({
        ...cur,
        pendingAppointment: { place: data.place, datetimeISO: data.datetimeISO, lat: data.lat, lng: data.lng, proposedBy: data.proposedBy, acceptedBy: data.acceptedBy },
      })
    }

    const onPendingAppointmentAccepted = (data: { roomId: number; acceptedBy: number[] }) => {
      if (data.roomId !== room.id) return
      const cur = roomRef.current
      if (cur.pendingAppointment) {
        onUpdateRoom({ ...cur, pendingAppointment: { ...cur.pendingAppointment, acceptedBy: data.acceptedBy } })
      }
    }

    const onPendingAppointmentCleared = (data: { roomId: number }) => {
      if (data.roomId !== room.id) return
      const cur = roomRef.current
      onUpdateRoom({ ...cur, pendingAppointment: undefined })
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
    socket.on('pending-appointment-set', onPendingAppointmentSet)
    socket.on('pending-appointment-accepted', onPendingAppointmentAccepted)
    socket.on('pending-appointment-cleared', onPendingAppointmentCleared)
    socket.on('mutual-match-found', onMutualMatchFound)
    socket.on('nickname-changed', onNicknameChanged)

    return () => {
      socket.off('appointment-updated', onAppointmentUpdated)
      socket.off('appointment-accepted', onAppointmentAccepted)
      socket.off('appointment-verified', onAppointmentVerified)
      socket.off('pending-appointment-set', onPendingAppointmentSet)
      socket.off('pending-appointment-accepted', onPendingAppointmentAccepted)
      socket.off('pending-appointment-cleared', onPendingAppointmentCleared)
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
      const result = await api.post<{ message: string; pending?: boolean }>(`/rooms/${room.id}/appointment`, { place, datetimeISO, lat, lng }, true)
      if (!result.pending) {
        // 새 약속 설정: 소켓 릴레이 + 낙관적 업데이트
        const socket = getSocket()
        socket.emit('appointment-set', { roomId: room.id, place, datetimeISO, lat, lng })
        const apptMsg: ChatMessage = { id: Date.now(), text: '', isMine: true, time: nowTime(), isAppointment: true }
        onUpdateRoom({
          ...room,
          messages: [...room.messages, apptMsg],
          appointment: { place, datetimeISO, accepted: false, acceptedBy: [], verified: false, verifiedBy: [], lat, lng },
        })
      }
      // pending: true이면 백엔드가 'pending-appointment-set' 소켓을 전체에 emit → 소켓으로 처리
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : '약속 설정에 실패했습니다.')
    }
    setShowAppModal(false)
  }

  const handleAcceptAppointment = async () => {
    try {
      await api.put(`/rooms/${room.id}/appointment/accept`, {}, true)
      // 상태 업데이트는 소켓 이벤트 'appointment-accepted'가 전담 (자신 포함 전체 멤버)
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : '수락에 실패했습니다.')
    }
  }

  const handleAcceptPending = async () => {
    try {
      await api.put(`/rooms/${room.id}/appointment/pending/accept`, {}, true)
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : '수락에 실패했습니다.')
    }
  }


  const handleVerify = async (pos: { lat: number; lng: number }) => {
    try {
      await api.put(`/rooms/${room.id}/appointment/verify`, { lat: pos.lat, lng: pos.lng }, true)
      // 상태 업데이트는 소켓 이벤트 'appointment-verified'가 전담
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : '인증에 실패했습니다.')
    }
  }

  const handlePicked = (nickname: string, ratings: Record<number, number>) => {
    onUpdateRoom({ ...room, myLike: nickname || room.myLike, myRatings: { ...room.myRatings, ...ratings } })
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
  } else if (!appt.accepted) {
    const acceptCount = appt.acceptedBy.length
    rightBtn = <span style={{ fontSize: '0.75rem', color: '#aaa', whiteSpace: 'nowrap' }}>✅ {acceptCount}/{room.capacity}명 수락</span>
  } else if (!myVerified) {
    rightBtn = <button className="btn-verify-header" onClick={() => setShowVerify(true)}>✅ 만남 인증</button>
  } else {
    rightBtn = (
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span className="btn-verified-header">✓ 인증완료</span>
        {canPick
          ? <button className="btn-verify-header" style={{ fontSize: '0.75rem', padding: '4px 8px' }} onClick={() => setShowPick(true)}>
              {room.myLike ? '❤️ 선택완료' : '❤️ 선택 & ⭐ 별점'}
            </button>
          : pickCountdown && <span style={{ fontSize: '0.68rem', color: '#aaa', whiteSpace: 'nowrap' }}>{pickCountdown} 후 선택</span>
        }
      </div>
    )
  }

  if (isPenalized) {
    return (
      <div className="chat-room-wrap">
        <div className="modal-overlay">
          <div className="modal-box" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>⚠️</div>
            <h3 className="modal-title" style={{ marginBottom: 12 }}>이용 제한 안내</h3>
            <p style={{ fontSize: '0.92rem', color: '#555', lineHeight: 1.6, marginBottom: 20 }}>
              약속 시간 내 만남 인증을 완료하지 않아<br />
              해당 채팅방 이용이 <strong>불가</strong>합니다.<br />
              채팅방에서 자동으로 나가게 됩니다.
            </p>
            <button className="btn-login" style={{ background: '#e74c3c', width: '100%' }} onClick={onLeave}>
              확인 후 나가기
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="chat-room-wrap">
      {showPlus && (
        <PlusMenu
          hasAppointment={!!appt}
          canLeave={!appt?.accepted}
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
          currentGender={currentGender}
          myLike={room.myLike}
          myRatings={room.myRatings}
          canRate={canRate}
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
                <div className="chat-bubble bubble-theirs" style={{ background: '#f0f0f0', color: '#999', fontSize: '0.82rem' }}>📍 이 약속은 변경되었습니다</div>
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

      {room.pendingAppointment && (
        <PendingApptBar
          pending={room.pendingAppointment}
          currentUserId={currentUserId}
          totalCapacity={room.capacity}
          onAccept={handleAcceptPending}
        />
      )}

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
