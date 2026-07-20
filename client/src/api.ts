import { getStoredToken, clearStoredToken } from './auth/storage'

const API_BASE = ''

function authHeaders(extra?: HeadersInit): HeadersInit {
  const token = getStoredToken()
  return {
    ...(extra || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: authHeaders(options?.headers),
  })
  if (res.status === 401) {
    clearStoredToken()
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((data as { message?: string }).message || `请求失败 ${res.status}`)
  }
  return data as T
}

export async function login(username: string, password: string) {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message || '登录失败')
  return data as {
    token: string
    expiresAt: string
    user: { id: number; username: string }
  }
}

export async function logout() {
  await request('/api/auth/logout', { method: 'POST' })
}

export async function fetchMe() {
  const res = await request<{ data: { id: number; username: string } }>('/api/auth/me')
  return res.data
}

export async function listSessions() {
  const res = await request<{ data: import('./types').Session[] }>('/api/sessions')
  return res.data
}

export async function getSession(id: number) {
  const res = await request<{ data: import('./types').Session }>(`/api/sessions/${id}`)
  return res.data
}

export async function createSession(form: FormData) {
  const res = await fetch('/api/sessions', {
    method: 'POST',
    body: form,
    headers: authHeaders(),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.message || '创建失败')
  return data.data as import('./types').Session
}

export async function endSession(id: number) {
  return request<{
    data: import('./types').Session
    endedRound?: number | null
    analysis?: { analysis: import('./types').AnalysisResult; questions: import('./types').Question[] } | null
    analysisError?: string | null
  }>(`/api/sessions/${id}/end`, {
    method: 'POST',
  })
}

export async function continueSession(id: number) {
  const res = await request<{ data: import('./types').Session }>(`/api/sessions/${id}/continue`, {
    method: 'POST',
  })
  return res.data
}

export async function deleteSession(id: number) {
  await request(`/api/sessions/${id}`, { method: 'DELETE' })
}

export async function deleteRound(sessionId: number, roundNumber: number) {
  const res = await request<{ data: import('./types').Session }>(
    `/api/sessions/${sessionId}/rounds/${roundNumber}`,
    { method: 'DELETE' },
  )
  return res.data
}

export async function recordSlide(id: number, slideIndex: number, eventAtMs: number) {
  await request(`/api/sessions/${id}/slide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slideIndex, eventAtMs }),
  })
}

export async function updateSubtitleStyle(id: number, subtitleStyle: import('./types').SubtitleStyle) {
  await request(`/api/sessions/${id}/subtitle-style`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subtitleStyle }),
  })
}

export async function analyzeSession(id: number, round?: number) {
  const query = round != null ? `?round=${round}` : ''
  const res = await request<{ data: { analysis: import('./types').AnalysisResult; questions: import('./types').Question[]; roundNumber?: number } }>(
    `/api/sessions/${id}/analyze${query}`,
    { method: 'POST' },
  )
  return res.data
}

export async function getReport(id: number, round?: number) {
  const query = round != null ? `?round=${round}` : ''
  const res = await request<{ data: import('./types').Report }>(`/api/sessions/${id}/report${query}`)
  return res.data
}

export function exportUrl(id: number, format: 'md' | 'docx', round?: number) {
  const params = new URLSearchParams({ format })
  if (round != null) params.set('round', String(round))
  const token = getStoredToken()
  if (token) params.set('token', token)
  return `/api/sessions/${id}/export?${params.toString()}`
}

export async function getAgentConfig() {
  const res = await request<{ data: import('./types/agentConfig').AgentConfig }>('/api/agent/config')
  return res.data
}

export async function saveAgentConfig(config: import('./types/agentConfig').AgentConfig) {
  const res = await request<{ data: import('./types/agentConfig').AgentConfig }>('/api/agent/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
  return res.data
}

export async function listKnowledgeDocs() {
  const res = await request<{ data: import('./types/agentConfig').KnowledgeDoc[] }>(
    '/api/agent/knowledge',
  )
  return res.data
}

export async function uploadKnowledgeDoc(form: FormData) {
  const res = await fetch('/api/agent/knowledge', {
    method: 'POST',
    body: form,
    headers: authHeaders(),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.message || '上传失败')
  return data.data as import('./types/agentConfig').KnowledgeDoc
}

export async function deleteKnowledgeDoc(id: string) {
  await request(`/api/agent/knowledge/${id}`, { method: 'DELETE' })
}

export function wsAsrUrl(sessionId: number) {
  const serverPort = import.meta.env.VITE_SERVER_PORT || '3200'
  const token = getStoredToken() || ''
  const qs = `sessionId=${sessionId}&token=${encodeURIComponent(token)}`
  if (import.meta.env.DEV) {
    return `ws://localhost:${serverPort}/ws/asr?${qs}`
  }
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const host = window.location.host
  return `${proto}://${host}/ws/asr?${qs}`
}
