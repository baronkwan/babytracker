import type { BabyProfile, ExcreteLog, FeedLog, LogEntry } from './types'
import { DEFAULT_BABY } from './types'

const KEYS = {
  baby: 'babylog_v2_profile',
  feeds: 'babylog_v2_feeds',
  excretes: 'babylog_v2_excretes',
  // migrate from old single-file app keys if present
  oldBaby: 'baby_profile',
  oldFeeds: 'baby_feeds',
  oldExcretes: 'baby_excretes',
} as const

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
    type: raw.type === 'formula' ? 'formula' : 'breast',
    volume: Number(raw.volume) || 0,
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
    color: String(raw.color ?? ''),
    consistency: String(raw.consistency ?? ''),
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

export function saveAll(baby: BabyProfile, feeds: FeedLog[], excretes: ExcreteLog[]) {
  localStorage.setItem(KEYS.baby, JSON.stringify(baby))
  localStorage.setItem(KEYS.feeds, JSON.stringify(feeds))
  localStorage.setItem(KEYS.excretes, JSON.stringify(excretes))
}

export function makeId() {
  return uid()
}

export function combineLogs(feeds: FeedLog[], excretes: ExcreteLog[]): LogEntry[] {
  return [...feeds, ...excretes].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  )
}

export function exportCsv(feeds: FeedLog[], excretes: ExcreteLog[]): string {
  const rows = [
    ['kind', 'timestamp', 'type', 'volume_ml', 'duration_min', 'side', 'color', 'consistency', 'notes'],
  ]
  for (const f of feeds) {
    rows.push([
      'feed',
      f.timestamp,
      f.type,
      String(f.volume || ''),
      String(f.duration || ''),
      f.side || '',
      '',
      '',
      f.notes || '',
    ])
  }
  for (const e of excretes) {
    rows.push([
      'excrete',
      e.timestamp,
      e.type,
      '',
      '',
      '',
      e.color || '',
      e.consistency || '',
      e.notes || '',
    ])
  }
  return rows
    .map((r) => r.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(','))
    .join('\n')
}
