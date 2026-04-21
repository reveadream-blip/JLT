import { useEffect, useState, type MouseEvent } from 'react'
import { Download, X } from 'lucide-react'
import { useI18n } from '../lib/i18n'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

type Variant = 'sidebar' | 'bottom-nav'

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true
  if ((window.navigator as unknown as { standalone?: boolean }).standalone === true) return true
  return false
}

function detectIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !(window as unknown as { MSStream?: unknown }).MSStream
}

export function InstallPWAButton({ variant = 'sidebar' }: { variant?: Variant }) {
  const { t } = useI18n()
  const app = t('app')
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isStandalone, setIsStandalone] = useState<boolean>(detectStandalone())
  const [showHelp, setShowHelp] = useState(false)

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault()
      setDeferredPrompt(event as BeforeInstallPromptEvent)
    }
    const onInstalled = () => {
      setIsStandalone(true)
      setDeferredPrompt(null)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (isStandalone) return null

  const handleClick = async (event: MouseEvent) => {
    event.preventDefault()
    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt()
        const { outcome } = await deferredPrompt.userChoice
        if (outcome === 'accepted') {
          setDeferredPrompt(null)
        }
      } catch {
        setShowHelp(true)
      }
      return
    }
    setShowHelp(true)
  }

  const isIOS = detectIOS()
  const helpText = isIOS ? app.installAppHintIos : app.installAppHint

  if (variant === 'bottom-nav') {
    return (
      <>
        <button
          type="button"
          className="dashboard-bottom-nav-item"
          onClick={handleClick}
          style={{ background: 'transparent', border: 0, cursor: 'pointer', fontFamily: 'inherit' }}
          aria-label={app.installApp}
        >
          <Download size={20} />
          <span>{app.installApp}</span>
        </button>
        {showHelp && (
          <InstallHelpModal
            title={app.installAppTitle}
            text={helpText}
            closeLabel={app.cancel}
            onClose={() => setShowHelp(false)}
          />
        )}
      </>
    )
  }

  return (
    <>
      <button
        type="button"
        className="item"
        onClick={handleClick}
        style={{
          background: 'transparent',
          border: 0,
          cursor: 'pointer',
          textAlign: 'left',
          width: '100%',
          font: 'inherit',
        }}
      >
        <Download size={16} />
        {app.installApp}
      </button>
      {showHelp && (
        <InstallHelpModal
          title={app.installAppTitle}
          text={helpText}
          closeLabel={app.cancel}
          onClose={() => setShowHelp(false)}
        />
      )}
    </>
  )
}

function InstallHelpModal({
  title,
  text,
  closeLabel,
  onClose,
}: {
  title: string
  text: string
  closeLabel: string
  onClose: () => void
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(8, 23, 56, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        zIndex: 1000,
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: 16,
          padding: '24px 24px 20px',
          maxWidth: 420,
          width: '100%',
          boxShadow: '0 24px 60px rgba(8, 23, 56, 0.25)',
          position: 'relative',
          color: '#0f172a',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            border: 0,
            background: 'transparent',
            cursor: 'pointer',
            padding: 6,
            borderRadius: 8,
            color: '#64748b',
          }}
        >
          <X size={18} />
        </button>
        <h3 style={{ margin: '0 0 12px', fontSize: '1.1rem', color: '#081738' }}>{title}</h3>
        <p style={{ margin: 0, lineHeight: 1.55, color: '#475569', whiteSpace: 'pre-line' }}>
          {text}
        </p>
      </div>
    </div>
  )
}
