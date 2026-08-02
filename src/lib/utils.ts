import { differenceInCalendarDays, format, formatDistanceToNowStrict, isToday, parseISO } from 'date-fns'
import { zhTW } from 'date-fns/locale'
import type { BabyProfile, ExcreteLog, FeedLog, Unit } from './types'
import { POOP_COLORS, POOP_TEXTURES } from './types'

export function dayKey(iso: string) {
  return format(parseISO(iso), 'yyyy-MM-dd')
}

export function hourKey(iso: string) {
  return format(parseISO(iso), 'HH')
}

// Parse free-form speech/text into form fields, e.g.
// "今日 下午2點 70ml 母乳 30ml 配方奶 有尿有屎 黃色 軟" → date today,
// time 14:00, breast 70, formula 30, excrete both, color 黃色, texture 軟.
// Milk keywords pair with numbers in text order (first keyword ↔ first
// number, etc.); time/count numbers (8點/3次) are filtered out.
// Excrete: 尿/屎/便 keywords, sizes 少/多, colors/textures by label.
export function parseSpeechText(text: string): {
  breastVolume: number
  formulaVolume: number
  excreteType: 'wet' | 'poop' | 'both' | null
  peeSize: string
  pooSize: string
  dayOffset: number
  time: string | null
  color: string
  texture: string
} {
  const s = text.toLowerCase()
  // Numbers for milk volumes: exclude digits that are part of time/count
  // expressions (12點 / 8:30 / 8點45 / 3次 / 今日). Lookbehind blocks
  // minute digits after 點/時/colon; lookahead blocks time/count suffixes.
  const nums = [...s.matchAll(/(?<![\d點時分:：])(\d+(?:\.\d+)?)(?!\d)(?!\s*(?:點|時|分|次|日|天|[:：]))/g)].map((m) => Number(m[1]))
  const kwOrder = [...s.matchAll(/母乳|母奶|親餵|配方|奶粉/g)].map((m) => m[0])
  const kwNum = (re: RegExp) => {
    const i = kwOrder.findIndex((k) => re.test(k))
    return i >= 0 && i < nums.length ? nums[i] : 0
  }
  const hasWet = /尿|pee/.test(s)
  const hasPoo = /屎|便|poo/.test(s)

  // Date: 今日/今天 0, 尋日/昨日/昨天 -1, 前日/前天 -2
  const dayOffset = /前日|前天/.test(s) ? -2 : /尋日|昨日|昨天/.test(s) ? -1 : 0

  // Time: 凌晨/早上/上午/中午/下午/傍晚/晚上/夜晚/今晚 + H點(半|MM) or HH:MM
  let time: string | null = null
  const tq = /(凌晨|半夜|早上|朝早|上午|中午|下午|傍晚|下晝|晏晝|晚上|夜晚|今晚)/.exec(s)
  const qual = tq?.[1] ?? ''
  const cn = s.match(/(\d{1,2})\s*(?:點|时|時)(半|(\d{1,2}))?(?:分)?/)
  const colon = s.match(/(\d{1,2})[:：](\d{1,2})/)
  if (cn) {
    let h = Number(cn[1])
    const m = cn[2] === '半' ? 30 : cn[3] ? Number(cn[3]) : 0
    const eve = /晚上|夜晚|傍晚|半夜/.test(qual)
    const late = /晚上|夜晚|凌晨|半夜/.test(qual)
    if ((eve || /下午|下晝|晏晝/.test(qual)) && h < 12) h += 12
    if (late && h === 12) h = 0
    time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  } else if (colon) {
    time = `${colon[1].padStart(2, '0')}:${colon[2].padStart(2, '0')}`
  }

  const colorMatch = (POOP_COLORS as string[]).find((c) => s.includes(c.toLowerCase()))
  const textureMatch = (POOP_TEXTURES as string[]).find((t) => s.includes(t))

  return {
    breastVolume: kwNum(/母乳|母奶|親餵/),
    formulaVolume: kwNum(/配方|奶粉/),
    excreteType: hasWet && hasPoo ? 'both' : hasPoo ? 'poop' : hasWet ? 'wet' : null,
    peeSize: /少(?:量)?尿/.test(s) ? '少' : /多(?:量)?尿/.test(s) ? '多' : '',
    pooSize: /少(?:量)?[屎便]/.test(s) ? '少' : /多(?:量)?[屎便]/.test(s) ? '多' : '',
    dayOffset,
    time,
    color: /啡色|棕色/.test(s) ? '棕色' : (colorMatch ?? ''),
    texture: textureMatch ?? '',
  }
}

export function todayKey() {
  return format(new Date(), 'yyyy-MM-dd')
}

export function todayLocal() {
  return format(new Date(), 'yyyy-MM-dd')
}

export function offsetDateKey(offsetDays: number) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return format(d, 'yyyy-MM-dd')
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

export function sideLabel(side: FeedLog['side']) {
  if (side === 'left') return '左'
  if (side === 'right') return '右'
  if (side === 'both') return '兩邊'
  return ''
}

export function excreteLabel(type: ExcreteLog['type']) {
  if (type === 'wet') return '淨尿'
  if (type === 'poop') return '淨便'
  return '尿+便'
}

export function feedVolumeMl(f: FeedLog) {
  const parts: string[] = []
  if (f.breastVolume > 0) parts.push(`母乳 ${f.breastVolume}ml`)
  if (f.formulaVolume > 0) parts.push(`配方 ${f.formulaVolume}ml`)
  return parts.length ? parts.join(' + ') : ''
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
  const bvol = tf.reduce((s, f) => s + (f.breastVolume || 0), 0)
  const fvol = tf.reduce((s, f) => s + (f.formulaVolume || 0), 0)
  const vol = bvol + fvol
  const wet = te.filter((e) => e.type === 'wet' || e.type === 'both').length
  const poop = te.filter((e) => e.type === 'poop' || e.type === 'both').length
  const lines = [
    `BabyTracker 醫生報告 — ${baby.name}`,
    `性別：${baby.gender}｜出生日：${baby.dob || '—'}｜出生體重：${baby.birthWeight || '—'}g`,
    `年齡：${ageLabel(baby.dob)}`,
    '',
    `【今日】${format(new Date(), 'yyyy-MM-dd')}`,
    `餵奶：${tf.length} 次，共 ${vol} ml（母乳 ${bvol} / 配方 ${fvol}）`,
    `排泄：${te.length} 次（尿 ${wet} / 便 ${poop}）`,
    '',
    '【最近餵奶】',
    ...tf.slice(0, 8).map(
      (f) =>
        `${fmtDateTime(f.timestamp)} · ${feedVolumeMl(f) || '記錄'}` +
        (f.duration ? ` · ${f.duration}min` : '') +
        (f.side ? ` · ${sideLabel(f.side)}` : '') +
        (f.notes ? ` · ${f.notes}` : ''),
    ),
    '',
    '【最近排泄】',
    ...te.slice(0, 8).map(
      (e) =>
        `${fmtDateTime(e.timestamp)} · ${excreteLabel(e.type)}` +
        (e.peeSize ? ` · 尿量${e.peeSize}` : '') +
        (e.pooSize ? ` · 便量${e.pooSize}` : '') +
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


