import { useState, useEffect } from 'react'

export interface UserProfile {
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

export const MOCK_USERS: MockUser[] = [
  { nickname: '봄바람', studentId: '22031045', gender: '여', dept: '경영학부' },
  { nickname: '하늘이', studentId: '23010892', gender: '여', dept: '간호학과' },
  { nickname: '이슬비', studentId: '24012345', gender: '여', dept: '미디어커뮤니케이션학과' },
  { nickname: '서하린', studentId: '23045678', gender: '여', dept: '호텔관광학부' },
  { nickname: '나연',   studentId: '22060601', gender: '여', dept: '식품영양학과' },
  { nickname: '지유',   studentId: '23050505', gender: '여', dept: '아동가족복지학과' },
  { nickname: '강태양', studentId: '21055231', gender: '남', dept: '컴퓨터학부' },
  { nickname: '민준혁', studentId: '22078901', gender: '남', dept: '전기전자공학부' },
  { nickname: '도현',   studentId: '23091023', gender: '남', dept: '데이터과학부' },
  { nickname: '시윤',   studentId: '22101102', gender: '남', dept: '반도체공학과' },
  { nickname: '재원',   studentId: '23111213', gender: '남', dept: '법행정학부' },
  { nickname: '현우',   studentId: '24131401', gender: '남', dept: '건설환경에너지공학부' },
]

function makeCode() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

function randomPick(pool: MockUser[], count: number): MockUser[] {
  return [...pool].sort(() => Math.random() - 0.5).slice(0, count)
}

type View = 'select' | 'host-setup' | 'host-wait' | 'join-input' | 'join-wait' | 'instant' | 'instant-searching' | 'result'
type TeamGender = '남' | '여'

interface MatchResult {
  myTeam: MockUser[]
  otherTeam: MockUser[]
  size: number
}

interface Props {
  onBack: () => void
  currentUser: UserProfile
  onMatchSuccess: (matchedUsers: MockUser[], size: number) => void
  onRoomCreated?: (room: AvailableRoom) => void
  publicRooms?: AvailableRoom[]
  onJoinPublicRoom?: (room: AvailableRoom) => void
  initialView?: View
}

export default function RandomMatchScreen({ onBack, currentUser, onMatchSuccess, onRoomCreated, publicRooms, onJoinPublicRoom, initialView = 'select' }: Props) {
  const [view, setView]           = useState<View>(initialView)
  const [matchSize, setMatchSize] = useState(3)
  const [teamGender, setTeamGender] = useState<TeamGender>(currentUser.gender)
  const [roomCode, setRoomCode]   = useState('')
  const [roomId, setRoomId]       = useState(0)
  const [members, setMembers]     = useState(1)
  const [joinCode, setJoinCode]   = useState('')
  const [joinError, setJoinError] = useState('')
  const [countdown, setCountdown] = useState<number | null>(null)
  const [result, setResult]       = useState<MatchResult | null>(null)

  const otherGender: TeamGender = teamGender === '남' ? '여' : '남'

  // ── 방 만들기 ──
  const createRoom = () => {
    const newCode = makeCode()
    const newId = Date.now()
    setRoomCode(newCode)
    setRoomId(newId)
    setMembers(1)
    setView('host-wait')
    onRoomCreated?.({
      id: newId,
      title: `${matchSize}v${matchSize} 과팅`,
      capacity: matchSize,
      memberCount: 1,
      code: newCode,
    })
  }

  // ── 방 참여하기 ──
  const joinRoom = () => {
    if (joinCode.length !== 6) { setJoinError('방 번호는 6자리예요.'); return }
    setJoinError('')
    setView('join-wait')
  }

  // ── 멤버 추가 시뮬 ──
  const addMember = () => setMembers(p => Math.min(p + 1, matchSize))

  // ── 매칭 시작 ──
  const startMatch = () => {
    const myPool    = MOCK_USERS.filter(u => u.gender === teamGender)
    const otherPool = MOCK_USERS.filter(u => u.gender === otherGender)

    const autoFill  = Math.max(matchSize - members, 0)     // 내 팀 자동 채울 인원
    const myAuto    = randomPick(myPool, autoFill)          // 자동 채워진 내 팀원
    const otherTeam = randomPick(otherPool, matchSize)      // 상대팀 전체

    // 내 팀: 방에 있는 실제 인원(나 포함) + 자동 채워진 인원
    const myTeam: MockUser[] = [
      { nickname: currentUser.nickname, studentId: currentUser.studentId, gender: currentUser.gender, dept: currentUser.dept },
      ...Array.from({ length: members - 1 }, (_, i) => ({
        nickname: `친구${i + 1}`,
        studentId: `2400${i + 10}`,
        gender: teamGender,
        dept: '수원대학교',
      })),
      ...myAuto,
    ]

    setResult({ myTeam, otherTeam, size: matchSize })
    setCountdown(3)
  }

  // ── 카운트다운 ──
  useEffect(() => {
    if (countdown === null) return
    if (countdown === 0) {
      setView('result')
      if (result) onMatchSuccess([...result.myTeam, ...result.otherTeam], result.size)
      return
    }
    const t = setTimeout(() => setCountdown(c => (c ?? 1) - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown])

  // ════════════════════════════════
  // 화면 선택
  // ════════════════════════════════
  if (view === 'select') return (
    <div className="match-wrap">
      <button className="btn-back" onClick={onBack}>← 뒤로</button>
      <h2 className="match-title">랜덤매칭</h2>
      <p className="step-desc">방을 만들거나 방 번호로 입장하세요.</p>
      <div className="match-select-cards">
        <button className="match-select-card card-create"
          onClick={() => { setMatchSize(3); setTeamGender(currentUser.gender); setView('host-setup') }}>
          <span className="match-card-icon">🏠</span>
          <span className="match-card-label">방 만들기</span>
          <span className="match-card-sub">고유 번호로 친구 초대</span>
        </button>
        <button className="match-select-card card-join"
          onClick={() => { setJoinCode(''); setJoinError(''); setView('join-input') }}>
          <span className="match-card-icon">🚪</span>
          <span className="match-card-label">방 참여하기</span>
          <span className="match-card-sub">방 번호 입력 후 입장</span>
        </button>
      </div>
    </div>
  )

  // ── 방 설정 ──
  if (view === 'host-setup') return (
    <div className="match-wrap">
      <button className="btn-back" onClick={onBack}>← 뒤로</button>
      <h2 className="match-title">방 만들기</h2>

      <div className="input-group">
        <label>미팅 인원</label>
        <div className="match-size-row">
          {[1, 2, 3, 4].map(n => (
            <button key={n}
              className={`match-size-btn ${matchSize === n ? 'selected' : ''}`}
              onClick={() => setMatchSize(n)}>
              {n}v{n}
            </button>
          ))}
        </div>
        <p className="step-desc" style={{ marginTop: 8 }}>
          각 팀 {matchSize}명씩 총 {matchSize * 2}명이 매칭돼요.
        </p>
      </div>

      <p className="step-desc">
        우리 팀 {teamGender}자 {matchSize}명 vs 상대팀 {otherGender}자 {matchSize}명으로 매칭돼요.
      </p>

      <button className="btn-login" onClick={createRoom}>방 만들기</button>
    </div>
  )

  // ── 방장 대기실 ──
  if (view === 'host-wait') return (
    <div className="match-wrap">
      <button className="btn-back" onClick={() => setView('host-setup')}>← 뒤로</button>
      <h2 className="match-title">대기 중</h2>

      <div className="room-code-box">
        <p className="room-code-label">초대 코드</p>
        <p className="room-code">{roomCode}</p>
        <p className="room-code-hint">친구에게 이 번호를 공유하세요</p>
      </div>

      {/* 내 팀 현황 */}
      <div className="team-status-box">
        <p className="team-status-title">우리 팀 ({teamGender}자)</p>
        <div className="member-dots">
          {Array.from({ length: matchSize }).map((_, i) => (
            <div key={i} className={`member-dot ${i < members ? 'filled' : 'auto'}`}>
              {i < members ? (i === 0 ? '나' : `친구`) : '?'}
            </div>
          ))}
        </div>
        <p className="member-count">
          {members}/{matchSize}명 입장 · 부족한 {Math.max(matchSize - members, 0)}명은 자동 매칭
        </p>
      </div>

      {/* 상대팀 */}
      <div className="team-status-box other-team">
        <p className="team-status-title">상대팀 ({otherGender}자) — 자동 매칭</p>
        <div className="member-dots">
          {Array.from({ length: matchSize }).map((_, i) => (
            <div key={i} className="member-dot auto">?</div>
          ))}
        </div>
      </div>

      {members < matchSize && (
        <button className="btn-signup" onClick={addMember}>
          [테스트] 친구 입장 시뮬
        </button>
      )}

      <button className="btn-login" onClick={startMatch} disabled={countdown !== null}>
        {countdown !== null ? `${countdown}초 후 매칭 시작...` : '매칭 시작하기 💘'}
      </button>

      <p className="match-notice">
        지금 바로 시작해도 돼요! 부족한 인원은 자동으로 채워져요.
      </p>
    </div>
  )

  // ── 방 참여: 코드 입력 ──
  if (view === 'join-input') {
    const openRooms = (publicRooms ?? []).filter(r => r.memberCount < r.capacity)
    return (
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
        <button className="btn-login" onClick={joinRoom} disabled={joinCode.length !== 6}>
          입장하기
        </button>
      </div>
    )
  }

  // ── 즉시 랜덤매칭 설정 ──
  if (view === 'instant') return (
    <div className="match-wrap">
      <button className="btn-back" onClick={onBack}>← 뒤로</button>
      <h2 className="match-title">랜덤매칭</h2>
      <p className="step-desc">인원과 우리 팀 성별을 설정하면 바로 매칭해드려요!</p>

      <div className="input-group">
        <label>미팅 인원</label>
        <div className="match-size-row">
          {[1, 2, 3, 4].map(n => (
            <button key={n}
              className={`match-size-btn ${matchSize === n ? 'selected' : ''}`}
              onClick={() => setMatchSize(n)}>
              {n}v{n}
            </button>
          ))}
        </div>
      </div>

      <p className="step-desc">
        {teamGender}자 {matchSize}명 vs {otherGender}자 {matchSize}명으로 매칭돼요.
      </p>

      <button className="btn-login" onClick={() => {
        setView('instant-searching')
        setTimeout(() => {
          const myPool    = MOCK_USERS.filter(u => u.gender === teamGender)
          const otherPool = MOCK_USERS.filter(u => u.gender === otherGender)
          const myTeam: MockUser[] = [
            { nickname: currentUser.nickname, studentId: currentUser.studentId, gender: currentUser.gender, dept: currentUser.dept },
            ...randomPick(myPool, matchSize - 1),
          ]
          const otherTeam = randomPick(otherPool, matchSize)
          setResult({ myTeam, otherTeam, size: matchSize })
          setView('result')
          onMatchSuccess([...myTeam, ...otherTeam], matchSize)
        }, 2000)
      }}>
        매칭 시작하기 💘
      </button>
    </div>
  )

  // ── 즉시 매칭 중 ──
  if (view === 'instant-searching') return (
    <div className="match-wrap" style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontSize: '3.5rem', animation: 'heartSpin 1s linear infinite' }}>💘</div>
      <h2 className="match-title" style={{ textAlign: 'center' }}>매칭 중...</h2>
      <p className="step-desc" style={{ textAlign: 'center' }}>잠시만 기다려주세요</p>
    </div>
  )

  // ── 참가자 대기 ──
  if (view === 'join-wait') return (
    <div className="match-wrap">
      <button className="btn-back" onClick={() => setView('join-input')}>← 뒤로</button>
      <h2 className="match-title">입장 완료!</h2>
      <div className="room-code-box">
        <p className="room-code-label">입장한 방</p>
        <p className="room-code">{joinCode}</p>
      </div>
      <div className="waiting-spinner">
        <div className="spinner-dot" /><div className="spinner-dot" /><div className="spinner-dot" />
      </div>
      <p className="step-desc" style={{ textAlign: 'center' }}>
        방장이 매칭을 시작하기를 기다리고 있어요...
      </p>
      <button className="btn-login" onClick={startMatch}>
        [테스트] 매칭 시작
      </button>
    </div>
  )

  // ── 매칭 결과 ──
  if (view === 'result' && result) return (
    <div className="match-wrap">
      <h2 className="match-title" style={{ textAlign: 'center' }}>🎉 매칭 완료!</h2>
      <p className="step-desc" style={{ textAlign: 'center' }}>
        {result.size}v{result.size} 미팅이 성사됐어요!
      </p>

      <div className="result-team-box my-team-box">
        <p className="result-team-label">우리 팀 ({teamGender}자)</p>
        {result.myTeam.map((u, i) => (
          <div key={i} className="result-user-row">
            <span className="result-nickname">{u.nickname}</span>
            <span className="result-info">{u.studentId.slice(0, 2)}학번 · {u.dept}</span>
          </div>
        ))}
      </div>

      <div className="result-vs">VS</div>

      <div className="result-team-box other-team-box">
        <p className="result-team-label">상대팀 ({otherGender}자)</p>
        {result.otherTeam.map((u, i) => (
          <div key={i} className="result-user-row">
            <span className="result-nickname">{u.nickname}</span>
            <span className="result-info">{u.studentId.slice(0, 2)}학번 · {u.dept}</span>
          </div>
        ))}
      </div>

      <button className="btn-login" onClick={onBack}>채팅방 확인하기</button>
    </div>
  )

  return null
}
