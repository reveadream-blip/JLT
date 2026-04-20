import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { I18nProvider } from './lib/i18n'
import { RequireAuth } from './components/RequireAuth'
import { DashboardShell } from './pages/DashboardShell'
import { LandingPage } from './pages/LandingPage'
import { LoginPage } from './pages/LoginPage'

/**
 * En démo publique (VITE_PUBLIC_DEMO_MODE=true), l'app se connecte en anonyme
 * automatiquement côté DashboardShell, donc RequireAuth est court-circuité.
 * En production, RequireAuth protège toutes les routes /app/*.
 */
const isPublicDemoMode = import.meta.env.VITE_PUBLIC_DEMO_MODE === 'true'

function ProtectedDashboard() {
  if (isPublicDemoMode) return <DashboardShell />
  return (
    <RequireAuth>
      <DashboardShell />
    </RequireAuth>
  )
}

function App() {
  return (
    <I18nProvider>
      <BrowserRouter>
        <div className="app-shell">
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/connexion" element={<LoginPage />} />
            <Route path="/inscription" element={<LoginPage />} />
            <Route path="/app" element={<Navigate to="/app/dashboard" replace />} />
            <Route path="/app/pricing" element={<Navigate to="/app/dashboard" replace />} />
            <Route path="/app/carte" element={<Navigate to="/app/dashboard" replace />} />
            <Route path="/app/:section" element={<ProtectedDashboard />} />
          </Routes>
        </div>
      </BrowserRouter>
    </I18nProvider>
  )
}

export default App
