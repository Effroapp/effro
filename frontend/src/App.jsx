import { BrowserRouter, Routes, Route, useLocation, Outlet } from 'react-router-dom'
import { useEffect, useState, useCallback } from 'react'
import { useTheme } from './hooks/useTheme'
import { useFont } from './hooks/useFont'
import { BionicContext } from './hooks/useBionic'
import { useDisplayName } from './hooks/useDisplayName'
import { useTextSize } from './hooks/useTextSize'
import { useAvatar } from './hooks/useAvatar'
import { useUpdater } from './hooks/useUpdater'
import SettingsMenu from './components/SettingsMenu'
import UpdateToast from './components/UpdateToast'
import { ToastProvider } from './components/Toast'
import QuickCapture from './components/QuickCapture'
import QuickSwitcher from './components/QuickSwitcher'
import NewAreaModal from './components/NewAreaModal'
import SplashScreen from './components/SplashScreen'
import OnboardingWizard, { useOnboarding } from './components/OnboardingWizard'
import Sidebar from './components/Sidebar'
import RequireAuth from './components/RequireAuth'
import { useHeartbeat } from './hooks/useHeartbeat'
import Dashboard from './pages/Dashboard'
import Insights from './pages/Insights'
import Signals from './pages/Signals'
import AreaView from './pages/AreaView'
import ThreadView from './pages/ThreadView'
import LogView from './pages/LogView'
import ProcessView from './pages/ProcessView'
import SystemSettings from './pages/SystemSettings'
import LoginPage from './pages/LoginPage'
import SetupPage from './pages/SetupPage'
import SetPasswordPage from './pages/SetPasswordPage'
import { areasApi } from './api/client'

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function App() {
  const { dark, toggle } = useTheme()
  const { font, setFont } = useFont()
  const { displayName, setDisplayName } = useDisplayName()
  const { textSize, setTextSize } = useTextSize()
  const { avatar, setAvatar } = useAvatar()
  const updater = useUpdater()    // no-op outside Tauri
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [newAreaOpen, setNewAreaOpen] = useState(false)
  const [booting, setBooting] = useState(true)

  // Global ⌘K / Ctrl+K toggles the QuickSwitcher from anywhere
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'k' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        setSwitcherOpen((v) => !v)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  // Boot splash: hold for the full splash animation length (3s) plus a beat
  // of stillness so the slogan can be read, then fade out. The fade itself
  // takes ~400ms (opacity transition on the splash overlay). Total: ~5s on
  // a normal boot. Capped at 7s so a hung backend never traps the user on
  // the splash forever.
  useEffect(() => {
    const MIN_SPLASH_MS = 5000      // = 3s animation + ~2s stillness
    const MAX_SPLASH_MS = 7000
    const startedAt = Date.now()
    let cancelled = false
    const finish = () => { if (!cancelled) setBooting(false) }
    const finishAfterMin = () => {
      const remaining = Math.max(0, MIN_SPLASH_MS - (Date.now() - startedAt))
      setTimeout(finish, remaining)
    }
    const hardTimeout = setTimeout(finish, MAX_SPLASH_MS)
    areasApi.list()
      .catch(() => {})
      .finally(finishAfterMin)
    return () => { cancelled = true; clearTimeout(hardTimeout) }
  }, [])

  return (
    <ToastProvider>
      <SplashScreen visible={booting} />
      <BrowserRouter>
        <BionicContext.Provider value={font === 'bionic'}>
          <Routes>
            {/* Public auth routes - no chrome, no gated API calls */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/setup" element={<SetupPage />} />
            <Route path="/set-password" element={<SetPasswordPage />} />

            {/* Everything else is gated. When auth is off (desktop) the guard
                always passes; when on (hosted) it redirects to /login. */}
            <Route element={<RequireAuth />}>
              <Route
                element={
                  <AuthedChrome
                    avatar={avatar}
                    setAvatar={setAvatar}
                    displayName={displayName}
                    setDisplayName={setDisplayName}
                    dark={dark}
                    toggle={toggle}
                    font={font}
                    setFont={setFont}
                    textSize={textSize}
                    setTextSize={setTextSize}
                    updater={updater}
                    switcherOpen={switcherOpen}
                    setSwitcherOpen={setSwitcherOpen}
                    newAreaOpen={newAreaOpen}
                    setNewAreaOpen={setNewAreaOpen}
                  />
                }
              >
                <Route path="/" element={<Dashboard />} />
                <Route path="/insights" element={<Insights />} />
                <Route path="/signals" element={<Signals />} />
                <Route path="/area/:areaId" element={<AreaView />} />
                <Route path="/thread/:threadId" element={<ThreadView />} />
                <Route path="/log" element={<LogView />} />
                <Route path="/process" element={<ProcessView />} />
                <Route path="/settings" element={<SystemSettings updater={updater} />} />
              </Route>
            </Route>
          </Routes>
        </BionicContext.Provider>
      </BrowserRouter>
    </ToastProvider>
  )
}

// AuthedChrome wraps the persistent app chrome (sidebar, personal settings,
// quick capture/switcher, update toast) around the routed page, which renders
// into Shell's <Outlet/>. Rendered only once the guard has admitted the user,
// so the heartbeat and area loads never fire pre-login.
function AuthedChrome({
  avatar, setAvatar, displayName, setDisplayName,
  dark, toggle, font, setFont, textSize, setTextSize,
  updater, switcherOpen, setSwitcherOpen, newAreaOpen, setNewAreaOpen,
}) {
  // Badge lights up for both 'available' (just detected) and 'dismissed'
  // (user clicked Later but the update is still pending).
  const systemSettingsBadge =
    updater?.status === 'available' || updater?.status === 'dismissed'

  return (
    <>
      <Shell
        onOpenSwitcher={() => setSwitcherOpen(true)}
        onOpenNewArea={() => setNewAreaOpen(true)}
        updater={updater}
        systemSettingsBadge={systemSettingsBadge}
      />
      {/* Personal settings - top-right avatar, on every page */}
      <SettingsMenu
        avatar={avatar}
        onChangeAvatar={setAvatar}
        displayName={displayName}
        onChangeDisplayName={setDisplayName}
        dark={dark}
        onToggleTheme={toggle}
        font={font}
        onChangeFont={setFont}
        textSize={textSize}
        onChangeTextSize={setTextSize}
      />
      {/* Update prompt - appears once per detected new version, then
          collapses into the cog badge until installed. */}
      <UpdateToast updater={updater} />
      <QuickCapture />
      <QuickSwitcher isOpen={switcherOpen} onClose={() => setSwitcherOpen(false)} />
      <NewAreaModal isOpen={newAreaOpen} onClose={() => setNewAreaOpen(false)} />
    </>
  )
}

// Shell wraps every route so navigation is always visible. The active page
// renders into the <Outlet/>.
function Shell({ onOpenSwitcher, onOpenNewArea, systemSettingsBadge }) {
  const [areas, setAreas] = useState([])
  const location = useLocation()
  const { shouldShow } = useOnboarding()
  const [showOnboarding, setShowOnboarding] = useState(false)

  // Record presence while the app is open, powering the Insights working window.
  useHeartbeat()

  const loadAreas = useCallback(() => {
    areasApi.list().then(setAreas).catch(() => {})
  }, [])

  useEffect(() => { loadAreas() }, [location.pathname, loadAreas])

  // Fire wizard after the splash screen has cleared (250ms buffer)
  useEffect(() => {
    const t = setTimeout(() => {
      if (shouldShow()) setShowOnboarding(true)
    }, 250)
    return () => clearTimeout(t)
  }, [shouldShow])

  return (
    <div className="flex min-h-screen bg-white dark:bg-pitch-800">
      <Sidebar
        areas={areas}
        onOpenSwitcher={onOpenSwitcher}
        onOpenNewArea={onOpenNewArea}
        systemSettingsBadge={systemSettingsBadge}
      />
      <main data-onboarding="main-content" className="flex-1 min-w-0">
        <Outlet />
      </main>

      {/* Onboarding wizard — fires once on first run, replayable from Help */}
      {showOnboarding && (
        <OnboardingWizard onComplete={() => setShowOnboarding(false)} />
      )}
    </div>
  )
}
