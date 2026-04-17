import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Activity, FileSignature, TrendingUp, Users } from 'lucide-react'
import './HeroDashboardPreview.css'

const DONUT_R = 52
const DONUT_C = 2 * Math.PI * DONUT_R

const LINE_D =
  'M 6 108 C 42 100, 72 68, 108 76 S 176 38, 220 50 S 278 26, 314 36'

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3)
}

function donutSegProgress(t: number, index: number) {
  const stagger = 0.13
  const span = 0.64
  return Math.min(1, Math.max(0, (t - index * stagger) / span))
}

export type HeroDashboardPreviewProps = {
  metricLabels: [string, string, string]
  counters: { contracts: number; clients: number; revenus: number }
}

export function HeroDashboardPreview({ metricLabels, counters }: HeroDashboardPreviewProps) {
  const pathRef = useRef<SVGPathElement | null>(null)
  const clipId = `hdp-clip-${useId().replace(/:/g, '')}`
  const gradId = `hdp-grad-${useId().replace(/:/g, '')}`

  const [progress, setProgress] = useState(0)
  const [head, setHead] = useState({ x: 6, y: 108 })

  const seg = [0.45, 0.27, 0.28] as const
  const lens = useMemo(() => seg.map((p) => p * DONUT_C), [])
  const offs = useMemo(() => [0, -lens[0], -(lens[0] + lens[1])], [lens])
  const targets = [45, 27, 28] as const

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      setProgress(1)
      return
    }
    const dur = 2600
    const t0 = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min((now - t0) / dur, 1)
      setProgress(easeOutCubic(t))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  useLayoutEffect(() => {
    const path = pathRef.current
    if (!path) return
    const len = path.getTotalLength()
    if (len <= 0) return
    const p = path.getPointAtLength(len * progress)
    setHead({ x: p.x, y: p.y })
  }, [progress])

  const kpi = [
    {
      label: metricLabels[0],
      value: counters.contracts,
      suffix: '',
      icon: FileSignature,
      accent: 'amber' as const,
    },
    {
      label: metricLabels[1],
      value: counters.clients,
      suffix: '',
      icon: Users,
      accent: 'sky' as const,
    },
    {
      label: metricLabels[2],
      value: counters.revenus,
      suffix: 'k',
      icon: TrendingUp,
      accent: 'emerald' as const,
    },
  ]

  return (
    <div className="hdp" aria-hidden>
      <div className="hdp__mesh" />
      <div className="hdp__noise" />
      <div className="hdp__chrome">
        <div className="hdp__dots" aria-hidden>
          <span className="hdp__dot hdp__dot--r" />
          <span className="hdp__dot hdp__dot--y" />
          <span className="hdp__dot hdp__dot--g" />
        </div>
        <div className="hdp__chrome-title">
          <Activity size={14} strokeWidth={2.5} className="hdp__chrome-icon" />
          <span>Dashboard</span>
        </div>
        <span className="hdp__live">
          <span className="hdp__live-ping" />
          Live
        </span>
      </div>

      <div className="hdp__body">
        <div className="hdp__kpi">
          {kpi.map((item) => (
            <div key={item.label} className={`hdp__kpi-card hdp__kpi-card--${item.accent}`}>
              <div className="hdp__kpi-top">
                <item.icon size={15} strokeWidth={2.2} className="hdp__kpi-ico" />
                <span className="hdp__kpi-label">{item.label}</span>
              </div>
              <p className="hdp__kpi-value">
                {item.value}
                {item.suffix && <span className="hdp__kpi-suffix">{item.suffix}</span>}
              </p>
              <div className="hdp__kpi-spark" />
            </div>
          ))}
        </div>

        <div className="hdp__panels">
          <div className="hdp__panel hdp__panel--chart">
            <div className="hdp__panel-head">
              <span className="hdp__panel-title">Performance</span>
              <span className="hdp__panel-meta">30j</span>
              <span className="hdp__panel-trend">+12%</span>
            </div>
            <div className="hdp__chart-wrap">
              <svg className="hdp__chart-svg" viewBox="0 0 320 140" preserveAspectRatio="none">
                <defs>
                  <linearGradient id={`${gradId}-a`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.45" />
                    <stop offset="55%" stopColor="#6366f1" stopOpacity="0.15" />
                    <stop offset="100%" stopColor="#0f172a" stopOpacity="0" />
                  </linearGradient>
                  <linearGradient id={`${gradId}-l`} x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#fbbf24" />
                    <stop offset="40%" stopColor="#22d3ee" />
                    <stop offset="100%" stopColor="#a78bfa" />
                  </linearGradient>
                  <filter id={`${gradId}-glow`} x="-30%" y="-30%" width="160%" height="160%">
                    <feGaussianBlur stdDeviation="2" result="b" />
                    <feMerge>
                      <feMergeNode in="b" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                  <clipPath id={clipId}>
                    <rect x="0" y="0" width={320 * progress} height="140" />
                  </clipPath>
                </defs>

                <rect className="hdp__chart-bg" x="0" y="0" width="320" height="140" />

                <g className="hdp__chart-grid">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <line key={i} x1="8" y1={24 + i * 26} x2="312" y2={24 + i * 26} />
                  ))}
                </g>

                <g className="hdp__chart-bars">
                  {[0.28, 0.52, 0.36, 0.68, 0.44, 0.58, 0.5].map((h, i) => {
                    const bh = h * 72 * progress
                    return (
                      <rect
                        key={i}
                        x={14 + i * 42}
                        y={132 - bh}
                        width="12"
                        height={Math.max(0.5, bh)}
                        rx="3"
                      />
                    )
                  })}
                </g>

                <g style={{ clipPath: `url(#${clipId})` }}>
                  <path d={`${LINE_D} L 314 132 L 6 132 Z`} fill={`url(#${gradId}-a)`} />
                </g>

                <path
                  ref={pathRef}
                  pathLength="1"
                  d={LINE_D}
                  fill="none"
                  stroke={`url(#${gradId}-l)`}
                  strokeWidth="2.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  filter={`url(#${gradId}-glow)`}
                  style={{ strokeDasharray: 1, strokeDashoffset: 1 - progress }}
                />

                <g transform={`translate(${head.x} ${head.y})`}>
                  <circle className="hdp__head-ring" cx="0" cy="0" r="8" />
                  <circle className="hdp__head-core" cx="0" cy="0" r="5" />
                </g>
              </svg>
            </div>
          </div>

          <div className="hdp__panel hdp__panel--donut">
            <div className="hdp__panel-head">
              <span className="hdp__panel-title">Mix</span>
              <span className="hdp__panel-meta">fleet</span>
            </div>
            <div className="hdp__donut-wrap">
              <svg className="hdp__donut-svg" viewBox="0 0 200 200">
                <defs>
                  <filter id={`${gradId}-ds`} x="-35%" y="-35%" width="170%" height="170%">
                    <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#22d3ee" floodOpacity="0.15" />
                  </filter>
                </defs>
                <circle className="hdp__donut-glow" cx="100" cy="100" r="58" />
                <g filter={`url(#${gradId}-ds)`} transform="translate(100,100) rotate(-90)" className="hdp__donut-rings">
                  {[
                    { len: lens[0], off: offs[0], c: '#fbbf24' },
                    { len: lens[1], off: offs[1], c: '#6366f1' },
                    { len: lens[2], off: offs[2], c: '#38bdf8' },
                  ].map((ring, i) => {
                    const t = donutSegProgress(progress, i)
                    const v = ring.len * t
                    return (
                      <circle
                        key={i}
                        r={DONUT_R}
                        fill="none"
                        stroke={ring.c}
                        strokeWidth="26"
                        strokeLinecap="butt"
                        strokeDasharray={`${v} ${DONUT_C - v}`}
                        strokeDashoffset={ring.off}
                      />
                    )
                  })}
                </g>
                <text x="100" y="96" textAnchor="middle" className="hdp__donut-center-k">
                  100%
                </text>
                <text x="100" y="114" textAnchor="middle" className="hdp__donut-center-s">
                  active
                </text>
                <g className="hdp__donut-nums" fontSize="11" fontWeight="800">
                  <text x="46" y="92" textAnchor="middle" className="hdp__dn hdp__dn--a">
                    {Math.round(targets[0] * donutSegProgress(progress, 0))}
                  </text>
                  <text x="128" y="148" textAnchor="middle" className="hdp__dn hdp__dn--b">
                    {Math.round(targets[1] * donutSegProgress(progress, 1))}
                  </text>
                  <text x="144" y="68" textAnchor="middle" className="hdp__dn hdp__dn--c">
                    {Math.round(targets[2] * donutSegProgress(progress, 2))}
                  </text>
                </g>
              </svg>
              <ul className="hdp__legend">
                <li>
                  <span className="hdp__lg hdp__lg--a" /> Scooters
                </li>
                <li>
                  <span className="hdp__lg hdp__lg--b" /> Auto
                </li>
                <li>
                  <span className="hdp__lg hdp__lg--c" /> Autres
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
