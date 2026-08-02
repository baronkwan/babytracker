import { differenceInCalendarDays, format, formatDistanceToNowStrict, isToday, parseISO } from 'date-fns'
import { zhTW } from 'date-fns/locale'
import type { BabyProfile, ExcreteLog, FeedLog, Unit } from './types'

export function dayKey(iso: string) {
  return format(parseISO(iso), 'yyyy-MM-dd')
}

export function todayKey() {
  return format(new Date(), 'yyyy-MM-dd')
}

export function todayLocal() {
  return format(new Date(), 'yyyy-MM-dd')
}

export function nowLocalTime() {
  return format(new Date(), 'HH:mm')
}

export function toIsoFromLocal(date: string, time: string) {
  const d = new Date(`${date || todayLocal()}T${time || '00:00'}`)
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}

export function ageLabel(dob: string) {
  if (!dob) return ''
  const days = differenceInCalendarDays(new Date(), parseISO(dob))
  if (days < 0) return '未出生'
  if (days === 0) return '今日出生'
  if (days < 7) return `${days} 天大`
  const weeks = Math.floor(days / 7)
  const rem = days % 7
  if (days < 60) return rem ? `${weeks} 週又 ${rem} 天` : `${weeks} 週大`
  const months = Math.floor(days / 30.437)
  return `${months} 個月大 · ${days} 天`
}

export function fmtDateTime(iso: string) {
  const d = parseISO(iso)
  if (isToday(d)) return `今日 ${format(d, 'HH:mm')}`
  return format(d, 'M/d HH:mm')
}

export function fmtAgo(iso: string) {
  try {
    return formatDistanceToNowStrict(parseISO(iso), { addSuffix: true, locale: zhTW })
  } catch {
    return ''
  }
}

export function toDisplayVolume(ml: number, unit: Unit) {
  if (unit === 'oz') return Math.round((ml / 29.5735) * 10) / 10
  return Math.round(ml)
}

export function unitLabel(unit: Unit) {
  return unit === 'oz' ? 'oz' : 'ml'
}

export function feedTypeLabel(type: FeedLog['type']) {
  return type === 'breast' ? '母乳' : '配方奶'
}

export function sideLabel(side: FeedLog['side']) {
  if (side === 'left') return '左'
  if (side === 'right') return '右'
  if (side === 'both') return '兩邊'
  return ''
}

export function excreteLabel(type: ExcreteLog['type']) {
  if (type === 'wet') return '濕尿布'
  if (type === 'poop') return '大便'
  return '濕+便'
}

export function todayFeeds(feeds: FeedLog[]) {
  const t = todayKey()
  return feeds.filter((f) => dayKey(f.timestamp) === t)
}

export function todayExcretes(excretes: ExcreteLog[]) {
  const t = todayKey()
  return excretes.filter((e) => dayKey(e.timestamp) === t)
}

export function buildDoctorText(baby: BabyProfile, feeds: FeedLog[], excretes: ExcreteLog[]) {
  const tf = todayFeeds(feeds)
  const te = todayExcretes(excretes)
  const vol = tf.reduce((s, f) => s + (f.volume || 0), 0)
  const wet = te.filter((e) => e.type === 'wet' || e.type === 'both').length
  const poop = te.filter((e) => e.type === 'poop' || e.type === 'both').length
  const lines = [
    `BabyLog 醫生報告 — ${baby.name}`,
    `性別：${baby.gender}｜出生日：${baby.dob || '—'}｜出生體重：${baby.birthWeight || '—'}g`,
    `年齡：${ageLabel(baby.dob)}`,
    '',
    `【今日】${format(new Date(), 'yyyy-MM-dd')}`,
    `餵奶：${tf.length} 次，共 ${vol} ml`,
    `排泄：${te.length} 次（濕 ${wet} / 便 ${poop}）`,
    '',
    '【最近餵奶】',
    ...tf.slice(0, 8).map(
      (f) =>
        `${fmtDateTime(f.timestamp)} · ${feedTypeLabel(f.type)} · ${f.volume || 0}ml` +
        (f.duration ? ` · ${f.duration}min` : '') +
        (f.side ? ` · ${sideLabel(f.side)}` : '') +
        (f.notes ? ` · ${f.notes}` : ''),
    ),
    '',
    '【最近排泄】',
    ...te.slice(0, 8).map(
      (e) =>
        `${fmtDateTime(e.timestamp)} · ${excreteLabel(e.type)}` +
        (e.color ? ` · ${e.color}` : '') +
        (e.consistency ? ` · ${e.consistency}` : '') +
        (e.notes ? ` · ${e.notes}` : ''),
    ),
    '',
    `累計：餵奶 ${feeds.length} 次 / 排泄 ${excretes.length} 次`,
    `生成時間：${format(new Date(), 'yyyy-MM-dd HH:mm')}`,
    '（僅供參考，請以臨床判斷為準）',
  ]
  return lines.join('\n')
}

export function lastNDaysKeys(n: number) {
  const keys: string[] = []
  const now = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(now.getDate() - i)
    keys.push(format(d, 'yyyy-MM-dd'))
  }
  return keys
}


