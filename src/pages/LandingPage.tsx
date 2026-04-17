import { useEffect, useState } from 'react'
import {
  Activity,
  BarChart3,
  BellRing,
  Camera,
  CheckCircle2,
  FileSignature,
  MapPin,
  ShieldCheck,
  Smartphone,
  Star,
  Timer,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { localeOptions, useI18n, type Locale } from '../lib/i18n'
import { HeroDashboardPreview } from './HeroDashboardPreview'
import './LandingPage.css'

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3)
}

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
      const easeOut = easeOutCubic(progress)

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

  const pricingPlans = [
    {
      name: landing.pricingPlanMonthlyName,
      price: landing.pricingPlanMonthlyPrice,
      suffix: landing.pricingPlanMonthlySuffix,
      variant: 'blue' as const,
      popular: false,
    },
    {
      name: landing.pricingPlanOneMonthName,
      price: landing.pricingPlanOneMonthPrice,
      suffix: landing.pricingPlanOneMonthSuffix,
      variant: 'orange' as const,
      popular: true,
    },
    {
      name: landing.pricingPlanYearlyName,
      price: landing.pricingPlanYearlyPrice,
      suffix: landing.pricingPlanYearlySuffix,
      variant: 'purple' as const,
      popular: false,
    },
  ]

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

          <div className="hero-visual">
            <HeroDashboardPreview
              metricLabels={landing.metrics as [string, string, string]}
              counters={counters}
            />
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

        <section className="pricing-section" id="pricing">
          <p className="pricing-label">{nav.pricing}</p>
          <h3 className="pricing-section-title">{landing.pricingSectionTitle}</h3>
          <p className="pricing-section-subtitle">{landing.pricingSectionSubtitle}</p>

          <div className="pricing-grid">
            {pricingPlans.map((plan) => (
              <article
                key={plan.name}
                className={`pricing-card pricing-card--${plan.variant}${plan.popular ? ' pricing-card--featured' : ''}`}
              >
                {plan.popular && (
                  <div className="pricing-card-badge" aria-hidden="true">
                    <Star size={12} strokeWidth={2.5} />
                    {landing.pricingPopularBadge}
                  </div>
                )}
                <span className={`pricing-card-pill pricing-card-pill--${plan.variant}`}>{plan.name}</span>
                <p className="pricing-card-price">
                  <span className="pricing-card-amount">{plan.price}</span>
                  <span className="pricing-card-suffix">{plan.suffix}</span>
                </p>
                <p className="pricing-card-desc">{landing.pricingUnlimitedDescription}</p>
                <ul className="pricing-card-features">
                  {landing.pricingFeatureBullets.map((line: string) => (
                    <li key={line}>
                      <CheckCircle2 size={16} className="pricing-card-check" aria-hidden />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
                <Link to="/app/dashboard" className={`pricing-card-cta pricing-card-cta--${plan.variant}`}>
                  {landing.pricingCta}
                </Link>
              </article>
            ))}
          </div>

          <div className="pricing-how">
            <h4 className="pricing-how-title">{landing.pricingHowTitle}</h4>
            <ul className="pricing-how-list">
              {landing.pricingHowItems.map((item: string) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </section>
      </main>
    </div>
  )
}
