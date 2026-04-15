import { useEffect, useState } from 'react'
import {
  Activity,
  BarChart3,
  BellRing,
  Camera,
  FileSignature,
  MapPin,
  ShieldCheck,
  Smartphone,
  Timer,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { localeOptions, useI18n, type Locale } from '../lib/i18n'
import './LandingPage.css'

export function LandingPage() {
  const { locale, setLocale, t } = useI18n()
  const nav = t('nav')
  const landing = t('landing')
  const [counters, setCounters] = useState({ contracts: 0, clients: 0, revenus: 0 })
  const [kpis, setKpis] = useState({ minutes: 0, paperless: 0, access: 0 })

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches

    if (prefersReducedMotion) {
      setCounters({ contracts: 45, clients: 87, revenus: 812 })
      setKpis({ minutes: 5, paperless: 100, access: 24 })
      return
    }

    const durationMs = 900
    const startedAt = performance.now()
    let rafId = 0

    const tick = (now: number) => {
      const progress = Math.min((now - startedAt) / durationMs, 1)
      const easeOut = 1 - Math.pow(1 - progress, 3)

      setCounters({
        contracts: Math.round(45 * easeOut),
        clients: Math.round(87 * easeOut),
        revenus: Math.round(812 * easeOut),
      })
      setKpis({
        minutes: Math.round(5 * easeOut),
        paperless: Math.round(100 * easeOut),
        access: Math.round(24 * easeOut),
      })

      if (progress < 1) {
        rafId = requestAnimationFrame(tick)
      }
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [])

  const featureItems = [
    {
      icon: FileSignature,
      title: landing.features[0][0],
      badge: landing.features[0][1],
      description: landing.features[0][2],
    },
    {
      icon: Camera,
      title: landing.features[1][0],
      badge: landing.features[1][1],
      description: landing.features[1][2],
    },
    {
      icon: MapPin,
      title: landing.features[2][0],
      badge: landing.features[2][1],
      description: landing.features[2][2],
    },
    {
      icon: BarChart3,
      title: landing.features[3][0],
      badge: landing.features[3][1],
      description: landing.features[3][2],
    },
    {
      icon: BellRing,
      title: landing.features[4][0],
      badge: landing.features[4][1],
      description: landing.features[4][2],
    },
    {
      icon: Smartphone,
      title: landing.features[5][0],
      badge: landing.features[5][1],
      description: landing.features[5][2],
    },
  ]

  return (
    <div className="home">
      <header className="nav">
        <div className="logo">
          <span className="logo-mark">JLT</span>
          <div>
            <p>JLT</p>
            <small>JLS LEASE & TECHNOLOGIES</small>
          </div>
        </div>
        <nav role="navigation" aria-label={nav.mainNav}>
          <a href="#features">{nav.features}</a>
          <a href="#pricing">{nav.pricing}</a>
          <Link to="/app/dashboard">{nav.trial}</Link>
        </nav>
        <select
          className="lang-select"
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
        <Link to="/connexion" className="btn btn-primary">
          {nav.login}
        </Link>
      </header>

      <main className="content">
        <section className="hero">
          <div className="hero-text">
            <p className="tag">{landing.tag}</p>
            <h1>
              {landing.titleBefore} <span>{landing.titleAccent}</span>{' '}
              {landing.titleAfter}
            </h1>
            <p>{landing.subtitle}</p>
            <div className="hero-actions">
              <Link to="/app/dashboard" className="btn btn-accent">
                {landing.start}
              </Link>
              <a href="#features" className="btn btn-ghost">
                {landing.seeFeatures}
              </a>
            </div>
            <ul className="proofs">
              <li>
                <ShieldCheck size={14} /> {landing.proofs[0]}
              </li>
              <li>
                <Timer size={14} /> {landing.proofs[1]}
              </li>
              <li>
                <Activity size={14} /> {landing.proofs[2]}
              </li>
            </ul>
          </div>

          <div className="hero-card" aria-hidden="true">
            <div className="window-bar" />
            <div className="mock-grid">
              <div className="mock metric">
                <p>{landing.metrics[0]}</p>
                <strong>{counters.contracts}</strong>
              </div>
              <div className="mock metric">
                <p>{landing.metrics[1]}</p>
                <strong>{counters.clients}</strong>
              </div>
              <div className="mock metric">
                <p>{landing.metrics[2]}</p>
                <strong>{counters.revenus}k</strong>
              </div>
              <div className="mock chart" />
              <div className="mock donut" />
            </div>
          </div>
        </section>

        <section className="features" id="features">
          <p className="chip">{nav.features}</p>
          <h2>{landing.featureTitle}</h2>
          <p className="features-intro">{landing.featureIntro}</p>

          <div className="feature-grid">
            {featureItems.map((item, index) => (
              <article
                key={item.title}
                className={`feature-card${index === 0 ? ' active' : ''}`}
              >
                <div className="feature-head">
                  <h3>
                    <item.icon size={16} />
                    {item.title}
                  </h3>
                  <span>{item.badge}</span>
                </div>
                <p>{item.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="stats">
          <div>
            <strong>
              <Timer size={18} /> {`< ${kpis.minutes} min`}
            </strong>
            <span>{landing.kpis[0]}</span>
          </div>
          <div>
            <strong>
              <FileSignature size={18} /> {kpis.paperless}%
            </strong>
            <span>{landing.kpis[1]}</span>
          </div>
          <div>
            <strong>
              <Activity size={18} /> {kpis.access}/7
            </strong>
            <span>{landing.kpis[2]}</span>
          </div>
          <div>
            <strong>
              <ShieldCheck size={18} /> 0
            </strong>
            <span>{landing.kpis[3]}</span>
          </div>
        </section>

        <section className="pricing-solution" id="pricing">
          <p className="pricing-label">{nav.pricing}</p>
          <h3>{landing.pricingTitle}</h3>
          <p className="pricing-amount">{landing.pricingAmount}</p>
          <p>{landing.pricingDescription}</p>
          <Link to="/app/dashboard" className="btn btn-accent">
            {landing.start}
          </Link>
        </section>
      </main>
    </div>
  )
}
