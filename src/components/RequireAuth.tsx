import { useEffect, useState, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useI18n } from '../lib/i18n'
import { supabase } from '../lib/supabase'

type AuthState = 'loading' | 'authenticated' | 'anonymous'

export function RequireAuth({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const auth = t('auth')
  const [authState, setAuthState] = useState<AuthState>('loading')

  useEffect(() => {
    let mounted = true

    const checkSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!mounted) return
      setAuthState(session ? 'authenticated' : 'anonymous')
    }

    void checkSession()

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthState(session ? 'authenticated' : 'anonymous')
    })

    return () => {
      mounted = false
      data.subscription.unsubscribe()
    }
  }, [])

  if (authState === 'loading') {
    return (
      <main
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          fontSize: '0.95rem',
          color: '#6b7280',
        }}
      >
        {auth.loading}
      </main>
    )
  }

  if (authState === 'anonymous') {
    return <Navigate to="/connexion" replace />
  }

  return <>{children}</>
}
