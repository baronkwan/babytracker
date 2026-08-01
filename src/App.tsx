import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { BabyProfile, ExcreteLog, FeedLog, FeedType, LogEntry, TabId, Unit } from './lib/types'
import { DEFAULT_BABY, DURATION_CHIPS, POOP_COLORS, POOP_TEXTURES, VOLUME_CHIPS_ML } from './lib/types'
import { combineLogs, loadBaby, loadExcretes, loadFeeds, makeId, saveAll } from './lib/storage'
import {
  ageLabel,
  buildDoctorText,
  excreteLabel,
  feedTypeLabel,
  fmtAgo,
  fmtDateTime,
  lastNDaysKeys,
  sideLabel,
  todayExcretes,
  todayFeeds,
  toDisplayVolume,
  unitLabel,
} from './lib/utils'
import { api, setToken, clearToken, getToken } from './lib/api'
import {
  BarChart3,
  Check,
  Copy,
  Droplets,
  History as HistoryIcon,
  Home as HomeIcon,
  LogOut,
  Milk,
  MoonStar,
  Settings,
  Stethoscope,
  Sun,
  UserPlus,
  X,
} from 'lucide-react'

// ──────────────────────────────────────────────

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') return (localStorage.getItem('theme') as 'light' | 'dark') || 'light'
    return 'light'
  })
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem('theme', theme)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0b1220' : '#f8fafc')
  }, [theme])
  return { theme, toggleTheme: () => setTheme(t => t === 'dark' ? 'light' : 'dark') }
}

function useAuth() {
  const [token, setTokenState] = useState<string | null>(getToken())
  const login = async (username: string, password: string) => {
    const res = await api.login(username, password)
    setToken(res.token)
    setTokenState(res.token)
    return res
  }
  const logout = () => { clearToken(); setTokenState(null) }
  return { token, login, logout }
}

// MAIN APP
// ──────────────────────────────────────────────
export default function App() {
  const [baby, setBaby] = useState<BabyProfile>(DEFAULT_BABY)
  const [feeds, setFeeds] = useState<FeedLog[]>([])
  const [excretes, setExcretes] = useState<ExcreteLog[]>([])
  const [tab, setTab] = useState<TabId>('home')
  const [loaded, setLoaded] = useState(false)
  const [showAdmin, setShowAdmin] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const { theme, toggleTheme } = useTheme()
  const { token, login, logout } = useAuth()

  useEffect(() => {
    setBaby(loadBaby())
    setFeeds(loadFeeds())
    setExcretes(loadExcretes())
    setLoaded(true)
  }, [])

  // Server rows lack `kind` — add it back when hydrating.
  const toFeed = (r: Record<string, unknown>): FeedLog => ({
    id: String(r.id),
    kind: 'feed',
    timestamp: String(r.timestamp),
    type: r.type === 'formula' ? 'formula' : 'breast',
    volume: Number(r.volume) || 0,
    duration: Number(r.duration) || 0,
    side: (r.side as FeedLog['side']) || null,
    notes: String(r.notes ?? ''),
  })
  const toExcrete = (r: Record<string, unknown>): ExcreteLog => ({
    id: String(r.id),
    kind: 'excrete',
    timestamp: String(r.timestamp),
    type: r.type === 'poop' || r.type === 'both' ? (r.type as ExcreteLog['type']) : 'wet',
    color: String(r.color ?? ''),
    consistency: String(r.consistency ?? ''),
    notes: String(r.notes ?? ''),
  })
  const toBaby = (r: Record<string, unknown> | null): BabyProfile => ({
    ...DEFAULT_BABY,
    ...(r
      ? {
          name: String(r.name ?? DEFAULT_BABY.name),
          dob: String(r.dob ?? DEFAULT_BABY.dob),
          gender: r.gender === '男' ? '男' : '女',
          birthWeight: Number(r.birth_weight) || 0,
          unit: r.unit === 'oz' ? 'oz' : 'ml',
        }
      : {}),
  })

  // Server ∪ local by id — local-only rows (offline / failed push) survive a refresh.
  const mergeById = <T extends { id: string }>(local: T[], server: T[]): T[] => {
    const m = new Map<string, T>()
    for (const x of [...local, ...server]) m.set(x.id, x)
    return [...m.values()]
  }

  const refreshFromServer = useCallback(async () => {
    const data = await api.getData()
    const baby = toBaby(data.baby)
    const localFeeds = loadFeeds()
    const localExcretes = loadExcretes()
    const sf = (data.feeds ?? []).map(toFeed)
    const se = (data.excretes ?? []).map(toExcrete)
    // Backfill: push local-only rows (offline / failed push / pre-sync data) up to the server.
    // Fire-and-forget; a rejected push surfaces the banner once the promise settles.
    const serverFeedIds = new Set(sf.map((f) => f.id))
    const serverExcreteIds = new Set(se.map((e) => e.id))
    for (const f of localFeeds) {
      if (!serverFeedIds.has(f.id)) api.addFeed(f).catch(() => setSyncError('⚠️ 部分本機記錄未能上傳，將於下次同步重試'))
    }
    for (const e of localExcretes) {
      if (!serverExcreteIds.has(e.id)) api.addExcrete(e).catch(() => setSyncError('⚠️ 部分本機記錄未能上傳，將於下次同步重試'))
    }
    const mf = mergeById(localFeeds, sf)
    const me = mergeById(localExcretes, se)
    setBaby(baby)
    setFeeds(mf)
    setExcretes(me)
    saveAll(baby, mf, me)
    setSyncError(null)
  }, [])

  // Refresh from cloud whenever a token appears (login or stored token on reload).
  useEffect(() => {
    if (!token) return
    refreshFromServer().catch(() => setSyncError('⚠️ 無法讀取雲端資料 — 顯示本機資料'))
  }, [token, refreshFromServer])

  const persist = useCallback(
    (b: BabyProfile, f: FeedLog[], e: ExcreteLog[]) => {
      saveAll(b, f, e)
      setBaby(b)
      setFeeds(f)
      setExcretes(e)
    },
    [],
  )

  // Optimistic local write + push to server. Failure keeps local change and shows a banner.
  const push = useCallback((fn: () => Promise<unknown>) => {
    fn().then(() => setSyncError(null)).catch(() => setSyncError('⚠️ 同步失敗 — 改動僅存本機，下次成功同步後合併'))
  }, [])

  const addFeed = useCallback(
    (log: FeedLog) => {
      const f = [log, ...feeds]
      persist(baby, f, excretes)
      push(() => api.addFeed(log))
    },
    [baby, feeds, excretes, persist, push],
  )

  const addExcrete = useCallback(
    (log: ExcreteLog) => {
      const e = [log, ...excretes]
      persist(baby, feeds, e)
      push(() => api.addExcrete(log))
    },
    [baby, feeds, excretes, persist, push],
  )

  const saveBaby = useCallback(
    (b: BabyProfile) => {
      persist(b, feeds, excretes)
      push(() => api.saveBaby(b))
    },
    [feeds, excretes, persist, push],
  )

  const deleteLog = useCallback(
    (id: string, kind: 'feed' | 'excrete') => {
      const f = kind === 'feed' ? feeds.filter((x) => x.id !== id) : feeds
      const e = kind === 'excrete' ? excretes.filter((x) => x.id !== id) : excretes
      persist(baby, f, e)
      push(() => api.deleteLog(id, kind))
    },
    [baby, feeds, excretes, persist, push],
  )

  const resetAll = useCallback(() => {
    if (!window.confirm('清除所有記錄？此操作無法復原。')) return
    const b = { ...DEFAULT_BABY, dob: baby.dob }
    persist(b, [], [])
    push(() => api.deleteAll())
  }, [baby.dob, persist, push])

  const allLogs = useMemo(() => combineLogs(feeds, excretes), [feeds, excretes])

  if (!loaded && token) return <Splash />

  return (
    <>
      {!token ? (
        <LoginScreen onLogin={login} onOpenAdmin={() => setShowAdmin(true)} />
      ) : (
        <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col bg-[var(--bg)]">
          <Header baby={baby} tab={tab} feeds={feeds} excretes={excretes} saveBaby={saveBaby} resetAll={resetAll} theme={theme} toggleTheme={toggleTheme} onLogout={logout} onOpenAdmin={() => setShowAdmin(true)} />
          {syncError && (
            <div className="mx-4 mt-2 rounded-xl bg-[var(--red)]/10 px-3 py-2 text-xs font-medium text-[var(--red)]">{syncError}</div>
          )}
          <main className="safe-pb flex-1 px-4 pt-3">
            {tab === 'home' && <Home baby={baby} feeds={feeds} excretes={excretes} allLogs={allLogs} deleteLog={deleteLog} setTab={setTab} />}
            {tab === 'feed' && <FeedForm baby={baby} addFeed={addFeed} setTab={setTab} />}
            {tab === 'excrete' && <ExcreteForm addExcrete={addExcrete} setTab={setTab} />}
            {tab === 'history' && <History allLogs={allLogs} deleteLog={deleteLog} unit={baby.unit} />}
            {tab === 'charts' && <Charts feeds={feeds} excretes={excretes} unit={baby.unit} />}
          </main>
          <BottomNav tab={tab} setTab={setTab} />
        </div>
      )}
      {showAdmin && <AdminCreateUser onClose={() => setShowAdmin(false)} />}
    </>
  )
}

// ──────────────────────────────────────────────
// SPLASH
// ──────────────────────────────────────────────
function Splash() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[var(--bg)]">
      <div className="flex flex-col items-center gap-3">
        <div className="rounded-2xl bg-gradient-to-br from-[var(--teal)] to-[var(--pink)] p-4 shadow-lg">
          <span className="text-4xl">👶</span>
        </div>
        <span className="text-lg font-semibold tracking-tight">BabyLog</span>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
// HEADER
// ──────────────────────────────────────────────
function Header({
  baby,
  tab,
  feeds,
  excretes,
  saveBaby,
  resetAll,
  theme,
  toggleTheme,
  onLogout,
  onOpenAdmin,
}: {
  baby: BabyProfile
  tab: TabId
  feeds: FeedLog[]
  excretes: ExcreteLog[]
  saveBaby: (b: BabyProfile) => void
  resetAll: () => void
  theme: 'light' | 'dark'
  toggleTheme: () => void
  onLogout: () => void
  onOpenAdmin: () => void
}) {
  const [showSettings, setShowSettings] = useState(false)
  const [showReport, setShowReport] = useState(false)
  const titles: Record<TabId, string> = {
    home: '首頁',
    feed: '餵奶',
    excrete: '排泄',
    history: '歷史',
    charts: '圖表',
  }

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--bg)]/90 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--teal)] to-[var(--pink)] shadow-md">
              <span className="text-xl">👶</span>
            </div>
            <div>
              <div className="text-sm font-semibold">{baby.name}</div>
              <div className="text-xs text-[var(--muted)]">{ageLabel(baby.dob)}</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={toggleTheme} aria-label="切換主題" className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] active:bg-[var(--surface2)]">
              {theme === 'dark' ? <Sun size={18} /> : <MoonStar size={18} />}
            </button>
            <button
              onClick={() => setShowReport(true)}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] active:bg-[var(--surface2)]"
              aria-label="報告"
            >
              <Stethoscope size={18} />
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] active:bg-[var(--surface2)]"
              aria-label="設定"
            >
              <Settings size={18} />
            </button>
            <button
              onClick={onOpenAdmin}
              aria-label="建立用戶"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] active:bg-[var(--surface2)]"
            >
              <UserPlus size={18} />
            </button>
            <button onClick={onLogout} aria-label="登出" className="flex h-9 w-9 items-center justify-center text-[var(--muted)] active:text-[var(--red)]">
              <LogOut size={18} />
            </button>
          </div>
        </div>
        <div className="mt-1 text-xl font-bold tracking-tight text-[var(--text)]">{titles[tab]}</div>
      </header>

      {showSettings && <SettingsModal baby={baby} saveBaby={saveBaby} resetAll={resetAll} onClose={() => setShowSettings(false)} />}
      {showReport && <ReportModal baby={baby} feeds={feeds} excretes={excretes} onClose={() => setShowReport(false)} />}
    </>
  )
}

// ──────────────────────────────────────────────
// BOTTOM NAV
// ──────────────────────────────────────────────
function BottomNav({ tab, setTab }: { tab: TabId; setTab: (t: TabId) => void }) {
  const items: { id: TabId; icon: ReactNode; label: string }[] = [
    { id: 'home', icon: <HomeIcon size={24} />, label: '首頁' },
    { id: 'feed', icon: <Milk size={24} />, label: '餵奶' },
    { id: 'excrete', icon: <Droplets size={24} />, label: '排泄' },
    { id: 'history', icon: <HistoryIcon size={24} />, label: '歷史' },
    { id: 'charts', icon: <BarChart3 size={24} />, label: '圖表' },
  ]

  return (
    <nav className="safe-bottom-nav fixed bottom-0 left-0 right-0 z-40 mx-auto max-w-[480px] border-t border-[var(--border)] bg-[var(--surface)]/95 px-1 backdrop-blur-xl">
      <div className="grid h-16 grid-cols-5">
        {items.map((it) => {
          const active = it.id === tab
          return (
            <button
              key={it.id}
              onClick={() => setTab(it.id)}
              className="nav-item flex flex-col items-center justify-center gap-0.5 text-xs"
              style={{ color: active ? 'var(--teal)' : 'var(--muted)' }}
            >
              {it.icon}
              <span>{it.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}

// ──────────────────────────────────────────────
// HOME TAB
// ──────────────────────────────────────────────
function Home({
  baby,
  feeds,
  excretes,
  allLogs,
  deleteLog,
  setTab,
}: {
  baby: BabyProfile
  feeds: FeedLog[]
  excretes: ExcreteLog[]
  allLogs: LogEntry[]
  deleteLog: (id: string, kind: 'feed' | 'excrete') => void
  setTab: (t: TabId) => void
}) {
  const tf = todayFeeds(feeds)
  const te = todayExcretes(excretes)
  const vol = tf.reduce((s, f) => s + (f.volume || 0), 0)
  const wet = te.filter((e) => e.type === 'wet' || e.type === 'both').length
  const poop = te.filter((e) => e.type === 'poop' || e.type === 'both').length

  const lastF = feeds.slice().sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp))[0]
  const lastE = excretes.slice().sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp))[0]

  return (
    <div className="space-y-4 rise">
      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => setTab('feed')}
          className="card flex items-center gap-3 rounded-2xl p-4 text-left transition-transform active:scale-[0.98]"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--teal-dim)] text-[var(--teal)]"><Milk size={20} /></div>
          <div>
            <div className="text-sm font-semibold">記錄餵奶</div>
            <div className="text-xs text-[var(--muted)]">份量時長邊別</div>
          </div>
        </button>
        <button
          onClick={() => setTab('excrete')}
          className="card flex items-center gap-3 rounded-2xl p-4 text-left transition-transform active:scale-[0.98]"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--pink-dim)] text-[var(--pink)]"><Droplets size={20} /></div>
          <div>
            <div className="text-sm font-semibold">記錄排泄</div>
            <div className="text-xs text-[var(--muted)]">尿布大便詳情</div>
          </div>
        </button>
      </div>

      {/* Today stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="card rounded-2xl p-4">
          <div className="mb-1 text-xs text-[var(--muted)]">今日餵奶</div>
          <div className="flex items-baseline gap-1">
            <span className="num text-3xl font-bold text-[var(--teal)]">{tf.length}</span>
            <span className="text-sm text-[var(--muted)]">次</span>
          </div>
          <div className="mt-0.5 text-sm font-semibold">{vol} {unitLabel(baby.unit)}</div>
          {lastF && <div className="mt-1 text-xs text-[var(--muted)]">上次 · {fmtAgo(lastF.timestamp)}</div>}
        </div>
        <div className="card rounded-2xl p-4">
          <div className="mb-1 text-xs text-[var(--muted)]">今日排泄</div>
          <div className="flex items-baseline gap-1">
            <span className="num text-3xl font-bold text-[var(--pink)]">{te.length}</span>
            <span className="text-sm text-[var(--muted)]">次</span>
          </div>
          <div className="mt-0.5 flex gap-3 text-xs">
            <span>濕 <strong className="font-semibold text-[var(--blue)]">{wet}</strong></span>
            <span>便 <strong className="font-semibold text-[var(--amber)]">{poop}</strong></span>
          </div>
          {lastE && <div className="mt-1 text-xs text-[var(--muted)]">上次 · {fmtAgo(lastE.timestamp)}</div>}
        </div>
      </div>

      {/* Recent */}
      <div>
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)] section-label">最近紀錄</span>
          <button onClick={() => setTab('history')} className="text-xs text-[var(--teal)] active:text-[var(--teal-dim)]">
            查看全部 →
          </button>
        </div>
        <div className="space-y-2">
          {allLogs.slice(0, 5).length === 0 && (
            <div className="card rounded-2xl p-5 text-center text-sm text-[var(--muted)]">尚無記錄，開始記錄吧 👆</div>
          )}
          {allLogs.slice(0, 5).map((log) => (
            <LogCard key={log.id} log={log} unit={baby.unit} onDelete={() => deleteLog(log.id, log.kind)} />
          ))}
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
// LOG CARD (shared)
// ──────────────────────────────────────────────
function LogCard({ log, unit, bare = false, onDelete }: { log: LogEntry; unit: Unit; bare?: boolean; onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false)

  if (log.kind === 'feed') {
    return (
      <div className={`${bare ? '' : 'card rounded-2xl'} p-3.5 rise`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0 flex-1">
            <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--teal-dim)] text-[var(--teal)]"><Milk size={14} /></span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-semibold">{feedTypeLabel(log.type)}</span>
                {log.volume > 0 && <Badge color="var(--teal)" label={`${toDisplayVolume(log.volume, unit)} ${unitLabel(unit)}`} />}
              </div>
              <div className="text-xs text-[var(--muted)]">
                {fmtDateTime(log.timestamp)}
                {log.duration > 0 && ` · ${log.duration}min`}
                {log.side && ` · ${sideLabel(log.side)}`}
              </div>
              {log.notes && <div className="mt-1 text-xs italic text-[var(--muted)]">{log.notes}</div>}
            </div>
          </div>
          {confirm ? (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete() }}
              className="flex-shrink-0 rounded-lg bg-[var(--red)]/10 px-2 py-1 text-xs font-semibold text-[var(--red)] active:bg-[var(--red)]/20"
            >
              確認?
            </button>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); setConfirm(true); setTimeout(() => setConfirm(false), 3000) }}
              className="flex-shrink-0 text-[var(--muted)] active:text-[var(--red)]"
              aria-label="刪除"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={`${bare ? '' : 'card rounded-2xl'} p-3.5 rise`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0 flex-1">
          <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--pink-dim)] text-[var(--pink)]"><Droplets size={14} /></span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-semibold">{excreteLabel(log.type)}</span>
              {log.color && <Badge color="var(--amber)" label={log.color} />}
            </div>
            <div className="text-xs text-[var(--muted)]">{fmtDateTime(log.timestamp)}{log.consistency ? ` · ${log.consistency}` : ''}</div>
            {log.notes && <div className="mt-1 text-xs italic text-[var(--muted)]">{log.notes}</div>}
          </div>
        </div>
        {confirm ? (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            className="flex-shrink-0 rounded-lg bg-[var(--red)]/10 px-2 py-1 text-xs font-semibold text-[var(--red)] active:bg-[var(--red)]/20"
          >
            確認?
          </button>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); setConfirm(true); setTimeout(() => setConfirm(false), 3000) }}
            className="flex-shrink-0 text-[var(--muted)] active:text-[var(--red)]"
            aria-label="刪除"
          >
            <X size={16} />
          </button>
        )}
      </div>
    </div>
  )
}

function Badge({ color, label }: { color: string; label: string }) {
  return (
    <span
      className="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold"
      style={{ backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`, color }}
    >
      {label}
    </span>
  )
}

// ──────────────────────────────────────────────
// FEED FORM
// ──────────────────────────────────────────────
function FeedForm({ baby, addFeed, setTab }: { baby: BabyProfile; addFeed: (f: FeedLog) => void; setTab: (t: TabId) => void }) {
  const [type, setType] = useState<FeedType>('breast')
  const [volume, setVolume] = useState('')
  const [duration, setDuration] = useState('')
  const [side, setSide] = useState<FeedLog['side']>('both')
  const [notes, setNotes] = useState('')

  const save = () => {
    addFeed({
      id: makeId(),
      kind: 'feed',
      timestamp: new Date().toISOString(),
      type,
      volume: Number(volume) || 0,
      duration: Number(duration) || 0,
      side: type === 'breast' ? (side || 'both') : null,
      notes: notes.trim(),
    })
    setVolume(''); setDuration(''); setNotes('')
    setTab('home')
  }

  return (
    <div className="space-y-4 rise">
      <div className="card rounded-2xl p-4">
        <div className="mb-3 flex">
          <button
            onClick={() => setType('breast')}
            className={`chip flex-1 text-center ${type === 'breast' ? 'active' : ''}`}
          >
            母乳
          </button>
          <div className="w-2" />
          <button
            onClick={() => setType('formula')}
            className={`chip flex-1 text-center ${type === 'formula' ? 'active' : ''}`}
          >
            配方奶
          </button>
        </div>

        {/* Volume */}
        <div className="mb-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            份量 ({unitLabel(baby.unit)})
          </div>
          <div className="flex flex-wrap gap-2">
            {VOLUME_CHIPS_ML.map((v) => (
              <button
                key={v}
                onClick={() => setVolume(String(v))}
                className={`chip text-sm ${String(v) === volume ? 'active' : ''}`}
              >
                {toDisplayVolume(v, baby.unit)}
              </button>
            ))}
          </div>
          <input
            value={volume}
            onChange={(e) => setVolume(e.target.value)}
            placeholder="自訂"
            inputMode="numeric"
            className="field mt-2"
          />
        </div>

        {/* Duration */}
        <div className="mb-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">時長 (分鐘)</div>
          <div className="flex flex-wrap gap-2">
            {DURATION_CHIPS.map((v) => (
              <button
                key={v}
                onClick={() => setDuration(String(v))}
                className={`chip text-sm ${String(v) === duration ? 'active' : ''}`}
              >
                {v} min
              </button>
            ))}
          </div>
          <input
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            placeholder="自訂"
            inputMode="numeric"
            className="field mt-2"
          />
        </div>

        {/* Side (breast only) */}
        {type === 'breast' && (
          <div className="mb-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">邊別</div>
            <div className="flex gap-2">
              {(['left', 'right', 'both'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSide(s)}
                  className={`chip flex-1 text-center ${side === s ? 'active' : ''}`}
                >
                  {sideLabel(s)}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        <div className="mb-5">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">備註</div>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="選填 · 如：很乖，吃得很開心"
            className="field"
          />
        </div>

        <button onClick={save} className="btn-primary flex items-center justify-center gap-2">
          ✓ 儲存餵奶記錄
        </button>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
// EXCRETE FORM
// ──────────────────────────────────────────────
function ExcreteForm({ addExcrete, setTab }: { addExcrete: (e: ExcreteLog) => void; setTab: (t: TabId) => void }) {
  const [type, setType] = useState<'wet' | 'poop' | 'both'>('wet')
  const [color, setColor] = useState('')
  const [texture, setTexture] = useState('')
  const [notes, setNotes] = useState('')

  const save = () => {
    addExcrete({
      id: makeId(),
      kind: 'excrete',
      timestamp: new Date().toISOString(),
      type,
      color: type !== 'wet' ? color : '',
      consistency: type !== 'wet' ? texture : '',
      notes: notes.trim(),
    })
    setColor(''); setTexture(''); setNotes('')
    setTab('home')
  }

  const showPoop = type === 'poop' || type === 'both'

  return (
    <div className="space-y-4 rise">
      <div className="card rounded-2xl p-4">
        <div className="mb-4 flex gap-2">
          {(['wet', 'poop', 'both'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`chip flex-1 text-center text-sm ${
                t === 'wet' ? 'active' : t === 'poop' ? 'pink active' : ''
              } ${type === t ? (t === 'wet' ? 'active' : 'pink active') : ''}`}
              style={t === 'wet' && type === t ? { borderColor: 'var(--blue)', background: 'rgba(96,165,250,.14)', color: 'var(--blue)' } : {}} // handled by CSS class for others
            >
              {t === 'wet' ? '濕尿布' : t === 'poop' ? '大便' : '兩者'}
            </button>
          ))}
        </div>

        {showPoop && (
          <div className="mb-4 grid grid-cols-2 gap-3">
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">顏色</div>
              <div className="flex flex-wrap gap-1.5">
                {POOP_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={`chip text-sm ${c === color ? 'pink active' : ''}`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">質地</div>
              <div className="flex flex-wrap gap-1.5">
                {POOP_TEXTURES.map((t) => (
                  <button
                    key={t}
                    onClick={() => setTexture(t)}
                    className={`chip text-sm ${t === texture ? 'pink active' : ''}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="mb-5">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">備註</div>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="選填 · 如：大便量多"
            className="field"
          />
        </div>

        <button onClick={save} className="btn-pink flex items-center justify-center gap-2">
          ✓ 儲存排泄記錄
        </button>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
// HISTORY
// ──────────────────────────────────────────────
function History({ allLogs, deleteLog, unit }: { allLogs: LogEntry[]; deleteLog: (id: string, kind: 'feed' | 'excrete') => void; unit: Unit }) {
  const [filter, setFilter] = useState<'all' | 'feed' | 'excrete'>('all')
  const [search, setSearch] = useState('')

  const filtered = allLogs.filter((log) => {
    if (filter === 'feed' && log.kind !== 'feed') return false
    if (filter === 'excrete' && log.kind !== 'excrete') return false
    if (search) {
      const notes = log.kind === 'feed' ? log.notes || '' : log.notes || ''
      if (!notes.toLowerCase().includes(search.toLowerCase())) return false
    }
    return true
  })

  return (
    <div className="space-y-3 rise">
      <div className="flex gap-2">
        {(['all', 'feed', 'excrete'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`chip text-xs ${filter === f ? 'active' : ''}`}
          >
            {f === 'all' ? '全部' : f === 'feed' ? '餵奶' : '排泄'}
          </button>
        ))}
      </div>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="搜尋備註..."
        className="field"
      />
      <div className="group-list">
        {filtered.length === 0 && (
          <div className="p-6 text-center text-sm text-[var(--muted)]">沒有符合的記錄</div>
        )}
        {filtered.map((log) => (
          <LogCard key={log.id} log={log} unit={unit} bare onDelete={() => deleteLog(log.id, log.kind)} />
        ))}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
// CHARTS
// ──────────────────────────────────────────────
const PERIODS = [
  { id: '7d', label: '7天', days: 7, barW: 28, spacing: 64, labelEvery: 1 },
  { id: '1m', label: '1月', days: 30, barW: 12, spacing: 28, labelEvery: 5 },
  { id: '3m', label: '3月', days: 90, barW: 8, spacing: 20, labelEvery: 10 },
] as const
type PeriodId = (typeof PERIODS)[number]['id']

function Charts({ feeds, excretes, unit }: { feeds: FeedLog[]; excretes: ExcreteLog[]; unit: Unit }) {
  const [period, setPeriod] = useState<PeriodId>('7d')
  const cfg = PERIODS.find((p) => p.id === period)!
  const days = lastNDaysKeys(cfg.days)
  const label = days.map((d) => d.slice(5))

  const feedVol = days.map((d) =>
    toDisplayVolume(feeds.filter((f) => f.timestamp.startsWith(d)).reduce((s, f) => s + (f.volume || 0), 0), unit),
  )
  const excByDay = days.map((d) => {
    const ex = excretes.filter((e) => e.timestamp.startsWith(d))
    return {
      wet: ex.filter((e) => e.type === 'wet' || e.type === 'both').length,
      poop: ex.filter((e) => e.type === 'poop' || e.type === 'both').length,
      total: ex.length,
    }
  })

  const maxVol = Math.max(...feedVol, 1)
  const maxEx = Math.max(...excByDay.map((d) => d.total), 1)
  const CHART_H = 160

  return (
    <div className="space-y-5 rise">
      <div className="flex gap-2">
        {PERIODS.map((p) => (
          <button key={p.id} onClick={() => setPeriod(p.id)} className={`chip flex-1 text-center text-xs ${period === p.id ? 'active' : ''}`}>
            {p.label}
          </button>
        ))}
      </div>

      {/* Feed chart */}
      <div className="card rounded-2xl p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-semibold">餵奶量趨勢</span>
          <span className="text-xs text-[var(--muted)]">近{cfg.days}天 · {unitLabel(unit)}/日</span>
        </div>
        <BarChart labels={label} data={feedVol} max={maxVol} color="var(--teal)" h={CHART_H} barW={cfg.barW} spacing={cfg.spacing} labelEvery={cfg.labelEvery} />
      </div>

      {/* Excrete chart */}
      <div className="card rounded-2xl p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-semibold">排泄頻率</span>
          <span className="text-xs text-[var(--muted)]">近{cfg.days}天 · 次/日</span>
        </div>
        <BarChart labels={label} data={excByDay.map((d) => d.total)} max={maxEx} color="var(--pink)" h={CHART_H} barW={cfg.barW} spacing={cfg.spacing} labelEvery={cfg.labelEvery} />
      </div>

      <div className="text-center text-xs text-[var(--muted)]">數據僅供參考 · 如有異常請即時聯絡醫生</div>
    </div>
  )
}

function BarChart({ labels, data, max, color, h, barW = 28, spacing = 64, labelEvery = 1 }: { labels: string[]; data: number[]; max: number; color: string; h: number; barW?: number; spacing?: number; labelEvery?: number }) {
  const totalW = labels.length * spacing + 16
  const chartH = h
  const showValues = spacing >= 40

  return (
    <div className="-mx-4 overflow-x-auto scroll-hide px-4">
      <svg viewBox={`0 0 ${totalW} ${chartH}`} width={totalW} height={chartH} className="mx-auto block">
        {/* Grid lines */}
        {[0, 0.5, 1].map((frac) => (
          <line
            key={frac}
            x1={0}
            y1={chartH - 20 - frac * (chartH - 32)}
            x2={totalW}
            y2={chartH - 20 - frac * (chartH - 32)}
            stroke="var(--border)"
            strokeDasharray="4,4"
          />
        ))}
        {data.map((v, i) => {
          const barH = max > 0 ? ((v / max) * (chartH - 32)) : 0
          const x = i * spacing + (spacing - barW) / 2
          const y = chartH - 20 - barH
          return (
            <g key={i}>
              <rect x={x} y={y} width={barW} height={Math.max(barH, 2)} rx={Math.min(6, barW / 2)} fill={color} opacity={0.85} />
              {showValues && (
                <text x={x + barW / 2} y={y - 6} textAnchor="middle" fill="var(--muted)" fontSize="10" fontFamily="SF Pro Text,sans-serif">
                  {v > 0 ? v : ''}
                </text>
              )}
              {i % labelEvery === 0 && (
                <text x={x + barW / 2} y={chartH - 2} textAnchor="middle" fill="var(--muted)" fontSize="10" fontFamily="SF Pro Text,sans-serif">
                  {labels[i]}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ──────────────────────────────────────────────
// SETTINGS MODAL
// ──────────────────────────────────────────────
function SettingsModal({
  baby,
  saveBaby,
  resetAll,
  onClose,
}: {
  baby: BabyProfile
  saveBaby: (b: BabyProfile) => void
  resetAll: () => void
  onClose: () => void
}) {
  const [form, setForm] = useState(baby)
  const [closing, setClosing] = useState(false)

  const close = () => {
    setClosing(true)
    setTimeout(onClose, 180)
  }

  const save = () => {
    saveBaby(form)
    close()
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) close() }}
      className={`fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center ${closing ? 'modal-scrim-exit' : 'modal-scrim'}`}
    >
      <div className={`w-full max-w-[420px] rounded-t-2xl bg-[var(--surface)] p-5 sm:rounded-2xl sm:m-4 ${closing ? 'modal-sheet exit' : 'modal-sheet'}`}>
        <div className="mb-4 flex items-center justify-between">
          <span className="text-lg font-semibold">設定</span>
          <button onClick={close} aria-label="關閉" className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--muted)] active:bg-[var(--surface2)]"><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <div className="mb-1 text-xs text-[var(--muted)]">寶寶姓名</div>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="field"
              placeholder="小寶寶"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="mb-1 text-xs text-[var(--muted)]">出生日期</div>
              <input
                type="date"
                value={form.dob}
                onChange={(e) => setForm({ ...form, dob: e.target.value })}
                className="field"
              />
            </div>
            <div>
              <div className="mb-1 text-xs text-[var(--muted)]">性別</div>
              <select
                value={form.gender}
                onChange={(e) => setForm({ ...form, gender: e.target.value as BabyProfile['gender'] })}
                className="field"
              >
                <option value="女">女寶寶</option>
                <option value="男">男寶寶</option>
              </select>
            </div>
          </div>
          <div>
            <div className="mb-1 text-xs text-[var(--muted)]">出生體重 (g)</div>
            <input
              type="number"
              value={form.birthWeight || ''}
              onChange={(e) => setForm({ ...form, birthWeight: Number(e.target.value) || 0 })}
              className="field"
              inputMode="numeric"
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-[var(--muted)]">單位</div>
            <div className="flex gap-2">
              {(['ml', 'oz'] as const).map((u) => (
                <button
                  key={u}
                  onClick={() => setForm({ ...form, unit: u })}
                  className={`chip flex-1 text-center ${form.unit === u ? 'active' : ''}`}
                >
                  {u === 'ml' ? '毫升 (ml)' : '盎司 (oz)'}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-5 flex gap-3">
          <button onClick={save} className="btn-primary flex-1">
            儲存設定
          </button>
          <button
            onClick={() => { close(); resetAll(); }}
            className="flex-1 rounded-2xl border border-[var(--red)]/30 bg-[var(--red)]/10 p-3 text-sm font-semibold text-[var(--red)] active:bg-[var(--red)]/20"
          >
            清除所有資料
          </button>
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
// REPORT MODAL
// ──────────────────────────────────────────────
function ReportModal({
  baby,
  feeds,
  excretes,
  onClose,
}: {
  baby: BabyProfile
  feeds: FeedLog[]
  excretes: ExcreteLog[]
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [closing, setClosing] = useState(false)
  const text = buildDoctorText(baby, feeds, excretes)

  const close = () => {
    setClosing(true)
    setTimeout(onClose, 180)
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // fallback
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) close() }}
      className={`fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center ${closing ? 'modal-scrim-exit' : 'modal-scrim'}`}
    >
      <div className={`flex max-h-[85dvh] w-full max-w-[420px] flex-col rounded-t-2xl bg-[var(--surface)] sm:rounded-2xl sm:m-4 ${closing ? 'modal-sheet exit' : 'modal-sheet'}`}>
        <div className="flex items-center justify-between border-b border-[var(--border)] p-4">
          <div>
            <div className="text-lg font-semibold">醫生報告</div>
            <div className="text-xs text-[var(--muted)]">{baby.name} · {ageLabel(baby.dob)}</div>
          </div>
          <div className="flex gap-2">
            <button onClick={copy} className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 py-1.5 text-xs font-semibold active:bg-[var(--surface2)]">
              {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? '已複製' : '複製'}
            </button>
            <button onClick={close} aria-label="關閉" className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--muted)] active:bg-[var(--surface2)]"><X size={18} /></button>
          </div>
        </div>
        <div className="overflow-y-auto p-4">
          <pre className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text)]" style={{ fontFamily: 'SF Pro Text, Noto Sans TC, sans-serif' }}>
            {text}
          </pre>
        </div>
        <div className="border-t border-[var(--border)] px-4 py-3 text-center text-xs text-[var(--muted)]">
          此報告僅供參考 · 請帶同完整記錄給醫生參閱
        </div>
      </div>
    </div>
  )
}

function LoginScreen({ onLogin, onOpenAdmin }: { onLogin: (u: string, p: string) => Promise<any>; onOpenAdmin: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const handleLogin = async () => {
    if (!username || !password) return
    setLoading(true); setError('')
    try { await onLogin(username, password) }
    catch (e: any) { setError(e.message || '登入失敗') }
    finally { setLoading(false) }
  }
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[var(--bg)] p-6">
      <div className="w-full max-w-[360px]">
        <div className="text-center mb-8">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--teal)] to-[var(--pink)]">
            <span className="text-4xl">👶</span>
          </div>
          <div className="text-2xl font-semibold">BabyLog</div>
        </div>
        <div className="space-y-4">
          <input type="text" placeholder="用戶名" value={username} onChange={e => setUsername(e.target.value)} className="field w-full" autoComplete="username" />
          <input type="password" placeholder="密碼" value={password} onChange={e => setPassword(e.target.value)} className="field w-full" autoComplete="current-password" onKeyDown={e => e.key === 'Enter' && handleLogin()} />
          {error && <div className="text-sm text-[var(--red)]">{error}</div>}
          <button onClick={handleLogin} disabled={loading} className="bg-[var(--teal)] hover:opacity-90 w-full py-3 rounded-xl text-white font-semibold text-base disabled:opacity-50">
            {loading ? '登入中...' : '登入'}
          </button>
        </div>
        <div className="mt-6 text-center"><button onClick={onOpenAdmin} className="text-sm text-[var(--teal)] hover:underline">建立新用戶</button></div>
      </div>
    </div>
  )
}

function AdminCreateUser({ onClose }: { onClose: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [adminKey, setAdminKey] = useState('')
  const [msg, setMsg] = useState('')
  const [closing, setClosing] = useState(false)

  const close = () => {
    setClosing(true)
    setTimeout(onClose, 180)
  }

  const create = async () => {
    if (!username || !password || !adminKey) return
    try {
      await api.createUser(username, password, adminKey)
      setMsg('✅ 用戶建立成功')
      setTimeout(close, 1200)
    } catch (e: any) { setMsg('❌ ' + (e.message || '建立失敗')) }
  }
  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 ${closing ? 'modal-scrim-exit' : 'modal-scrim'}`} onClick={close}>
      <div className={`card w-full max-w-[360px] p-6 ${closing ? 'modal-sheet exit' : 'modal-sheet'}`} onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <span className="text-lg font-semibold">建立新用戶</span>
          <button onClick={close} aria-label="關閉" className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--muted)] active:bg-[var(--surface2)]"><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <input placeholder="用戶名" value={username} onChange={e => setUsername(e.target.value)} className="field w-full" />
          <input type="password" placeholder="密碼" value={password} onChange={e => setPassword(e.target.value)} className="field w-full" />
          <input type="password" placeholder="ADMIN_KEY" value={adminKey} onChange={e => setAdminKey(e.target.value)} className="field w-full" />
        </div>
        {msg && <div className="mt-3 text-sm">{msg}</div>}
        <div className="mt-4 flex gap-2">
          <button onClick={close} className="flex-1 py-2 rounded-xl border border-[var(--border)]">取消</button>
          <button onClick={create} className="flex-1 py-2 rounded-xl bg-[var(--teal)] text-white font-medium">建立</button>
        </div>
      </div>
    </div>
  )
}

