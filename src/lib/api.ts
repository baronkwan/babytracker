import type { BabyProfile, ExcreteLog, FeedLog, WeightLog } from './types'

const API_BASE = import.meta.env.VITE_API_BASE || 'https://babytracker-api.baronjetso.workers.dev'

let token: string | null = (() => {
  const t = localStorage.getItem('babytracker_token')
  if (t !== null) return t
  // one-time migration from the old key
  const old = localStorage.getItem('babylog_token')
  if (old !== null) {
    localStorage.setItem('babytracker_token', old)
    localStorage.removeItem('babylog_token')
    return old
  }
  return null
})()

export function setToken(t: string) {
  token = t
  localStorage.setItem('babytracker_token', t)
}

export function clearToken() {
  token = null
  localStorage.removeItem('babytracker_token')
  localStorage.removeItem('babylog_token')
}

export function getToken() {
  return token
}

export interface ApiData {
  baby: Record<string, unknown> | null
  feeds: Record<string, unknown>[]
  excretes: Record<string, unknown>[]
  weights: Record<string, unknown>[]
}

async function request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || 'Request failed')
  }
  return res.json()
}

export const api = {
  login: (username: string, password: string) =>
    request<{ token: string; username: string }>('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) }),

  createUser: (username: string, password: string, adminKey: string) =>
    request<{ success: boolean }>('/api/admin/create-user', {
      method: 'POST',
      body: JSON.stringify({ username, password, admin_key: adminKey }),
    }),

  getData: () => request<ApiData>('/api/data'),

  addFeed: (log: FeedLog) => request('/api/feeds', { method: 'POST', body: JSON.stringify(log) }),
  addExcrete: (log: ExcreteLog) => request('/api/excretes', { method: 'POST', body: JSON.stringify(log) }),
  addWeight: (log: WeightLog) => request('/api/weights', { method: 'POST', body: JSON.stringify(log) }),
  deleteLog: (id: string, kind: 'feed' | 'excrete' | 'weight') =>
    request('/api/logs', { method: 'DELETE', body: JSON.stringify({ id, kind }) }),
  deleteAll: () => request('/api/logs/all', { method: 'DELETE' }),
  saveBaby: (baby: BabyProfile) => request('/api/baby', { method: 'POST', body: JSON.stringify(baby) }),
}
