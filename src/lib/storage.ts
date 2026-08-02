import type { BabyProfile, ExcreteLog, FeedLog, LogEntry, WeightLog } from './types'
import { DEFAULT_BABY } from './types'

const KEYS = {
  baby: 'babytracker_v2_profile',
  feeds: 'babytracker_v2_feeds',
  excretes: 'babytracker_v2_excretes',
  weights: 'babytracker_v2_weights',
  // legacy keys from the old single-file app
  oldBaby: 'baby_profile',
  oldFeeds: 'baby_feeds',
  oldExcretes: 'baby_excretes',
} as const

// One-time migration from the old 'babylog_*' keys so local data survives the rename.
const OLD_KEYS: Record<'baby' | 'feeds' | 'excretes' | 'weights', string> = {
  baby: 'babylog_v2_profile',
  feeds: 'babylog_v2_feeds',
  excretes: 'babylog_v2_excretes',
  weights: 'babylog_v2_weights',
}
for (const k of ['baby', 'feeds', 'excretes', 'weights'] as const) {
  if (!localStorage.getItem(KEYS[k])) {
    const v = localStorage.getItem(OLD_KEYS[k])
    if (v !== null) {
      localStorage.setItem(KEYS[k], v)
      localStorage.removeItem(OLD_KEYS[k])
    }
  }
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function uid() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function normalizeFeed(raw: Record<string, unknown>): FeedLog {
  return {
    id: String(raw.id ?? uid()),
    kind: 'feed',
    timestamp: String(raw.timestamp ?? new Date().toISOString()),
    // legacy rows stored a single type + volume; new rows store split volumes
    breastVolume: raw.type === 'breast' ? Number(raw.volume) || 0 : Number(raw.breastVolume) || 0,
    formulaVolume: raw.type === 'formula' ? Number(raw.volume) || 0 : Number(raw.formulaVolume) || 0,
    duration: Number(raw.duration) || 0,
    side: (raw.side as FeedLog['side']) || null,
    notes: String(raw.notes ?? ''),
  }
}

function normalizeExcrete(raw: Record<string, unknown>): ExcreteLog {
  const type = raw.type === 'poop' || raw.type === 'both' ? raw.type : 'wet'
  return {
    id: String(raw.id ?? uid()),
    kind: 'excrete',
    timestamp: String(raw.timestamp ?? new Date().toISOString()),
    type,
    peeSize: String(raw.peeSize ?? ''),
    pooSize: String(raw.pooSize ?? ''),
    color: String(raw.color ?? ''),
    consistency: String(raw.consistency ?? ''),
    notes: String(raw.notes ?? ''),
  }
}

function normalizeWeight(raw: Record<string, unknown>): WeightLog {
  return {
    id: String(raw.id ?? uid()),
    kind: 'weight',
    timestamp: String(raw.timestamp ?? new Date().toISOString()),
    weight: Number(raw.weight) || 0,
    notes: String(raw.notes ?? ''),
  }
}

export function loadBaby(): BabyProfile {
  const v2 = safeParse<BabyProfile | null>(localStorage.getItem(KEYS.baby), null)
  if (v2) return { ...DEFAULT_BABY, ...v2 }
  const old = safeParse<Partial<BabyProfile> | null>(localStorage.getItem(KEYS.oldBaby), null)
  if (old) return { ...DEFAULT_BABY, ...old }
  return { ...DEFAULT_BABY }
}

export function loadFeeds(): FeedLog[] {
  const v2 = safeParse<unknown[]>(localStorage.getItem(KEYS.feeds), [])
  if (v2.length) return v2.map((x) => normalizeFeed(x as Record<string, unknown>))
  const old = safeParse<unknown[]>(localStorage.getItem(KEYS.oldFeeds), [])
  return old.map((x) => normalizeFeed(x as Record<string, unknown>))
}

export function loadExcretes(): ExcreteLog[] {
  const v2 = safeParse<unknown[]>(localStorage.getItem(KEYS.excretes), [])
  if (v2.length) return v2.map((x) => normalizeExcrete(x as Record<string, unknown>))
  const old = safeParse<unknown[]>(localStorage.getItem(KEYS.oldExcretes), [])
  return old.map((x) => normalizeExcrete(x as Record<string, unknown>))
}

export function loadWeights(): WeightLog[] {
  const v2 = safeParse<unknown[]>(localStorage.getItem(KEYS.weights), [])
  return v2.map((x) => normalizeWeight(x as Record<string, unknown>))
}

export function saveAll(baby: BabyProfile, feeds: FeedLog[], excretes: ExcreteLog[], weights: WeightLog[]) {
  localStorage.setItem(KEYS.baby, JSON.stringify(baby))
  localStorage.setItem(KEYS.feeds, JSON.stringify(feeds))
  localStorage.setItem(KEYS.excretes, JSON.stringify(excretes))
  localStorage.setItem(KEYS.weights, JSON.stringify(weights))
}

export function makeId() {
  return uid()
}

export function combineLogs(feeds: FeedLog[], excretes: ExcreteLog[], weights: WeightLog[]): LogEntry[] {
  return [...feeds, ...excretes, ...weights].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  )
}
