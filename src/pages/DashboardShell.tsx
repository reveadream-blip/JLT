import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent,
  type TouchEvent,
  type WheelEvent,
} from 'react'
import {
  Bell,
  Calendar,
  Car,
  ClipboardList,
  CreditCard,
  LayoutDashboard,
  Plus,
  Search,
  Users,
  X,
} from 'lucide-react'
import { jsPDF } from 'jspdf'
import { localeOptions, useI18n } from '../lib/i18n'
import { Link, NavLink, useParams, useSearchParams } from 'react-router-dom'
import {
  supabase,
  vehiclePhotosBucket,
  parseVehiclePhotoObjectKey,
  vehicleIdFromVehiclePhotoPath,
  vehiclePhotosUsePublicUrl,
  buildVehiclePhotoStoragePath,
  clientPassportPhotosBucket,
  buildClientPassportPhotoPath,
} from '../lib/supabase'
import './DashboardShell.css'
import { LocalizedDatePicker } from '../components/LocalizedDatePicker'

/** Démo publique : connexion anonyme + accès sans abonnement (voir VITE_PUBLIC_DEMO_MODE). */
const isPublicDemoMode = import.meta.env.VITE_PUBLIC_DEMO_MODE === 'true'

function normalizeVehicleLabel(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Recherche insensible aux accents (e / é / è…). */
function foldSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

/** Plusieurs mots : chaque fragment doit apparaître (ordre libre), ex. « pcx hon » → Honda PCX */
function matchesSearchQuery(haystack: string, query: string): boolean {
  const raw = query.trim()
  if (!raw) return true
  const folded = foldSearchText(haystack)
  const tokens = foldSearchText(raw)
    .split(/\s+/)
    .filter(Boolean)
  return tokens.every((t) => folded.includes(t))
}

/** Nombre de jours facturés (aligné sur la facture PDF : au moins 1 jour si fin > début). */
function contractBillableDaysCount(startIso: string, endIso: string): number | null {
  if (!startIso || !endIso) return null
  const start = new Date(startIso)
  const end = new Date(endIso)
  if (Number.isNaN(+start) || Number.isNaN(+end) || end <= start) return null
  const dayMs = 1000 * 60 * 60 * 24
  return Math.max(1, Math.ceil((+end - +start) / dayMs))
}

function isoDateLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseLocalDate(isoYmd: string): Date {
  const [y, m, day] = isoYmd.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, day, 12, 0, 0, 0)
}

function addDaysLocal(isoYmd: string, days: number): string {
  const d = parseLocalDate(isoYmd)
  d.setDate(d.getDate() + days)
  return isoDateLocal(d)
}

/** Chevauchement (jours facturables) entre contrat [cStart,cEnd] et période [rStart, rEndExcl). */
function overlapBillableDaysInRange(
  cStartIso: string,
  cEndIso: string,
  rangeStartInclusive: string,
  rangeEndExclusive: string,
): number {
  const cs = +parseLocalDate(cStartIso.slice(0, 10))
  const ce = +parseLocalDate(cEndIso.slice(0, 10))
  const rs = +parseLocalDate(rangeStartInclusive.slice(0, 10))
  const re = +parseLocalDate(rangeEndExclusive.slice(0, 10))
  const start = Math.max(cs, rs)
  const end = Math.min(ce, re)
  if (end <= start) return 0
  return contractBillableDaysCount(isoDateLocal(new Date(start)), isoDateLocal(new Date(end))) ?? 0
}

/** Période d’analyse : 0 = 7 jours, 1 = 30 jours, 2–4 = 3 / 6 / 12 mois (calendaires). */
function dateRangeForAnalysisPeriodChip(index: number): { start: string; end: string } {
  const now = new Date()
  now.setHours(12, 0, 0, 0)
  if (index === 0) {
    const end = new Date(now)
    const start = new Date(now)
    start.setDate(start.getDate() - 6)
    return { start: isoDateLocal(start), end: isoDateLocal(end) }
  }
  if (index === 1) {
    const end = new Date(now)
    const start = new Date(now)
    start.setDate(start.getDate() - 29)
    return { start: isoDateLocal(start), end: isoDateLocal(end) }
  }
  const monthSpan = index === 2 ? 3 : index === 3 ? 6 : 12
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  const start = new Date(now.getFullYear(), now.getMonth() - (monthSpan - 1), 1)
  return { start: isoDateLocal(start), end: isoDateLocal(end) }
}

const menuMeta = [
  { key: 'dashboard', icon: LayoutDashboard },
  { key: 'vehicules', icon: Car },
  { key: 'clients', icon: Users },
  { key: 'contrats', icon: ClipboardList },
  { key: 'planning', icon: Calendar },
  { key: 'abonnement', icon: CreditCard },
]

type VehicleTypeFilter = 'all' | 'scooter' | 'car' | 'bike'
type StatusFilter = 'all' | 'available' | 'reserved' | 'maintenance' | 'active' | 'done' | 'draft'
type VehicleRow = {
  id: string
  type: 'scooter' | 'car' | 'bike'
  brand: string
  model: string
  status: 'available' | 'reserved' | 'maintenance'
  daily_price: number
  year?: number | null
  license_plate?: string | null
  airtag_code?: string | null
}
type ClientRow = {
  id: string
  full_name: string
  phone: string | null
  email: string | null
  passport_number?: string | null
  nationality?: string | null
  passport_photo_path?: string | null
  notes?: string | null
  deposit_amount?: number | null
}
type ContractRow = {
  id: string
  client_id: string
  vehicle_id: string
  start_at: string
  end_at: string
  total_price: number
  status: 'draft' | 'active' | 'completed' | 'cancelled'
  created_at: string
}

/** Tarif journalier : prix du véhicule (référence), sinon dérivé du total (fallback seulement). */
function contractDailyRate(contract: ContractRow, vehicle: VehicleRow | undefined): number {
  const fromVehicle = Number(vehicle?.daily_price ?? 0)
  if (fromVehicle > 0) return fromVehicle
  const cStart = String(contract.start_at || '').slice(0, 10)
  const cEnd = String(contract.end_at || '').slice(0, 10)
  const totalDays = contractBillableDaysCount(cStart, cEnd)
  if (totalDays === null || totalDays < 1) return 0
  return Math.round((Number(contract.total_price ?? 0) / totalDays) * 100) / 100
}

/** Revenu = journalier × jours de chevauchement (pas total ÷ jours × …). */
function contractRevenueDailyTimesOverlap(
  contract: ContractRow,
  vehicle: VehicleRow | undefined,
  overlapDays: number,
): number {
  if (contract.status === 'cancelled' || overlapDays < 1) return 0
  const daily = contractDailyRate(contract, vehicle)
  if (daily <= 0) return 0
  return Math.round(daily * overlapDays)
}

function contractRevenueInAnalysisRange(
  contract: ContractRow,
  vehicle: VehicleRow | undefined,
  rangeStartInclusive: string,
  rangeEndInclusive: string,
): number {
  if (contract.status === 'cancelled') return 0
  const cStart = String(contract.start_at || '').slice(0, 10)
  const cEnd = String(contract.end_at || '').slice(0, 10)
  const rangeEndExcl = addDaysLocal(rangeEndInclusive, 1)
  const od = overlapBillableDaysInRange(cStart, cEnd, rangeStartInclusive, rangeEndExcl)
  return contractRevenueDailyTimesOverlap(contract, vehicle, od)
}

type DashboardRevenuePoint = {
  label: string
  date: string
  isoDate: string
  amount: number
  contracts: number
}

/** Revenus sur la période (journalier × jours) et points pour le graphique (jour si 7j/30j, sinon mois). */
function buildDashboardRevenueSeries(
  contractsData: ContractRow[],
  vehiclesData: VehicleRow[],
  rangeStartInclusive: string,
  rangeEndInclusive: string,
  periodIndex: number,
): { buckets: DashboardRevenuePoint[]; periodTotal: number; periodContractCount: number } {
  const rangeEndExcl = addDaysLocal(rangeEndInclusive, 1)
  const vehicleById = new Map(vehiclesData.map((v) => [v.id, v]))

  let periodTotal = 0
  let periodContractCount = 0
  for (const row of contractsData) {
    if (row.status === 'cancelled') continue
    const cStart = String(row.start_at || '').slice(0, 10)
    const cEnd = String(row.end_at || '').slice(0, 10)
    const od = overlapBillableDaysInRange(cStart, cEnd, rangeStartInclusive, rangeEndExcl)
    if (od < 1) continue
    periodContractCount += 1
    periodTotal += contractRevenueInAnalysisRange(row, vehicleById.get(row.vehicle_id), rangeStartInclusive, rangeEndInclusive)
  }

  const buckets: DashboardRevenuePoint[] = []
  const useDaily = periodIndex <= 1

  if (useDaily) {
    const cur = parseLocalDate(rangeStartInclusive)
    const end = parseLocalDate(rangeEndInclusive)
    while (cur <= end) {
      const dayIso = isoDateLocal(cur)
      const dayEndExcl = addDaysLocal(dayIso, 1)
      let amount = 0
      let contracts = 0
      for (const row of contractsData) {
        if (row.status === 'cancelled') continue
        const cStart = String(row.start_at || '').slice(0, 10)
        const cEnd = String(row.end_at || '').slice(0, 10)
        const totalDays = contractBillableDaysCount(cStart, cEnd)
        if (totalDays === null || totalDays < 1) continue
        const od = overlapBillableDaysInRange(cStart, cEnd, dayIso, dayEndExcl)
        if (od < 1) continue
        const vehicle = vehicleById.get(row.vehicle_id)
        amount += contractRevenueDailyTimesOverlap(row, vehicle, od)
        contracts += 1
      }
      const label = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' }).format(
        parseLocalDate(dayIso),
      )
      buckets.push({
        label,
        date: parseLocalDate(dayIso).toLocaleDateString('fr-FR'),
        isoDate: dayIso,
        amount,
        contracts,
      })
      cur.setDate(cur.getDate() + 1)
    }
  } else {
    const start = parseLocalDate(rangeStartInclusive)
    const end = parseLocalDate(rangeEndInclusive)
    const iter = new Date(start.getFullYear(), start.getMonth(), 1)
    const endMonth = new Date(end.getFullYear(), end.getMonth(), 1)
    while (iter <= endMonth) {
      const y = iter.getFullYear()
      const m = iter.getMonth()
      const monthStart = new Date(y, m, 1)
      const monthEnd = new Date(y, m + 1, 0)
      let ms = isoDateLocal(monthStart)
      let me = isoDateLocal(monthEnd)
      if (ms < rangeStartInclusive.slice(0, 10)) ms = rangeStartInclusive.slice(0, 10)
      if (me > rangeEndInclusive.slice(0, 10)) me = rangeEndInclusive.slice(0, 10)
      const monthEndExcl = addDaysLocal(me, 1)
      let amount = 0
      let contracts = 0
      for (const row of contractsData) {
        if (row.status === 'cancelled') continue
        const cStart = String(row.start_at || '').slice(0, 10)
        const cEnd = String(row.end_at || '').slice(0, 10)
        const totalDays = contractBillableDaysCount(cStart, cEnd)
        if (totalDays === null || totalDays < 1) continue
        const od = overlapBillableDaysInRange(cStart, cEnd, ms, monthEndExcl)
        if (od < 1) continue
        const vehicle = vehicleById.get(row.vehicle_id)
        amount += contractRevenueDailyTimesOverlap(row, vehicle, od)
        contracts += 1
      }
      const formatter = new Intl.DateTimeFormat('fr-FR', { month: 'short', year: '2-digit' })
      buckets.push({
        label: formatter.format(monthStart),
        date: parseLocalDate(me).toLocaleDateString('fr-FR'),
        isoDate: me,
        amount,
        contracts,
      })
      iter.setMonth(iter.getMonth() + 1)
    }
  }

  return { buckets, periodTotal, periodContractCount }
}

type PricingPlanRow = {
  id: string
  label: string
  vehicle_type: 'scooter' | 'car' | 'bike'
  day_rate: number
  week_rate: number
  month_rate: number
  active: boolean
}
type VehicleRevisionRow = {
  id: string
  vehicle_id: string
  due_date: string
  status: 'scheduled' | 'done' | 'overdue'
  note: string | null
  created_at: string
}
type BillingSubscriptionRow = {
  id: string
  plan_code: string
  provider: 'stripe' | 'promptpay'
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete'
  current_period_start: string
  current_period_end: string
  auto_renew: boolean
}
type EditModalKind = 'vehicle' | 'client' | 'contract' | 'pricing'
type EditModalState = {
  mode: 'create' | 'edit'
  kind: EditModalKind
  id: string
  values: Record<string, string>
}
type InvoiceProfile = {
  companyName: string
  companyAddress: string
  companyPhone: string
  logoDataUrl: string
}

const defaultInvoiceProfile: InvoiceProfile = {
  companyName: 'JLT - JUST LEASE TECH',
  companyAddress: 'Thailand',
  companyPhone: '',
  logoDataUrl: '',
}

/** Dépôt / caution client : chaîne vide → null ; invalide → null avec invalid=true */
function parseClientDeposit(raw: string): { value: number | null; invalid: boolean } {
  const t = raw.trim()
  if (!t) return { value: null, invalid: false }
  const n = Number(t.replace(/\s/g, '').replace(',', '.'))
  if (Number.isNaN(n) || n < 0) return { value: null, invalid: true }
  return { value: Math.round(n * 100) / 100, invalid: false }
}

function parseInvoiceProfile(raw: unknown): InvoiceProfile {
  if (!raw || typeof raw !== 'object') {
    return { ...defaultInvoiceProfile }
  }
  const o = raw as Record<string, unknown>
  const pickStr = (a: unknown, b: unknown) => {
    const v = (typeof a === 'string' ? a : '') || (typeof b === 'string' ? b : '')
    return v
  }
  return {
    companyName: pickStr(o.companyName, o.company_name) || defaultInvoiceProfile.companyName,
    companyAddress: pickStr(o.companyAddress, o.company_address) || defaultInvoiceProfile.companyAddress,
    companyPhone: pickStr(o.companyPhone, o.company_phone),
    logoDataUrl: pickStr(o.logoDataUrl, o.logo_data_url),
  }
}

function readInvoiceProfileFromStorage(): InvoiceProfile {
  try {
    const stored = localStorage.getItem('jlt-invoice-profile')
    if (!stored) return { ...defaultInvoiceProfile }
    return parseInvoiceProfile(JSON.parse(stored) as unknown)
  } catch {
    return { ...defaultInvoiceProfile }
  }
}

async function compressImageFile(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  const imageUrl = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = imageUrl
    })
    const maxDimension = 1600
    const ratio = Math.min(1, maxDimension / Math.max(image.width, image.height))
    const width = Math.max(1, Math.round(image.width * ratio))
    const height = Math.max(1, Math.round(image.height * ratio))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(image, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.72),
    )
    if (!blob) return file
    const normalizedName = `${file.name.replace(/\.[^/.]+$/, '')}.jpg`
    return new File([blob], normalizedName, { type: 'image/jpeg' })
  } catch {
    return file
  } finally {
    URL.revokeObjectURL(imageUrl)
  }
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('read-file-failed'))
    reader.readAsDataURL(file)
  })
}

/** Dimensions image pour logo PDF (ratio conservé, pas d’étirement). */
function pdfLoadImageDimensions(dataUrl: string): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => resolve(null)
    img.src = dataUrl
  })
}

function DashboardHome({
  app,
  selectedType,
  selectedStatus,
  vehiclesData,
  clientsData,
  contractsData,
  revisionsData,
}: {
  app: any
  selectedType: VehicleTypeFilter
  selectedStatus: StatusFilter
  vehiclesData: VehicleRow[]
  clientsData: ClientRow[]
  contractsData: ContractRow[]
  revisionsData: VehicleRevisionRow[]
}) {
  const d = app.dashboard
  const [activePeriodIndex, setActivePeriodIndex] = useState(3)
  const [selectedStartDate, setSelectedStartDate] = useState(() => dateRangeForAnalysisPeriodChip(3).start)
  const [selectedEndDate, setSelectedEndDate] = useState(() => dateRangeForAnalysisPeriodChip(3).end)
  const [activeRevenueIndex, setActiveRevenueIndex] = useState(0)

  const { buckets: revenueBuckets, periodTotal, periodContractCount } = useMemo(
    () =>
      buildDashboardRevenueSeries(contractsData, vehiclesData, selectedStartDate, selectedEndDate, activePeriodIndex),
    [contractsData, vehiclesData, selectedStartDate, selectedEndDate, activePeriodIndex],
  )
  const visibleRevenueTimeline =
    revenueBuckets.length > 0
      ? revenueBuckets
      : [
          {
            label: '—',
            date: '',
            isoDate: selectedStartDate,
            amount: 0,
            contracts: 0,
          },
        ]
  const revenuePoints = visibleRevenueTimeline.map((item) => item.amount)
  const maxPoint = Math.max(...revenuePoints)
  const minPoint = Math.min(...revenuePoints)
  const chartWidth = 540
  const chartHeight = 126
  const xStep = chartWidth / Math.max(1, revenuePoints.length - 1)
  const toY = (point: number) => {
    const normalized = (point - minPoint) / Math.max(1, maxPoint - minPoint)
    return 10 + (1 - normalized) * (chartHeight - 20)
  }
  const points = revenuePoints.map((point, index) => ({
    x: Math.round(index * xStep),
    y: Math.round(toY(point)),
  }))
  const linePath = points
    .map((point, index, arr) => {
      if (index === 0) return `M ${point.x} ${point.y}`
      const prev = arr[index - 1]
      const cx = Math.round((prev.x + point.x) / 2)
      return `Q ${cx} ${prev.y}, ${point.x} ${point.y}`
    })
    .join(' ')
  const areaPath = `${linePath} L ${chartWidth} ${chartHeight} L 0 ${chartHeight} Z`
  const safeActiveRevenueIndex = Math.min(
    activeRevenueIndex,
    Math.max(visibleRevenueTimeline.length - 1, 0),
  )
  const activeX = Math.round(safeActiveRevenueIndex * xStep)
  const activeY = Math.round(toY(visibleRevenueTimeline[safeActiveRevenueIndex].amount))
  const activeRevenue = visibleRevenueTimeline[safeActiveRevenueIndex]
  const updateActiveByClientX = (clientX: number, rect: DOMRect) => {
    const ratio = (clientX - rect.left) / rect.width
    const next = Math.round(ratio * (visibleRevenueTimeline.length - 1))
    setActiveRevenueIndex(Math.min(visibleRevenueTimeline.length - 1, Math.max(0, next)))
  }
  const onRevenueWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    setActiveRevenueIndex((prev) => {
      const next = event.deltaY > 0 ? prev + 1 : prev - 1
      return Math.min(visibleRevenueTimeline.length - 1, Math.max(0, next))
    })
  }
  const onRevenueMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    updateActiveByClientX(event.clientX, event.currentTarget.getBoundingClientRect())
  }
  const onRevenueTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    if (!event.touches[0]) return
    updateActiveByClientX(event.touches[0].clientX, event.currentTarget.getBoundingClientRect())
  }

  useEffect(() => {
    setActiveRevenueIndex((prev) =>
      Math.min(prev, Math.max(visibleRevenueTimeline.length - 1, 0)),
    )
  }, [visibleRevenueTimeline.length])
  useEffect(() => {
    setActiveRevenueIndex(Math.max(0, revenueBuckets.length - 1))
  }, [selectedStartDate, selectedEndDate, activePeriodIndex])

  const activeContractsCount = contractsData.filter((row) => row.status === 'active').length
  const availableVehiclesCount = vehiclesData.filter((row) => row.status === 'available').length
  const kpiCards: Array<{
    label: string
    value: string
    hint: string
    linkTo?: string
  }> = [
    {
      label: app.menu[1],
      value: String(vehiclesData.length),
      hint: `${availableVehiclesCount} ${d.available}`,
      linkTo: '/app/vehicules',
    },
    {
      label: d.activeContracts.toUpperCase(),
      value: String(activeContractsCount),
      hint: ' ',
      linkTo: '/app/contrats',
    },
    {
      label: app.menu[2],
      value: String(clientsData.length),
      hint: d.registered,
      linkTo: '/app/clients',
    },
    { label: d.revenueTitle.toUpperCase(), value: `฿${periodTotal}`, hint: d.selectedPeriod },
  ]
  const [marketMetric, setMarketMetric] = useState<'contracts' | 'revenue'>('contracts')
  const colorByIndex = ['#f59e0b', '#3b82f6', '#14b8a6', '#8b5cf6', '#ef4444', '#22c55e']
  const vehicleById = new Map(vehiclesData.map((row) => [row.id, row]))
  const marketMap = new Map<string, { name: string; contracts: number; revenue: number }>()
  contractsData.forEach((contract) => {
    if (contract.status === 'cancelled') return
    const overlapDays = overlapBillableDaysInRange(
      String(contract.start_at || '').slice(0, 10),
      String(contract.end_at || '').slice(0, 10),
      selectedStartDate,
      addDaysLocal(selectedEndDate, 1),
    )
    if (overlapDays < 1) return
    const vehicle = vehicleById.get(contract.vehicle_id)
    const share = contractRevenueInAnalysisRange(contract, vehicle, selectedStartDate, selectedEndDate)
    const model = vehicle ? `${vehicle.brand} ${vehicle.model}` : contract.vehicle_id
    const existing = marketMap.get(model) || { name: model, contracts: 0, revenue: 0 }
    existing.contracts += 1
    existing.revenue += share
    marketMap.set(model, existing)
  })
  const marketShare = Array.from(marketMap.values())
    .sort((a, b) => b.contracts - a.contracts)
    .slice(0, 5)
    .map((row, index) => ({ ...row, color: colorByIndex[index % colorByIndex.length] }))
  const marketTotal = marketShare.reduce(
    (sum, row) => sum + (marketMetric === 'contracts' ? row.contracts : row.revenue),
    0,
  )
  const marketRows = marketShare.map((row) => {
    const value = marketMetric === 'contracts' ? row.contracts : row.revenue
    const pct = Math.round((value / Math.max(1, marketTotal)) * 100)
    return { ...row, value, pct }
  })

  const clientById = new Map(clientsData.map((row) => [row.id, row]))
  const statusLabelByKey = {
    active: app.active,
    completed: app.done,
    draft: app.draft,
    cancelled: app.statusCancelled,
  } as const
  const recentContracts = contractsData
    .slice()
    .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
    .slice(0, 6)
    .map((contract) => {
      const client = clientById.get(contract.client_id)
      const vehicle = vehicleById.get(contract.vehicle_id)
      const type = vehicle?.type || 'scooter'
      return {
        client: client?.full_name || app.entityClient,
        vehicle: vehicle ? `${vehicle.brand} ${vehicle.model}` : app.entityVehicle,
        ref: contract.id.slice(0, 8).toUpperCase(),
        date: new Date(contract.start_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
        status: statusLabelByKey[contract.status as keyof typeof statusLabelByKey] || contract.status,
        statusKey: contract.status === 'completed' ? 'done' : (contract.status as StatusFilter),
        type,
      }
    })

  const makeFleetRow = (key: 'scooter' | 'car' | 'bike', label: string) => {
    const rows = vehiclesData.filter((vehicle) => vehicle.type === key)
    const available = rows.filter((vehicle) => vehicle.status === 'available').length
    const rented = rows.filter((vehicle) => vehicle.status === 'reserved').length
    const maintenance = rows.filter((vehicle) => vehicle.status === 'maintenance').length
    const total = rows.length
    return { key, type: label, total: `${rented}/${Math.max(total, 1)}`, available, rented, maintenance }
  }
  const fleetRows = [
    makeFleetRow('scooter', d.vehicleTypes[0]),
    makeFleetRow('car', d.vehicleTypes[1]),
    makeFleetRow('bike', d.vehicleTypes[2]),
  ]
  const filteredRecentContracts = recentContracts.filter((row) => {
    const typeOk = selectedType === 'all' || row.type === selectedType
    const statusOk = selectedStatus === 'all' || row.statusKey === selectedStatus
    return typeOk && statusOk
  })
  const filteredFleetRows = fleetRows.filter((row) => selectedType === 'all' || row.key === selectedType)
  const todayIso = new Date().toISOString().slice(0, 10)
  const returnsToday = contractsData.filter(
    (contract) =>
      contract.end_at?.slice(0, 10) === todayIso &&
      (contract.status === 'active' || contract.status === 'draft'),
  )
  const upcomingRevisions = revisionsData
    .filter((revision) => revision.status !== 'done')
    .filter((revision) => {
      const due = revision.due_date?.slice(0, 10)
      if (!due) return false
      const diffDays = Math.ceil((+new Date(due) - +new Date(todayIso)) / (1000 * 60 * 60 * 24))
      return diffDays >= 0 && diffDays <= 7
    })
    .slice(0, 5)

  return (
    <div className="dashboard-home">
      <section className="alerts-card">
        <h3>{app.notificationsTitle}</h3>
        <div className="alerts-list">
          {returnsToday.map((contract) => {
            const vehicle = vehicleById.get(contract.vehicle_id)
            return (
              <p key={`return-${contract.id}`}>
                {app.returnToday}: {vehicle ? `${vehicle.brand} ${vehicle.model}` : contract.vehicle_id}
              </p>
            )
          })}
          {upcomingRevisions.map((revision) => {
            const vehicle = vehicleById.get(revision.vehicle_id)
            return (
              <p key={`revision-${revision.id}`}>
                {app.revisionUpcoming} ({revision.due_date.slice(0, 10)}):{' '}
                {vehicle ? `${vehicle.brand} ${vehicle.model}` : revision.vehicle_id}
              </p>
            )
          })}
          {returnsToday.length === 0 && upcomingRevisions.length === 0 && (
            <p className="empty-state">{app.noNotifications}</p>
          )}
        </div>
      </section>
      <div className="kpi-row">
        {kpiCards.map((item) =>
          item.linkTo ? (
            <Link key={item.label} to={item.linkTo} className="kpi-card kpi-card--link">
              <p>{item.label}</p>
              <strong>{item.value}</strong>
              <small>{item.hint}</small>
            </Link>
          ) : (
            <article key={item.label} className="kpi-card">
              <p>{item.label}</p>
              <strong>{item.value}</strong>
              <small>{item.hint}</small>
            </article>
          ),
        )}
      </div>

      <section className="analysis-card">
        <div className="analysis-top">
          <div>
            <p className="analysis-title">{d.analysisPeriod.toUpperCase()}</p>
            <div className="chips">
              {d.periodLabels.map((label: string, index: number) => (
                <button
                  key={label}
                  type="button"
                  className={index === activePeriodIndex ? 'active' : ''}
                  onClick={() => {
                    const { start, end } = dateRangeForAnalysisPeriodChip(index)
                    setSelectedStartDate(start)
                    setSelectedEndDate(end)
                    setActivePeriodIndex(index)
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="date-range">
            <input
              type="date"
              value={selectedStartDate}
              onChange={(event) => {
                const next = event.target.value
                setSelectedStartDate(next)
                if (next > selectedEndDate) setSelectedEndDate(next)
              }}
            />
            <input
              type="date"
              value={selectedEndDate}
              onChange={(event) => {
                const next = event.target.value
                setSelectedEndDate(next)
                if (next < selectedStartDate) setSelectedStartDate(next)
              }}
            />
          </div>
        </div>

        <div className="charts-grid">
          <article className="revenue-card">
            <div className="row-between">
              <div>
                <h3>{d.revenueTitle}</h3>
                <strong>{`฿${periodTotal}`}</strong>
                <p>{`${periodContractCount} ${d.contractsCount}`}</p>
              </div>
              <span className="danger-chip">{`-100% ${d.vsLastMonth}`}</span>
            </div>
            <div
              className="line-chart"
              onWheel={onRevenueWheel}
              onMouseMove={onRevenueMouseMove}
              onTouchMove={onRevenueTouchMove}
            >
              <div className="revenue-tooltip">
                <strong>{`฿${activeRevenue.amount}`}</strong>
                <span>{activeRevenue.date}</span>
              </div>
              <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none">
                <defs>
                  <linearGradient id="revenueArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgba(245,158,11,0.34)" />
                    <stop offset="100%" stopColor="rgba(245,158,11,0.04)" />
                  </linearGradient>
                </defs>
                <path d={areaPath} className="line-area" />
                <path d={linePath} className="line-stroke" />
                <line x1={activeX} y1="0" x2={activeX} y2={chartHeight} className="line-cursor" />
                <circle cx={activeX} cy={activeY} r="5.5" className="line-dot" />
                {points.map((point, index) => (
                  <circle
                    key={visibleRevenueTimeline[index].label}
                    cx={point.x}
                    cy={point.y}
                    r={index === safeActiveRevenueIndex ? 4 : 2.8}
                    className={`line-step-dot${index === safeActiveRevenueIndex ? ' is-active' : ''}`}
                  />
                ))}
              </svg>
              <div className="line-axis">
                {visibleRevenueTimeline.map((item) => (
                  <span key={item.label}>{item.label}</span>
                ))}
              </div>
            </div>
          </article>

          <article className="market-card">
            <div className="row-between">
              <div>
                <h3>{d.marketShare}</h3>
                <p>{d.byVehicleModel}</p>
              </div>
              <div className="chips small">
                <button
                  type="button"
                  className={marketMetric === 'contracts' ? 'active' : ''}
                  onClick={() => setMarketMetric('contracts')}
                >
                  {d.contractsTab}
                </button>
                <button
                  type="button"
                  className={marketMetric === 'revenue' ? 'active' : ''}
                  onClick={() => setMarketMetric('revenue')}
                >
                  {d.revenueTab}
                </button>
              </div>
            </div>

            <div className="market-body">
              <div className="donut-ring" />
              <div className="market-list">
                {marketRows.length > 0 ? (
                  marketRows.map((item) => (
                    <div key={item.name} className="market-item">
                      <div className="market-label">
                        <span style={{ background: item.color }} />
                        {item.name}
                      </div>
                      <div className="market-track">
                        <i style={{ width: `${item.pct}%`, background: item.color }} />
                      </div>
                      <small>
                        {marketMetric === 'contracts'
                          ? `${item.value} ${d.contractsCount}`
                          : `฿${item.value}`}
                      </small>
                    </div>
                  ))
                ) : (
                  <p className="empty-state">{app.emptyRevenueData}</p>
                )}
              </div>
            </div>
          </article>
        </div>
      </section>

      <div className="bottom-grid">
        <article className="recent-card">
          <div className="row-between">
            <h3>{d.recentContracts}</h3>
            <Link to="/app/contrats" className="see-all-link">
              {d.seeAll}
            </Link>
          </div>
          <div className="contracts-table">
            {filteredRecentContracts.length > 0 ? (
              filteredRecentContracts.map((row) => (
                <div key={row.ref} className="contract-line">
                  <div>
                    <strong>{row.client}</strong>
                    <p>
                      {row.vehicle} - {row.ref}
                    </p>
                  </div>
                  <div className="contract-right">
                    <span>{row.date}</span>
                    <span className="pill">{row.status}</span>
                  </div>
                </div>
              ))
            ) : (
              <p className="empty-state">{app.emptyContracts}</p>
            )}
          </div>
        </article>

        <article className="fleet-card">
          <h3>{d.fleetOverview}</h3>
          {filteredFleetRows.length > 0 ? (
            filteredFleetRows.map((row) => (
              <div key={row.type} className="fleet-row">
                <div className="row-between">
                  <strong>{row.type}</strong>
                  <small>{row.total}</small>
                </div>
                <div className="fleet-bar">
                  <i style={{ width: `${row.available * 35}%`, background: '#22c55e' }} />
                  <i style={{ width: `${row.rented * 35}%`, background: '#f59e0b' }} />
                  <i style={{ width: `${row.maintenance * 30}%`, background: '#ef4444' }} />
                </div>
                <p>
                  {row.available} {d.available} • {row.rented} {d.rented} • {row.maintenance}{' '}
                  {d.maintenance}
                </p>
              </div>
            ))
          ) : (
            <p className="empty-state">{app.emptyVehicles}</p>
          )}
        </article>
      </div>
    </div>
  )
}

function VehiculesPage({
  app,
  selectedType,
  selectedStatus,
  searchQuery,
  vehiclesData,
  revisionsData,
  onCreateRevision,
  onUpdateRevisionStatus,
  onDeleteRevision,
  onEditVehicle,
  onDeleteVehicle,
}: {
  app: any
  selectedType: VehicleTypeFilter
  selectedStatus: StatusFilter
  searchQuery: string
  vehiclesData: VehicleRow[]
  revisionsData: VehicleRevisionRow[]
  onCreateRevision: (payload: {
    vehicle_id: string
    due_date: string
    status: 'scheduled' | 'done' | 'overdue'
    note: string
  }) => Promise<void>
  onUpdateRevisionStatus: (
    revisionId: string,
    status: 'scheduled' | 'done' | 'overdue',
  ) => Promise<void>
  onDeleteRevision: (revisionId: string) => Promise<void>
  onEditVehicle: (vehicleId: string) => Promise<void>
  onDeleteVehicle: (vehicleId: string) => Promise<void>
}) {
  const [searchParams] = useSearchParams()
  const [sessionUserId, setSessionUserId] = useState<string | null>(null)
  const [vehiclePhotos, setVehiclePhotos] = useState<Record<string, string>>({})
  const [vehicleGalleries, setVehicleGalleries] = useState<
    Record<string, Array<{ id: string; filePath: string; signedUrl: string }>>
  >({})
  const [uploadingFor, setUploadingFor] = useState<string | null>(null)
  const [airtagDrafts, setAirtagDrafts] = useState<Record<string, string>>({})
  const [savingAirtagFor, setSavingAirtagFor] = useState<string | null>(null)
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')
  const [vehicleTab, setVehicleTab] = useState<'fleet' | 'revisions'>('fleet')

  /** Suivi des blob: URLs pour les révoquer (affichage via download(), pas /object/sign/). */
  const vehiclePhotoBlobUrlsRef = useRef<string[]>([])

  const revokeVehiclePhotoBlobs = useCallback(() => {
    vehiclePhotoBlobUrlsRef.current.forEach((u) => {
      try {
        URL.revokeObjectURL(u)
      } catch {
        /* ignore */
      }
    })
    vehiclePhotoBlobUrlsRef.current = []
  }, [])

  /**
   * Bucket public : URL directe. Sinon : download authentifié + blob (évite les 400 sur les URLs signées /object/sign/).
   */
  const resolveVehiclePhotoUrl = useCallback(async (rawPath: string): Promise<string> => {
    const key = parseVehiclePhotoObjectKey(rawPath)
    if (vehiclePhotosUsePublicUrl) {
      const { data } = supabase.storage.from(vehiclePhotosBucket).getPublicUrl(key)
      return data.publicUrl
    }
    const { data: blob, error } = await supabase.storage.from(vehiclePhotosBucket).download(key)
    if (!error && blob) {
      const url = URL.createObjectURL(blob)
      vehiclePhotoBlobUrlsRef.current.push(url)
      return url
    }
    /* Démo en ligne : si download échoue (policy / réseau), tenter une URL signée sur le préfixe demo/ */
    if (isPublicDemoMode && key.startsWith('demo/')) {
      const { data: signed, error: signErr } = await supabase.storage
        .from(vehiclePhotosBucket)
        .createSignedUrl(key, 60 * 60)
      if (!signErr && signed?.signedUrl) return signed.signedUrl
    }
    console.warn(`[${vehiclePhotosBucket}] download`, key, error?.message ?? '')
    return ''
  }, [])

  useEffect(() => () => revokeVehiclePhotoBlobs(), [revokeVehiclePhotoBlobs])

  useEffect(() => {
    if (searchParams.get('tab') === 'revisions') {
      setVehicleTab('revisions')
    }
  }, [searchParams])
  const [revisionForm, setRevisionForm] = useState({
    vehicle_id: '',
    due_date: '',
    note: '',
  })

  const statusLabelMap = {
    available: app.available,
    reserved: app.reserved,
    maintenance: app.dashboard.maintenance,
  } as const
  const cardTypeMap = {
    scooter: app.dashboard.vehicleTypes[0],
    car: app.dashboard.vehicleTypes[1],
    bike: app.dashboard.vehicleTypes[2],
  } as const
  const vehicles = vehiclesData.map((vehicle) => ({
    id: vehicle.id,
    brand: vehicle.brand,
    model: vehicle.model,
    name: `${vehicle.brand} ${vehicle.model}`,
    type: vehicle.type,
    statusKey: vehicle.status,
    statusLabel: statusLabelMap[vehicle.status],
    cardType: cardTypeMap[vehicle.type],
    pricePerDay: Number(vehicle.daily_price ?? 0),
    specs: [
      vehicle.license_plate || '—',
      vehicle.year ? String(vehicle.year) : '—',
      vehicle.type === 'car' ? 'Auto' : vehicle.type === 'bike' ? 'Velo' : 'Scooter',
    ],
    airtagCode: vehicle.airtag_code || '',
  }))
  const filteredVehicles = vehicles.filter((vehicle) => {
    const typeOk = selectedType === 'all' || vehicle.type === selectedType
    const vehicleStatusFilter =
      selectedStatus === 'available' ||
      selectedStatus === 'reserved' ||
      selectedStatus === 'maintenance' ||
      selectedStatus === 'all'
        ? selectedStatus
        : 'all'
    const statusOk = vehicleStatusFilter === 'all' || vehicle.statusKey === vehicleStatusFilter
    const searchHaystack = [
      vehicle.name,
      vehicle.brand,
      vehicle.model,
      vehicle.cardType,
      vehicle.statusLabel,
      vehicle.statusKey,
      ...vehicle.specs,
    ].join(' ')
    const searchOk = matchesSearchQuery(searchHaystack, searchQuery)
    return typeOk && statusOk && searchOk
  })
  const sortedRevisions = [...revisionsData].sort((a, b) =>
    (a.due_date || '').localeCompare(b.due_date || ''),
  )
  const revisionStats = sortedRevisions.reduce(
    (acc, revision) => {
      if (revision.status === 'done') acc.done += 1
      else if (revision.status === 'overdue') acc.overdue += 1
      else acc.scheduled += 1
      return acc
    },
    { scheduled: 0, done: 0, overdue: 0 },
  )
  const formatRevisionDate = (value: string) => value?.slice(0, 10) || '-'
  const revisionToneClass = (status: 'scheduled' | 'done' | 'overdue') =>
    status === 'done'
      ? 'is-done'
      : status === 'overdue'
        ? 'is-overdue'
        : 'is-scheduled'
  const revisionStatusLabel = (status: 'scheduled' | 'done' | 'overdue') =>
    status === 'done'
      ? app.revisionStatusDone
      : status === 'overdue'
        ? app.revisionStatusOverdue
        : app.revisionStatusScheduled

  useEffect(() => {
    let mounted = true
    const syncSession = (userId: string | null) => {
      if (mounted) setSessionUserId(userId)
    }
    void supabase.auth.getSession().then(({ data: { session } }) => {
      syncSession(session?.user?.id ?? null)
    })
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      syncSession(session?.user?.id ?? null)
    })
    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    const loadPhotos = async () => {
      const userId = sessionUserId
      if (!userId) {
        revokeVehiclePhotoBlobs()
        setVehiclePhotos({})
        setVehicleGalleries({})
        return
      }

      const { data: rows, error: rowsError } = await supabase
        .from('vehicle_photos')
        .select('id,vehicle_id,vehicle_label,file_path,created_at')
        .eq('owner_id', userId)
        .order('created_at', { ascending: false })
      if (rowsError) {
        console.warn('[vehicle_photos]', rowsError.message)
        return
      }
      if (!rows?.length) {
        revokeVehiclePhotoBlobs()
        setVehiclePhotos({})
        setVehicleGalleries({})
        return
      }

      revokeVehiclePhotoBlobs()

      type PhotoRow = (typeof rows)[number]
      const rowsForVehicle = (v: { id: string; brand: string; model: string }) => {
        const nameNorm = normalizeVehicleLabel(`${v.brand} ${v.model}`)
        return rows.filter((r: PhotoRow) => {
          if (r.vehicle_id === v.id) return true
          const idFromPath = vehicleIdFromVehiclePhotoPath(r.file_path)
          if (idFromPath === v.id) return true
          return (
            r.vehicle_id == null && normalizeVehicleLabel(r.vehicle_label) === nameNorm
          )
        })
      }

      const nextPhotos: Record<string, string> = {}
      const nextGalleries: Record<
        string,
        Array<{ id: string; filePath: string; signedUrl: string }>
      > = {}

      for (const v of vehiclesData) {
        const matching = rowsForVehicle(v).sort(
          (a, b) => +new Date(b.created_at) - +new Date(a.created_at),
        )
        if (!matching.length) continue

        const signed = await Promise.all(
          matching.slice(0, 6).map(async (row) => {
            const key = parseVehiclePhotoObjectKey(row.file_path)
            const signedUrl = await resolveVehiclePhotoUrl(row.file_path)
            return {
              id: row.id,
              filePath: key,
              signedUrl,
            }
          }),
        )
        const valid = signed.filter((item) => item.signedUrl)
        if (!valid.length) continue

        nextPhotos[v.id] = valid[0].signedUrl
        nextGalleries[v.id] = valid
      }

      setVehiclePhotos(nextPhotos)
      setVehicleGalleries(nextGalleries)
    }

    void loadPhotos()
  }, [sessionUserId, vehiclesData, revokeVehiclePhotoBlobs])

  useEffect(() => {
    const nextDrafts: Record<string, string> = {}
    vehicles.forEach((vehicle) => {
      nextDrafts[vehicle.id] = vehicle.airtagCode
    })
    setAirtagDrafts(nextDrafts)
  }, [vehiclesData])

  const onSaveAirtag = async (vehicleId: string) => {
    setFeedback('')
    setError('')
    setSavingAirtagFor(vehicleId)
    const code = (airtagDrafts[vehicleId] || '').trim()
    const { error: updateError } = await supabase
      .from('vehicles')
      .update({ airtag_code: code || null })
      .eq('id', vehicleId)
    if (updateError) {
      setError(updateError.message)
    } else {
      setFeedback(app.airtagSaved)
    }
    setSavingAirtagFor(null)
  }

  const onVehiclePhotoChange =
    (vehicleId: string, vehicleName: string) => async (event: ChangeEvent<HTMLInputElement>) => {
      setFeedback('')
      setError('')
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return

      if (!sessionUserId) {
        setError(app.vehiclePhotoAuth)
        return
      }

      setUploadingFor(vehicleId)
      const compressedFile = await compressImageFile(file)
      const extension = compressedFile.name.split('.').pop() || 'jpg'
      const normalizedVehicleLabel = normalizeVehicleLabel(vehicleName)
      const safeVehicle = normalizedVehicleLabel.replace(/\s+/g, '-')
      const fileName = `${Date.now()}.${extension}`
      const filePath = buildVehiclePhotoStoragePath({
        isPublicDemo: isPublicDemoMode,
        userId: sessionUserId,
        vehicleId,
        vehicleSlugForTabUpload: isPublicDemoMode ? undefined : safeVehicle,
        fileName,
      })

      const { error: uploadError } = await supabase.storage
        .from(vehiclePhotosBucket)
        .upload(filePath, compressedFile, {
          cacheControl: '3600',
          upsert: false,
          contentType: compressedFile.type || 'image/jpeg',
        })

      if (uploadError) {
        setError(uploadError.message)
        setUploadingFor(null)
        return
      }

      const { error: insertError } = await supabase.from('vehicle_photos').insert({
        owner_id: sessionUserId,
        vehicle_id: vehicleId,
        vehicle_label: normalizedVehicleLabel,
        file_path: filePath,
      })
      if (insertError) {
        setError(insertError.message)
        setUploadingFor(null)
        return
      }

      const displayUrl = await resolveVehiclePhotoUrl(filePath)

      if (!displayUrl) {
        setError(app.vehiclePhotoError)
      } else {
        setVehiclePhotos((prev) => {
          const old = prev[vehicleId]
          if (old?.startsWith('blob:')) URL.revokeObjectURL(old)
          return { ...prev, [vehicleId]: displayUrl }
        })
        setVehicleGalleries((prev) => ({
          ...prev,
          [vehicleId]: [
            {
              id: `local-${Date.now()}`,
              filePath: parseVehiclePhotoObjectKey(filePath),
              signedUrl: displayUrl,
            },
            ...(prev[vehicleId] ?? []),
          ].slice(0, 6),
        }))
        setFeedback(app.vehiclePhotoSuccess)
      }
      setUploadingFor(null)
    }

  const onDeleteVehiclePhoto = async (vehicleId: string, photoId: string, filePath: string) => {
    setFeedback('')
    setError('')
    const removed = (vehicleGalleries[vehicleId] ?? []).find((item) => item.id === photoId)
    if (removed?.signedUrl?.startsWith('blob:')) URL.revokeObjectURL(removed.signedUrl)
    const { error: removeStorageError } = await supabase.storage
      .from(vehiclePhotosBucket)
      .remove([parseVehiclePhotoObjectKey(filePath)])
    if (removeStorageError) {
      setError(removeStorageError.message)
      return
    }
    if (!photoId.startsWith('local-')) {
      await supabase.from('vehicle_photos').delete().eq('id', photoId)
    }
    const remaining = (vehicleGalleries[vehicleId] ?? []).filter((item) => item.id !== photoId)
    setVehicleGalleries((prev) => ({
      ...prev,
      [vehicleId]: remaining,
    }))
    setVehiclePhotos((prev) => ({
      ...prev,
      [vehicleId]: remaining[0]?.signedUrl ?? '',
    }))
  }

  return (
    <div className="grid-cards">
      <div className="vehicle-tab-header">
        <div className="chips">
          <button
            type="button"
            className={vehicleTab === 'fleet' ? 'active' : ''}
            onClick={() => setVehicleTab('fleet')}
          >
            {app.menu[1]}
          </button>
          <button
            type="button"
            className={vehicleTab === 'revisions' ? 'active' : ''}
            onClick={() => setVehicleTab('revisions')}
          >
            {app.revisionsTab}
          </button>
        </div>
        <div className="vehicle-tab-kpis">
          <p>
            <strong>{filteredVehicles.length}</strong> {app.menu[1].toLowerCase()}
          </p>
          <p className="warn">
            <strong>{revisionStats.overdue}</strong> {app.revisionStatusOverdue.toLowerCase()}
          </p>
        </div>
      </div>
      {vehicleTab === 'revisions' && (
        <article className="vehicle-revisions-board">
          <header className="vehicle-revisions-summary">
            <div className="revision-stat">
              <span>{app.revisionStatusScheduled}</span>
              <strong>{revisionStats.scheduled}</strong>
            </div>
            <div className="revision-stat done">
              <span>{app.revisionStatusDone}</span>
              <strong>{revisionStats.done}</strong>
            </div>
            <div className="revision-stat overdue">
              <span>{app.revisionStatusOverdue}</span>
              <strong>{revisionStats.overdue}</strong>
            </div>
          </header>
          <div className="revision-create-card">
            <h4>{app.scheduleRevision}</h4>
            <div className="revision-create-grid">
              <select
                value={revisionForm.vehicle_id}
                onChange={(event) =>
                  setRevisionForm((prev) => ({ ...prev, vehicle_id: event.target.value }))
                }
              >
                <option value="">{app.vehicleField}</option>
                {vehiclesData.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.brand} {vehicle.model}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={revisionForm.due_date}
                onChange={(event) =>
                  setRevisionForm((prev) => ({ ...prev, due_date: event.target.value }))
                }
              />
              <input
                value={revisionForm.note}
                onChange={(event) =>
                  setRevisionForm((prev) => ({ ...prev, note: event.target.value }))
                }
                placeholder={app.noteField}
              />
              <button
                type="button"
                onClick={() =>
                  void (async () => {
                    if (!revisionForm.vehicle_id || !revisionForm.due_date) return
                    await onCreateRevision({
                      vehicle_id: revisionForm.vehicle_id,
                      due_date: revisionForm.due_date,
                      status: 'scheduled',
                      note: revisionForm.note,
                    })
                    setRevisionForm({ vehicle_id: '', due_date: '', note: '' })
                  })()
                }
              >
                {app.create}
              </button>
            </div>
          </div>
          <div className="list vehicle-revisions-list">
            {sortedRevisions.map((revision) => {
              const vehicle = vehiclesData.find((v) => v.id === revision.vehicle_id)
              return (
                <article key={revision.id} className="revision-card">
                  <div className="revision-card-main">
                    <span className={`revision-badge ${revisionToneClass(revision.status)}`}>
                      {revisionStatusLabel(revision.status)}
                    </span>
                    <h4>{vehicle ? `${vehicle.brand} ${vehicle.model}` : revision.vehicle_id}</h4>
                    <p>{formatRevisionDate(revision.due_date)}</p>
                    <p>{revision.note || '-'}</p>
                  </div>
                  <div className="row-actions revision-actions">
                    <select
                      value={revision.status}
                      onChange={(event) =>
                        void onUpdateRevisionStatus(
                          revision.id,
                          event.target.value as 'scheduled' | 'done' | 'overdue',
                        )
                      }
                    >
                      <option value="scheduled">{app.revisionStatusScheduled}</option>
                      <option value="done">{app.revisionStatusDone}</option>
                      <option value="overdue">{app.revisionStatusOverdue}</option>
                    </select>
                    <button type="button" onClick={() => void onDeleteRevision(revision.id)}>
                      {app.delete}
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        </article>
      )}
      {vehicleTab === 'fleet' &&
        filteredVehicles.map((vehicle) => (
        <article key={vehicle.id} className="vehicle-card">
          <div className="vehicle-meta-top">
            <small>{vehicle.cardType}</small>
            <span className={`vehicle-status ${vehicle.statusKey}`}>{vehicle.statusLabel}</span>
          </div>
          <div className="vehicle-cover">
            {vehiclePhotos[vehicle.id] ? (
              <img
                src={vehiclePhotos[vehicle.id]}
                alt={vehicle.name}
                loading="lazy"
              />
            ) : (
              <div className="vehicle-no-photo">Aucune photo</div>
            )}
          </div>
          <h4>{vehicle.name}</h4>
          <div className="vehicle-specs">
            {vehicle.specs.map((spec, index) => (
              <span key={`${vehicle.id}-spec-${index}`}>{spec}</span>
            ))}
          </div>
          <div className="airtag-editor">
            <input
              value={airtagDrafts[vehicle.id] ?? ''}
              onChange={(event) =>
                setAirtagDrafts((prev) => ({ ...prev, [vehicle.id]: event.target.value }))
              }
              placeholder={app.airtagPlaceholder}
            />
            <button
              type="button"
              onClick={() => void onSaveAirtag(vehicle.id)}
              disabled={savingAirtagFor === vehicle.id}
            >
              {savingAirtagFor === vehicle.id ? '...' : app.save}
            </button>
          </div>
          <p className="vehicle-price">
            <strong>{vehicle.pricePerDay} ฿</strong> /jour
          </p>
          <div className="row-actions">
            <button type="button" onClick={() => void onEditVehicle(vehicle.id)}>
              {app.edit}
            </button>
            <button type="button" onClick={() => void onDeleteVehicle(vehicle.id)}>
              {app.delete}
            </button>
          </div>
          <div className="vehicle-photo-upload-actions">
            <label className="photo-upload-btn photo-upload-btn--half">
              {uploadingFor === vehicle.id ? app.vehiclePhotoUploading : app.fileInputChooseSingle}
              <input
                type="file"
                accept="image/*"
                onChange={onVehiclePhotoChange(vehicle.id, vehicle.name)}
                disabled={uploadingFor === vehicle.id}
              />
            </label>
            <label className="photo-upload-btn photo-upload-btn--half">
              {uploadingFor === vehicle.id ? app.vehiclePhotoUploading : app.vehiclePhotoTakePhoto}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => {
                  onVehiclePhotoChange(vehicle.id, vehicle.name)(e)
                  requestAnimationFrame(() => window.scrollTo(0, 0))
                }}
                disabled={uploadingFor === vehicle.id}
              />
            </label>
          </div>
          {(vehicleGalleries[vehicle.id] ?? []).length > 0 && (
            <div className="vehicle-gallery">
              {(vehicleGalleries[vehicle.id] ?? []).map((photo) => (
                <div key={photo.id} className="vehicle-thumb-wrap">
                  <button
                    type="button"
                    className="vehicle-thumb"
                    onClick={() =>
                      setVehiclePhotos((prev) => ({
                        ...prev,
                        [vehicle.id]: photo.signedUrl,
                      }))
                    }
                  >
                    <img src={photo.signedUrl} alt={vehicle.name} loading="lazy" />
                  </button>
                  <button
                    type="button"
                    className="vehicle-thumb-delete"
                    onClick={() =>
                      void onDeleteVehiclePhoto(vehicle.id, photo.id, photo.filePath)
                    }
                  >
                    {app.delete}
                  </button>
                </div>
              ))}
            </div>
          )}
        </article>
      ))}
      {(feedback || error) && (
        <p className={`vehicle-photo-feedback${error ? ' is-error' : ''}`}>
          {error || feedback}
        </p>
      )}
    </div>
  )
}

function ClientsPage({
  app,
  clientsData,
  searchQuery,
  passportUrlsByClientId,
  onOpenPassportViewer,
  onEditClient,
  onDeleteClient,
}: {
  app: any
  clientsData: ClientRow[]
  searchQuery: string
  passportUrlsByClientId: Record<string, string>
  onOpenPassportViewer: (url: string, title: string) => void
  onEditClient: (clientId: string) => Promise<void>
  onDeleteClient: (clientId: string) => Promise<void>
}) {
  const filteredClients = useMemo(() => {
    return clientsData.filter((client) => {
      const searchHaystack = [
        client.full_name,
        client.nationality,
        client.passport_number,
        client.phone,
        client.email,
        client.notes,
        client.deposit_amount != null && !Number.isNaN(Number(client.deposit_amount))
          ? String(client.deposit_amount)
          : '',
      ]
        .map((x) => (x == null ? '' : String(x).trim()))
        .join(' ')
      return matchesSearchQuery(searchHaystack, searchQuery)
    })
  }, [clientsData, searchQuery])

  return (
    <div className="list">
      {filteredClients.map((client) => (
        <article key={client.id} className="list-item list-item--client">
          <div className="client-card__top">
            <h4>{client.full_name}</h4>
            {passportUrlsByClientId[client.id] ? (
              <button
                type="button"
                className="client-passport-frame"
                onClick={() =>
                  onOpenPassportViewer(
                    passportUrlsByClientId[client.id],
                    client.full_name,
                  )
                }
                aria-label={app.passportPhotoOpen}
              >
                <img
                  src={passportUrlsByClientId[client.id]}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="client-passport-frame__img"
                />
              </button>
            ) : null}
          </div>
          <p>
            {app.fieldNationality}: {client.nationality?.trim() || '—'}
          </p>
          <p>
            {app.fieldPassportNumber}: {client.passport_number?.trim() || '—'}
          </p>
          <p>
            {app.fieldDeposit}:{' '}
            {client.deposit_amount != null && !Number.isNaN(Number(client.deposit_amount))
              ? `฿${Number(client.deposit_amount).toLocaleString(undefined, {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 2,
                })}`
              : '—'}
          </p>
          <div className="client-card-notes">
            <span className="client-card-notes__label">{app.fieldNotes}</span>
            <p className="client-card-notes__text">{client.notes?.trim() || '—'}</p>
          </div>
          <p>{client.phone || '—'}</p>
          <p>{client.email || '—'}</p>
          <div className="row-actions">
            <button type="button" onClick={() => void onEditClient(client.id)}>
              {app.edit}
            </button>
            <button type="button" onClick={() => void onDeleteClient(client.id)}>
              {app.delete}
            </button>
          </div>
        </article>
      ))}
    </div>
  )
}

function ContratsPage({
  app,
  selectedType,
  selectedStatus,
  searchQuery,
  contractsData,
  clientsData,
  vehiclesData,
  invoiceProfile,
  onEditContract,
  onDeleteContract,
}: {
  app: any
  selectedType: VehicleTypeFilter
  selectedStatus: StatusFilter
  searchQuery: string
  contractsData: ContractRow[]
  clientsData: ClientRow[]
  vehiclesData: VehicleRow[]
  invoiceProfile: {
    companyName: string
    companyAddress: string
    companyPhone: string
    logoDataUrl: string
  }
  onEditContract: (contractId: string) => Promise<void>
  onDeleteContract: (contractId: string) => Promise<void>
}) {
  const [invoiceFeedback, setInvoiceFeedback] = useState('')
  const [invoicePreviewUrl, setInvoicePreviewUrl] = useState('')
  const clientById = new Map(clientsData.map((row) => [row.id, row]))
  const vehicleById = new Map(vehiclesData.map((row) => [row.id, row]))
  const statusLabelMap = {
    active: app.active,
    completed: app.done,
    draft: app.draft,
    cancelled: app.statusCancelled,
  } as const
  const contracts = contractsData.map((contract) => {
    const client = clientById.get(contract.client_id)
    const vehicle = vehicleById.get(contract.vehicle_id)
    const startYmd = String(contract.start_at || '').slice(0, 10)
    const endYmd = String(contract.end_at || '').slice(0, 10)
    const billedDays = contractBillableDaysCount(startYmd, endYmd) ?? 1
    const totalPrice = Number(contract.total_price ?? 0)
    const dailyPrice = Number(vehicle?.daily_price ?? 0)
    const displayDaily = dailyPrice > 0 ? dailyPrice : billedDays > 0 ? Math.round((totalPrice / billedDays) * 100) / 100 : 0
    const displayTotal =
      dailyPrice > 0 ? Math.round(dailyPrice * billedDays) : totalPrice
    return {
      label: `${client?.full_name || app.entityClient} - ${vehicle ? `${vehicle.brand} ${vehicle.model}` : app.entityVehicle}`,
      clientName: client?.full_name || app.entityClient,
      vehicleName: vehicle ? `${vehicle.brand} ${vehicle.model}` : app.entityVehicle,
      status: statusLabelMap[contract.status as keyof typeof statusLabelMap] || contract.status,
      statusKey: contract.status === 'completed' ? 'done' : (contract.status as StatusFilter),
      type: (vehicle?.type || 'scooter') as VehicleTypeFilter,
      startAt: contract.start_at,
      endAt: contract.end_at,
      id: contract.id,
      clientId: contract.client_id,
      dailyPrice,
      totalPrice,
      billedDays,
      displayDaily,
      displayTotal,
      clientEmail: client?.email?.trim() || '',
      clientPhone: client?.phone?.trim() || '',
      vehicleBrand: vehicle?.brand?.trim() || '',
      vehicleModel: vehicle?.model?.trim() || '',
      licensePlate: vehicle?.license_plate?.trim() || '',
    }
  })
  const filteredContracts = contracts.filter((contract) => {
    const typeOk = selectedType === 'all' || contract.type === selectedType
    const statusOk = selectedStatus === 'all' || contract.statusKey === selectedStatus
    const searchHaystack = [
      contract.label,
      contract.clientName,
      contract.vehicleName,
      contract.vehicleBrand,
      contract.vehicleModel,
      contract.licensePlate,
      contract.status,
      contract.clientEmail,
      contract.clientPhone,
      String(contract.startAt || '').slice(0, 10),
      String(contract.endAt || '').slice(0, 10),
      contract.id,
    ].join(' ')
    const searchOk = matchesSearchQuery(searchHaystack, searchQuery)
    return typeOk && statusOk && searchOk
  })
  const buildInvoiceDoc = async (contract: (typeof filteredContracts)[number]) => {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' })
    const pageW = 210
    const margin = 18
    const contentW = pageW - margin * 2
    const fmtMoney = (n: number) =>
      n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const dateLong = (value: string) =>
      value
        ? new Date(value).toLocaleDateString('fr-FR', {
            day: '2-digit',
            month: 'long',
            year: 'numeric',
          })
        : '—'

    const startYmd = String(contract.startAt || '').slice(0, 10)
    const endYmd = String(contract.endAt || '').slice(0, 10)
    const billedDays = contractBillableDaysCount(startYmd, endYmd) ?? 1
    const lineDaily = Number(contract.dailyPrice ?? 0)
    const invoiceTotal =
      lineDaily > 0 ? Math.round(lineDaily * billedDays) : contract.totalPrice

    const companyName = invoiceProfile.companyName?.trim() || 'JLT - JUST LEASE TECH'
    const companyAddr = invoiceProfile.companyAddress?.trim() || '—'
    const companyPhone = invoiceProfile.companyPhone?.trim()

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    const addrLines = doc.splitTextToSize(companyAddr, 92)

    let y = margin
    const headerTop = y
    let logoBottom = headerTop

    const logoData = invoiceProfile.logoDataUrl
    if (logoData) {
      const dims = await pdfLoadImageDimensions(logoData)
      if (dims && dims.w > 0 && dims.h > 0) {
        const maxW = 52
        const maxH = 24
        const scale = Math.min(maxW / dims.w, maxH / dims.h)
        const lw = dims.w * scale
        const lh = dims.h * scale
        const lx = pageW - margin - lw
        try {
          doc.addImage(logoData, 'JPEG', lx, headerTop, lw, lh)
        } catch {
          try {
            doc.addImage(logoData, 'PNG', lx, headerTop, lw, lh)
          } catch {
            /* logo invalide */
          }
        }
        logoBottom = headerTop + lh + 1
      }
    }

    doc.setTextColor(15, 23, 42)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(16)
    doc.text(companyName, margin, headerTop + 6)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    doc.setTextColor(71, 85, 105)
    let ty = headerTop + 12
    doc.text(addrLines, margin, ty)
    ty += addrLines.length * 4.4
    if (companyPhone) {
      doc.text(`${app.fieldPhone}: ${companyPhone}`, margin, ty)
      ty += 5
    }

    y = Math.max(ty, logoBottom) + 7
    doc.setDrawColor(203, 213, 225)
    doc.setLineWidth(0.35)
    doc.line(margin, y, pageW - margin, y)
    y += 9

    doc.setTextColor(15, 23, 42)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(22)
    doc.text(app.invoiceTitle, margin, y)
    y += 9
    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(100, 116, 139)
    const invRef = contract.id.slice(0, 8).toUpperCase()
    doc.text(`${app.invoiceNumber}: ${invRef}`, margin, y)
    const issueStr = new Date().toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    })
    doc.text(`${app.invoiceIssueDate}: ${issueStr}`, pageW - margin, y, { align: 'right' })
    y += 11

    const pad = 5
    const issuerBody =
      6 +
      5 +
      addrLines.length * 4.4 +
      (companyPhone ? 5 : 0) +
      pad * 2
    doc.setFillColor(248, 250, 252)
    doc.setDrawColor(226, 232, 240)
    doc.rect(margin, y, contentW, issuerBody, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(15, 23, 42)
    doc.text(app.invoiceSectionIssuer, margin + pad, y + 7)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    doc.setTextColor(51, 65, 85)
    let iy = y + 13
    doc.text(companyName, margin + pad, iy)
    iy += 5
    doc.text(addrLines, margin + pad, iy)
    iy += addrLines.length * 4.4
    if (companyPhone) {
      doc.text(`${app.fieldPhone}: ${companyPhone}`, margin + pad, iy)
    }
    y += issuerBody + 7

    const clientParts: string[] = [contract.clientName]
    if (contract.clientEmail) clientParts.push(`${app.fieldEmail}: ${contract.clientEmail}`)
    if (contract.clientPhone) clientParts.push(`${app.fieldPhone}: ${contract.clientPhone}`)
    doc.setFontSize(9)
    let clientH = 13
    clientParts.forEach((line) => {
      const w = doc.splitTextToSize(line, contentW - pad * 2)
      clientH += w.length * 4.4
    })
    clientH += pad
    doc.setFillColor(255, 251, 235)
    doc.setDrawColor(253, 230, 138)
    doc.rect(margin, y, contentW, clientH, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(15, 23, 42)
    doc.text(app.invoiceSectionClient, margin + pad, y + 7)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    doc.setTextColor(51, 65, 85)
    let cy = y + 13
    clientParts.forEach((line) => {
      const wrapped = doc.splitTextToSize(line, contentW - pad * 2)
      doc.text(wrapped, margin + pad, cy)
      cy += wrapped.length * 4.4
    })
    y += clientH + 8

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(15, 23, 42)
    doc.text(app.invoiceSectionRental, margin, y)
    y += 8
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    doc.setTextColor(71, 85, 105)

    const rowLabelVal = (label: string, value: string) => {
      doc.setFont('helvetica', 'bold')
      doc.text(label, margin, y)
      doc.setFont('helvetica', 'normal')
      const valueX = margin + 72
      const vw = doc.splitTextToSize(value, pageW - margin - valueX)
      doc.text(vw, valueX, y)
      y += Math.max(6, vw.length * 4.2)
    }

    rowLabelVal(app.invoiceVehicle, contract.vehicleName)
    rowLabelVal(app.invoiceStartDate, dateLong(contract.startAt))
    rowLabelVal(app.invoiceEndDate, dateLong(contract.endAt))
    rowLabelVal(app.invoiceStatus, contract.status)

    y += 3
    doc.setDrawColor(226, 232, 240)
    doc.line(margin, y, pageW - margin, y)
    y += 8

    const tableTop = y
    doc.setFillColor(241, 245, 249)
    doc.rect(margin, y, contentW, 9, 'F')
    doc.setDrawColor(226, 232, 240)
    doc.rect(margin, tableTop, contentW, 22, 'S')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(15, 23, 42)
    doc.text(app.invoiceDays, margin + 3, y + 6)
    doc.text(app.fieldDailyPrice, margin + 52, y + 6)
    doc.text(`${app.invoiceTotal} (THB)`, pageW - margin - 3, y + 6, { align: 'right' })
    y += 11
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    doc.setTextColor(51, 65, 85)
    doc.text(String(billedDays), margin + 3, y + 5)
    doc.text(`${fmtMoney(lineDaily)}`, margin + 52, y + 5)
    doc.text(`${fmtMoney(invoiceTotal)}`, pageW - margin - 3, y + 5, { align: 'right' })
    y += 14

    doc.setFillColor(254, 243, 199)
    doc.setDrawColor(251, 191, 36)
    doc.setLineWidth(0.25)
    doc.rect(margin, y, contentW, 14, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(120, 53, 15)
    doc.text(`${app.invoiceTotal} THB`, margin + 5, y + 9)
    doc.text(`${fmtMoney(invoiceTotal)}`, pageW - margin - 5, y + 9, { align: 'right' })
    y += 22

    doc.setFont('helvetica', 'italic')
    doc.setFontSize(8.5)
    doc.setTextColor(148, 163, 184)
    const foot = doc.splitTextToSize(app.invoiceFooter, contentW)
    doc.text(foot, margin, Math.min(y, 268))

    const filename = `invoice-${invRef}.pdf`
    return { doc, filename }
  }
  const onOpenInvoicePdf = (contract: (typeof filteredContracts)[number]) => {
    setInvoiceFeedback('')
    void (async () => {
      const { doc } = await buildInvoiceDoc(contract)
      const blob = doc.output('blob')
      const blobUrl = URL.createObjectURL(blob)
      setInvoicePreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return blobUrl
      })
    })()
  }
  const onSendInvoiceEmail = async (contract: (typeof filteredContracts)[number]) => {
    setInvoiceFeedback('')
    const clientEmail = clientsData.find((client) => client.id === contract.clientId)?.email
    if (!clientEmail) {
      setInvoiceFeedback(app.invoiceMissingEmail)
      return
    }
    const {
      data: { session },
    } = await supabase.auth.getSession()
    const ownerId = session?.user?.id
    if (!ownerId) {
      setInvoiceFeedback(app.vehiclePhotoAuth)
      return
    }

    const { doc, filename } = await buildInvoiceDoc(contract)
    const pdfBlob = doc.output('blob')
    const filePath = `${ownerId}/contracts/${filename}`
    const { error: uploadError } = await supabase.storage
      .from('invoices')
      .upload(filePath, pdfBlob, {
        cacheControl: '3600',
        upsert: true,
        contentType: 'application/pdf',
      })
    if (uploadError) {
      setInvoiceFeedback(uploadError.message)
      return
    }
    const { data: signedData, error: signedError } = await supabase.storage
      .from('invoices')
      .createSignedUrl(filePath, 60 * 60 * 24 * 7)
    if (signedError || !signedData?.signedUrl) {
      setInvoiceFeedback(signedError?.message || app.vehiclePhotoError)
      return
    }
    const subject = encodeURIComponent(`${app.invoiceTitle} - ${contract.id.slice(0, 8).toUpperCase()}`)
    const body = encodeURIComponent(`${app.invoiceEmailBody}\n\n${signedData.signedUrl}`)
    window.location.href = `mailto:${encodeURIComponent(clientEmail)}?subject=${subject}&body=${body}`
    setInvoiceFeedback(app.invoiceEmailReady)
  }

  return (
    <div className="list">
      {filteredContracts.map((contract) => (
        <article key={contract.id} className="contract-row">
          <div>
            <h4>{contract.label}</h4>
            <p>
              {new Date(contract.startAt).toLocaleDateString('fr-FR')} -{' '}
              {new Date(contract.endAt).toLocaleDateString('fr-FR')}
            </p>
            <p className="contract-pricing-line">
              {app.contractPricingSummary
                .replace('{total}', String(contract.displayTotal))
                .replace('{days}', String(contract.billedDays))
                .replace('{daily}', String(contract.displayDaily))}
            </p>
            <div className="row-actions">
              <button type="button" onClick={() => void onEditContract(contract.id)}>
                  {app.edit}
              </button>
              <button type="button" onClick={() => void onDeleteContract(contract.id)}>
                  {app.delete}
              </button>
              <button type="button" onClick={() => onOpenInvoicePdf(contract)}>
                {app.invoicePdf}
              </button>
              <button type="button" onClick={() => void onSendInvoiceEmail(contract)}>
                {app.invoiceSendEmail}
              </button>
            </div>
          </div>
          <span className="pill">{contract.status}</span>
        </article>
      ))}
      {invoiceFeedback && <p className="vehicle-photo-feedback">{invoiceFeedback}</p>}
      {invoicePreviewUrl && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card" style={{ width: 'min(960px, 95vw)', height: 'min(88vh, 860px)' }}>
            <div className="row-between" style={{ marginBottom: '8px' }}>
              <h3>{app.invoiceTitle}</h3>
              <div className="row-actions">
                <a href={invoicePreviewUrl} download="invoice.pdf">
                  {app.invoicePdf}
                </a>
                <button
                  type="button"
                  onClick={() =>
                    setInvoicePreviewUrl((prev) => {
                      if (prev) URL.revokeObjectURL(prev)
                      return ''
                    })
                  }
                >
                  {app.cancel}
                </button>
              </div>
            </div>
            <iframe
              title="invoice-preview"
              src={invoicePreviewUrl}
              style={{ width: '100%', height: '100%', border: '1px solid #e5e7eb', borderRadius: '8px' }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function PlanningPage({
  app,
  searchQuery,
  contractsData,
  clientsData,
  vehiclesData,
  onEditContract,
  onDeleteContract,
}: {
  app: any
  searchQuery: string
  contractsData: ContractRow[]
  clientsData: ClientRow[]
  vehiclesData: VehicleRow[]
  onEditContract: (contractId: string) => Promise<void>
  onDeleteContract: (contractId: string) => Promise<void>
}) {
  const clientById = useMemo(
    () => new Map(clientsData.map((row) => [row.id, row])),
    [clientsData],
  )
  const vehicleById = useMemo(
    () => new Map(vehiclesData.map((row) => [row.id, row])),
    [vehiclesData],
  )

  const filteredContracts = useMemo(() => {
    return contractsData.filter((contract) => {
      const client = clientById.get(contract.client_id)
      const vehicle = vehicleById.get(contract.vehicle_id)
      const vehicleLabel = vehicle ? `${vehicle.brand} ${vehicle.model}`.trim() : ''
      const searchHaystack = [
        client?.full_name?.trim() || '',
        vehicle?.brand?.trim() || '',
        vehicle?.model?.trim() || '',
        vehicleLabel,
        vehicle?.license_plate?.trim() || '',
        client?.email?.trim() || '',
        client?.phone?.trim() || '',
        contract.id,
        String(contract.start_at || '').slice(0, 10),
        String(contract.end_at || '').slice(0, 10),
      ].join(' ')
      return matchesSearchQuery(searchHaystack, searchQuery)
    })
  }, [contractsData, clientById, vehicleById, searchQuery])

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  const startWeekDay = (monthStart.getDay() + 6) % 7
  const totalDays = monthEnd.getDate()
  const cells = Array.from({ length: 35 }).map((_, index) => {
    const day = index - startWeekDay + 1
    const inMonth = day >= 1 && day <= totalDays
    const date = inMonth
      ? new Date(now.getFullYear(), now.getMonth(), day).toISOString().slice(0, 10)
      : null
    const hasContract =
      !!date &&
      filteredContracts.some((contract) => {
        const start = contract.start_at.slice(0, 10)
        const end = contract.end_at.slice(0, 10)
        return date >= start && date <= end
      })
    return { day, inMonth, hasContract }
  })
  return (
    <>
      <section className="calendar">
        {cells.map((cell, index) => (
          <div
            key={index}
            className={`day${cell.hasContract ? ' highlight' : ''}${cell.inMonth ? '' : ' day-off'}`}
          >
            {cell.inMonth ? cell.day : ''}
          </div>
        ))}
      </section>
      <div className="list" style={{ marginTop: '10px' }}>
        {filteredContracts.map((contract) => {
          const client = clientById.get(contract.client_id)
          const vehicle = vehicleById.get(contract.vehicle_id)
          const label = `${client?.full_name?.trim() || app.entityClient} — ${vehicle ? `${vehicle.brand} ${vehicle.model}`.trim() : app.entityVehicle}`
          return (
            <article key={contract.id} className="contract-row">
              <div>
                <h4>{label}</h4>
                <p className="planning-contract-ref">{contract.id.slice(0, 8).toUpperCase()}</p>
                <p>
                  {new Date(contract.start_at).toLocaleDateString('fr-FR')} -{' '}
                  {new Date(contract.end_at).toLocaleDateString('fr-FR')}
                </p>
                <div className="row-actions">
                  <button type="button" onClick={() => void onEditContract(contract.id)}>
                    {app.edit}
                  </button>
                  <button type="button" onClick={() => void onDeleteContract(contract.id)}>
                    {app.delete}
                  </button>
                </div>
              </div>
              <span className="pill">{contract.status}</span>
            </article>
          )
        })}
      </div>
    </>
  )
}

function AbonnementPage({
  app,
  currentSubscription,
  pendingCheckoutCode,
  onStartCheckout,
  testModeEnabled,
}: {
  app: any
  currentSubscription: BillingSubscriptionRow | null
  pendingCheckoutCode: string
  onStartCheckout: (planCode: string) => Promise<void>
  testModeEnabled: boolean
}) {
  const plans = [
    {
      code: 'stripe_monthly_auto_990',
      title: app.billingPlanStripeMonthlyTitle,
      amount: '990 baths',
      description: app.billingPlanStripeMonthlyDesc,
    },
    {
      code: 'promptpay_monthly_990',
      title: app.billingPlanPromptPayMonthlyTitle,
      amount: '990 baths',
      description: app.billingPlanPromptPayMonthlyDesc,
    },
    {
      code: 'promptpay_yearly_9900',
      title: app.billingPlanPromptPayYearlyTitle,
      amount: '9900 baths',
      description: app.billingPlanPromptPayYearlyDesc,
    },
  ]

  return (
    <div className="plans">
      {testModeEnabled && (
        <article className="plan active">
          <h4>{app.billingTestModeTitle}</h4>
          <p>{app.billingTestModeDesc}</p>
        </article>
      )}
      {currentSubscription && (
        <article className="plan active">
          <h4>{app.billingCurrentPlan}</h4>
          <strong>{currentSubscription.plan_code}</strong>
          <p>
            {app.billingAccessUntil}: {new Date(currentSubscription.current_period_end).toLocaleDateString('fr-FR')}
          </p>
        </article>
      )}
      {plans.map((plan) => (
        <article key={plan.code} className="plan">
          <h4>{plan.title}</h4>
          <strong>{plan.amount}</strong>
          <p>{plan.description}</p>
          <button
            type="button"
            className="accent-btn"
            onClick={() => void onStartCheckout(plan.code)}
            disabled={pendingCheckoutCode === plan.code}
          >
            {pendingCheckoutCode === plan.code ? '...' : app.billingPayNow}
          </button>
        </article>
      ))}
    </div>
  )
}

function renderSection(
  section: string,
  app: any,
  selectedType: VehicleTypeFilter,
  selectedStatus: StatusFilter,
  searchQuery: string,
  vehiclesData: VehicleRow[],
  revisionsData: VehicleRevisionRow[],
  invoiceProfile: InvoiceProfile,
  clientsData: ClientRow[],
  contractsData: ContractRow[],
  currentSubscription: BillingSubscriptionRow | null,
  pendingCheckoutCode: string,
  onStartCheckout: (planCode: string) => Promise<void>,
  testModeEnabled: boolean,
  onEditVehicle: (vehicleId: string) => Promise<void>,
  onDeleteVehicle: (vehicleId: string) => Promise<void>,
  onCreateRevision: (payload: {
    vehicle_id: string
    due_date: string
    status: 'scheduled' | 'done' | 'overdue'
    note: string
  }) => Promise<void>,
  onUpdateRevisionStatus: (
    revisionId: string,
    status: 'scheduled' | 'done' | 'overdue',
  ) => Promise<void>,
  onDeleteRevision: (revisionId: string) => Promise<void>,
  onEditClient: (clientId: string) => Promise<void>,
  onDeleteClient: (clientId: string) => Promise<void>,
  onEditContract: (contractId: string) => Promise<void>,
  onDeleteContract: (contractId: string) => Promise<void>,
  passportUrlsByClientId: Record<string, string>,
  onOpenPassportViewer: (url: string, title: string) => void,
) {
  switch (section) {
    case 'vehicules':
      return (
        <VehiculesPage
          app={app}
          selectedType={selectedType}
          selectedStatus={selectedStatus}
          searchQuery={searchQuery}
          vehiclesData={vehiclesData}
          revisionsData={revisionsData}
          onCreateRevision={onCreateRevision}
          onUpdateRevisionStatus={onUpdateRevisionStatus}
          onDeleteRevision={onDeleteRevision}
          onEditVehicle={onEditVehicle}
          onDeleteVehicle={onDeleteVehicle}
        />
      )
    case 'clients':
      return (
        <ClientsPage
          app={app}
          clientsData={clientsData}
          searchQuery={searchQuery}
          passportUrlsByClientId={passportUrlsByClientId}
          onOpenPassportViewer={onOpenPassportViewer}
          onEditClient={onEditClient}
          onDeleteClient={onDeleteClient}
        />
      )
    case 'contrats':
      return (
        <ContratsPage
          app={app}
          selectedType={selectedType}
          selectedStatus={selectedStatus}
          searchQuery={searchQuery}
          contractsData={contractsData}
          clientsData={clientsData}
          vehiclesData={vehiclesData}
          invoiceProfile={invoiceProfile}
          onEditContract={onEditContract}
          onDeleteContract={onDeleteContract}
        />
      )
    case 'planning':
      return (
        <PlanningPage
          app={app}
          searchQuery={searchQuery}
          contractsData={contractsData}
          clientsData={clientsData}
          vehiclesData={vehiclesData}
          onEditContract={onEditContract}
          onDeleteContract={onDeleteContract}
        />
      )
    case 'abonnement':
      return (
        <AbonnementPage
          app={app}
          currentSubscription={currentSubscription}
          pendingCheckoutCode={pendingCheckoutCode}
          onStartCheckout={onStartCheckout}
          testModeEnabled={testModeEnabled}
        />
      )
    default:
      return (
        <DashboardHome
          app={app}
          selectedType={selectedType}
          selectedStatus={selectedStatus}
          vehiclesData={vehiclesData}
          clientsData={clientsData}
          contractsData={contractsData}
          revisionsData={revisionsData}
        />
      )
  }
}

export function DashboardShell() {
  const { locale, setLocale, t } = useI18n()
  const app = t('app')
  const d = app.dashboard
  const { section = 'dashboard' } = useParams()
  const [selectedType, setSelectedType] = useState<VehicleTypeFilter>('all')
  const [selectedStatus, setSelectedStatus] = useState<StatusFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [vehiclesData, setVehiclesData] = useState<VehicleRow[]>([])
  const [revisionsData, setRevisionsData] = useState<VehicleRevisionRow[]>([])
  const [invoiceProfile, setInvoiceProfile] = useState<InvoiceProfile>(readInvoiceProfileFromStorage)
  const [invoiceProfileDraft, setInvoiceProfileDraft] =
    useState<InvoiceProfile>(readInvoiceProfileFromStorage)
  const [invoiceProfileOpen, setInvoiceProfileOpen] = useState(false)
  const [clientsData, setClientsData] = useState<ClientRow[]>([])
  const [contractsData, setContractsData] = useState<ContractRow[]>([])
  const [currentSubscription, setCurrentSubscription] = useState<BillingSubscriptionRow | null>(null)
  const [pendingCheckoutCode, setPendingCheckoutCode] = useState('')
  const [testModeEnabled, setTestModeEnabled] = useState(true)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [editModal, setEditModal] = useState<EditModalState | null>(null)
  const [modalVehiclePhoto, setModalVehiclePhoto] = useState<File | null>(null)
  const [modalClientPassportPhoto, setModalClientPassportPhoto] = useState<File | null>(null)
  const [clientPassportPreviewUrl, setClientPassportPreviewUrl] = useState<string | null>(null)
  const [passportLocalPreviewUrl, setPassportLocalPreviewUrl] = useState<string | null>(null)
  const [modalInspectionPhotos, setModalInspectionPhotos] = useState<File[]>([])
  const [savingModal, setSavingModal] = useState(false)
  const [modalError, setModalError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [clientPassportListUrls, setClientPassportListUrls] = useState<Record<string, string>>({})
  const [passportViewer, setPassportViewer] = useState<{ url: string; title: string } | null>(null)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const notificationsRef = useRef<HTMLDivElement>(null)
  const modalFileInputRef = useRef<HTMLInputElement>(null)
  const currentIndex = Math.max(0, menuMeta.findIndex((item) => item.key === section))
  const refreshAppData = async () => {
    setLoadError('')
    const {
      data: { session },
    } = await supabase.auth.getSession()
    const ownerId = session?.user?.id
    if (!ownerId) return
    setCurrentUserId(ownerId)

    const [vehiclesRes, clientsRes, contractsRes, revisionsRes, subscriptionRes] = await Promise.all([
      supabase.from('vehicles').select('id,type,brand,model,status,daily_price'),
      supabase
        .from('clients')
        .select(
          'id,full_name,phone,email,passport_number,nationality,passport_photo_path,notes,deposit_amount',
        ),
      supabase.from('contracts').select('id,client_id,vehicle_id,start_at,end_at,total_price,status,created_at'),
      supabase
        .from('vehicle_revisions')
        .select('id,vehicle_id,due_date,status,note,created_at')
        .eq('owner_id', ownerId),
      supabase
        .from('billing_subscriptions')
        .select('id,plan_code,provider,status,current_period_start,current_period_end,auto_renew')
        .eq('owner_id', ownerId)
        .in('status', ['active', 'trialing'])
        .order('current_period_end', { ascending: false })
        .limit(1),
    ])

    if (!vehiclesRes.error && vehiclesRes.data) setVehiclesData(vehiclesRes.data as VehicleRow[])
    if (!clientsRes.error && clientsRes.data) setClientsData(clientsRes.data as ClientRow[])
    if (!contractsRes.error && contractsRes.data) setContractsData(contractsRes.data as ContractRow[])
    if (!revisionsRes.error && revisionsRes.data) {
      setRevisionsData(revisionsRes.data as VehicleRevisionRow[])
    }
    if (!subscriptionRes.error && subscriptionRes.data?.length) {
      setCurrentSubscription(subscriptionRes.data[0] as BillingSubscriptionRow)
    } else {
      setCurrentSubscription(null)
    }
    const isMissingBillingTableError =
      !!subscriptionRes.error &&
      (subscriptionRes.error.message.toLowerCase().includes('does not exist') ||
        subscriptionRes.error.message.toLowerCase().includes("could not find the table") ||
        subscriptionRes.error.message.toLowerCase().includes('billing_subscriptions'))
    const firstError =
      vehiclesRes.error?.message ||
      clientsRes.error?.message ||
      contractsRes.error?.message ||
      (revisionsRes.error &&
      !revisionsRes.error.message.toLowerCase().includes('does not exist')
        ? revisionsRes.error.message
        : '') ||
      (subscriptionRes.error && !isMissingBillingTableError
        ? subscriptionRes.error.message
        : '') ||
      ''
    if (firstError) setLoadError(firstError)
  }
  useEffect(() => {
    let cancelled = false
    const bootstrap = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!cancelled && !session?.user && isPublicDemoMode) {
        const { error: anonError } = await supabase.auth.signInAnonymously()
        if (anonError && !cancelled) {
          setLoadError(anonError.message)
          return
        }
      }
      if (!cancelled) await refreshAppData()
    }
    void bootstrap()
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
        void refreshAppData()
      }
    })
    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const entries = await Promise.all(
        clientsData.map(async (c) => {
          const p = c.passport_photo_path?.trim()
          if (!p) return null
          const { data, error } = await supabase.storage
            .from(clientPassportPhotosBucket)
            .createSignedUrl(p, 3600)
          if (error || !data?.signedUrl) return null
          return [c.id, data.signedUrl] as const
        }),
      )
      if (cancelled) return
      const next: Record<string, string> = {}
      for (const row of entries) {
        if (row) next[row[0]] = row[1]
      }
      setClientPassportListUrls(next)
    })()
    return () => {
      cancelled = true
    }
  }, [clientsData])

  useEffect(() => {
    if (!passportViewer) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPassportViewer(null)
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      document.removeEventListener('keydown', onKey)
    }
  }, [passportViewer])

  const passportPreviewRevokeRef = useRef<string | null>(null)
  useEffect(() => {
    if (!modalClientPassportPhoto) {
      if (passportPreviewRevokeRef.current) {
        URL.revokeObjectURL(passportPreviewRevokeRef.current)
        passportPreviewRevokeRef.current = null
      }
      setPassportLocalPreviewUrl(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const compressed = await compressImageFile(modalClientPassportPhoto)
        if (cancelled) return
        if (passportPreviewRevokeRef.current) URL.revokeObjectURL(passportPreviewRevokeRef.current)
        const u = URL.createObjectURL(compressed)
        passportPreviewRevokeRef.current = u
        setPassportLocalPreviewUrl(u)
      } catch {
        if (cancelled) return
        if (passportPreviewRevokeRef.current) URL.revokeObjectURL(passportPreviewRevokeRef.current)
        const u = URL.createObjectURL(modalClientPassportPhoto)
        passportPreviewRevokeRef.current = u
        setPassportLocalPreviewUrl(u)
      }
    })()
    return () => {
      cancelled = true
      if (passportPreviewRevokeRef.current) {
        URL.revokeObjectURL(passportPreviewRevokeRef.current)
        passportPreviewRevokeRef.current = null
      }
    }
  }, [modalClientPassportPhoto])

  useEffect(() => {
    if (editModal?.kind !== 'client' || editModal.mode !== 'edit') {
      setClientPassportPreviewUrl(null)
      return
    }
    const path = String(editModal.values.passport_photo_path || '').trim()
    if (!path) {
      setClientPassportPreviewUrl(null)
      return
    }
    let cancelled = false
    void (async () => {
      const { data, error } = await supabase.storage
        .from(clientPassportPhotosBucket)
        .createSignedUrl(path, 3600)
      if (!cancelled && !error && data?.signedUrl) setClientPassportPreviewUrl(data.signedUrl)
    })()
    return () => {
      cancelled = true
    }
  }, [editModal?.kind, editModal?.mode, editModal?.id, editModal?.values?.passport_photo_path])

  useEffect(() => {
    if (isPublicDemoMode) {
      setTestModeEnabled(true)
      return
    }
    const stored = localStorage.getItem('jlt-test-mode')
    if (stored === 'false') setTestModeEnabled(false)
  }, [])

  useEffect(() => {
    if (!notificationsOpen) return
    const onDocPointerDown = (e: PointerEvent) => {
      if (notificationsRef.current && !notificationsRef.current.contains(e.target as Node)) {
        setNotificationsOpen(false)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNotificationsOpen(false)
    }
    document.addEventListener('pointerdown', onDocPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [notificationsOpen])

  const onGlobalInvoiceLogoChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const compressedLogo = await compressImageFile(file)
    const dataUrl = await fileToDataUrl(compressedLogo).catch(() => '')
    if (!dataUrl) return
    setInvoiceProfileDraft((prev) => ({ ...prev, logoDataUrl: dataUrl }))
  }
  const onSaveInvoiceProfile = () => {
    setInvoiceProfile(invoiceProfileDraft)
    localStorage.setItem('jlt-invoice-profile', JSON.stringify(invoiceProfileDraft))
    setInvoiceProfileOpen(false)
  }

  const closeModal = () => {
    setEditModal(null)
    setModalVehiclePhoto(null)
    setModalClientPassportPhoto(null)
    setClientPassportPreviewUrl(null)
    setPassportLocalPreviewUrl(null)
    setModalInspectionPhotos([])
    setModalError('')
  }

  const onDeleteVehicle = async (vehicleId: string) => {
    if (!window.confirm(app.confirmDeleteVehicle)) return
    const { error } = await supabase.from('vehicles').delete().eq('id', vehicleId)
    if (!error) await refreshAppData()
  }

  const onEditVehicle = async (vehicleId: string) => {
    const row = vehiclesData.find((item) => item.id === vehicleId)
    if (!row) return
    setModalVehiclePhoto(null)
    setEditModal({
      mode: 'edit',
      kind: 'vehicle',
      id: vehicleId,
      values: {
        brand: row.brand,
        model: row.model,
        daily_price: String(row.daily_price ?? 0),
        status: row.status,
        type: row.type,
      },
    })
  }

  const onCreateRevision = async (payload: {
    vehicle_id: string
    due_date: string
    status: 'scheduled' | 'done' | 'overdue'
    note: string
  }) => {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    const ownerId = currentUserId || session?.user?.id
    if (!ownerId) return
    const { error } = await supabase.from('vehicle_revisions').insert({
      owner_id: ownerId,
      vehicle_id: payload.vehicle_id,
      due_date: payload.due_date,
      status: payload.status,
      note: payload.note || null,
    })
    if (!error) await refreshAppData()
  }

  const onUpdateRevisionStatus = async (
    revisionId: string,
    status: 'scheduled' | 'done' | 'overdue',
  ) => {
    const { error } = await supabase.from('vehicle_revisions').update({ status }).eq('id', revisionId)
    if (!error) await refreshAppData()
  }

  const onDeleteRevision = async (revisionId: string) => {
    const { error } = await supabase.from('vehicle_revisions').delete().eq('id', revisionId)
    if (!error) await refreshAppData()
  }

  const onStartCheckout = async (planCode: string) => {
    setPendingCheckoutCode(planCode)
    const payload = {
      planCode,
      successUrl: `${window.location.origin}/app/abonnement`,
      cancelUrl: `${window.location.origin}/app/abonnement`,
      locale,
    }
    const { data, error } = await supabase.functions.invoke('create-checkout-session', {
      body: payload,
    })
    setPendingCheckoutCode('')
    if (error) {
      setLoadError(error.message)
      return
    }
    if (data?.url) {
      window.location.href = data.url
      return
    }
    if (data?.checkoutUrl) {
      window.location.href = data.checkoutUrl
      return
    }
    setLoadError('Checkout URL missing')
  }

  const onDeleteClient = async (clientId: string) => {
    if (!window.confirm(app.confirmDeleteClient)) return
    const { error } = await supabase.from('clients').delete().eq('id', clientId)
    if (!error) await refreshAppData()
  }

  const onEditClient = async (clientId: string) => {
    const row = clientsData.find((item) => item.id === clientId)
    if (!row) return
    setModalClientPassportPhoto(null)
    setEditModal({
      mode: 'edit',
      kind: 'client',
      id: clientId,
      values: {
        full_name: row.full_name,
        phone: row.phone || '',
        email: row.email || '',
        passport_number: row.passport_number || '',
        nationality: row.nationality || '',
        passport_photo_path: row.passport_photo_path || '',
        notes: row.notes || '',
        deposit_amount: row.deposit_amount != null ? String(row.deposit_amount) : '',
      },
    })
  }

  const onDeleteContract = async (contractId: string) => {
    if (!window.confirm(app.confirmDeleteContract)) return
    const { error } = await supabase.from('contracts').delete().eq('id', contractId)
    if (!error) await refreshAppData()
  }

  const onEditContract = async (contractId: string) => {
    const row = contractsData.find((item) => item.id === contractId)
    if (!row) return
    const normalizedStart = row.start_at ? String(row.start_at).slice(0, 10) : ''
    const normalizedEnd = row.end_at ? String(row.end_at).slice(0, 10) : ''
    const days = contractBillableDaysCount(normalizedStart, normalizedEnd) ?? 1
    const total = Number(row.total_price ?? 0)
    const vehicle = vehiclesData.find((item) => item.id === row.vehicle_id)
    const dailyFromVehicle = Number(vehicle?.daily_price ?? 0)
    const dailyDerived =
      dailyFromVehicle > 0
        ? dailyFromVehicle
        : days > 0
          ? Math.round((total / days) * 100) / 100
          : total
    setEditModal({
      mode: 'edit',
      kind: 'contract',
      id: contractId,
      values: {
        client_id: row.client_id || '',
        vehicle_id: row.vehicle_id || '',
        daily_price: String(dailyDerived),
        start_at: normalizedStart,
        end_at: normalizedEnd,
        status: row.status,
      },
    })
  }

  const onSubmitEditModal = async () => {
    if (!editModal) return
    setModalError('')
    const isEmailValid = (value: string) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    const isPositive = (value: string) => Number(value || 0) > 0

    if (editModal.kind === 'vehicle') {
      if (!editModal.values.brand || !editModal.values.model) {
        setModalError(app.validationRequired)
        return
      }
      if (!isPositive(editModal.values.daily_price)) {
        setModalError(app.validationPricePositive)
        return
      }
    }
    if (editModal.kind === 'client') {
      if (!editModal.values.full_name) {
        setModalError(app.validationRequired)
        return
      }
      if (!isEmailValid(editModal.values.email || '')) {
        setModalError(app.validationEmailInvalid)
        return
      }
      const dep = parseClientDeposit(editModal.values.deposit_amount || '')
      if (dep.invalid) {
        setModalError(app.validationDepositInvalid)
        return
      }
    }
    if (editModal.kind === 'contract') {
      if (!editModal.values.client_id || !editModal.values.vehicle_id) {
        setModalError(app.validationContractRefsRequired)
        return
      }
      const start = new Date(editModal.values.start_at || '')
      const end = new Date(editModal.values.end_at || '')
      if (Number.isNaN(+start) || Number.isNaN(+end) || end <= start) {
        setModalError(app.contractDateError)
        return
      }
      if (contractBillableDaysCount(editModal.values.start_at, editModal.values.end_at) === null) {
        setModalError(app.contractDateError)
        return
      }
      if (!isPositive(editModal.values.daily_price)) {
        setModalError(app.validationPricePositive)
        return
      }
    }
    if (editModal.kind === 'pricing') {
      if (!editModal.values.label) {
        setModalError(app.validationRequired)
        return
      }
      if (
        !isPositive(editModal.values.day_rate) ||
        !isPositive(editModal.values.week_rate) ||
        !isPositive(editModal.values.month_rate)
      ) {
        setModalError(app.validationPricePositive)
        return
      }
    }
    setSavingModal(true)
    let requestError: string | null = null
    try {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    const ownerId = currentUserId || session?.user?.id || null

    if (editModal.mode === 'create' && !ownerId) {
      setModalError(app.vehiclePhotoAuth)
      return
    }

    if (editModal.kind === 'vehicle' && editModal.mode === 'edit') {
      const { error } = await supabase
        .from('vehicles')
        .update({
          brand: editModal.values.brand,
          model: editModal.values.model,
          daily_price: Number(editModal.values.daily_price || 0),
          status: editModal.values.status as VehicleRow['status'],
          type: editModal.values.type as VehicleRow['type'],
        })
        .eq('id', editModal.id)
      if (error) requestError = error.message
    }
    if (editModal.kind === 'client' && editModal.mode === 'edit') {
      const depositVal = parseClientDeposit(editModal.values.deposit_amount || '').value
      const { error } = await supabase
        .from('clients')
        .update({
          full_name: editModal.values.full_name,
          phone: editModal.values.phone || null,
          email: editModal.values.email || null,
          passport_number: (editModal.values.passport_number || '').trim() || null,
          nationality: (editModal.values.nationality || '').trim() || null,
          notes: (editModal.values.notes || '').trim() || null,
          deposit_amount: depositVal,
        })
        .eq('id', editModal.id)
      if (error) requestError = error.message
      else if (!requestError && modalClientPassportPhoto && ownerId) {
        const compressed = await compressImageFile(modalClientPassportPhoto)
        const ext = compressed.name.split('.').pop() || 'jpg'
        const fileName = `passport-${Date.now()}.${ext}`
        const filePath = buildClientPassportPhotoPath({
          isPublicDemo: isPublicDemoMode,
          userId: ownerId,
          clientId: editModal.id,
          fileName,
        })
        const { error: upErr } = await supabase.storage
          .from(clientPassportPhotosBucket)
          .upload(filePath, compressed, {
            cacheControl: '3600',
            upsert: true,
            contentType: compressed.type || 'image/jpeg',
          })
        if (upErr) requestError = upErr.message
        else {
          const { error: upDb } = await supabase
            .from('clients')
            .update({ passport_photo_path: filePath })
            .eq('id', editModal.id)
          if (upDb) requestError = upDb.message
        }
      }
    }
    if (editModal.kind === 'contract' && editModal.mode === 'edit') {
      const selectedClient = clientsData.find((client) => client.id === editModal.values.client_id)
      const selectedVehicle = vehiclesData.find((vehicle) => vehicle.id === editModal.values.vehicle_id)
      const contractDays = contractBillableDaysCount(editModal.values.start_at, editModal.values.end_at) ?? 1
      const contractTotalPrice = Math.round(Number(editModal.values.daily_price || 0) * contractDays)
      const fullPayload = {
        client_id: editModal.values.client_id,
        vehicle_id: editModal.values.vehicle_id,
        client_name: selectedClient?.full_name || '',
        vehicle_label: selectedVehicle
          ? `${selectedVehicle.brand} ${selectedVehicle.model}`.trim()
          : '',
        total_price: contractTotalPrice,
        start_at: editModal.values.start_at,
        end_at: editModal.values.end_at,
        status: editModal.values.status as ContractRow['status'],
      }
      let { error } = await supabase.from('contracts').update(fullPayload).eq('id', editModal.id)
      if (
        error &&
        (error.message.includes('schema cache') ||
          error.message.includes('column') ||
          error.message.includes('client_name') ||
          error.message.includes('vehicle_label'))
      ) {
        const fallbackPayload = {
          client_id: editModal.values.client_id,
          vehicle_id: editModal.values.vehicle_id,
          total_price: contractTotalPrice,
          start_at: editModal.values.start_at,
          end_at: editModal.values.end_at,
          status: editModal.values.status as ContractRow['status'],
        }
        const fallbackRes = await supabase
          .from('contracts')
          .update(fallbackPayload)
          .eq('id', editModal.id)
        error = fallbackRes.error
      }
      if (error) requestError = error.message
    }
    if (editModal.kind === 'vehicle' && editModal.mode === 'create' && ownerId) {
      const vehiclePayload = {
        owner_id: ownerId,
        brand: editModal.values.brand,
        model: editModal.values.model,
        type: editModal.values.type as VehicleRow['type'],
        status: (editModal.values.status || 'available') as VehicleRow['status'],
        daily_price: Number(editModal.values.daily_price || 0),
      }
      const { data: createdVehicle, error: createVehicleError } = await supabase
        .from('vehicles')
        .insert(vehiclePayload)
        .select('id,brand,model')
        .single()
      if (createVehicleError) {
        requestError = createVehicleError.message
      } else if (modalVehiclePhoto && createdVehicle) {
        const compressedPhoto = await compressImageFile(modalVehiclePhoto)
        const extension = compressedPhoto.name.split('.').pop() || 'jpg'
        const fileName = `${Date.now()}.${extension}`
        const filePath = buildVehiclePhotoStoragePath({
          isPublicDemo: isPublicDemoMode,
          userId: ownerId,
          vehicleId: createdVehicle.id,
          fileName,
        })
        const { error: uploadError } = await supabase.storage
          .from(vehiclePhotosBucket)
          .upload(filePath, compressedPhoto, {
            cacheControl: '3600',
            upsert: false,
            contentType: compressedPhoto.type || 'image/jpeg',
          })
        if (uploadError) {
          requestError = uploadError.message
        } else {
          const vehicleLabel = normalizeVehicleLabel(
            `${createdVehicle.brand} ${createdVehicle.model}`.trim(),
          )
          const { error: photoInsertError } = await supabase.from('vehicle_photos').insert({
            owner_id: ownerId,
            vehicle_id: createdVehicle.id,
            vehicle_label: vehicleLabel,
            file_path: filePath,
          })
          if (photoInsertError) requestError = photoInsertError.message
        }
      }
    }
    if (editModal.kind === 'client' && editModal.mode === 'create' && ownerId) {
      const depositVal = parseClientDeposit(editModal.values.deposit_amount || '').value
      const baseInsert = {
        owner_id: ownerId,
        full_name: editModal.values.full_name,
        phone: editModal.values.phone || null,
        email: editModal.values.email || null,
      }
      const passportOnlyInsert = {
        ...baseInsert,
        passport_number: (editModal.values.passport_number || '').trim() || null,
        nationality: (editModal.values.nationality || '').trim() || null,
      }
      const extendedInsert = {
        ...passportOnlyInsert,
        notes: (editModal.values.notes || '').trim() || null,
        deposit_amount: depositVal,
      }
      const isSchemaish = (msg: string) =>
        msg.includes('column') ||
        msg.includes('schema') ||
        msg.includes('passport') ||
        msg.includes('nationality') ||
        msg.includes('notes') ||
        msg.includes('deposit') ||
        msg.includes('Could not find')
      let { data: createdClient, error } = await supabase
        .from('clients')
        .insert(extendedInsert)
        .select('id')
        .single()
      if (error && isSchemaish(error.message)) {
        const retry = await supabase.from('clients').insert(passportOnlyInsert).select('id').single()
        createdClient = retry.data
        error = retry.error
      }
      if (error && isSchemaish(error.message)) {
        const retry2 = await supabase.from('clients').insert(baseInsert).select('id').single()
        createdClient = retry2.data
        error = retry2.error
      }
      if (error) requestError = error.message
      else if (createdClient?.id && modalClientPassportPhoto && !requestError) {
        const compressed = await compressImageFile(modalClientPassportPhoto)
        const ext = compressed.name.split('.').pop() || 'jpg'
        const fileName = `passport-${Date.now()}.${ext}`
        const filePath = buildClientPassportPhotoPath({
          isPublicDemo: isPublicDemoMode,
          userId: ownerId,
          clientId: createdClient.id,
          fileName,
        })
        const { error: upErr } = await supabase.storage
          .from(clientPassportPhotosBucket)
          .upload(filePath, compressed, {
            cacheControl: '3600',
            upsert: true,
            contentType: compressed.type || 'image/jpeg',
          })
        if (upErr) requestError = upErr.message
        else {
          const { error: upDb } = await supabase
            .from('clients')
            .update({ passport_photo_path: filePath })
            .eq('id', createdClient.id)
          if (upDb) requestError = upDb.message
        }
      }
    }
    if (editModal.kind === 'contract' && editModal.mode === 'create' && ownerId) {
      const selectedClient = clientsData.find((client) => client.id === editModal.values.client_id)
      const selectedVehicle = vehiclesData.find((vehicle) => vehicle.id === editModal.values.vehicle_id)
      const contractDays = contractBillableDaysCount(editModal.values.start_at, editModal.values.end_at) ?? 1
      const contractTotalPrice = Math.round(Number(editModal.values.daily_price || 0) * contractDays)
      const fullPayload = {
        owner_id: ownerId,
        client_id: editModal.values.client_id,
        vehicle_id: editModal.values.vehicle_id,
        client_name: selectedClient?.full_name || '',
        vehicle_label: selectedVehicle
          ? `${selectedVehicle.brand} ${selectedVehicle.model}`.trim()
          : '',
        start_at: editModal.values.start_at,
        end_at: editModal.values.end_at,
        total_price: contractTotalPrice,
        status: (editModal.values.status || 'draft') as ContractRow['status'],
      }
      let { data: createdContract, error } = await supabase
        .from('contracts')
        .insert(fullPayload)
        .select('id')
        .single()
      if (
        error &&
        (error.message.includes('schema cache') ||
          error.message.includes('column') ||
          error.message.includes('client_name') ||
          error.message.includes('vehicle_label'))
      ) {
        const fallbackPayload = {
          owner_id: ownerId,
          client_id: editModal.values.client_id,
          vehicle_id: editModal.values.vehicle_id,
          start_at: editModal.values.start_at,
          end_at: editModal.values.end_at,
          total_price: contractTotalPrice,
          status: (editModal.values.status || 'draft') as ContractRow['status'],
        }
        const fallbackRes = await supabase.from('contracts').insert(fallbackPayload).select('id').single()
        createdContract = fallbackRes.data
        error = fallbackRes.error
      }
      if (error) requestError = error.message
      else if (createdContract?.id) {
        const notesTrim = (editModal.values.inspection_notes || '').trim()
        const needsInspection = notesTrim.length > 0 || modalInspectionPhotos.length > 0
        if (needsInspection) {
          const vehicleId = editModal.values.vehicle_id
          let inspRes = await supabase
            .from('inspections')
            .insert({
              owner_id: ownerId,
              contract_id: createdContract.id,
              vehicle_id: vehicleId,
              stage: 'checkout',
              damage_flag: false,
              notes: notesTrim || null,
            })
            .select('id')
            .single()
          if (
            inspRes.error &&
            (inspRes.error.message.includes('column') ||
              inspRes.error.message.includes('schema') ||
              inspRes.error.message.includes('vehicle_id') ||
              inspRes.error.message.includes('stage') ||
              inspRes.error.message.includes('damage'))
          ) {
            inspRes = await supabase
              .from('inspections')
              .insert({
                owner_id: ownerId,
                contract_id: createdContract.id,
                notes: notesTrim || null,
              })
              .select('id')
              .single()
          }
          if (inspRes.error) {
            requestError = inspRes.error.message
          } else {
            const inspectionId = inspRes.data?.id
            if (inspectionId && modalInspectionPhotos.length > 0) {
              for (let i = 0; i < modalInspectionPhotos.length; i++) {
                const compressed = await compressImageFile(modalInspectionPhotos[i])
                const extension = compressed.name.split('.').pop() || 'jpg'
                const filePath = `${ownerId}/${createdContract.id}/${inspectionId}/${Date.now()}-${i}.${extension}`
                const { error: uploadError } = await supabase.storage
                  .from('inspection-photos')
                  .upload(filePath, compressed, {
                    cacheControl: '3600',
                    upsert: false,
                    contentType: compressed.type || 'image/jpeg',
                  })
                if (uploadError) {
                  requestError = uploadError.message
                  break
                }
                const { error: photoInsertError } = await supabase.from('inspection_photos').insert({
                  owner_id: ownerId,
                  inspection_id: inspectionId,
                  file_path: filePath,
                })
                if (photoInsertError) {
                  requestError = photoInsertError.message
                  break
                }
              }
            }
          }
        }
      }
    }
    if (editModal.kind === 'pricing' && editModal.mode === 'create' && ownerId) {
      const { error } = await supabase.from('pricing_plans').insert({
        owner_id: ownerId,
        label: editModal.values.label,
        vehicle_type: editModal.values.vehicle_type as PricingPlanRow['vehicle_type'],
        day_rate: Number(editModal.values.day_rate || 0),
        week_rate: Number(editModal.values.week_rate || 0),
        month_rate: Number(editModal.values.month_rate || 0),
      })
      if (error) requestError = error.message
    }

    if (requestError) {
      setModalError(requestError)
      return
    }

    closeModal()
    await refreshAppData()
    } catch (err) {
      setModalError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingModal(false)
    }
  }
  const onOpenCreateModal = () => {
    setModalVehiclePhoto(null)
    setModalInspectionPhotos([])
    if (section === 'vehicules') {
      setEditModal({
        mode: 'create',
        kind: 'vehicle',
        id: '',
        values: { brand: '', model: '', daily_price: '', status: 'available', type: 'scooter' },
      })
      return
    }
    if (section === 'clients') {
      setModalClientPassportPhoto(null)
      setEditModal({
        mode: 'create',
        kind: 'client',
        id: '',
        values: {
          full_name: '',
          phone: '',
          email: '',
          passport_number: '',
          nationality: '',
          passport_photo_path: '',
          notes: '',
          deposit_amount: '',
        },
      })
      return
    }
    if (section === 'contrats' || section === 'planning' || section === 'dashboard') {
      setEditModal({
        mode: 'create',
        kind: 'contract',
        id: '',
        values: {
          client_id: '',
          vehicle_id: '',
          daily_price: '',
          start_at: '',
          end_at: '',
          status: 'draft',
          inspection_notes: '',
        },
      })
      return
    }
    if (section === 'abonnement') {
      setEditModal({
        mode: 'create',
        kind: 'pricing',
        id: '',
        values: { label: '', day_rate: '', week_rate: '', month_rate: '', vehicle_type: 'scooter' },
      })
    }
  }
  const selectedModalVehicle =
    editModal?.kind === 'contract' && editModal.values.vehicle_id
      ? vehiclesData.find((vehicle) => vehicle.id === editModal.values.vehicle_id)
      : null
  const contractStartDate = editModal?.kind === 'contract' ? editModal.values.start_at : ''
  const contractEndDate = editModal?.kind === 'contract' ? editModal.values.end_at : ''
  const contractDaysForModal =
    editModal?.kind === 'contract' ? contractBillableDaysCount(contractStartDate, contractEndDate) : null
  const contractTotalPreview =
    editModal?.kind === 'contract' &&
    contractDaysForModal !== null &&
    Number(editModal.values.daily_price || 0) > 0
      ? Math.round(contractDaysForModal * Number(editModal.values.daily_price || 0))
      : null
  const sectionSubtitleMap: Record<string, string> = {
    dashboard: app.subtitles[0] || '',
    vehicules: `${vehiclesData.length} ${app.subtitles[1]?.replace(/^.*?(\d+\s+)/, '') || ''}`.trim(),
    clients: `${clientsData.length} ${d.registered}`,
    contrats: `${contractsData.length} ${app.subtitles[3]?.replace(/^.*?(\d+\s+)/, '') || ''}`.trim(),
    planning: app.subtitles[4] || '',
    abonnement: app.subtitles[5] || '',
  }
  const sectionSubtitle = sectionSubtitleMap[section] || app.subtitles[currentIndex] || app.subtitles[0]
  const isSubscriptionActive =
    !!currentSubscription && new Date(currentSubscription.current_period_end).getTime() > Date.now()
  const hasAccess = testModeEnabled || isSubscriptionActive
  const todayIso = new Date().toISOString().slice(0, 10)
  const returnsTodayCount = contractsData.filter(
    (contract) =>
      contract.end_at?.slice(0, 10) === todayIso &&
      (contract.status === 'active' || contract.status === 'draft'),
  ).length
  const revisionsSoonCount = revisionsData.filter((revision) => {
    if (revision.status === 'done') return false
    const due = revision.due_date?.slice(0, 10)
    if (!due) return false
    const diffDays = Math.ceil((+new Date(due) - +new Date(todayIso)) / (1000 * 60 * 60 * 24))
    return diffDays >= 0 && diffDays <= 7
  }).length
  const notificationCount = returnsTodayCount + revisionsSoonCount
  const primaryActionLabel =
    section === 'dashboard'
      ? app.actions[3]
      : app.actions[currentIndex] || app.actions[0]
  const vehicleByIdNotif = new Map(vehiclesData.map((v) => [v.id, v]))
  const returnsTodayNotifications = contractsData.filter(
    (contract) =>
      contract.end_at?.slice(0, 10) === todayIso &&
      (contract.status === 'active' || contract.status === 'draft'),
  )
  const revisionsSoonNotifications = revisionsData
    .filter((revision) => revision.status !== 'done')
    .filter((revision) => {
      const due = revision.due_date?.slice(0, 10)
      if (!due) return false
      const diffDays = Math.ceil((+new Date(due) - +new Date(todayIso)) / (1000 * 60 * 60 * 24))
      return diffDays >= 0 && diffDays <= 7
    })
    .slice(0, 8)
  return (
    <div className="dashboard-layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="brand-row">
            <span className="jlt-dot">JLT</span>
            <div className="brand-text">
              <p>JLT</p>
              <small>JUST LEASE TECH .</small>
            </div>
          </div>
        </div>

        <nav className="sidebar-menu">
          {menuMeta.map(({ key, icon: Icon }, index) => (
            <NavLink
              key={key}
              to={`/app/${key}`}
              className={({ isActive }) => (isActive ? 'item active' : 'item')}
            >
              <Icon size={16} />
              {app.menu[index]}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <select
            className="sidebar-lang"
            aria-label={t('nav').language}
            value={locale}
            onChange={(event) => setLocale(event.target.value as any)}
          >
            {localeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <Link to="/">{app.backSite}</Link>
        </div>
      </aside>

      <section className="dashboard-main">
        {isPublicDemoMode && (
          <div
            className="demo-mode-banner"
            role="status"
            style={{
              padding: '10px 20px',
              fontSize: '0.85rem',
              background: '#ecfdf5',
              borderBottom: '1px solid #a7f3d0',
              color: '#065f46',
            }}
          >
            <strong>{app.billingTestModeTitle}</strong> — {app.billingTestModeDesc}
          </div>
        )}
        <header className="dashboard-top">
          <div className="dashboard-top__left">
            <div className="dashboard-top__titles">
              <h1>{app.menu[currentIndex] || app.menu[0]}</h1>
              <p>{sectionSubtitle}</p>
            </div>
            <div className="dashboard-top__meta">
              <div className="dashboard-top__meta-left">
                <select
                  className="sidebar-lang"
                  aria-label={t('nav').language}
                  value={locale}
                  onChange={(event) => setLocale(event.target.value as any)}
                >
                  {localeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <Link to="/" className="dashboard-mobile-back">
                  {app.backSite}
                </Link>
              </div>
              <div className="dashboard-top__company invoice-profile-preview">
                {invoiceProfile.logoDataUrl ? (
                  <img src={invoiceProfile.logoDataUrl} alt="invoice-logo" />
                ) : (
                  <div className="invoice-profile-logo-placeholder">LOGO</div>
                )}
                <div>
                  <strong>{invoiceProfile.companyName}</strong>
                  <p>{invoiceProfile.companyAddress}</p>
                  {invoiceProfile.companyPhone?.trim() ? (
                    <p className="invoice-profile-phone">{invoiceProfile.companyPhone.trim()}</p>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
          <div className="top-actions">
            <div className="notifications-wrap" ref={notificationsRef}>
              <button
                type="button"
                className="ghost-btn"
                aria-expanded={notificationsOpen}
                aria-haspopup="dialog"
                aria-label={app.notificationsTitle}
                onClick={() => setNotificationsOpen((open) => !open)}
              >
                <Bell size={14} />
                {notificationCount > 0 && <span className="notif-badge">{notificationCount}</span>}
              </button>
              {notificationsOpen && (
                <div className="notifications-panel" role="dialog" aria-label={app.notificationsTitle}>
                  <h4>{app.notificationsTitle}</h4>
                  {returnsTodayNotifications.length === 0 && revisionsSoonNotifications.length === 0 ? (
                    <p className="notifications-empty">{app.noNotifications}</p>
                  ) : (
                    <>
                      {returnsTodayNotifications.length > 0 && (
                        <>
                          <p className="notif-section-label">{app.returnToday}</p>
                          <ul className="notifications-list">
                            {returnsTodayNotifications.map((contract) => {
                              const vehicle = vehicleByIdNotif.get(contract.vehicle_id)
                              return (
                                <li key={`bell-ret-${contract.id}`}>
                                  {vehicle ? `${vehicle.brand} ${vehicle.model}` : contract.vehicle_id}
                                </li>
                              )
                            })}
                          </ul>
                        </>
                      )}
                      {revisionsSoonNotifications.length > 0 && (
                        <>
                          <p className="notif-section-label">{app.revisionsTab}</p>
                          <ul className="notifications-list">
                            {revisionsSoonNotifications.map((revision) => {
                              const vehicle = vehicleByIdNotif.get(revision.vehicle_id)
                              return (
                                <li key={`bell-rev-${revision.id}`}>
                                  {revision.due_date?.slice(0, 10)} —{' '}
                                  {vehicle ? `${vehicle.brand} ${vehicle.model}` : revision.vehicle_id}
                                </li>
                              )
                            })}
                          </ul>
                        </>
                      )}
                      <div className="notif-actions">
                        <Link to="/app/planning" onClick={() => setNotificationsOpen(false)}>
                          {app.menu[4]}
                        </Link>
                        <Link to="/app/vehicules?tab=revisions" onClick={() => setNotificationsOpen(false)}>
                          {app.revisionsTab}
                        </Link>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
            <button
              type="button"
              className="ghost-btn top-actions__settings"
              onClick={() => {
                setInvoiceProfileDraft(invoiceProfile)
                setInvoiceProfileOpen(true)
              }}
            >
              {app.invoiceProfile}
            </button>
            <button type="button" className="accent-btn top-actions__primary" onClick={onOpenCreateModal}>
              <Plus size={14} />
              {primaryActionLabel}
            </button>
          </div>
        </header>

        {section !== 'abonnement' && (
          <div className="toolbar">
            <div className="search-box">
              <Search size={14} />
              <input
                placeholder={app.search}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </div>
            {section !== 'planning' && (
              <div className="toolbar-actions">
                <select
                  value={selectedType}
                  onChange={(event) => setSelectedType(event.target.value as VehicleTypeFilter)}
                  aria-label={app.filterType}
                >
                  <option value="all">{app.filterType}</option>
                  <option value="scooter">{d.vehicleTypes[0]}</option>
                  <option value="car">{d.vehicleTypes[1]}</option>
                  <option value="bike">{d.vehicleTypes[2]}</option>
                </select>
                <select
                  value={selectedStatus}
                  onChange={(event) => setSelectedStatus(event.target.value as StatusFilter)}
                  aria-label={app.filterStatus}
                >
                  <option value="all">{app.filterStatus}</option>
                  <option value="available">{app.available}</option>
                  <option value="reserved">{app.reserved}</option>
                  <option value="maintenance">{d.maintenance}</option>
                  <option value="active">{app.active}</option>
                  <option value="done">{app.done}</option>
                  <option value="draft">{app.draft}</option>
                </select>
              </div>
            )}
          </div>
        )}

        <div className="dashboard-content">
          {loadError && <p className="modal-error">{loadError}</p>}
          {section !== 'abonnement' && !hasAccess ? (
            <article className="list-item">
              <h4>{app.billingLockedTitle}</h4>
              <p>{app.billingLockedDesc}</p>
              <Link to="/app/abonnement" className="see-all-link">
                {app.menu[5]}
              </Link>
            </article>
          ) : (
            renderSection(
              section,
              app,
              selectedType,
              selectedStatus,
              searchQuery,
              vehiclesData,
              revisionsData,
              invoiceProfile,
              clientsData,
              contractsData,
              currentSubscription,
              pendingCheckoutCode,
              onStartCheckout,
              testModeEnabled,
              onEditVehicle,
              onDeleteVehicle,
              onCreateRevision,
              onUpdateRevisionStatus,
              onDeleteRevision,
              onEditClient,
              onDeleteClient,
              onEditContract,
              onDeleteContract,
              clientPassportListUrls,
              (url: string, title: string) => setPassportViewer({ url, title }),
            )
          )}
        </div>
        {editModal && (
          <div className="modal-backdrop" role="dialog" aria-modal="true">
            <div className="modal-card">
              <h3>
                {editModal.kind === 'vehicle'
                  ? editModal.mode === 'create'
                    ? app.modalCreateVehicle
                    : app.modalTitleVehicle
                  : editModal.kind === 'client'
                    ? editModal.mode === 'create'
                      ? app.modalCreateClient
                      : app.modalTitleClient
                    : editModal.kind === 'contract'
                      ? editModal.mode === 'create'
                        ? app.modalCreateContract
                        : app.modalTitleContract
                      : editModal.mode === 'create'
                        ? app.modalCreatePricing
                        : app.modalTitlePricing}
              </h3>

              {editModal.kind === 'vehicle' && (
                <>
                  <input value={editModal.values.brand || ''} onChange={(e) => setEditModal((p) => (p ? { ...p, values: { ...p.values, brand: e.target.value } } : p))} placeholder={app.fieldBrand} />
                  <input value={editModal.values.model || ''} onChange={(e) => setEditModal((p) => (p ? { ...p, values: { ...p.values, model: e.target.value } } : p))} placeholder={app.fieldModel} />
                  <input value={editModal.values.daily_price || ''} onChange={(e) => setEditModal((p) => (p ? { ...p, values: { ...p.values, daily_price: e.target.value } } : p))} placeholder={app.fieldDailyPrice} />
                  <div className="modal-file-input">
                    <span>{app.vehiclePhotoCta}</span>
                    <div className="modal-file-input__row modal-file-input__row--vehicle-photo">
                      <label className="modal-file-input__pick-label">
                        <span className="modal-file-input__pick">{app.fileInputChooseSingle}</span>
                        <input
                          type="file"
                          className="modal-file-input__overlay-file"
                          accept="image/*"
                          onChange={(event) => {
                            setModalVehiclePhoto(event.target.files?.[0] ?? null)
                            event.target.value = ''
                          }}
                        />
                      </label>
                      <label className="modal-file-input__pick-label">
                        <span className="modal-file-input__pick">{app.vehiclePhotoTakePhoto}</span>
                        <input
                          type="file"
                          className="modal-file-input__overlay-file"
                          accept="image/*"
                          capture="environment"
                          onChange={(event) => {
                            setModalVehiclePhoto(event.target.files?.[0] ?? null)
                            event.target.value = ''
                            requestAnimationFrame(() => {
                              window.scrollTo(0, 0)
                            })
                          }}
                        />
                      </label>
                      <span className="modal-file-input__status">
                        {modalVehiclePhoto ? modalVehiclePhoto.name : app.fileInputNoneSelected}
                      </span>
                    </div>
                  </div>
                  <select value={editModal.values.status || 'available'} onChange={(e) => setEditModal((p) => (p ? { ...p, values: { ...p.values, status: e.target.value } } : p))}>
                    <option value="available">{app.available}</option>
                    <option value="reserved">{app.reserved}</option>
                    <option value="maintenance">{app.dashboard.maintenance}</option>
                  </select>
                  <select value={editModal.values.type || 'scooter'} onChange={(e) => setEditModal((p) => (p ? { ...p, values: { ...p.values, type: e.target.value } } : p))}>
                    <option value="scooter">{app.dashboard.vehicleTypes[0]}</option>
                    <option value="car">{app.dashboard.vehicleTypes[1]}</option>
                    <option value="bike">{app.dashboard.vehicleTypes[2]}</option>
                  </select>
                </>
              )}
              {editModal.kind === 'client' && (
                <>
                  <input
                    value={editModal.values.full_name || ''}
                    onChange={(e) =>
                      setEditModal((p) => (p ? { ...p, values: { ...p.values, full_name: e.target.value } } : p))
                    }
                    placeholder={app.fieldFullName}
                  />
                  <input
                    value={editModal.values.passport_number || ''}
                    onChange={(e) =>
                      setEditModal((p) =>
                        p ? { ...p, values: { ...p.values, passport_number: e.target.value } } : p,
                      )
                    }
                    placeholder={app.fieldPassportNumber}
                    autoComplete="off"
                  />
                  <input
                    value={editModal.values.nationality || ''}
                    onChange={(e) =>
                      setEditModal((p) =>
                        p ? { ...p, values: { ...p.values, nationality: e.target.value } } : p,
                      )
                    }
                    placeholder={app.fieldNationality}
                    autoComplete="off"
                  />
                  <input
                    value={editModal.values.phone || ''}
                    onChange={(e) =>
                      setEditModal((p) => (p ? { ...p, values: { ...p.values, phone: e.target.value } } : p))
                    }
                    placeholder={app.fieldPhone}
                  />
                  <input
                    value={editModal.values.email || ''}
                    onChange={(e) =>
                      setEditModal((p) => (p ? { ...p, values: { ...p.values, email: e.target.value } } : p))
                    }
                    placeholder={app.fieldEmail}
                  />
                  <div className="modal-field">
                    <label htmlFor="jlt-client-notes">{app.fieldNotes}</label>
                    <textarea
                      id="jlt-client-notes"
                      rows={3}
                      value={editModal.values.notes || ''}
                      onChange={(e) =>
                        setEditModal((p) =>
                          p ? { ...p, values: { ...p.values, notes: e.target.value } } : p,
                        )
                      }
                      placeholder={app.fieldNotesPlaceholder}
                    />
                  </div>
                  <div className="modal-field">
                    <label htmlFor="jlt-client-deposit">{app.fieldDeposit}</label>
                    <input
                      id="jlt-client-deposit"
                      type="number"
                      min={0}
                      step="0.01"
                      inputMode="decimal"
                      value={editModal.values.deposit_amount || ''}
                      onChange={(e) =>
                        setEditModal((p) =>
                          p ? { ...p, values: { ...p.values, deposit_amount: e.target.value } } : p,
                        )
                      }
                      placeholder="0"
                    />
                  </div>
                  <div className="modal-file-input">
                    <span>{app.clientPassportPhotoCta}</span>
                    <div className="modal-file-input__row modal-file-input__row--passport">
                      <label className="modal-file-input__pick-label">
                        <span className="modal-file-input__pick">{app.fileInputChooseSingle}</span>
                        <input
                          type="file"
                          className="modal-file-input__overlay-file"
                          accept="image/*"
                          onChange={(event) => {
                            const file = event.target.files?.[0] ?? null
                            setModalClientPassportPhoto(file)
                            event.target.value = ''
                            requestAnimationFrame(() => {
                              window.scrollTo(0, 0)
                            })
                          }}
                        />
                      </label>
                      <span className="modal-file-input__status">
                        {modalClientPassportPhoto ? modalClientPassportPhoto.name : app.fileInputNoneSelected}
                      </span>
                    </div>
                  </div>
                  {(passportLocalPreviewUrl || clientPassportPreviewUrl) && (
                    <div className="modal-passport-preview">
                      <img
                        src={passportLocalPreviewUrl || clientPassportPreviewUrl || ''}
                        alt=""
                        className="modal-passport-preview__img"
                        decoding="async"
                      />
                    </div>
                  )}
                </>
              )}
              {editModal.kind === 'contract' && (
                <>
                  <select
                    value={editModal.values.client_id || ''}
                    onChange={(e) =>
                      setEditModal((p) => (p ? { ...p, values: { ...p.values, client_id: e.target.value } } : p))
                    }
                  >
                    <option value="">{app.fieldClientId}</option>
                    {clientsData.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.full_name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={editModal.values.vehicle_id || ''}
                    onChange={(e) =>
                      setEditModal((p) => {
                        if (!p) return p
                        const nextVehicleId = e.target.value
                        const nextVehicle = vehiclesData.find((vehicle) => vehicle.id === nextVehicleId)
                        return {
                          ...p,
                          values: {
                            ...p.values,
                            vehicle_id: nextVehicleId,
                            daily_price:
                              p.mode === 'create' && nextVehicle
                                ? String(nextVehicle.daily_price || 0)
                                : p.values.daily_price,
                          },
                        }
                      })
                    }
                  >
                    <option value="">{app.fieldVehicleId}</option>
                    {vehiclesData.map((vehicle) => (
                      <option key={vehicle.id} value={vehicle.id}>
                        {vehicle.brand} {vehicle.model}
                      </option>
                    ))}
                  </select>
                  <LocalizedDatePicker
                    locale={locale}
                    value={editModal.values.start_at || ''}
                    onChange={(ymd) =>
                      setEditModal((p) =>
                        p
                          ? {
                              ...p,
                              values: {
                                ...p.values,
                                start_at: ymd,
                                end_at:
                                  p.values.end_at && p.values.end_at < ymd ? ymd : p.values.end_at,
                              },
                            }
                          : p,
                      )
                    }
                    placeholder={app.fieldStartAt}
                  />
                  <LocalizedDatePicker
                    locale={locale}
                    value={editModal.values.end_at || ''}
                    min={editModal.values.start_at || undefined}
                    onChange={(ymd) =>
                      setEditModal((p) => (p ? { ...p, values: { ...p.values, end_at: ymd } } : p))
                    }
                    placeholder={app.fieldEndAt}
                  />
                  <input
                    type="number"
                    min={0}
                    step="any"
                    inputMode="decimal"
                    value={editModal.values.daily_price || ''}
                    onChange={(e) =>
                      setEditModal((p) => (p ? { ...p, values: { ...p.values, daily_price: e.target.value } } : p))
                    }
                    placeholder={app.fieldDailyPrice}
                  />
                  {selectedModalVehicle && (
                    <p className="modal-hint">
                      {`${app.dailyRateHint} (${app.fieldVehicleId}): ฿${selectedModalVehicle.daily_price}`}
                    </p>
                  )}
                  {contractTotalPreview !== null && contractDaysForModal !== null && (
                    <p className="modal-hint">
                      {app.contractPricingSummary
                        .replace('{total}', String(contractTotalPreview))
                        .replace('{days}', String(contractDaysForModal))
                        .replace('{daily}', editModal.values.daily_price || '0')}
                    </p>
                  )}
                  <select value={editModal.values.status || 'draft'} onChange={(e) => setEditModal((p) => (p ? { ...p, values: { ...p.values, status: e.target.value } } : p))}>
                    <option value="draft">{app.draft}</option>
                    <option value="active">{app.active}</option>
                    <option value="completed">{app.done}</option>
                    <option value="cancelled">{app.statusCancelled}</option>
                  </select>
                  {editModal.mode === 'create' && (
                    <>
                      <p className="modal-hint" style={{ marginTop: 6 }}>
                        {app.contractInspectionHeading}
                      </p>
                      <textarea
                        value={editModal.values.inspection_notes || ''}
                        onChange={(e) =>
                          setEditModal((p) =>
                            p ? { ...p, values: { ...p.values, inspection_notes: e.target.value } } : p,
                          )
                        }
                        placeholder={app.contractInspectionPlaceholder}
                      />
                      <div className="modal-file-input">
                        <span>{app.contractInspectionPhotosCta}</span>
                        <div className="modal-file-input__row">
                          <button
                            type="button"
                            className="modal-file-input__pick"
                            onClick={() => modalFileInputRef.current?.click()}
                          >
                            {app.fileInputChooseMultiple}
                          </button>
                          <span className="modal-file-input__status">
                            {modalInspectionPhotos.length === 0
                              ? app.fileInputNoneSelected
                              : app.contractInspectionPhotosCount.replace(
                                  '{n}',
                                  String(modalInspectionPhotos.length),
                                )}
                          </span>
                        </div>
                        <input
                          ref={modalFileInputRef}
                          type="file"
                          className="modal-file-input__hidden"
                          accept="image/*"
                          capture="environment"
                          multiple
                          onChange={(event) => {
                            const files = Array.from(event.target.files ?? [])
                            setModalInspectionPhotos((prev) => [...prev, ...files])
                            event.target.value = ''
                          }}
                        />
                      </div>
                      {modalInspectionPhotos.length > 0 && (
                        <div className="modal-contract-inspection-row">
                          <span className="modal-hint">
                            {app.contractInspectionPhotosCount.replace(
                              '{n}',
                              String(modalInspectionPhotos.length),
                            )}
                          </span>
                          <button type="button" onClick={() => setModalInspectionPhotos([])}>
                            {app.contractInspectionPhotosClear}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
              {editModal.kind === 'pricing' && (
                <>
                  <input value={editModal.values.label || ''} onChange={(e) => setEditModal((p) => (p ? { ...p, values: { ...p.values, label: e.target.value } } : p))} placeholder={app.fieldLabel} />
                  <input value={editModal.values.day_rate || ''} onChange={(e) => setEditModal((p) => (p ? { ...p, values: { ...p.values, day_rate: e.target.value } } : p))} placeholder={app.fieldDayRate} />
                  <input value={editModal.values.week_rate || ''} onChange={(e) => setEditModal((p) => (p ? { ...p, values: { ...p.values, week_rate: e.target.value } } : p))} placeholder={app.fieldWeekRate} />
                  <input value={editModal.values.month_rate || ''} onChange={(e) => setEditModal((p) => (p ? { ...p, values: { ...p.values, month_rate: e.target.value } } : p))} placeholder={app.fieldMonthRate} />
                  <select value={editModal.values.vehicle_type || 'scooter'} onChange={(e) => setEditModal((p) => (p ? { ...p, values: { ...p.values, vehicle_type: e.target.value } } : p))}>
                    <option value="scooter">{app.dashboard.vehicleTypes[0]}</option>
                    <option value="car">{app.dashboard.vehicleTypes[1]}</option>
                    <option value="bike">{app.dashboard.vehicleTypes[2]}</option>
                  </select>
                </>
              )}

              <div className="modal-actions">
                <button type="button" onClick={closeModal}>
                  {app.cancel}
                </button>
                <button type="button" onClick={() => void onSubmitEditModal()} disabled={savingModal}>
                  {savingModal ? '...' : editModal.mode === 'create' ? app.create : app.save}
                </button>
              </div>
              {modalError && <p className="modal-error">{modalError}</p>}
            </div>
          </div>
        )}
        {invoiceProfileOpen && (
          <div className="modal-backdrop" role="dialog" aria-modal="true">
            <div className="modal-card modal-card--invoice">
              <h3>{app.invoiceProfile}</h3>
              <p className="modal-hint">{app.invoiceProfileHint}</p>
              <div className="modal-field">
                <label htmlFor="jlt-invoice-name">{app.invoiceCompanyName}</label>
                <input
                  id="jlt-invoice-name"
                  value={invoiceProfileDraft.companyName}
                  onChange={(event) =>
                    setInvoiceProfileDraft((prev) => ({ ...prev, companyName: event.target.value }))
                  }
                  autoComplete="organization"
                />
              </div>
              <div className="modal-field">
                <label htmlFor="jlt-invoice-address">{app.invoiceCompanyAddress}</label>
                <textarea
                  id="jlt-invoice-address"
                  rows={3}
                  value={invoiceProfileDraft.companyAddress}
                  onChange={(event) =>
                    setInvoiceProfileDraft((prev) => ({ ...prev, companyAddress: event.target.value }))
                  }
                  autoComplete="street-address"
                />
              </div>
              <div className="modal-field">
                <label htmlFor="jlt-invoice-phone">{app.invoiceCompanyPhone}</label>
                <input
                  id="jlt-invoice-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={invoiceProfileDraft.companyPhone}
                  onChange={(event) =>
                    setInvoiceProfileDraft((prev) => ({ ...prev, companyPhone: event.target.value }))
                  }
                />
              </div>
              <div className="modal-field">
                <span className="modal-field__static-label">{app.invoiceClientLogo}</span>
                {invoiceProfileDraft.logoDataUrl ? (
                  <div className="invoice-modal-logo-preview">
                    <img src={invoiceProfileDraft.logoDataUrl} alt="" />
                  </div>
                ) : null}
                <label className="photo-upload-btn">
                  {app.invoiceChangeLogo}
                  <input type="file" accept="image/*" onChange={onGlobalInvoiceLogoChange} />
                </label>
              </div>
              <div className="modal-actions">
                <button type="button" onClick={() => setInvoiceProfileOpen(false)}>
                  {app.cancel}
                </button>
                <button type="button" onClick={onSaveInvoiceProfile}>
                  {app.save}
                </button>
              </div>
            </div>
          </div>
        )}
        {passportViewer && (
          <div
            className="passport-viewer-backdrop"
            role="presentation"
            onClick={() => setPassportViewer(null)}
          >
            <div
              className="passport-viewer-dialog"
              role="dialog"
              aria-modal="true"
              aria-label={passportViewer.title}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="passport-viewer-close"
                onClick={() => setPassportViewer(null)}
                aria-label={app.cancel}
              >
                <X size={22} strokeWidth={2} aria-hidden />
              </button>
              <img
                src={passportViewer.url}
                alt={app.passportPhotoAlt}
                className="passport-viewer-img"
              />
            </div>
          </div>
        )}
      </section>

      <nav className="dashboard-bottom-nav" aria-label={t('nav').mainNav}>
        {menuMeta.map(({ key, icon: Icon }, index) => (
          <NavLink
            key={key}
            to={`/app/${key}`}
            className={({ isActive }) =>
              isActive ? 'dashboard-bottom-nav-item active' : 'dashboard-bottom-nav-item'
            }
          >
            <Icon size={22} strokeWidth={2} aria-hidden />
            <span>{app.menu[index]}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
