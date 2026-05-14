import { useState, useEffect } from 'react'
import SplashScreen from './components/SplashScreen'
import LoginScreen from './components/LoginScreen'
import ForgotPasswordScreen from './components/ForgotPasswordScreen'
import SignupScreen from './components/SignupScreen'
import MainScreen from './components/MainScreen'
import { UserProfile } from './components/RandomMatchScreen'
import { getStoredUser, clearToken, UserInfo } from './api/client'
import { disconnectSocket } from './api/socket'

type Screen = 'splash' | 'login' | 'forgot' | 'signup' | 'main'

function userInfoToProfile(u: UserInfo): UserProfile {
  return {
    id: u.id,
    nickname: u.nickname,
    studentId: u.student_id ?? '',
    gender: u.gender,
    dept: u.dept,
  }
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('splash')
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null)
  const [darkMode, setDarkMode] = useState(() => {
    try { return localStorage.getItem('sws_darkMode') === 'true' } catch { return false }
  })

  useEffect(() => {
    try { localStorage.setItem('sws_darkMode', darkMode ? 'true' : 'false') } catch {}
  }, [darkMode])

  useEffect(() => {
    const timer = setTimeout(() => {
      const stored = getStoredUser()
      if (stored) {
        setCurrentUser(userInfoToProfile(stored))
        setScreen('main')
      } else {
        setScreen('login')
      }
    }, 2000)
    return () => clearTimeout(timer)
  }, [])

  const handleLogin = (user: UserInfo) => {
    setCurrentUser(userInfoToProfile(user))
    setScreen('main')
  }

  const handleSignupComplete = (user: UserInfo) => {
    setCurrentUser(userInfoToProfile(user))
    setScreen('main')
  }

  const handleLogout = () => {
    clearToken()
    disconnectSocket()
    setCurrentUser(null)
    setScreen('login')
  }

  return (
    <div className={`phone-frame${darkMode ? ' dark' : ''}`}>
      {screen === 'splash' && <SplashScreen />}
      {screen === 'main' && currentUser && (
        <MainScreen
          onLogout={handleLogout}
          onAccountDeleted={handleLogout}
          onPasswordReset={handleLogout}
          currentUser={currentUser}
          setCurrentUser={setCurrentUser}
          darkMode={darkMode}
          onToggleDarkMode={() => setDarkMode(p => !p)}
        />
      )}
      {screen !== 'splash' && screen !== 'main' && (
        <div className="app-shell">
          {screen === 'login' && (
            <LoginScreen
              onForgot={() => setScreen('forgot')}
              onSignup={() => setScreen('signup')}
              onLogin={handleLogin}
            />
          )}
          {screen === 'forgot' && (
            <ForgotPasswordScreen onBack={() => setScreen('login')} />
          )}
          {screen === 'signup' && (
            <SignupScreen
              onBack={() => setScreen('login')}
              onComplete={handleSignupComplete}
            />
          )}
        </div>
      )}
    </div>
  )
}
