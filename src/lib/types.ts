export type FeedType = 'breast' | 'formula'
export type FeedSide = 'left' | 'right' | 'both'
export type ExcreteType = 'wet' | 'poop' | 'both'
export type Unit = 'ml' | 'oz'
export type TabId = 'home' | 'feed' | 'excrete' | 'history' | 'charts'

export interface BabyProfile {
  name: string
  dob: string
  gender: '女' | '男'
  birthWeight: number
  unit: Unit
}

export interface FeedLog {
  id: string
  kind: 'feed'
  timestamp: string
  type: FeedType
  volume: number
  duration: number
  side: FeedSide | null
  notes: string
}

export interface ExcreteLog {
  id: string
  kind: 'excrete'
  timestamp: string
  type: ExcreteType
  color: string
  consistency: string
  notes: string
}

export interface WeightLog {
  id: string
  kind: 'weight'
  timestamp: string
  weight: number
  notes: string
}

export type LogEntry = FeedLog | ExcreteLog | WeightLog

export const DEFAULT_BABY: BabyProfile = {
  name: '小寶寶',
  dob: new Date().toISOString().slice(0, 10),
  gender: '女',
  birthWeight: 3200,
  unit: 'ml',
}

export const VOLUME_CHIPS_ML = [30, 60, 90, 120, 150, 180]
export const DURATION_CHIPS = [5, 10, 15, 20, 30]
export const POOP_COLORS = ['黃色', '綠色', '棕色', '黑色', '紅色', '白色']
export const POOP_TEXTURES = ['軟', '稀', '硬', '水狀', '顆粒']
