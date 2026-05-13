import { useState, useEffect } from 'react'
import { api } from '../api/client'
import { UserProfile } from './RandomMatchScreen'

type View = 'main' | 'profile' | 'pwStep1' | 'pwStep2' | 'pwStep3' | 'deleteConfirm' | 'deleteConfirm2' | 'deleted'

interface Props {
  onLogout: () => void
  onAccountDeleted: () => void
  onPasswordReset: () => void
  darkMode: boolean
  onToggleDarkMode: () => void
  currentUser: UserProfile
  onUpdateUser: (nickname: string) => void
}

export default function SettingsTab({ onLogout, onAccountDeleted, onPasswordReset, darkMode, onToggleDarkMode, currentUser, onUpdateUser }: Props) {
  const [view, setView] = useState<View>('main')
  const [loading, setLoading] = useState(false)

  // 프로필
  const [nickname, setNickname] = useState(currentUser.nickname)

  useEffect(() => {
    setNickname(currentUser.nickname)
  }, [currentUser.nickname])
  const [nicknameError, setNicknameError] = useState('')
  const [nicknameSaved, setNicknameSaved] = useState(false)

  // 비밀번호 재설정
  const [emailId, setEmailId] = useState('')
  const [inputCode, setInputCode] = useState('')
  const [codeError, setCodeError] = useState(false)
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwError, setPwError] = useState('')

  // 계정 삭제
  const [deletePw, setDeletePw] = useState('')
  const [deletePwError, setDeletePwError] = useState('')

  const sendCode = async () => {
    setLoading(true)
    try {
      await api.post('/auth/send-code', { email: emailId, type: 'reset' })
      setInputCode('')
      setCodeError(false)
      setView('pwStep2')
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : '전송에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const verifyCode = async () => {
    setLoading(true)
    try {
      await api.post('/auth/verify-code', { email: emailId, code: inputCode, type: 'reset' })
      setCodeError(false)
      setView('pwStep3')
    } catch {
      setCodeError(true)
    } finally {
      setLoading(false)
    }
  }

  const resetPassword = async () => {
    if (newPw.length < 8) { setPwError('비밀번호는 8자 이상이어야 해요.'); return }
    if (newPw !== confirmPw) { setPwError('비밀번호가 일치하지 않아요.'); return }
    setPwError('')
    setLoading(true)
    try {
      await api.post('/auth/reset-password', { email: emailId, password: newPw })
      alert('비밀번호가 재설정됐어요. 다시 로그인해주세요.')
      onPasswordReset()
    } catch (e: unknown) {
      setPwError(e instanceof Error ? e.message : '재설정에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const saveNickname = async () => {
    if (!nickname) { setNicknameError('닉네임을 입력해주세요.'); return }
    if (nickname.length > 10) { setNicknameError('10자 이하로 입력해주세요.'); return }
    setNicknameError('')
    setLoading(true)
    try {
      await api.put('/users/profile', { nickname }, true)
      onUpdateUser(nickname)
      setNicknameSaved(true)
      setTimeout(() => setNicknameSaved(false), 2000)
    } catch (e: unknown) {
      setNicknameError(e instanceof Error ? e.message : '저장에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const tryDelete = async () => {
    if (deletePw.length < 8) { setDeletePwError('비밀번호를 올바르게 입력해주세요.'); return }
    setDeletePwError('')
    setView('deleteConfirm2')
  }

  const confirmDelete = async () => {
    setLoading(true)
    try {
      await api.del('/users/me', { password: deletePw }, true)
      setView('deleted')
    } catch (e: unknown) {
      setDeletePwError(e instanceof Error ? e.message : '삭제에 실패했습니다.')
      setView('deleteConfirm')
    } finally {
      setLoading(false)
    }
  }

  if (view === 'main') return (
    <div className="settings-wrap">
      <h2 className="settings-title">설정</h2>
      <div className="settings-list">
        <button className="settings-item" onClick={() => { setNickname(currentUser.nickname); setView('profile') }}>
          <span className="settings-item-icon">👤</span>
          <span className="settings-item-label">프로필 수정</span>
          <span className="settings-item-arrow">›</span>
        </button>

        <div className="settings-item" onClick={onToggleDarkMode} style={{ cursor: 'pointer' }}>
          <span className="settings-item-icon">{darkMode ? '🌙' : '☀️'}</span>
          <span className="settings-item-label">다크모드</span>
          <div className={`toggle-switch ${darkMode ? 'on' : ''}`}>
            <div className="toggle-knob" />
          </div>
        </div>

        <button className="settings-item" onClick={onLogout}>
          <span className="settings-item-icon">🚪</span>
          <span className="settings-item-label">로그아웃</span>
          <span className="settings-item-arrow">›</span>
        </button>
        <button className="settings-item danger" onClick={() => { setDeletePw(''); setDeletePwError(''); setView('deleteConfirm') }}>
          <span className="settings-item-icon">🗑️</span>
          <span className="settings-item-label">계정 삭제</span>
          <span className="settings-item-arrow">›</span>
        </button>
      </div>
    </div>
  )

  if (view === 'profile') return (
    <div className="login-wrap">
      <button className="btn-back" onClick={() => setView('main')}>← 설정으로</button>
      <h2 className="login-title">프로필 수정</h2>

      <div className="input-group">
        <label>닉네임 <span className="label-hint">(10자 이하)</span></label>
        <input
          type="text"
          placeholder="새 닉네임 입력"
          value={nickname}
          onChange={e => { setNickname(e.target.value); setNicknameError('') }}
          className={`pw-input ${nicknameError ? 'error' : ''}`}
          maxLength={10}
        />
        <div className="input-meta">
          {nicknameError ? <p className="error-msg">{nicknameError}</p> : <span />}
          <span className="char-count">{nickname.length}/10</span>
        </div>
      </div>
      {nicknameSaved && <p style={{ color: '#1a8fa0', fontSize: '0.85rem', textAlign: 'center' }}>닉네임이 저장됐어요!</p>}
      <button className="btn-login" onClick={saveNickname} disabled={loading}>
        {loading ? '저장 중...' : '닉네임 저장'}
      </button>

      <div className="divider" />

      <button className="btn-signup" onClick={() => { setEmailId(''); setView('pwStep1') }}>
        비밀번호 재설정
      </button>
    </div>
  )

  if (view === 'pwStep1') return (
    <div className="login-wrap">
      <button className="btn-back" onClick={() => setView('profile')}>← 프로필 수정으로</button>
      <h2 className="login-title">비밀번호 재설정</h2>
      <p className="step-desc">학교 이메일로 인증을 진행해주세요.</p>
      <div className="input-group">
        <label>학교 이메일</label>
        <div className="email-row">
          <input
            type="text"
            placeholder="아이디 입력"
            value={emailId}
            onChange={e => setEmailId(e.target.value)}
            className="email-input"
          />
          <span className="email-domain">@suwon.ac.kr</span>
        </div>
      </div>
      <button className="btn-login" onClick={sendCode} disabled={!emailId || loading}>
        {loading ? '전송 중...' : '인증번호 전송'}
      </button>
    </div>
  )

  if (view === 'pwStep2') return (
    <div className="login-wrap">
      <button className="btn-back" onClick={() => setView('pwStep1')}>← 이전으로</button>
      <h2 className="login-title">인증번호 확인</h2>
      <p className="step-desc"><b>{emailId}@suwon.ac.kr</b> 로 전송된<br />인증번호 6자리를 입력해주세요.</p>
      <div className="input-group">
        <label>인증번호</label>
        <input
          type="text"
          placeholder="인증번호 6자리"
          value={inputCode}
          onChange={e => { setInputCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setCodeError(false) }}
          className={`pw-input ${codeError ? 'error' : ''}`}
          maxLength={6}
        />
        {codeError && <p className="error-msg">인증번호를 확인해주세요.</p>}
      </div>
      <button className="btn-login" onClick={verifyCode} disabled={inputCode.length !== 6 || loading}>확인</button>
      <button className="btn-forgot" onClick={sendCode} disabled={loading}>인증번호 재전송하기</button>
    </div>
  )

  if (view === 'pwStep3') return (
    <div className="login-wrap">
      <h2 className="login-title">새 비밀번호 설정</h2>
      <p className="step-desc">새로운 비밀번호를 입력해주세요.</p>
      <div className="input-group">
        <label>새 비밀번호</label>
        <input type="password" placeholder="8자 이상 입력" value={newPw}
          onChange={e => { setNewPw(e.target.value); setPwError('') }}
          className="pw-input" />
      </div>
      <div className="input-group">
        <label>비밀번호 확인</label>
        <input type="password" placeholder="비밀번호 재입력" value={confirmPw}
          onChange={e => { setConfirmPw(e.target.value); setPwError('') }}
          className={`pw-input ${pwError ? 'error' : ''}`} />
        {pwError && <p className="error-msg">{pwError}</p>}
      </div>
      <button className="btn-login" onClick={resetPassword} disabled={loading}>
        {loading ? '처리 중...' : '비밀번호 재설정 완료'}
      </button>
    </div>
  )

  if (view === 'deleteConfirm') return (
    <div className="login-wrap">
      <button className="btn-back" onClick={() => setView('main')}>← 설정으로</button>
      <h2 className="login-title">계정 삭제</h2>
      <p className="step-desc">계정 삭제를 위해 비밀번호를 입력해주세요.</p>
      <div className="input-group">
        <label>비밀번호</label>
        <input type="password" placeholder="비밀번호 입력" value={deletePw}
          onChange={e => { setDeletePw(e.target.value); setDeletePwError('') }}
          className={`pw-input ${deletePwError ? 'error' : ''}`} />
        {deletePwError && <p className="error-msg">{deletePwError}</p>}
      </div>
      <button className="btn-login" style={{ background: '#e74c3c' }} onClick={tryDelete}>확인</button>
    </div>
  )

  if (view === 'deleteConfirm2') return (
    <div className="login-wrap" style={{ justifyContent: 'center', gap: 24 }}>
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: '2rem' }}>⚠️</p>
        <h2 className="login-title" style={{ marginTop: 12 }}>정말 계정을 삭제하시겠습니까?</h2>
        <p className="step-desc" style={{ marginTop: 8 }}>삭제된 계정은 복구할 수 없어요.</p>
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <button className="btn-signup" style={{ flex: 1 }} onClick={() => setView('main')}>아니오</button>
        <button className="btn-login" style={{ flex: 1, background: '#e74c3c' }} onClick={confirmDelete} disabled={loading}>
          {loading ? '삭제 중...' : '예'}
        </button>
      </div>
    </div>
  )

  return (
    <div className="login-wrap" style={{ justifyContent: 'center', alignItems: 'center', gap: 16, textAlign: 'center' }}>
      <p style={{ fontSize: '3rem' }}>✅</p>
      <h2 className="login-title">계정이 삭제되었습니다.</h2>
      <p className="step-desc">이용해 주셔서 감사해요.</p>
      <button className="btn-login" onClick={onAccountDeleted}>로그인 화면으로</button>
    </div>
  )
}
