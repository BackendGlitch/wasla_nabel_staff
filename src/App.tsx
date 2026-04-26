import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './index.css'
import InitScreen from '@/components/InitScreen'
import LoginScreen from '@/components/LoginScreen'
import { setAuthToken, type InitData } from '@/api/client'
import MainPage from '@/components/MainPage'
import { KioskShell } from '@/kiosk/KioskShell'
import { StationProvider } from '@/contexts/StationContext'
import { InitProvider } from '@/contexts/InitContext'
import { ensureMachineInfo } from '@/services/machineMode'

// Production cutover mode:
// - Kiosk shell is the default app surface.
// - Legacy MainPage remains reachable via `?ui=legacy` as a guarded fallback.
function isLegacyFallbackEnabled(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return new URLSearchParams(window.location.search).get('ui') === 'legacy'
  } catch {
    return false
  }
}

function App() {
  const [stage, setStage] = useState<'init' | 'login' | 'app'>('init')
  const [token, setToken] = useState<string | null>(null)
  const [initData, setInitData] = useState<InitData | null>(null)
  const hasSavedToken = useRef(false)

  const handleInitReady = useCallback((data: InitData) => {
    setInitData(data)
    if (hasSavedToken.current) {
      setStage('app')
    } else {
      setStage('login')
    }
  }, [])

  const handleLoggedIn = useCallback((t: string, _staffInfo: { firstName: string; lastName: string }) => {
    void _staffInfo
    setToken(t)
    setAuthToken(t)
    setStage('app')
  }, [])

  useEffect(() => {
    try {
      const saved = localStorage.getItem('authToken')
      if (saved) {
        hasSavedToken.current = true
        setToken(saved)
        setAuthToken(saved)
        // Still show init screen to load branding — handleInitReady will skip login
      }
    } catch {}
    // Warm the machine-info cache so the first HTTP request already carries
    // X-Wasla-Machine-Type / X-Wasla-Machine-Id (no behaviour change in
    // browser / normal mode — the helper is no-op there).
    void ensureMachineInfo()
  }, [])

  const screen = useMemo(() => {
    if (!initData) return <InitScreen onReady={handleInitReady} />
    if (stage === 'login') {
      return (
        <InitProvider data={initData}>
          <LoginScreen onLoggedIn={handleLoggedIn} />
        </InitProvider>
      )
    }
    const KioskOrLegacy = isLegacyFallbackEnabled() ? MainPage : KioskShell
    return (
      <InitProvider data={initData}>
        <StationProvider>
          <KioskOrLegacy />
        </StationProvider>
      </InitProvider>
    )
  }, [stage, initData, handleInitReady, handleLoggedIn, token])

  return screen
}

export default App
