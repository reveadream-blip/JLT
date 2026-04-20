import { useEffect, useState, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useI18n } from '../lib/i18n'
import { supabase } from '../lib/supabase'

type AuthState = 'loading' | 'authenticated' | 'anonymous'

/** En production, un user Supabase anonyme (is_anonymous) est traité comme non connecté. */
function classify(session: { user?: { is_anonymous?: boolean | null } | null } | null): AuthState {
  if (!session || !session.user) return 'anonymous'
  if (session.user.is_anonymous) return 'anonymous'
  return 'authenticated'
}

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
      setAuthState(classify(session))
    }

    void checkSession()

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthState(classify(session))
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
