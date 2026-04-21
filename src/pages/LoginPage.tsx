import { useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { localeOptions, useI18n, type Locale } from '../lib/i18n'
import { supabase } from '../lib/supabase'
import './LoginPage.css'

const STRONG_PASSWORD_REGEX = /^(?=.*[A-Z])(?=.*\d).{8,}$/
const KNOWN_PLAN_CODES = new Set([
  'stripe_monthly_auto_990',
  'promptpay_monthly_990',
  'promptpay_yearly_9900',
])

function sanitizeNextPath(raw: string | null): string {
  if (!raw) return ''
  if (!raw.startsWith('/') || raw.startsWith('//')) return ''
  return raw
}

function sanitizePlanCode(raw: string | null): string {
  if (!raw) return ''
  return KNOWN_PLAN_CODES.has(raw) ? raw : ''
}

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const { locale, setLocale, t } = useI18n()
  const nav = t('nav')
  const authText = t('auth')
  const isSignupPage = location.pathname === '/inscription'
  const planCode = useMemo(() => sanitizePlanCode(searchParams.get('plan')), [searchParams])
  const nextPath = useMemo(() => sanitizeNextPath(searchParams.get('next')), [searchParams])
  const redirectAfterAuth = planCode
    ? `/app/abonnement?plan=${planCode}`
    : nextPath || '/app/dashboard'
  const buildAuthPath = (target: '/connexion' | '/inscription') => {
    const params = new URLSearchParams()
    if (planCode) params.set('plan', planCode)
    if (nextPath) params.set('next', nextPath)
    const query = params.toString()
    return query ? `${target}?${query}` : target
  }
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const mapAuthError = (rawMessage: string) => {
    const message = rawMessage.toLowerCase()
    if (message.includes('invalid login credentials')) return authText.errorInvalidCredentials
    if (message.includes('email not confirmed')) return authText.errorEmailNotConfirmed
    if (message.includes('rate limit') || message.includes('too many requests'))
      return authText.errorTooManyRequests
    return authText.errorGeneric
  }

  const mapSignupError = (rawMessage: string) => {
    const message = rawMessage.toLowerCase()
    if (message.includes('user already registered')) return authText.errorEmailInUse
    if (message.includes('password should be at least')) return authText.errorPasswordTooShort
    if (message.includes('signup is disabled')) return authText.errorSignupDisabled
    if (message.includes('email rate limit exceeded')) return authText.errorEmailRateLimit
    if (message.includes('rate limit') || message.includes('too many requests'))
      return authText.errorEmailRateLimit
    return authText.errorGeneric
  }

  const clearFeedback = () => {
    setMessage('')
    setError('')
  }

  const onSubmit = async () => {
    clearFeedback()
    if (!email.trim()) {
      setError(authText.emailRequired)
      return
    }
    setLoading(true)
    if (isSignupPage) {
      if (!fullName.trim()) {
        setLoading(false)
        setError(authText.errorFullNameRequired)
        return
      }
      if (!STRONG_PASSWORD_REGEX.test(password.trim())) {
        setLoading(false)
        setError(authText.errorPasswordTooShort)
        return
      }
      const loginPath = buildAuthPath('/connexion')

      // Si le visiteur est dans une session anonyme (mode démo), on la termine
      // proprement avant signUp. Raison : supabase.auth.updateUser() sur un
      // user anonyme envoie un email de type "Change Email Address" avec un
      // template distinct, souvent non configuré. Le flow signUp reste donc
      // la voie fiable (même template "Confirm signup" que la prod).
      // Trade-off assumé : les données créées pendant la démo ne sont pas
      // migrées vers le nouveau compte — le visiteur repart sur une app vierge.
      const {
        data: { session: currentSession },
      } = await supabase.auth.getSession()
      if (currentSession?.user?.is_anonymous) {
        await supabase.auth.signOut()
      }

      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
          emailRedirectTo: `${window.location.origin}${loginPath}`,
        },
      })
      if (signUpError) {
        const normalized = signUpError.message.toLowerCase()
        if (
          normalized.includes('email rate limit exceeded') ||
          normalized.includes('rate limit') ||
          normalized.includes('too many requests')
        ) {
          setMessage(authText.signupPending)
          setPassword('')
          setTimeout(() => navigate(loginPath), 600)
        } else {
          setError(mapSignupError(signUpError.message))
        }
      } else {
        await supabase.auth.signOut()
        setMessage(authText.signupSuccess)
        setPassword('')
        setTimeout(() => navigate(loginPath), 600)
      }
      setLoading(false)
      return
    }

    // Si un mot de passe est fourni, auth directe (pas de rate limit email).
    if (password.trim()) {
      const { error: pwError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      if (pwError) {
        setError(mapAuthError(pwError.message))
      } else {
        setMessage(authText.codeVerified)
        setLoading(false)
        navigate(redirectAfterAuth)
        return
      }
      setLoading(false)
      return
    }

    // Sinon fallback OTP par email (utile si mot de passe oublié).
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
      },
    })
    if (otpError) {
      setError(mapAuthError(otpError.message))
    } else {
      setCodeSent(true)
      setMessage(authText.signInCodeSent)
    }
    setLoading(false)
  }

  const onVerifyCode = async () => {
    clearFeedback()
    if (!email.trim()) {
      setError(authText.emailRequired)
      return
    }
    if (!otpCode.trim()) {
      setError(authText.otpCode)
      return
    }
    setLoading(true)
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token: otpCode.trim(),
      type: 'email',
    })
    if (verifyError) {
      setError(mapAuthError(verifyError.message))
      setLoading(false)
      return
    }
    setMessage(authText.codeVerified)
    setLoading(false)
    navigate(redirectAfterAuth)
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <h2 id="login-title">{isSignupPage ? authText.signupTab : authText.loginTab}</h2>

        {isSignupPage && (
          <input
            className="login-field"
            placeholder={authText.fullName}
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
          />
        )}
        <input
          className="login-field"
          placeholder={authText.email}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
        />
        <input
          className="login-field"
          placeholder={authText.password}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete={isSignupPage ? 'new-password' : 'current-password'}
        />
        <select
          className="login-field"
          aria-label={nav.language}
          value={locale}
          onChange={(event) => setLocale(event.target.value as Locale)}
        >
          {localeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <button type="button" className="login-submit" onClick={() => void onSubmit()} disabled={loading}>
          {isSignupPage
            ? authText.signUp
            : password.trim()
              ? authText.signIn
              : authText.sendCode}
        </button>

        {!isSignupPage && codeSent && (
          <>
            <input
              className="login-field login-field--mt"
              placeholder={authText.otpCode}
              value={otpCode}
              onChange={(event) => setOtpCode(event.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
            />
            <button
              type="button"
              className="login-secondary"
              onClick={() => void onVerifyCode()}
              disabled={loading}
            >
              {authText.verifyCode}
            </button>
          </>
        )}

        {message && (
          <p className="login-feedback login-feedback--ok" role="status">
            {message}
          </p>
        )}
        {error && (
          <p className="login-feedback login-feedback--err" role="alert">
            {error}
          </p>
        )}

        <div className="login-footer">
          {!isSignupPage ? (
            <Link to={buildAuthPath('/inscription')}>{authText.signupTab}</Link>
          ) : (
            <Link to={buildAuthPath('/connexion')}>{authText.loginTab}</Link>
          )}
          <Link to="/">{authText.backHome}</Link>
        </div>
      </section>
    </main>
  )
}
