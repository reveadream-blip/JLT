import {
  useEffect,
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
  Globe,
  LayoutDashboard,
  Plus,
  Search,
  Users,
  Wallet,
} from 'lucide-react'
import { jsPDF } from 'jspdf'
import { localeOptions, useI18n } from '../lib/i18n'
import { Link, NavLink, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './DashboardShell.css'

/** Démo publique : connexion anonyme + accès sans abonnement (voir VITE_PUBLIC_DEMO_MODE). */
const isPublicDemoMode = import.meta.env.VITE_PUBLIC_DEMO_MODE === 'true'

const menuMeta = [
  { key: 'dashboard', icon: LayoutDashboard },
  { key: 'vehicules', icon: Car },
  { key: 'clients', icon: Users },
  { key: 'contrats', icon: ClipboardList },
  { key: 'planning', icon: Calendar },
  { key: 'pricing', icon: Wallet },
  { key: 'abonnement', icon: CreditCard },
  { key: 'carte', icon: Globe },
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
  logoDataUrl: string
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
  type RevenuePoint = {
    label: string
    date: string
    isoDate: string
    amount: number
    contracts: number
  }
  const defaultRevenueTimeline: RevenuePoint[] = (() => {
    const now = new Date()
    const formatter = new Intl.DateTimeFormat('en', { month: 'short', year: '2-digit' })
    return Array.from({ length: 6 }).map((_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1)
      return {
        label: formatter.format(date),
        date: new Date(date.getFullYear(), date.getMonth() + 1, 0).toLocaleDateString('fr-FR'),
        isoDate: new Date(date.getFullYear(), date.getMonth() + 1, 0).toISOString().slice(0, 10),
        amount: 0,
        contracts: 0,
      }
    })
  })()
  const [revenueTimeline, setRevenueTimeline] = useState<RevenuePoint[]>(defaultRevenueTimeline)
  const [activeRevenueIndex, setActiveRevenueIndex] = useState(revenueTimeline.length - 1)
  const [activePeriodIndex, setActivePeriodIndex] = useState(3)
  const [selectedStartDate, setSelectedStartDate] = useState(defaultRevenueTimeline[0].isoDate)
  const [selectedEndDate, setSelectedEndDate] = useState(
    defaultRevenueTimeline[defaultRevenueTimeline.length - 1].isoDate,
  )
  useEffect(() => {
    const now = new Date()
    const buckets = Array.from({ length: 6 }).map((_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1)
      return {
        key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
        date,
        amount: 0,
        contracts: 0,
      }
    })
    const bucketMap = new Map(buckets.map((bucket) => [bucket.key, bucket]))
    contractsData.forEach((row) => {
      if (!row.start_at || row.status === 'cancelled') return
      const date = new Date(row.start_at)
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      const bucket = bucketMap.get(key)
      if (!bucket) return
      bucket.amount += Number(row.total_price ?? 0)
      bucket.contracts += 1
    })

    const formatter = new Intl.DateTimeFormat('en', { month: 'short', year: '2-digit' })
    const nextTimeline: RevenuePoint[] = buckets.map((bucket) => ({
      label: formatter.format(bucket.date),
      date: new Date(bucket.date.getFullYear(), bucket.date.getMonth() + 1, 0).toLocaleDateString('fr-FR'),
      isoDate: new Date(bucket.date.getFullYear(), bucket.date.getMonth() + 1, 0).toISOString().slice(0, 10),
      amount: Math.round(bucket.amount),
      contracts: bucket.contracts,
    }))
    setRevenueTimeline(nextTimeline)
    setActiveRevenueIndex(nextTimeline.length - 1)
  }, [contractsData])

  const periodSpanMap = [2, 3, 4, 6, 6, 6]
  const rangedRevenueTimeline = revenueTimeline.filter(
    (item) => item.isoDate >= selectedStartDate && item.isoDate <= selectedEndDate,
  )
  const visibleRevenueTimeline = rangedRevenueTimeline.length
    ? rangedRevenueTimeline.slice(-Math.min(periodSpanMap[activePeriodIndex], rangedRevenueTimeline.length))
    : revenueTimeline.slice(-1)
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
    if (!revenueTimeline.length) return
    const minDate = revenueTimeline[0].isoDate
    const maxDate = revenueTimeline[revenueTimeline.length - 1].isoDate
    setSelectedStartDate((prev) => (prev < minDate || prev > maxDate ? minDate : prev))
    setSelectedEndDate((prev) => (prev > maxDate || prev < minDate ? maxDate : prev))
  }, [revenueTimeline])

  const activeContractsCount = contractsData.filter((row) => row.status === 'active').length
  const availableVehiclesCount = vehiclesData.filter((row) => row.status === 'available').length
  const kpiCards = [
    { label: app.menu[1], value: String(vehiclesData.length), hint: `${availableVehiclesCount} ${d.available}` },
    { label: d.activeContracts.toUpperCase(), value: String(activeContractsCount), hint: ' ' },
    { label: app.menu[2], value: String(clientsData.length), hint: d.registered },
    { label: d.revenueTitle.toUpperCase(), value: `฿${activeRevenue.amount}`, hint: d.selectedPeriod },
  ]
  const [marketMetric, setMarketMetric] = useState<'contracts' | 'revenue'>('contracts')
  const colorByIndex = ['#f59e0b', '#3b82f6', '#14b8a6', '#8b5cf6', '#ef4444', '#22c55e']
  const vehicleById = new Map(vehiclesData.map((row) => [row.id, row]))
  const marketMap = new Map<string, { name: string; contracts: number; revenue: number }>()
  contractsData.forEach((contract) => {
    if (contract.status === 'cancelled') return
    const vehicle = vehicleById.get(contract.vehicle_id)
    const model = vehicle ? `${vehicle.brand} ${vehicle.model}` : contract.vehicle_id
    const existing = marketMap.get(model) || { name: model, contracts: 0, revenue: 0 }
    existing.contracts += 1
    existing.revenue += Number(contract.total_price ?? 0)
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
        {kpiCards.map((item) => (
          <article key={item.label} className="kpi-card">
            <p>{item.label}</p>
            <strong>{item.value}</strong>
            <small>{item.hint}</small>
          </article>
        ))}
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
                  onClick={() => setActivePeriodIndex(index)}
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
                <strong>{`฿${activeRevenue.amount}`}</strong>
                <p>{`${activeRevenue.contracts ?? 0} ${d.contractsCount}`}</p>
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
  const [revisionForm, setRevisionForm] = useState({
    vehicle_id: '',
    due_date: '',
    note: '',
  })
  const normalizeVehicleLabel = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')

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
    const q = searchQuery.trim().toLowerCase()
    const searchOk =
      !q ||
      [
        vehicle.name,
        vehicle.cardType,
        vehicle.statusLabel,
        vehicle.statusKey,
        ...vehicle.specs,
      ]
        .join(' ')
        .toLowerCase()
        .includes(q)
    return typeOk && statusOk && searchOk
  })

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
      if (!userId) return

      const { data: rows, error: rowsError } = await supabase
        .from('vehicle_photos')
        .select('id,vehicle_label,file_path,created_at')
        .eq('owner_id', userId)
        .order('created_at', { ascending: false })
      if (rowsError || !rows) return

      const latestByVehicle = new Map<string, string>()
      rows.forEach((row) => {
        const normalizedLabel = normalizeVehicleLabel(row.vehicle_label)
        if (!latestByVehicle.has(normalizedLabel)) {
          latestByVehicle.set(normalizedLabel, row.file_path)
        }
      })

      const entries = await Promise.all(
        Array.from(latestByVehicle.entries()).map(async ([label, filePath]) => {
          const { data } = await supabase.storage
            .from('vehicle-photos')
            .createSignedUrl(filePath, 60 * 60)
          return [label, data?.signedUrl ?? ''] as const
        }),
      )

      const grouped = new Map<string, Array<{ id: string; filePath: string }>>()
      rows.forEach((row) => {
        const normalizedLabel = normalizeVehicleLabel(row.vehicle_label)
        const list = grouped.get(normalizedLabel) ?? []
        if (list.length < 6) list.push({ id: row.id, filePath: row.file_path })
        grouped.set(normalizedLabel, list)
      })
      const galleryEntries = await Promise.all(
        Array.from(grouped.entries()).map(async ([label, photos]) => {
          const signed = await Promise.all(
            photos.map(async (photo) => {
              const { data } = await supabase.storage
                .from('vehicle-photos')
                .createSignedUrl(photo.filePath, 60 * 60)
              return {
                id: photo.id,
                filePath: photo.filePath,
                signedUrl: data?.signedUrl ?? '',
              }
            }),
          )
          return [label, signed.filter((item) => item.signedUrl)] as const
        }),
      )

      const nextPhotos: Record<string, string> = {}
      entries.forEach(([label, signedUrl]) => {
        if (signedUrl) nextPhotos[label] = signedUrl
      })
      const nextGalleries: Record<
        string,
        Array<{ id: string; filePath: string; signedUrl: string }>
      > = {}
      galleryEntries.forEach(([label, items]) => {
        nextGalleries[label] = items
      })
      setVehiclePhotos(nextPhotos)
      setVehicleGalleries(nextGalleries)
    }

    void loadPhotos()
  }, [sessionUserId])

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
    (vehicleName: string) => async (event: ChangeEvent<HTMLInputElement>) => {
      setFeedback('')
      setError('')
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return

      if (!sessionUserId) {
        setError(app.vehiclePhotoAuth)
        return
      }

      setUploadingFor(vehicleName)
      const compressedFile = await compressImageFile(file)
      const extension = compressedFile.name.split('.').pop() || 'jpg'
      const normalizedVehicleLabel = normalizeVehicleLabel(vehicleName)
      const safeVehicle = normalizedVehicleLabel.replace(/\s+/g, '-')
      const filePath = `${sessionUserId}/${safeVehicle}/${Date.now()}.${extension}`

      const { error: uploadError } = await supabase.storage
        .from('vehicle-photos')
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
        vehicle_label: normalizedVehicleLabel,
        file_path: filePath,
      })
      if (insertError) {
        setError(insertError.message)
        setUploadingFor(null)
        return
      }

      const { data: signedData, error: signedError } = await supabase.storage
        .from('vehicle-photos')
        .createSignedUrl(filePath, 60 * 60)

      if (signedError || !signedData?.signedUrl) {
        setError(signedError?.message || app.vehiclePhotoError)
      } else {
        setVehiclePhotos((prev) => ({ ...prev, [normalizedVehicleLabel]: signedData.signedUrl }))
        setVehicleGalleries((prev) => ({
          ...prev,
          [normalizedVehicleLabel]: [
            {
              id: `local-${Date.now()}`,
              filePath,
              signedUrl: signedData.signedUrl,
            },
            ...(prev[normalizedVehicleLabel] ?? []),
          ].slice(0, 6),
        }))
        setFeedback(app.vehiclePhotoSuccess)
      }
      setUploadingFor(null)
    }

  const onDeleteVehiclePhoto = async (vehicleName: string, photoId: string, filePath: string) => {
    setFeedback('')
    setError('')
    const { error: removeStorageError } = await supabase.storage
      .from('vehicle-photos')
      .remove([filePath])
    if (removeStorageError) {
      setError(removeStorageError.message)
      return
    }
    if (!photoId.startsWith('local-')) {
      await supabase.from('vehicle_photos').delete().eq('id', photoId)
    }
    const remaining = (vehicleGalleries[vehicleName] ?? []).filter((item) => item.id !== photoId)
    setVehicleGalleries((prev) => ({
      ...prev,
      [vehicleName]: remaining,
    }))
    setVehiclePhotos((prev) => ({
      ...prev,
      [vehicleName]: remaining[0]?.signedUrl || prev[vehicleName],
    }))
  }

  return (
    <div className="grid-cards">
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
      {vehicleTab === 'revisions' && (
        <article className="list-item" style={{ gridColumn: '1 / -1' }}>
          <h4>{app.scheduleRevision}</h4>
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
            onChange={(event) => setRevisionForm((prev) => ({ ...prev, note: event.target.value }))}
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
          <div className="list" style={{ marginTop: '10px' }}>
            {revisionsData.map((revision) => {
              const vehicle = vehiclesData.find((v) => v.id === revision.vehicle_id)
              return (
                <article key={revision.id} className="contract-row">
                  <div>
                    <h4>{vehicle ? `${vehicle.brand} ${vehicle.model}` : revision.vehicle_id}</h4>
                    <p>{revision.due_date.slice(0, 10)}</p>
                    <p>{revision.note || '-'}</p>
                  </div>
                  <div className="row-actions">
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
        <article key={vehicle.name} className="vehicle-card">
          <div className="vehicle-meta-top">
            <small>{vehicle.cardType}</small>
            <span className={`vehicle-status ${vehicle.statusKey}`}>{vehicle.statusLabel}</span>
          </div>
          <div className="vehicle-cover">
            {vehiclePhotos[normalizeVehicleLabel(vehicle.name)] ? (
              <img
                src={vehiclePhotos[normalizeVehicleLabel(vehicle.name)]}
                alt={vehicle.name}
                loading="lazy"
              />
            ) : (
              <div className="vehicle-no-photo">Aucune photo</div>
            )}
          </div>
          <h4>{vehicle.name}</h4>
          <p className="vehicle-specs">{vehicle.specs.join('  •  ')}</p>
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
          <label className="photo-upload-btn">
            {uploadingFor === vehicle.name ? app.vehiclePhotoUploading : app.vehiclePhotoCta}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={onVehiclePhotoChange(vehicle.name)}
              disabled={uploadingFor === vehicle.name}
            />
          </label>
          {(vehicleGalleries[normalizeVehicleLabel(vehicle.name)] ?? []).length > 0 && (
            <div className="vehicle-gallery">
              {(vehicleGalleries[normalizeVehicleLabel(vehicle.name)] ?? []).map((photo) => (
                <div key={photo.id} className="vehicle-thumb-wrap">
                  <button
                    type="button"
                    className="vehicle-thumb"
                    onClick={() =>
                      setVehiclePhotos((prev) => ({
                        ...prev,
                        [normalizeVehicleLabel(vehicle.name)]: photo.signedUrl,
                      }))
                    }
                  >
                    <img src={photo.signedUrl} alt={vehicle.name} loading="lazy" />
                  </button>
                  <button
                    type="button"
                    className="vehicle-thumb-delete"
                    onClick={() =>
                      void onDeleteVehiclePhoto(
                        normalizeVehicleLabel(vehicle.name),
                        photo.id,
                        photo.filePath,
                      )
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
  onEditClient,
  onDeleteClient,
}: {
  app: any
  clientsData: ClientRow[]
  onEditClient: (clientId: string) => Promise<void>
  onDeleteClient: (clientId: string) => Promise<void>
}) {
  return (
    <div className="list">
      {clientsData.map((client) => (
        <article key={client.id} className="list-item">
          <h4>{client.full_name}</h4>
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
  contractsData: ContractRow[]
  clientsData: ClientRow[]
  vehiclesData: VehicleRow[]
  invoiceProfile: {
    companyName: string
    companyAddress: string
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
      dailyPrice: Number(vehicle?.daily_price ?? 0),
      totalPrice: Number(contract.total_price ?? 0),
    }
  })
  const filteredContracts = contracts.filter((contract) => {
    const typeOk = selectedType === 'all' || contract.type === selectedType
    const statusOk = selectedStatus === 'all' || contract.statusKey === selectedStatus
    return typeOk && statusOk
  })
  const buildInvoiceDoc = (contract: (typeof filteredContracts)[number]) => {
    const doc = new jsPDF()
    const margin = 16
    let y = 20
    const dateFmt = (value: string) =>
      value ? new Date(value).toLocaleDateString('fr-FR') : '-'
    const computeDurationDays = (start: string, end: string) => {
      if (!start || !end) return 1
      const startDate = new Date(start)
      const endDate = new Date(end)
      if (Number.isNaN(+startDate) || Number.isNaN(+endDate) || endDate <= startDate) return 1
      const dayMs = 1000 * 60 * 60 * 24
      return Math.max(1, Math.ceil((+endDate - +startDate) / dayMs))
    }
    const billedDays = computeDurationDays(contract.startAt, contract.endAt)
    const computedTotal = Math.round((contract.dailyPrice || 0) * billedDays)
    const invoiceTotal = computedTotal > 0 ? computedTotal : contract.totalPrice

    const logoData = invoiceProfile.logoDataUrl
    if (logoData) {
      try {
        doc.addImage(logoData, 'JPEG', 150, 12, 42, 20)
      } catch {
        try {
          doc.addImage(logoData, 'PNG', 150, 12, 42, 20)
        } catch {
          // Ignore invalid image format for PDF logo.
        }
      }
    }

    doc.setFontSize(18)
    doc.text(invoiceProfile.companyName || 'JLT - JUST LEASE TECH', margin, y)
    y += 10
    doc.setFontSize(10)
    doc.text(invoiceProfile.companyAddress || '-', margin, y)
    y += 8
    doc.setFontSize(14)
    doc.text(app.invoiceTitle, margin, y)
    y += 10
    doc.setFontSize(11)
    doc.text(`${app.invoiceNumber}: ${contract.id.slice(0, 8).toUpperCase()}`, margin, y)
    y += 8
    doc.text(`${app.invoiceClient}: ${contract.clientName}`, margin, y)
    y += 8
    doc.text(`${app.invoiceVehicle}: ${contract.vehicleName}`, margin, y)
    y += 8
    doc.text(`${app.invoiceStartDate}: ${dateFmt(contract.startAt)}`, margin, y)
    y += 8
    doc.text(`${app.invoiceEndDate}: ${dateFmt(contract.endAt)}`, margin, y)
    y += 8
    doc.text(`${app.invoiceStatus}: ${contract.status}`, margin, y)
    y += 8
    doc.text(`${app.fieldDailyPrice}: ${contract.dailyPrice.toFixed(2)} baths`, margin, y)
    y += 8
    doc.text(`${app.invoiceDays}: ${billedDays}`, margin, y)
    y += 10
    doc.setFontSize(13)
    doc.text(`${app.invoiceTotal}: ${invoiceTotal.toFixed(2)} baths`, margin, y)
    y += 16
    doc.setFontSize(10)
    doc.text(app.invoiceFooter, margin, y)

    const filename = `invoice-${contract.id.slice(0, 8).toUpperCase()}.pdf`
    return { doc, filename }
  }
  const onOpenInvoicePdf = (contract: (typeof filteredContracts)[number]) => {
    setInvoiceFeedback('')
    const { doc } = buildInvoiceDoc(contract)
    const blob = doc.output('blob')
    const blobUrl = URL.createObjectURL(blob)
    setInvoicePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return blobUrl
    })
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

    const { doc, filename } = buildInvoiceDoc(contract)
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
  contractsData,
  onEditContract,
  onDeleteContract,
}: {
  app: any
  contractsData: ContractRow[]
  onEditContract: (contractId: string) => Promise<void>
  onDeleteContract: (contractId: string) => Promise<void>
}) {
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
      contractsData.some((contract) => {
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
        {contractsData.slice(0, 5).map((contract) => (
          <article key={contract.id} className="contract-row">
            <div>
              <h4>{contract.id.slice(0, 8).toUpperCase()}</h4>
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
        ))}
      </div>
    </>
  )
}

function PricingPage({
  pricingPlansData,
  onEditPricingPlan,
  onDeletePricingPlan,
}: {
  pricingPlansData: PricingPlanRow[]
  onEditPricingPlan: (planId: string) => Promise<void>
  onDeletePricingPlan: (planId: string) => Promise<void>
}) {
  const { t } = useI18n()
  const app = t('app')
  const typeLabels = {
    scooter: app.dashboard.vehicleTypes[0],
    car: app.dashboard.vehicleTypes[1],
    bike: app.dashboard.vehicleTypes[2],
  } as const
  const rows = pricingPlansData.map((plan) => ({
    key: plan.id,
    label: `${plan.label} · ${typeLabels[plan.vehicle_type]}`,
    day: plan.day_rate,
    week: plan.week_rate,
    month: plan.month_rate,
  }))
  return (
    <div className="list">
      {rows.length > 0 ? (
        rows.map((row) => (
          <article key={row.key} className="list-item">
            <h4>{row.label}</h4>
            <p>
              {app.rateLabels[0]}: ฿{row.day} | {app.rateLabels[1]}: ฿{row.week} | {app.rateLabels[2]}:{' '}
              ฿{row.month}
            </p>
            <div className="row-actions">
              <button type="button" onClick={() => void onEditPricingPlan(row.key)}>
                {app.edit}
              </button>
              <button type="button" onClick={() => void onDeletePricingPlan(row.key)}>
                {app.delete}
              </button>
            </div>
          </article>
        ))
      ) : (
        <p className="empty-state">{app.emptyPricing}</p>
      )}
    </div>
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

function CartePage({
  app,
  vehiclesData,
}: {
  app: any
  vehiclesData: VehicleRow[]
}) {
  const [positions, setPositions] = useState<Record<string, { lat: string; lng: string }>>({})
  useEffect(() => {
    const raw = localStorage.getItem('jlt-airtag-positions')
    if (!raw) return
    try {
      setPositions(JSON.parse(raw) as Record<string, { lat: string; lng: string }>)
    } catch {
      // Ignore malformed local storage.
    }
  }, [])
  const onSavePosition = () => {
    localStorage.setItem('jlt-airtag-positions', JSON.stringify(positions))
  }
  const onCopyFromFindMy = async (vehicle: VehicleRow) => {
    const template = [
      `${app.mapCopyTemplateTitle}: ${vehicle.brand} ${vehicle.model}`,
      `${app.airtagPlaceholder}: ${vehicle.airtag_code || '-'}`,
      `${app.mapLat}: `,
      `${app.mapLng}: `,
    ].join('\n')
    try {
      await navigator.clipboard.writeText(template)
      window.open('https://www.icloud.com/find', '_blank', 'noopener,noreferrer')
    } catch {
      // Clipboard can fail on some browsers/contexts.
    }
  }
  return (
    <div className="list">
      <article className="list-item">
        <h4>{app.mapTitle}</h4>
        <p>{app.mapSubtitle}</p>
        <iframe
          title="thailand-map"
          src="https://www.openstreetmap.org/export/embed.html?bbox=95.0%2C4.5%2C106.5%2C21.5&layer=mapnik"
          style={{ width: '100%', height: '320px', border: '1px solid #e5e7eb', borderRadius: '8px' }}
        />
      </article>
      <article className="list-item">
        <h4>AirTag</h4>
        {vehiclesData.length === 0 && <p>{app.mapNoVehicles}</p>}
        <div className="list">
          {vehiclesData.map((vehicle) => {
            const name = `${vehicle.brand} ${vehicle.model}`
            const pos = positions[vehicle.id] || { lat: '', lng: '' }
            const mapsLink =
              pos.lat && pos.lng
                ? `https://www.google.com/maps?q=${encodeURIComponent(`${pos.lat},${pos.lng}`)}`
                : ''
            return (
              <article key={vehicle.id} className="contract-row">
                <div>
                  <h4>{name}</h4>
                  <p>{`${app.airtagPlaceholder}: ${vehicle.airtag_code || '-'}`}</p>
                  <div className="row-actions">
                    <input
                      value={pos.lat}
                      onChange={(event) =>
                        setPositions((prev) => ({
                          ...prev,
                          [vehicle.id]: { ...pos, lat: event.target.value },
                        }))
                      }
                      placeholder={app.mapLat}
                    />
                    <input
                      value={pos.lng}
                      onChange={(event) =>
                        setPositions((prev) => ({
                          ...prev,
                          [vehicle.id]: { ...pos, lng: event.target.value },
                        }))
                      }
                      placeholder={app.mapLng}
                    />
                    <button type="button" onClick={onSavePosition}>
                      {app.mapSavePosition}
                    </button>
                    <button type="button" onClick={() => void onCopyFromFindMy(vehicle)}>
                      {app.mapCopyFromFindMy}
                    </button>
                    {mapsLink && (
                      <a href={mapsLink} target="_blank" rel="noreferrer">
                        {app.mapOpenInMaps}
                      </a>
                    )}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      </article>
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
  pricingPlansData: PricingPlanRow[],
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
  onEditPricingPlan: (planId: string) => Promise<void>,
  onDeletePricingPlan: (planId: string) => Promise<void>,
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
          contractsData={contractsData}
          onEditContract={onEditContract}
          onDeleteContract={onDeleteContract}
        />
      )
    case 'pricing':
      return (
        <PricingPage
          pricingPlansData={pricingPlansData}
          onEditPricingPlan={onEditPricingPlan}
          onDeletePricingPlan={onDeletePricingPlan}
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
    case 'carte':
      return <CartePage app={app} vehiclesData={vehiclesData} />
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
  const [invoiceProfile, setInvoiceProfile] = useState<InvoiceProfile>({
    companyName: 'JLT - JUST LEASE TECH',
    companyAddress: 'Thailand',
    logoDataUrl: '',
  })
  const [invoiceProfileDraft, setInvoiceProfileDraft] = useState<InvoiceProfile>({
    companyName: 'JLT - JUST LEASE TECH',
    companyAddress: 'Thailand',
    logoDataUrl: '',
  })
  const [invoiceProfileOpen, setInvoiceProfileOpen] = useState(false)
  const [clientsData, setClientsData] = useState<ClientRow[]>([])
  const [contractsData, setContractsData] = useState<ContractRow[]>([])
  const [pricingPlansData, setPricingPlansData] = useState<PricingPlanRow[]>([])
  const [currentSubscription, setCurrentSubscription] = useState<BillingSubscriptionRow | null>(null)
  const [pendingCheckoutCode, setPendingCheckoutCode] = useState('')
  const [testModeEnabled, setTestModeEnabled] = useState(true)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [editModal, setEditModal] = useState<EditModalState | null>(null)
  const [modalVehiclePhoto, setModalVehiclePhoto] = useState<File | null>(null)
  const [modalInspectionPhotos, setModalInspectionPhotos] = useState<File[]>([])
  const [savingModal, setSavingModal] = useState(false)
  const [modalError, setModalError] = useState('')
  const [loadError, setLoadError] = useState('')
  const currentIndex = Math.max(0, menuMeta.findIndex((item) => item.key === section))
  const refreshAppData = async () => {
    setLoadError('')
    const {
      data: { session },
    } = await supabase.auth.getSession()
    const ownerId = session?.user?.id
    if (!ownerId) return
    setCurrentUserId(ownerId)

    const [vehiclesRes, clientsRes, contractsRes, pricingPlansRes, revisionsRes, subscriptionRes] = await Promise.all([
      supabase.from('vehicles').select('id,type,brand,model,status,daily_price'),
      supabase.from('clients').select('id,full_name,phone,email'),
      supabase.from('contracts').select('id,client_id,vehicle_id,start_at,end_at,total_price,status,created_at'),
      supabase.from('pricing_plans').select('id,label,vehicle_type,day_rate,week_rate,month_rate,active'),
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
    if (!pricingPlansRes.error && pricingPlansRes.data) {
      setPricingPlansData(pricingPlansRes.data as PricingPlanRow[])
    }
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
      pricingPlansRes.error?.message ||
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
    const stored = localStorage.getItem('jlt-invoice-profile')
    if (!stored) return
    try {
      const parsed = JSON.parse(stored) as InvoiceProfile
      const normalized = {
        companyName: parsed.companyName || 'JLT - JUST LEASE TECH',
        companyAddress: parsed.companyAddress || 'Thailand',
        logoDataUrl: parsed.logoDataUrl || '',
      }
      setInvoiceProfile(normalized)
      setInvoiceProfileDraft(normalized)
    } catch {
      // Ignore malformed local storage content.
    }
  }, [])
  useEffect(() => {
    if (isPublicDemoMode) {
      setTestModeEnabled(true)
      return
    }
    const stored = localStorage.getItem('jlt-test-mode')
    if (stored === 'false') setTestModeEnabled(false)
  }, [])

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
    setEditModal({
      mode: 'edit',
      kind: 'client',
      id: clientId,
      values: {
        full_name: row.full_name,
        phone: row.phone || '',
        email: row.email || '',
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
    setEditModal({
      mode: 'edit',
      kind: 'contract',
      id: contractId,
      values: {
        client_id: row.client_id || '',
        vehicle_id: row.vehicle_id || '',
        total_price: String(row.total_price ?? 0),
        start_at: normalizedStart,
        end_at: normalizedEnd,
        status: row.status,
      },
    })
  }

  const onDeletePricingPlan = async (planId: string) => {
    if (!window.confirm(app.confirmDeletePricing)) return
    const { error } = await supabase.from('pricing_plans').delete().eq('id', planId)
    if (!error) await refreshAppData()
  }

  const onEditPricingPlan = async (planId: string) => {
    const row = pricingPlansData.find((item) => item.id === planId)
    if (!row) return
    setEditModal({
      mode: 'edit',
      kind: 'pricing',
      id: planId,
      values: {
        label: row.label,
        day_rate: String(row.day_rate),
        week_rate: String(row.week_rate),
        month_rate: String(row.month_rate),
        vehicle_type: row.vehicle_type,
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
      if (!isPositive(editModal.values.total_price)) {
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
    const {
      data: { session },
    } = await supabase.auth.getSession()
    const ownerId = currentUserId || session?.user?.id || null

    if (editModal.mode === 'create' && !ownerId) {
      setSavingModal(false)
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
      const { error } = await supabase
        .from('clients')
        .update({
          full_name: editModal.values.full_name,
          phone: editModal.values.phone || null,
          email: editModal.values.email || null,
        })
        .eq('id', editModal.id)
      if (error) requestError = error.message
    }
    if (editModal.kind === 'contract' && editModal.mode === 'edit') {
      const selectedClient = clientsData.find((client) => client.id === editModal.values.client_id)
      const selectedVehicle = vehiclesData.find((vehicle) => vehicle.id === editModal.values.vehicle_id)
      const fullPayload = {
        client_id: editModal.values.client_id,
        vehicle_id: editModal.values.vehicle_id,
        client_name: selectedClient?.full_name || '',
        vehicle_label: selectedVehicle
          ? `${selectedVehicle.brand} ${selectedVehicle.model}`.trim()
          : '',
        total_price: Number(editModal.values.total_price || 0),
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
          total_price: Number(editModal.values.total_price || 0),
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
    if (editModal.kind === 'pricing' && editModal.mode === 'edit') {
      const { error } = await supabase
        .from('pricing_plans')
        .update({
          label: editModal.values.label,
          day_rate: Number(editModal.values.day_rate || 0),
          week_rate: Number(editModal.values.week_rate || 0),
          month_rate: Number(editModal.values.month_rate || 0),
          vehicle_type: editModal.values.vehicle_type as PricingPlanRow['vehicle_type'],
        })
        .eq('id', editModal.id)
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
        const filePath = `${ownerId}/${createdVehicle.id}/${Date.now()}.${extension}`
        const { error: uploadError } = await supabase.storage
          .from('vehicle-photos')
          .upload(filePath, compressedPhoto, {
            cacheControl: '3600',
            upsert: false,
            contentType: compressedPhoto.type || 'image/jpeg',
          })
        if (uploadError) {
          requestError = uploadError.message
        } else {
          const vehicleLabel = `${createdVehicle.brand} ${createdVehicle.model}`.trim()
          const { error: photoInsertError } = await supabase.from('vehicle_photos').insert({
            owner_id: ownerId,
            vehicle_label: vehicleLabel,
            file_path: filePath,
          })
          if (photoInsertError) requestError = photoInsertError.message
        }
      }
    }
    if (editModal.kind === 'client' && editModal.mode === 'create' && ownerId) {
      const { error } = await supabase.from('clients').insert({
        owner_id: ownerId,
        full_name: editModal.values.full_name,
        phone: editModal.values.phone || null,
        email: editModal.values.email || null,
      })
      if (error) requestError = error.message
    }
    if (editModal.kind === 'contract' && editModal.mode === 'create' && ownerId) {
      const selectedClient = clientsData.find((client) => client.id === editModal.values.client_id)
      const selectedVehicle = vehiclesData.find((vehicle) => vehicle.id === editModal.values.vehicle_id)
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
        total_price: Number(editModal.values.total_price || 0),
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
          total_price: Number(editModal.values.total_price || 0),
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
      setSavingModal(false)
      setModalError(requestError)
      return
    }

    setSavingModal(false)
    closeModal()
    await refreshAppData()
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
      setEditModal({
        mode: 'create',
        kind: 'client',
        id: '',
        values: { full_name: '', phone: '', email: '' },
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
          total_price: '',
          start_at: '',
          end_at: '',
          status: 'draft',
          inspection_notes: '',
        },
      })
      return
    }
    if (section === 'pricing' || section === 'abonnement') {
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
  const computedContractTotal =
    selectedModalVehicle && contractStartDate && contractEndDate
      ? (() => {
          const start = new Date(contractStartDate)
          const end = new Date(contractEndDate)
          if (Number.isNaN(+start) || Number.isNaN(+end) || end <= start) return null
          const dayMs = 1000 * 60 * 60 * 24
          const days = Math.max(1, Math.ceil((+end - +start) / dayMs))
          return Math.round(days * Number(selectedModalVehicle.daily_price || 0))
        })()
      : null
  const sectionSubtitleMap: Record<string, string> = {
    dashboard: app.subtitles[0] || '',
    vehicules: `${vehiclesData.length} ${app.subtitles[1]?.replace(/^.*?(\d+\s+)/, '') || ''}`.trim(),
    clients: `${clientsData.length} ${d.registered}`,
    contrats: `${contractsData.length} ${app.subtitles[3]?.replace(/^.*?(\d+\s+)/, '') || ''}`.trim(),
    planning: app.subtitles[4] || '',
    pricing: `${pricingPlansData.length} ${app.subtitles[5]?.replace(/^.*?(\d+\s+)/, '') || ''}`.trim(),
    abonnement: `${pricingPlansData.length} ${app.subtitles[6]?.replace(/^.*?(\d+\s+)/, '') || ''}`.trim(),
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
          <div>
            <h1>{app.menu[currentIndex] || app.menu[0]}</h1>
            <p>{sectionSubtitle}</p>
            <div className="invoice-profile-preview">
              {invoiceProfile.logoDataUrl ? (
                <img src={invoiceProfile.logoDataUrl} alt="invoice-logo" />
              ) : (
                <div className="invoice-profile-logo-placeholder">LOGO</div>
              )}
              <div>
                <strong>{invoiceProfile.companyName}</strong>
                <p>{invoiceProfile.companyAddress}</p>
              </div>
            </div>
          </div>
          <div className="top-actions">
            <button type="button" className="ghost-btn">
              <Bell size={14} />
              {notificationCount > 0 && <span className="notif-badge">{notificationCount}</span>}
            </button>
            <button type="button" className="ghost-btn" onClick={() => setInvoiceProfileOpen(true)}>
              {app.invoiceProfile}
            </button>
            <button type="button" className="accent-btn" onClick={onOpenCreateModal}>
              <Plus size={14} />
              {app.actions[currentIndex] || app.actions[0]}
            </button>
          </div>
        </header>

        <div className="toolbar">
          <div className="search-box">
            <Search size={14} />
            <input
              placeholder={app.search}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </div>
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
        </div>

        <div className="dashboard-content">
          {loadError && <p className="modal-error">{loadError}</p>}
          {section !== 'abonnement' && !hasAccess ? (
            <article className="list-item">
              <h4>{app.billingLockedTitle}</h4>
              <p>{app.billingLockedDesc}</p>
              <Link to="/app/abonnement" className="see-all-link">
                {app.menu[6]}
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
              pricingPlansData,
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
              onEditPricingPlan,
              onDeletePricingPlan,
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
                  <label className="modal-file-input">
                    <span>{app.vehiclePhotoCta}</span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={(event) => setModalVehiclePhoto(event.target.files?.[0] ?? null)}
                    />
                  </label>
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
                  <input value={editModal.values.full_name || ''} onChange={(e) => setEditModal((p) => (p ? { ...p, values: { ...p.values, full_name: e.target.value } } : p))} placeholder={app.fieldFullName} />
                  <input value={editModal.values.phone || ''} onChange={(e) => setEditModal((p) => (p ? { ...p, values: { ...p.values, phone: e.target.value } } : p))} placeholder={app.fieldPhone} />
                  <input value={editModal.values.email || ''} onChange={(e) => setEditModal((p) => (p ? { ...p, values: { ...p.values, email: e.target.value } } : p))} placeholder={app.fieldEmail} />
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
                            total_price:
                              p.mode === 'create' && nextVehicle
                                ? String(nextVehicle.daily_price || 0)
                                : p.values.total_price,
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
                  <input
                    type="date"
                    value={editModal.values.start_at || ''}
                    onChange={(e) =>
                      setEditModal((p) => (p ? { ...p, values: { ...p.values, start_at: e.target.value } } : p))
                    }
                    placeholder={app.fieldStartAt}
                  />
                  <input
                    type="date"
                    value={editModal.values.end_at || ''}
                    min={editModal.values.start_at || undefined}
                    onChange={(e) =>
                      setEditModal((p) => (p ? { ...p, values: { ...p.values, end_at: e.target.value } } : p))
                    }
                    placeholder={app.fieldEndAt}
                  />
                  <input
                    value={editModal.values.total_price || ''}
                    onChange={(e) =>
                      setEditModal((p) => (p ? { ...p, values: { ...p.values, total_price: e.target.value } } : p))
                    }
                    placeholder={app.fieldTotalPrice}
                  />
                  {selectedModalVehicle && (
                    <p className="modal-hint">
                      {`${app.dailyRateHint}: ฿${selectedModalVehicle.daily_price}`}
                      {computedContractTotal !== null
                        ? ` • ${app.suggestedTotalHint}: ฿${computedContractTotal}`
                        : ''}
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
                      <label className="modal-file-input">
                        <span>{app.contractInspectionPhotosCta}</span>
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          multiple
                          onChange={(event) => {
                            const files = Array.from(event.target.files ?? [])
                            setModalInspectionPhotos((prev) => [...prev, ...files])
                            event.target.value = ''
                          }}
                        />
                      </label>
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
            <div className="modal-card">
              <h3>{app.invoiceProfile}</h3>
              <input
                value={invoiceProfileDraft.companyName}
                onChange={(event) =>
                  setInvoiceProfileDraft((prev) => ({ ...prev, companyName: event.target.value }))
                }
                placeholder={app.invoiceCompanyName}
              />
              <input
                value={invoiceProfileDraft.companyAddress}
                onChange={(event) =>
                  setInvoiceProfileDraft((prev) => ({ ...prev, companyAddress: event.target.value }))
                }
                placeholder={app.invoiceCompanyAddress}
              />
              <label className="photo-upload-btn">
                {app.invoiceClientLogo}
                <input type="file" accept="image/*" onChange={onGlobalInvoiceLogoChange} />
              </label>
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
      </section>
    </div>
  )
}
