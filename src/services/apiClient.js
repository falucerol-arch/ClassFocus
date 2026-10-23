const resolveBaseUrl = () => {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL.replace(/\/$/, '')
  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:'
  return `${protocol}//${window.location.hostname}:8788/api`
}

class ApiClient {
  constructor() {
    this.baseUrl = resolveBaseUrl()
  }

  emitStatus(status, detail = '') {
    window.__CLASSFOCUS_DB_STATUS__ = { status, detail, at: Date.now() }
    window.dispatchEvent(new CustomEvent('classfocus-db-status', { detail: window.__CLASSFOCUS_DB_STATUS__ }))
  }

  async request(path, options = {}) {
    try {
      const token = sessionStorage.getItem('classfocus_api_token')
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) }
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        const error = new Error(data.message || data.error || `Error HTTP ${response.status}`)
        error.status = response.status
        throw error
      }
      this.emitStatus('online', data.database || 'PostgreSQL conectado')
      return data
    } catch (error) {
      if (!error.status) this.emitStatus('offline', 'API/PostgreSQL no disponible')
      throw error
    }
  }

  health() { return this.request('/health') }
  bootstrap() { return this.request('/bootstrap') }
  login(payload) { return this.request('/auth/login', { method: 'POST', body: JSON.stringify(payload) }) }
  syncAcademic(state) { return this.request('/academic', { method: 'PUT', body: JSON.stringify(state) }) }
  syncExams(exams) {
    const user = JSON.parse(sessionStorage.getItem('classfocus_session') || 'null')
    const own = user?.role === 'teacher' ? exams.filter(exam => Number(exam.teacherId) === user.id) : exams
    return this.request('/exams', { method: 'PUT', body: JSON.stringify({ exams: own }) })
  }
  liveIncidents(afterId) { return this.request(`/incidents/live${afterId ? `?afterId=${encodeURIComponent(afterId)}` : ''}`) }
  addIncident(studentId, incident) { return this.request('/incidents', { method: 'POST', body: JSON.stringify({ studentId, incident }) }) }
  addSample(studentId, sample) { return this.request('/samples', { method: 'POST', body: JSON.stringify({ studentId, sample }) }) }
}

export const apiClient = new ApiClient()
