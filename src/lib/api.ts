const API_BASE = import.meta.env.VITE_API_BASE || 'https://babylog-api.baronjetso.workers.dev'

let token: string | null = localStorage.getItem('babylog_token')

export function setToken(t: string) {
  token = t
  localStorage.setItem('babylog_token', t)
}

export function clearToken() {
  token = null
  localStorage.removeItem('babylog_token')
}

export function getToken() {
  return token
}

async function request(path: string, options: RequestInit = {}) {
  const headers: any = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || 'Request failed')
  }
  return res.json()
}

export const api = {
  login: (username: string, password: string) =>
    request('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) }),

  createUser: (username: string, password: string, adminKey: string) =>
    request('/api/admin/create-user', {
      method: 'POST',
      body: JSON.stringify({ username, password, admin_key: adminKey })
    }),

  getData: () => request('/api/data'),

  addFeed: (log: any) => request('/api/feeds', { method: 'POST', body: JSON.stringify(log) }),
  addExcrete: (log: any) => request('/api/excretes', { method: 'POST', body: JSON.stringify(log) }),
  deleteLog: (id: string, kind: 'feed' | 'excrete') =>
    request('/api/logs', { method: 'DELETE', body: JSON.stringify({ id, kind }) }),
  saveBaby: (baby: any) => request('/api/baby', { method: 'POST', body: JSON.stringify(baby) }),
}
