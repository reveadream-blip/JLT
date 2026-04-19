import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { format } from 'date-fns'
import { DayPicker, type Matcher } from 'react-day-picker'
import { de, enUS, fr, it, ru, th } from 'react-day-picker/locale'
import { Calendar } from 'lucide-react'
import type { Locale as AppLocale } from '../lib/i18n'

import 'react-day-picker/style.css'
import './LocalizedDatePicker.css'

const localeMap = {
  fr,
  en: enUS,
  th,
  ru,
  it,
  de,
} as const

function parseYmd(s: string): Date | undefined {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function toYmd(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

type Props = {
  value: string
  onChange: (ymd: string) => void
  min?: string
  max?: string
  placeholder: string
  locale: AppLocale
  id?: string
}

export function LocalizedDatePicker({ value, onChange, min, max, placeholder, locale, id }: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  const dpLocale = localeMap[locale]
  const selected = parseYmd(value)

  const updatePosition = () => {
    const el = wrapRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const pad = 8
    const approxWidth = 320
    let left = r.left
    if (left + approxWidth > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - approxWidth - pad)
    if (left < pad) left = pad
    setPos({ top: r.bottom + 6, left })
  }

  useLayoutEffect(() => {
    if (!open) return
    updatePosition()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onScrollResize = () => updatePosition()
    window.addEventListener('scroll', onScrollResize, true)
    window.addEventListener('resize', onScrollResize)
    return () => {
      window.removeEventListener('scroll', onScrollResize, true)
      window.removeEventListener('resize', onScrollResize)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (wrapRef.current?.contains(t)) return
      if (popRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const display =
    selected && !Number.isNaN(selected.getTime())
      ? format(selected, 'PPP', { locale: dpLocale })
      : placeholder

  const disabledMatchers: Matcher[] = []
  if (min) {
    const d = parseYmd(min)
    if (d) disabledMatchers.push({ before: d })
  }
  if (max) {
    const d = parseYmd(max)
    if (d) disabledMatchers.push({ after: d })
  }

  return (
    <div ref={wrapRef} className="localized-date-picker">
      <button
        id={id}
        type="button"
        className="localized-date-picker__trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          updatePosition()
          setOpen((o) => !o)
        }}
      >
        <Calendar size={16} strokeWidth={2} aria-hidden />
        <span>{display}</span>
      </button>
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popRef}
            className="localized-date-picker__popover"
            style={{ position: 'fixed', top: pos.top, left: pos.left }}
            role="dialog"
            aria-label={placeholder}
          >
            <DayPicker
              mode="single"
              selected={selected}
              onSelect={(d) => {
                if (d) {
                  onChange(toYmd(d))
                  setOpen(false)
                }
              }}
              locale={dpLocale}
              captionLayout="dropdown"
              startMonth={new Date(2020, 0)}
              endMonth={new Date(2038, 11)}
              defaultMonth={selected ?? parseYmd(min ?? '') ?? new Date()}
              disabled={disabledMatchers.length ? disabledMatchers : undefined}
            />
          </div>,
          document.body,
        )}
    </div>
  )
}
