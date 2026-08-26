import { BrowserRouter, Routes, Route, useLocation, Outlet } from 'react-router-dom'
import { useEffect, useState, useCallback } from 'react'
import { useTheme } from './hooks/useTheme'
import { useFont } from './hooks/useFont'
import { BionicContext } from './hooks/useBionic'
import { useDisplayName } from './hooks/useDisplayName'
import { useTextSize } from './hooks/useTextSize'
import { useAvatar } from './hooks/useAvatar'
import { syncPrefsUser } from './hooks/usePrefs'
import { useUpdater } from './hooks/useUpdater'
import { useAuth } from './contexts/AuthContext'
import SettingsMenu from './components/SettingsMenu'
import UpdateToast from './components/UpdateToast'
import UpdateOverlay from './components/UpdateOverlay'
import UpdatedNotice from './components/UpdatedNotice'
import { ToastProvider } from './components/Toast'
import QuickCapture from './components/QuickCapture'
import QuickSwitcher from './components/QuickSwitcher'
import NewAreaModal from './components/NewAreaModal'
import SplashScreen from './components/SplashScreen'
import OnboardingWizard, { useOnboarding } from './components/OnboardingWizard'
import Sidebar from './components/Sidebar'
import RequireAuth from './components/RequireAuth'
import LicenceBanner from './components/LicenceBanner'
import { useHeartbeat } from './hooks/useHeartbeat'
import Dashboard from './pages/Dashboard'
import Insights from './pages/Insights'
import Signals from './pages/Signals'
import AreaView from './pages/AreaView'
import ThreadView from './pages/ThreadView'
import LogView from './pages/LogView'
import ProcessView from './pages/ProcessView'
import FolioIndex from './pages/FolioIndex'
import FolioView from './pages/FolioView'
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
  const { user } = useAuth()

  // Point the prefs store at the signed-in user. On the desktop this is always
  // the synthetic local admin, so it settles on the first render pass. On a
  // hosted deployment it is null until sign-in and changes when somebody else
  // signs in, which drops the previous person's cached name and photo.
  useEffect(() => { syncPrefsUser(user?.id ?? null) }, [user?.id])
  // Enterprise licences disable auto-update (v1: updater is a no-op). Default to
  // enabled until /auth/me loads or when no licence info is present (Pro/desktop).
  const updater = useUpdater({
    enabled: user?.licence?.capabilities?.auto_update_enabled !== false,
  })    // no-op outside Tauri
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
                <Route path="/folios" element={<FolioIndex />} />
                <Route path="/folios/:folioId" element={<FolioView />} />
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
      {/* Licence notices (read-only / grace / over-seat) - hosted only. */}
      <LicenceBanner />
      {/* Update prompt - appears once per detected new version, then
          collapses into the cog badge until installed. */}
      <UpdateToast updater={updater} />
      {/* Full-screen progress while an accepted update downloads + installs,
          and a quiet welcome-back notice on the first launch afterwards. */}
      <UpdateOverlay updater={updater} />
      <UpdatedNotice />
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
  const { shouldShow, hydrated } = useOnboarding()
  const [showOnboarding, setShowOnboarding] = useState(false)

  // Record presence while the app is open, powering the Insights working window.
  useHeartbeat()

  const loadAreas = useCallback(() => {
    areasApi.list().then(setAreas).catch(() => {})
  }, [])

  useEffect(() => { loadAreas() }, [location.pathname, loadAreas])

  // Fire the wizard once prefs have settled, never on a timer alone. Waiting on
  // hydration is what stops a returning user seeing the welcome again before
  // their stored completion has loaded. The 250ms buffer stays as a minimum so
  // the wizard still lands after the splash rather than under it.
  useEffect(() => {
    if (!hydrated) return undefined
    const t = setTimeout(() => {
      if (shouldShow()) setShowOnboarding(true)
    }, 250)
    return () => clearTimeout(t)
  }, [hydrated, shouldShow])

  return (
    <div className="flex min-h-screen">
      <Sidebar
        areas={areas}
        onOpenSwitcher={onOpenSwitcher}
        onOpenNewArea={onOpenNewArea}
        systemSettingsBadge={systemSettingsBadge}
      />
      {/* The page ground lives here rather than on each page. Light mode used
          to be white behind every route, so a page had to remember to override
          it with bg-paper-100. A page that forgets should inherit paper. */}
      <main data-onboarding="main-content" className="flex-1 min-w-0 bg-paper-100 dark:bg-pitch-800">
        <Outlet />
      </main>

      {/* Onboarding wizard — fires once on first run, replayable from Help */}
      {showOnboarding && (
        <OnboardingWizard onComplete={() => setShowOnboarding(false)} />
      )}
    </div>
  )
}
