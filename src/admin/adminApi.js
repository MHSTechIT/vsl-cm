const BASE = import.meta.env.VITE_API_URL || ''
const TOKEN_KEY = 'vsl_admin_token'

export const getToken = () => localStorage.getItem(TOKEN_KEY) || ''
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t)
export const clearToken = () => localStorage.removeItem(TOKEN_KEY)

async function req(path, options = {}) {
  const res = await fetch(`${BASE}/api/admin${path}`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
      ...(options.headers || {}),
    },
    ...options,
  })
  if (res.status === 401) {
    const e = new Error('unauthorized')
    e.code = 401
    throw e
  }
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'request failed')
  return res.status === 204 ? null : res.json()
}

// multipart POST (file uploads) — no JSON content-type, browser sets boundary
async function postForm(path, formData) {
  const res = await fetch(`${BASE}/api/admin${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
    body: formData,
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'upload failed')
  return res.json()
}

// multipart POST with upload-progress (XHR exposes upload.onprogress; fetch can't)
function postFormProgress(path, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${BASE}/api/admin${path}`)
    xhr.setRequestHeader('Authorization', `Bearer ${getToken()}`)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText || '{}')) } catch { resolve({}) }
      } else {
        let msg = 'upload failed'
        try { msg = JSON.parse(xhr.responseText).error || msg } catch { /* ignore */ }
        reject(new Error(msg))
      }
    }
    xhr.onerror = () => reject(new Error('network error'))
    xhr.send(formData)
  })
}

export const adminApi = {
  stats: () => req('/stats'),
  getConfig: () => req('/config'),
  saveConfig: (formData, onProgress) => postFormProgress('/config', formData, onProgress),
  listTestimonials: () => req('/testimonials'),
  addTestimonial: (formData) => postForm('/testimonials', formData),
  deleteTestimonial: (id) => req(`/testimonials/${id}`, { method: 'DELETE' }),
  leads: () => req('/leads'),
  slots: () => req('/slots'),
  settings: () => req('/settings'),
  openDate: (date, times) =>
    req('/slots', { method: 'POST', body: JSON.stringify({ date, times }) }),
  closeDate: (date) => req('/slots/close', { method: 'POST', body: JSON.stringify({ date }) }),
  setSeats: (date, time, seats) =>
    req('/slots/seats', { method: 'POST', body: JSON.stringify({ date, time, seats }) }),
  removeTime: (date, time) =>
    req('/slots/remove', { method: 'POST', body: JSON.stringify({ date, time }) }),
  waSent: (phone) => req(`/leads/${encodeURIComponent(phone)}/wa-sent`, { method: 'POST' }),
}
