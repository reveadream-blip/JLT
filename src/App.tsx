import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { I18nProvider } from './lib/i18n'
import { DashboardShell } from './pages/DashboardShell'
import { LandingPage } from './pages/LandingPage'
import { LoginPage } from './pages/LoginPage'

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
            <Route path="/app/:section" element={<DashboardShell />} />
          </Routes>
        </div>
      </BrowserRouter>
    </I18nProvider>
  )
}

export default App
