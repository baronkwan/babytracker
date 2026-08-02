import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { BabyProfile, ExcreteLog, FeedLog, LogEntry, TabId, Unit, WeightLog } from './lib/types'
import { DEFAULT_BABY, DURATION_CHIPS, POOP_COLORS, POOP_TEXTURES } from './lib/types'
import { combineLogs, loadBaby, loadExcretes, loadFeeds, loadWeights, makeId, saveAll } from './lib/storage'
import {
  ageLabel,
  buildDoctorText,
  dayKey,
  excreteLabel,
  fmtAgo,
  fmtDateTime,
  lastNDaysKeys,
  nowLocalTime,
  sideLabel,
  todayExcretes,
  todayFeeds,
  todayLocal,
  toDisplayVolume,
  toIsoFromLocal,
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
  SquarePen,
  Stethoscope,
  Sun,
  UserPlus,
  Weight,
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
  const [username, setUsername] = useState<string | null>(() => localStorage.getItem('babylog_username'))
  const login = async (username: string, password: string) => {
    const res = await api.login(username, password)
    setToken(res.token)
    setTokenState(res.token)
    localStorage.setItem('babylog_username', res.username)
    setUsername(res.username)
    return res
  }
  const logout = () => { clearToken(); setTokenState(null); localStorage.removeItem('babylog_username'); setUsername(null) }
  return { token, username, login, logout }
}

// MAIN APP
// ──────────────────────────────────────────────
export default function App() {
  const [baby, setBaby] = useState<BabyProfile>(DEFAULT_BABY)
  const [feeds, setFeeds] = useState<FeedLog[]>([])
  const [excretes, setExcretes] = useState<ExcreteLog[]>([])
  const [weights, setWeights] = useState<WeightLog[]>([])
  const [tab, setTab] = useState<TabId>('home')
  const [loaded, setLoaded] = useState(false)
  const [showAdmin, setShowAdmin] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const { theme, toggleTheme } = useTheme()
  const { token, username, login, logout } = useAuth()

  useEffect(() => {
    setBaby(loadBaby())
    setFeeds(loadFeeds())
    setExcretes(loadExcretes())
    setWeights(loadWeights())
    setLoaded(true)
  }, [])

  // Server rows lack `kind` — add it back when hydrating.
  const toFeed = (r: Record<string, unknown>): FeedLog => ({
    id: String(r.id),
    kind: 'feed',
    timestamp: String(r.timestamp),
    // legacy rows stored type + volume; new rows store split volumes
    breastVolume: r.type === 'breast' ? Number(r.volume) || 0 : Number(r.breast_volume) || 0,
    formulaVolume: r.type === 'formula' ? Number(r.volume) || 0 : Number(r.formula_volume) || 0,
    duration: Number(r.duration) || 0,
    side: (r.side as FeedLog['side']) || null,
    notes: String(r.notes ?? ''),
  })
  const toExcrete = (r: Record<string, unknown>): ExcreteLog => ({
    id: String(r.id),
    kind: 'excrete',
    timestamp: String(r.timestamp),
    type: r.type === 'poop' || r.type === 'both' ? (r.type as ExcreteLog['type']) : 'wet',
    peeSize: String(r.pee_size ?? ''),
    pooSize: String(r.poo_size ?? ''),
    color: String(r.color ?? ''),
    consistency: String(r.consistency ?? ''),
    notes: String(r.notes ?? ''),
  })
  const toWeight = (r: Record<string, unknown>): WeightLog => ({
    id: String(r.id),
    kind: 'weight',
    timestamp: String(r.timestamp),
    weight: Number(r.weight) || 0,
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
    const localWeights = loadWeights()
    const sf = (data.feeds ?? []).map(toFeed)
    const se = (data.excretes ?? []).map(toExcrete)
    const sw = (data.weights ?? []).map(toWeight)
    // Backfill: push local-only rows (offline / failed push / pre-sync data) up to the server.
    // Fire-and-forget; a rejected push surfaces the banner once the promise settles.
    const serverFeedIds = new Set(sf.map((f) => f.id))
    const serverExcreteIds = new Set(se.map((e) => e.id))
    const serverWeightIds = new Set(sw.map((w) => w.id))
    for (const f of localFeeds) {
      if (!serverFeedIds.has(f.id)) api.addFeed(f).catch(() => setSyncError('⚠️ 部分本機記錄未能上傳，將於下次同步重試'))
    }
    for (const e of localExcretes) {
      if (!serverExcreteIds.has(e.id)) api.addExcrete(e).catch(() => setSyncError('⚠️ 部分本機記錄未能上傳，將於下次同步重試'))
    }
    for (const w of localWeights) {
      if (!serverWeightIds.has(w.id)) api.addWeight(w).catch(() => setSyncError('⚠️ 部分本機記錄未能上傳，將於下次同步重試'))
    }
    const mf = mergeById(localFeeds, sf)
    const me = mergeById(localExcretes, se)
    const mw = mergeById(localWeights, sw)
    setBaby(baby)
    setFeeds(mf)
    setExcretes(me)
    setWeights(mw)
    setSyncError(null)
  }, [])

  // Refresh from cloud whenever a token appears (login or stored token on reload).
  useEffect(() => {
    if (!token) return
    refreshFromServer().catch(() => setSyncError('⚠️ 無法讀取雲端資料 — 顯示本機資料'))
  }, [token, refreshFromServer])

  // Persist state to localStorage whenever it changes (after initial load).
  useEffect(() => {
    if (loaded) saveAll(baby, feeds, excretes, weights)
  }, [baby, feeds, excretes, weights, loaded])

  // Optimistic local write + push to server. Failure keeps local change and shows a banner.
  // Mutations use functional setState so multiple calls in one tick compose instead of
  // clobbering each other (e.g. combined feed+excrete form).
  const push = useCallback((fn: () => Promise<unknown>) => {
    fn().then(() => setSyncError(null)).catch(() => setSyncError('⚠️ 同步失敗 — 改動僅存本機，下次成功同步後合併'))
  }, [])

  const addFeed = useCallback(
    (log: FeedLog) => {
      setFeeds((prev) => [log, ...prev])
      push(() => api.addFeed(log))
    },
    [push],
  )

  const addExcrete = useCallback(
    (log: ExcreteLog) => {
      setExcretes((prev) => [log, ...prev])
      push(() => api.addExcrete(log))
    },
    [push],
  )

  const addWeight = useCallback(
    (log: WeightLog) => {
      setWeights((prev) => [log, ...prev])
      push(() => api.addWeight(log))
    },
    [push],
  )

  const saveBaby = useCallback(
    (b: BabyProfile) => {
      setBaby(b)
      push(() => api.saveBaby(b))
    },
    [push],
  )

  const deleteLog = useCallback(
    (id: string, kind: 'feed' | 'excrete' | 'weight') => {
      if (kind === 'feed') setFeeds((prev) => prev.filter((x) => x.id !== id))
      else if (kind === 'excrete') setExcretes((prev) => prev.filter((x) => x.id !== id))
      else setWeights((prev) => prev.filter((x) => x.id !== id))
      push(() => api.deleteLog(id, kind))
    },
    [push],
  )

  const resetAll = useCallback(() => {
    if (!window.confirm('清除所有記錄？此操作無法復原。')) return
    setBaby({ ...DEFAULT_BABY, dob: baby.dob })
    setFeeds([])
    setExcretes([])
    setWeights([])
    push(() => api.deleteAll())
  }, [baby.dob, push])

  const allLogs = useMemo(() => combineLogs(feeds, excretes, weights), [feeds, excretes, weights])

  if (!loaded && token) return <Splash />

  return (
    <>
      {!token ? (
        <LoginScreen onLogin={login} onOpenAdmin={() => setShowAdmin(true)} />
      ) : (
        <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col bg-[var(--bg)]">
          <Header baby={baby} tab={tab} feeds={feeds} excretes={excretes} username={username} saveBaby={saveBaby} resetAll={resetAll} theme={theme} toggleTheme={toggleTheme} onLogout={logout} onOpenAdmin={() => setShowAdmin(true)} />
          {syncError && (
            <div className="mx-4 mt-2 rounded-xl bg-[var(--red)]/10 px-3 py-2 text-xs font-medium text-[var(--red)]">{syncError}</div>
          )}
          <main className="safe-pb flex-1 px-4 pt-3">
            {tab === 'home' && <Home baby={baby} feeds={feeds} excretes={excretes} weights={weights} allLogs={allLogs} deleteLog={deleteLog} setTab={setTab} addWeight={addWeight} />}
            {tab === 'record' && <CombinedForm baby={baby} addFeed={addFeed} addExcrete={addExcrete} setTab={setTab} />}
            {tab === 'history' && <History allLogs={allLogs} deleteLog={deleteLog} unit={baby.unit} />}
            {tab === 'charts' && <Charts feeds={feeds} excretes={excretes} weights={weights} unit={baby.unit} />}
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
  username,
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
  username: string | null
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
    record: '記錄',
    history: '歷史',
    charts: '圖表',
  }
  const tf = todayFeeds(feeds)
  const te = todayExcretes(excretes)
  const feedVol = tf.reduce((s, f) => s + (f.breastVolume || 0) + (f.formulaVolume || 0), 0)
  const hour = new Date().getHours()
  const greet = hour < 6 ? '夜深了' : hour < 12 ? '早晨' : hour < 18 ? '午安' : '晚安'
  const greetIcon = hour < 6 || hour >= 18 ? '🌙' : '☀️'

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
        {tab === 'home' ? (
          <div className="mt-1">
            <div className="text-xl font-bold tracking-tight text-[var(--text)]">{greet}，{username || baby.name} {greetIcon}</div>
            <div className="mt-0.5 text-sm font-medium text-[var(--muted)]">今日 餵奶 {tf.length} 次 · {toDisplayVolume(feedVol, baby.unit)}{unitLabel(baby.unit)} ｜ 排泄 {te.length} 次</div>
          </div>
        ) : (
          <div className="mt-1 text-xl font-bold tracking-tight text-[var(--text)]">{titles[tab]}</div>
        )}
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
    { id: 'record', icon: <SquarePen size={24} />, label: '記錄' },
    { id: 'history', icon: <HistoryIcon size={24} />, label: '歷史' },
    { id: 'charts', icon: <BarChart3 size={24} />, label: '圖表' },
  ]

  return (
    <nav className="safe-bottom-nav fixed bottom-0 left-0 right-0 z-40 mx-auto max-w-[480px] border-t border-[var(--border)] bg-[var(--surface)]/95 px-1 backdrop-blur-xl">
      <div className="grid h-16 grid-cols-4">
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
  weights,
  allLogs,
  deleteLog,
  setTab,
  addWeight,
}: {
  baby: BabyProfile
  feeds: FeedLog[]
  excretes: ExcreteLog[]
  weights: WeightLog[]
  allLogs: LogEntry[]
  deleteLog: (id: string, kind: 'feed' | 'excrete' | 'weight') => void
  setTab: (t: TabId) => void
  addWeight: (log: WeightLog) => void
}) {
  const [showWeight, setShowWeight] = useState(false)
  const tf = todayFeeds(feeds)
  const te = todayExcretes(excretes)
  const vol = tf.reduce((s, f) => s + (f.breastVolume || 0) + (f.formulaVolume || 0), 0)
  const wet = te.filter((e) => e.type === 'wet' || e.type === 'both').length
  const poop = te.filter((e) => e.type === 'poop' || e.type === 'both').length

  const lastF = feeds.slice().sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp))[0]
  const lastE = excretes.slice().sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp))[0]
  const sortedW = weights.slice().sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp))
  const latestW = sortedW[0]
  const deltaW = latestW && sortedW[1] ? latestW.weight - sortedW[1].weight : null

  return (
    <div className="space-y-4 rise">
      {/* Quick action */}
      <button
        onClick={() => setTab('record')}
        className="card flex w-full items-center gap-3 rounded-2xl p-4 text-left transition-transform active:scale-[0.98]"
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--teal-dim)] to-[var(--pink-dim)] text-[var(--teal)]"><SquarePen size={20} /></div>
        <div>
          <div className="text-sm font-semibold">記錄餵奶 / 排泄</div>
          <div className="text-xs text-[var(--muted)]">同一頁搞掂，可以一齊記</div>
        </div>
      </button>

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
            <span>尿 <strong className="font-semibold text-[var(--blue)]">{wet}</strong></span>
            <span>便 <strong className="font-semibold text-[var(--amber)]">{poop}</strong></span>
          </div>
          {lastE && <div className="mt-1 text-xs text-[var(--muted)]">上次 · {fmtAgo(lastE.timestamp)}</div>}
        </div>
      </div>

      {/* Weight */}
      <div className="card rounded-2xl p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1 text-xs text-[var(--muted)]">最新體重</div>
            <div className="flex items-baseline gap-1">
              {latestW ? (
                <>
                  <span className="num text-3xl font-bold text-[var(--blue)]">{latestW.weight}</span>
                  <span className="text-sm text-[var(--muted)]">g</span>
                  {deltaW !== null && deltaW !== 0 && (
                    <span className={`ml-1 text-xs font-semibold ${deltaW > 0 ? 'text-[var(--teal)]' : 'text-[var(--red)]'}`}>
                      {deltaW > 0 ? '+' : ''}{deltaW}g
                    </span>
                  )}
                </>
              ) : (
                <span className="text-sm text-[var(--muted)]">尚未記錄體重</span>
              )}
            </div>
            {latestW && <div className="mt-0.5 text-xs text-[var(--muted)]">{fmtAgo(latestW.timestamp)} · 共 {weights.length} 次</div>}
          </div>
          <button
            onClick={() => setShowWeight(true)}
            className="flex items-center gap-1.5 rounded-xl bg-[var(--blue-dim)] px-3 py-2 text-xs font-semibold text-[var(--blue)] active:opacity-80"
          >
            <Weight size={14} /> 記錄
          </button>
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
      {showWeight && (
        <WeightModal
          onSave={(log) => { addWeight(log); setShowWeight(false) }}
          onClose={() => setShowWeight(false)}
        />
      )}
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
                <span className="font-semibold">餵奶</span>
                {log.breastVolume > 0 && <Badge color="var(--teal)" label={`母乳 ${toDisplayVolume(log.breastVolume, unit)}${unitLabel(unit)}`} />}
                {log.formulaVolume > 0 && <Badge color="var(--blue)" label={`配方 ${toDisplayVolume(log.formulaVolume, unit)}${unitLabel(unit)}`} />}
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

  if (log.kind === 'weight') {
    return (
      <div className={`${bare ? '' : 'card rounded-2xl'} p-3.5 rise`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0 flex-1">
            <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--blue-dim)] text-[var(--blue)]"><Weight size={14} /></span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-semibold">體重</span>
                <Badge color="var(--blue)" label={`${log.weight} g`} />
              </div>
              <div className="text-xs text-[var(--muted)]">{fmtDateTime(log.timestamp)}</div>
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
            <div className="text-xs text-[var(--muted)]">{fmtDateTime(log.timestamp)}{log.peeSize ? ` · 尿量${log.peeSize}` : ''}{log.pooSize ? ` · 便量${log.pooSize}` : ''}{log.consistency ? ` · ${log.consistency}` : ''}</div>
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
// RECORD FORM (feed + excrete combined)
// ──────────────────────────────────────────────
function CombinedForm({ baby, addFeed, addExcrete, setTab }: {
  baby: BabyProfile
  addFeed: (f: FeedLog) => void
  addExcrete: (e: ExcreteLog) => void
  setTab: (t: TabId) => void
}) {
  // feed
  const [breast, setBreast] = useState('')
  const [formula, setFormula] = useState('')
  const [duration, setDuration] = useState('')
  const [side, setSide] = useState<FeedLog['side']>('both')
  // excrete
  const [exType, setExType] = useState<'none' | ExcreteLog['type']>('none')
  const [peeSize, setPeeSize] = useState('')
  const [pooSize, setPooSize] = useState('')
  const [color, setColor] = useState('')
  const [texture, setTexture] = useState('')
  // shared
  const [notes, setNotes] = useState('')
  const [date, setDate] = useState(todayLocal())
  const [time, setTime] = useState(nowLocalTime())

  const bv = Number(breast) || 0
  const fv = Number(formula) || 0
  const dur = Number(duration) || 0
  const hasFeed = bv > 0 || fv > 0 || dur > 0
  const hasExcrete = exType !== 'none'
  const showPee = exType === 'wet' || exType === 'both'
  const showPoo = exType === 'poop' || exType === 'both'

  const save = () => {
    const ts = toIsoFromLocal(date, time)
    if (hasFeed) {
      addFeed({
        id: makeId(),
        kind: 'feed',
        timestamp: ts,
        breastVolume: bv,
        formulaVolume: fv,
        duration: dur,
        side: bv > 0 ? side : null,
        notes: notes.trim(),
      })
    }
    if (hasExcrete) {
      addExcrete({
        id: makeId(),
        kind: 'excrete',
        timestamp: ts,
        type: exType,
        peeSize: showPee ? peeSize : '',
        pooSize: showPoo ? pooSize : '',
        color: showPoo ? color : '',
        consistency: showPoo ? texture : '',
        notes: notes.trim(),
      })
    }
    setBreast(''); setFormula(''); setDuration(''); setSide('both')
    setExType('none'); setPeeSize(''); setPooSize(''); setColor(''); setTexture(''); setNotes('')
    setDate(todayLocal()); setTime(nowLocalTime())
    setTab('home')
  }

  return (
    <div className="space-y-4 rise">
      <div className="card rounded-2xl p-4">
        {/* Time */}
        <div className="mb-5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">時間</span>
            <button onClick={() => { setDate(todayLocal()); setTime(nowLocalTime()) }} className="text-xs font-semibold text-[var(--teal)] active:text-[var(--teal-dim)]">
              現在
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input type="date" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} className="field" />
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="field" />
          </div>
        </div>

        {/* ── Feed ── */}
        <div className="mb-5">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">餵奶</div>
          <div className="mb-4 grid grid-cols-2 gap-2">
            <div>
              <div className="mb-1 text-xs text-[var(--muted)]">母乳 ({unitLabel(baby.unit)})</div>
              <input value={breast} onChange={(e) => setBreast(e.target.value)} placeholder="0" inputMode="numeric" className="field" />
            </div>
            <div>
              <div className="mb-1 text-xs text-[var(--muted)]">配方奶 ({unitLabel(baby.unit)})</div>
              <input value={formula} onChange={(e) => setFormula(e.target.value)} placeholder="0" inputMode="numeric" className="field" />
            </div>
          </div>

          <div className="mb-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">時長 (分鐘)</div>
            <div className="flex flex-wrap gap-2">
              {DURATION_CHIPS.map((v) => (
                <button key={v} onClick={() => setDuration(String(v))} className={`chip text-sm ${String(v) === duration ? 'active' : ''}`}>
                  {v} min
                </button>
              ))}
            </div>
            <input value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="自訂" inputMode="numeric" className="field mt-2" />
          </div>

          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">邊別（母乳）</div>
            <div className="flex gap-2">
              {(['left', 'right', 'both'] as const).map((s) => (
                <button key={s} onClick={() => setSide(s)} className={`chip flex-1 text-center ${side === s ? 'active' : ''}`}>
                  {sideLabel(s)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Excrete ── */}
        <div className="mb-5 border-t border-[var(--border)] pt-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">排泄（可略過）</div>
          <div className="mb-4 flex gap-2">
            {(['wet', 'poop', 'both'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setExType(exType === t ? 'none' : t)}
                className={`chip flex-1 text-center text-sm ${exType === t ? 'pink active' : ''}`}
              >
                {t === 'wet' ? '淨尿' : t === 'poop' ? '淨便' : '尿+便'}
              </button>
            ))}
          </div>

          {showPee && (
            <div className="mb-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">尿量</div>
              <div className="flex gap-2">
                {(['少', '多'] as const).map((s) => (
                  <button key={s} onClick={() => setPeeSize(s)} className={`chip flex-1 text-center text-sm ${peeSize === s ? 'pink active' : ''}`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {showPoo && (
            <>
              <div className="mb-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">便量</div>
                <div className="flex gap-2">
                  {(['少', '多'] as const).map((s) => (
                    <button key={s} onClick={() => setPooSize(s)} className={`chip flex-1 text-center text-sm ${pooSize === s ? 'pink active' : ''}`}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mb-4 grid grid-cols-2 gap-3">
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">顏色</div>
                  <div className="flex flex-wrap gap-1.5">
                    {POOP_COLORS.map((c) => (
                      <button key={c} onClick={() => setColor(c)} className={`chip text-sm ${c === color ? 'pink active' : ''}`}>
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">質地</div>
                  <div className="flex flex-wrap gap-1.5">
                    {POOP_TEXTURES.map((t) => (
                      <button key={t} onClick={() => setTexture(t)} className={`chip text-sm ${t === texture ? 'pink active' : ''}`}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Notes */}
        <div className="mb-5">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">備註</div>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="選填" className="field" />
        </div>

        <button onClick={save} disabled={!hasFeed && !hasExcrete} className="btn-primary flex items-center justify-center gap-2">
          ✓ 儲存記錄
        </button>
      </div>
    </div>
  )
}


// ──────────────────────────────────────────────
// HISTORY
// ──────────────────────────────────────────────
function History({ allLogs, deleteLog, unit }: { allLogs: LogEntry[]; deleteLog: (id: string, kind: 'feed' | 'excrete' | 'weight') => void; unit: Unit }) {
  const [filter, setFilter] = useState<'all' | 'feed' | 'excrete' | 'weight'>('all')
  const [search, setSearch] = useState('')

  const filtered = allLogs.filter((log) => {
    if (filter === 'feed' && log.kind !== 'feed') return false
    if (filter === 'excrete' && log.kind !== 'excrete') return false
    if (filter === 'weight' && log.kind !== 'weight') return false
    if (search) {
      const notes = log.kind === 'feed' ? log.notes || '' : log.notes || ''
      if (!notes.toLowerCase().includes(search.toLowerCase())) return false
    }
    return true
  })

  return (
    <div className="space-y-3 rise">
      <div className="flex gap-2">
        {(['all', 'feed', 'excrete', 'weight'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`chip text-xs ${filter === f ? 'active' : ''}`}
          >
            {f === 'all' ? '全部' : f === 'feed' ? '餵奶' : f === 'excrete' ? '排泄' : '重量'}
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
  { id: '7d', label: '7天', days: 7, gap: 6, labelEvery: 1 },
  { id: '1m', label: '1月', days: 30, gap: 2, labelEvery: 5 },
  { id: '3m', label: '3月', days: 90, gap: 1, labelEvery: 10 },
] as const
type PeriodId = (typeof PERIODS)[number]['id']

function Charts({ feeds, excretes, weights, unit }: { feeds: FeedLog[]; excretes: ExcreteLog[]; weights: WeightLog[]; unit: Unit }) {
  const [period, setPeriod] = useState<PeriodId>('7d')
  const cfg = PERIODS.find((p) => p.id === period)!
  const days = lastNDaysKeys(cfg.days)
  const label = days.map((d) => d.slice(5))

  const feedVol = days.map((d) =>
    toDisplayVolume(feeds.filter((f) => dayKey(f.timestamp) === d).reduce((s, f) => s + (f.breastVolume || 0) + (f.formulaVolume || 0), 0), unit),
  )
  const excByDay = days.map((d) => {
    const ex = excretes.filter((e) => dayKey(e.timestamp) === d)
    return {
      wet: ex.filter((e) => e.type === 'wet' || e.type === 'both').length,
      poop: ex.filter((e) => e.type === 'poop' || e.type === 'both').length,
      total: ex.length,
    }
  })

  // Sparse weight entries → last weight of each day, forward-filled for a step trend.
  let lastW = 0
  const weightSeries = days.map((d) => {
    const dayW = weights
      .filter((w) => dayKey(w.timestamp) === d)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    if (dayW.length) lastW = dayW[dayW.length - 1].weight
    return lastW
  })

  const maxVol = Math.max(...feedVol, 1)
  const maxEx = Math.max(...excByDay.map((d) => d.total), 1)
  const maxW = Math.max(...weightSeries, 1)
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
        <BarChart labels={label} data={feedVol} max={maxVol} color="var(--teal)" h={CHART_H} gap={cfg.gap} labelEvery={cfg.labelEvery} />
      </div>

      {/* Excrete chart */}
      <div className="card rounded-2xl p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-semibold">排泄頻率</span>
          <span className="text-xs text-[var(--muted)]">近{cfg.days}天 · 次/日</span>
        </div>
        <BarChart labels={label} data={excByDay.map((d) => d.total)} max={maxEx} color="var(--pink)" h={CHART_H} gap={cfg.gap} labelEvery={cfg.labelEvery} />
      </div>

      {/* Weight chart */}
      <div className="card rounded-2xl p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-semibold">體重趨勢</span>
          <span className="text-xs text-[var(--muted)]">近{cfg.days}天 · g</span>
        </div>
        <BarChart labels={label} data={weightSeries} max={maxW} color="var(--blue)" h={CHART_H} gap={cfg.gap} labelEvery={cfg.labelEvery} />
      </div>

      <div className="text-center text-xs text-[var(--muted)]">數據僅供參考 · 如有異常請即時聯絡醫生</div>
    </div>
  )
}

function BarChart({ labels, data, max, color, h, gap = 4, labelEvery = 1 }: { labels: string[]; data: number[]; max: number; color: string; h: number; gap?: number; labelEvery?: number }) {
  // Responsive flex bars: flex-1 fills the container, so every period fits with no
  // horizontal scroll — bars just get narrower as the day count grows.
  const chartH = h - 24
  const showValues = data.length <= 14
  const barPx = (v: number) => (max > 0 ? Math.max((v / max) * (chartH - 14), v > 0 ? 2 : 0) : 0)

  return (
    <div>
      <div className="relative" style={{ height: chartH }}>
        {[0, 0.5, 1].map((frac) => (
          <div
            key={frac}
            className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-[var(--border)]"
            style={{ bottom: frac * (chartH - 14) }}
          />
        ))}
        <div className="absolute inset-0 flex items-end" style={{ gap }}>
          {data.map((v, i) => (
            <div key={i} className="flex h-full flex-1 flex-col items-center justify-end">
              {showValues && v > 0 && <span className="mb-1 text-[9px] leading-none text-[var(--muted)]">{v}</span>}
              <div className="w-full rounded-t-[3px]" style={{ height: barPx(v), background: color, opacity: 0.85 }} />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-1 flex" style={{ gap }}>
        {labels.map((l, i) => (
          <div key={i} className="flex-1 text-center text-[9px] leading-4 text-[var(--muted)]">
            {i % labelEvery === 0 ? l : ''}
          </div>
        ))}
      </div>
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

function WeightModal({ onSave, onClose }: { onSave: (log: WeightLog) => void; onClose: () => void }) {
  const [weight, setWeight] = useState('')
  const [notes, setNotes] = useState('')
  const [date, setDate] = useState(todayLocal())
  const [time, setTime] = useState(nowLocalTime())
  const [closing, setClosing] = useState(false)
  const invalid = !Number(weight) || Number(weight) <= 0

  const close = () => {
    setClosing(true)
    setTimeout(onClose, 180)
  }

  const save = () => {
    if (invalid) return
    onSave({
      id: makeId(),
      kind: 'weight',
      timestamp: toIsoFromLocal(date, time),
      weight: Math.round(Number(weight)),
      notes: notes.trim(),
    })
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) close() }}
      className={`fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center ${closing ? 'modal-scrim-exit' : 'modal-scrim'}`}
    >
      <div className={`w-full max-w-[420px] rounded-t-2xl bg-[var(--surface)] p-5 sm:rounded-2xl sm:m-4 ${closing ? 'modal-sheet exit' : 'modal-sheet'}`}>
        <div className="mb-4 flex items-center justify-between">
          <span className="text-lg font-semibold">記錄體重</span>
          <button onClick={close} aria-label="關閉" className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--muted)] active:bg-[var(--surface2)]"><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <div className="mb-1 text-xs text-[var(--muted)]">體重 (g)</div>
            <input
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="如：3000"
              inputMode="numeric"
              autoFocus
              className="field"
            />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs text-[var(--muted)]">時間</span>
              <button onClick={() => { setDate(todayLocal()); setTime(nowLocalTime()) }} className="text-xs font-semibold text-[var(--blue)] active:opacity-70">
                現在
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="date" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} className="field" />
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="field" />
            </div>
          </div>
          <div>
            <div className="mb-1 text-xs text-[var(--muted)]">備註</div>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="選填 · 如：健康院量度"
              className="field"
            />
          </div>
        </div>
        <button onClick={save} disabled={invalid} className="btn-primary mt-5">
          ✓ 儲存體重
        </button>
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

