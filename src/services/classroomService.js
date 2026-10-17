const GOOGLE_SCRIPT_ID = 'google-identity-services'
const CLASSROOM_TOKEN_KEY = 'classfocus_google_token'

const SCOPES = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.rosters.readonly',
  'https://www.googleapis.com/auth/classroom.profile.emails',
  'https://www.googleapis.com/auth/classroom.coursework.students.readonly'
].join(' ')

const demoCourses = [
  {
    id: 'demo-prog-2026',
    name: 'Programación I',
    section: 'Sección A · 2026',
    courseState: 'ACTIVE',
    alternateLink: 'https://classroom.google.com/',
    teachers: [
      { userId: 'demo-teacher-1', profile: { name: { fullName: 'Ing. Carlos Méndez' }, emailAddress: 'teacher@classfocus.com' } }
    ],
    students: [
      { userId: 'demo-student-1', profile: { name: { fullName: 'Alumno Demo' }, emailAddress: 'student@classfocus.com' } },
      { userId: 'demo-student-2', profile: { name: { fullName: 'María López' }, emailAddress: 'maria@classfocus.com' } }
    ],
    courseWork: [
      { id: 'cw1', title: 'Parcial 1 · Fundamentos de JavaScript', state: 'PUBLISHED', dueDate: { year: 2026, month: 10, day: 21 } },
      { id: 'cw2', title: 'Laboratorio · POO', state: 'PUBLISHED', dueDate: { year: 2026, month: 10, day: 28 } }
    ]
  },
  {
    id: 'demo-db-2026',
    name: 'Base de Datos I',
    section: 'Sección B · 2026',
    courseState: 'ACTIVE',
    alternateLink: 'https://classroom.google.com/',
    teachers: [
      { userId: 'demo-teacher-2', profile: { name: { fullName: 'Lic. Ana García' }, emailAddress: 'ana@classfocus.com' } }
    ],
    students: [
      { userId: 'demo-student-1', profile: { name: { fullName: 'Alumno Demo' }, emailAddress: 'student@classfocus.com' } },
      { userId: 'demo-student-3', profile: { name: { fullName: 'José Pérez' }, emailAddress: 'jose@classfocus.com' } }
    ],
    courseWork: [
      { id: 'cw3', title: 'Examen · Modelo relacional', state: 'PUBLISHED', dueDate: { year: 2026, month: 11, day: 4 } }
    ]
  }
]

function loadGoogleIdentity() {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  const existing = document.getElementById(GOOGLE_SCRIPT_ID)
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', resolve, { once: true })
      existing.addEventListener('error', () => reject(new Error('No se pudo cargar Google Identity Services.')), { once: true })
    })
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.id = GOOGLE_SCRIPT_ID
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = resolve
    script.onerror = () => reject(new Error('No se pudo cargar Google Identity Services.'))
    document.head.appendChild(script)
  })
}

async function apiGet(path, token) {
  const response = await fetch(`https://classroom.googleapis.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (!response.ok) {
    let detail = ''
    try {
      const body = await response.json()
      detail = body?.error?.message || ''
    } catch {
      // respuesta sin JSON
    }
    throw new Error(detail || `Google Classroom respondió ${response.status}.`)
  }
  return response.json()
}

class ClassroomService {
  constructor() {
    this.tokenClient = null
  }

  isConfigured() {
    return Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID)
  }

  getMode() {
    return this.isConfigured() ? 'real' : 'demo'
  }

  getStoredToken() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(CLASSROOM_TOKEN_KEY))
      if (saved?.accessToken && saved?.expiresAt > Date.now() + 15000) return saved.accessToken
    } catch {
      // token inválido: se ignora
    }
    return null
  }

  async connect() {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
    if (!clientId) throw new Error('Falta VITE_GOOGLE_CLIENT_ID. Puedes usar “Cargar demo de Classroom” mientras configuras Google Cloud.')

    await loadGoogleIdentity()

    return new Promise((resolve, reject) => {
      this.tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPES,
        callback: response => {
          if (response?.error) {
            reject(new Error(response.error_description || response.error))
            return
          }
          const expiresIn = Number(response.expires_in || 3600)
          sessionStorage.setItem(CLASSROOM_TOKEN_KEY, JSON.stringify({
            accessToken: response.access_token,
            expiresAt: Date.now() + (expiresIn * 1000)
          }))
          resolve(response.access_token)
        }
      })
      this.tokenClient.requestAccessToken({ prompt: 'consent' })
    })
  }

  async getToken() {
    return this.getStoredToken() || this.connect()
  }

  async disconnect() {
    const token = this.getStoredToken()
    sessionStorage.removeItem(CLASSROOM_TOKEN_KEY)
    if (token && window.google?.accounts?.oauth2) {
      window.google.accounts.oauth2.revoke(token)
    }
  }

  async listCourses({ demo = false } = {}) {
    if (demo) return JSON.parse(JSON.stringify(demoCourses))

    const token = await this.getToken()
    const response = await apiGet('courses?courseStates=ACTIVE&pageSize=20', token)
    const courses = response.courses || []

    return Promise.all(courses.map(async course => {
      const courseId = encodeURIComponent(course.id)
      const [studentsResult, teachersResult, workResult] = await Promise.allSettled([
        apiGet(`courses/${courseId}/students?pageSize=100`, token),
        apiGet(`courses/${courseId}/teachers?pageSize=20`, token),
        apiGet(`courses/${courseId}/courseWork?pageSize=30&orderBy=dueDate%20desc`, token)
      ])

      return {
        ...course,
        students: studentsResult.status === 'fulfilled' ? studentsResult.value.students || [] : [],
        teachers: teachersResult.status === 'fulfilled' ? teachersResult.value.teachers || [] : [],
        courseWork: workResult.status === 'fulfilled' ? workResult.value.courseWork || [] : []
      }
    }))
  }
}

export const classroomService = new ClassroomService()
