import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { localeOptions, useI18n, type Locale } from '../lib/i18n'
import { supabase } from '../lib/supabase'

const STRONG_PASSWORD_REGEX = /^(?=.*[A-Z])(?=.*\d).{8,}$/

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { locale, setLocale, t } = useI18n()
  const nav = t('nav')
  const authText = t('auth')
  const isSignupPage = location.pathname === '/inscription'
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
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
          emailRedirectTo: `${window.location.origin}/connexion`,
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
          setTimeout(() => navigate('/connexion'), 600)
        } else {
          setError(mapSignupError(signUpError.message))
        }
      } else {
        await supabase.auth.signOut()
        setMessage(authText.signupSuccess)
        setPassword('')
        setTimeout(() => navigate('/connexion'), 600)
      }
      setLoading(false)
      return
    }

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
    navigate('/app/dashboard')
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: '#f3f4f6',
        padding: '20px',
      }}
    >
      <section
        style={{
          width: '100%',
          maxWidth: '420px',
          background: '#fff',
          borderRadius: '14px',
          border: '1px solid #e5e7eb',
          padding: '24px',
        }}
      >
        <h2 style={{ margin: '0 0 12px', fontSize: '1.1rem' }}>
          {isSignupPage ? authText.signupTab : authText.loginTab}
        </h2>

        {isSignupPage && (
          <input
            placeholder={authText.fullName}
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            style={{
              width: '100%',
              marginBottom: '10px',
              padding: '10px',
              borderRadius: '10px',
              border: '1px solid #e5e7eb',
            }}
          />
        )}
        <input
          placeholder={authText.email}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          style={{
            width: '100%',
            marginBottom: '10px',
            padding: '10px',
            borderRadius: '10px',
            border: '1px solid #e5e7eb',
          }}
        />
        <input
          placeholder={authText.password}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          style={{
            width: '100%',
            marginBottom: '12px',
            padding: '10px',
            borderRadius: '10px',
            border: '1px solid #e5e7eb',
          }}
        />
        <select
          aria-label={nav.language}
          value={locale}
          onChange={(event) => setLocale(event.target.value as Locale)}
          style={{ width: '100%', marginBottom: '12px', padding: '10px', borderRadius: '10px', border: '1px solid #e5e7eb' }}
        >
          {localeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => void onSubmit()}
          disabled={loading}
          style={{
            width: '100%',
            border: '0',
            borderRadius: '10px',
            padding: '12px',
            background: '#f59e0b',
            color: '#111827',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          {isSignupPage ? authText.signUp : authText.sendCode}
        </button>

        {!isSignupPage && codeSent && (
          <>
            <input
              placeholder={authText.otpCode}
              value={otpCode}
              onChange={(event) => setOtpCode(event.target.value)}
              style={{
                width: '100%',
                marginTop: '10px',
                marginBottom: '10px',
                padding: '10px',
                borderRadius: '10px',
                border: '1px solid #e5e7eb',
              }}
            />
            <button
              type="button"
              onClick={() => void onVerifyCode()}
              disabled={loading}
              style={{
                width: '100%',
                border: '1px solid #e5e7eb',
                borderRadius: '10px',
                padding: '12px',
                background: '#fff',
                color: '#111827',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {authText.verifyCode}
            </button>
          </>
        )}

        {message && (
          <p style={{ marginTop: '10px', color: '#166534', fontSize: '0.9rem' }}>{message}</p>
        )}
        {error && (
          <p style={{ marginTop: '10px', color: '#b91c1c', fontSize: '0.9rem' }}>{error}</p>
        )}

        <div
          style={{
            marginTop: '14px',
            paddingTop: '12px',
            borderTop: '1px solid #e5e7eb',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          {!isSignupPage ? (
            <Link
              to="/inscription"
              style={{
                color: '#2563eb',
                textDecoration: 'none',
              }}
            >
              {authText.signupTab}
            </Link>
          ) : (
            <span />
          )}
          <Link
            to="/"
            style={{
              color: '#2563eb',
              textDecoration: 'none',
            }}
          >
            {authText.backHome}
          </Link>
        </div>
      </section>
    </main>
  )
}
