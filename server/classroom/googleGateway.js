import { OAuth2Client } from 'google-auth-library'
import { HttpError } from '../errors.js'

const ROOT = 'https://classroom.googleapis.com/v1/'
export const CLASSROOM_SCOPES = [
  'openid', 'email', 'profile',
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.rosters.readonly',
  'https://www.googleapis.com/auth/classroom.profile.emails'
]

// Se solicitan solo cursos y participantes. Las actividades se dejan para una etapa posterior.
export class GoogleGateway {
  constructor(config) { this.config = config }

  client() {
    return new OAuth2Client(this.config.clientId, this.config.clientSecret, this.config.redirectUri)
  }

  authorizationUrl(state, codeChallenge) {
    return this.client().generateAuthUrl({
      scope: CLASSROOM_SCOPES, access_type: 'offline', prompt: 'consent select_account',
      include_granted_scopes: true, state, code_challenge: codeChallenge, code_challenge_method: 'S256'
    })
  }

  async exchange(code, verifier) {
    const client = this.client()
    const { tokens } = await client.getToken({ code, codeVerifier: verifier })
    // El ID token firmado vincula la conexión con una identidad comprobada por Google.
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: this.config.clientId })
    const profile = ticket.getPayload()
    if (!profile?.sub || !profile.email || !profile.email_verified) throw new HttpError(403, 'Google no devolvió una identidad con correo verificado.')
    delete tokens.id_token
    return { tokens, profile }
  }

  async authorized(tokens, onTokens, action) {
    const client = this.client()
    client.setCredentials(tokens)
    // La librería renueva el access token. Se conserva el refresh token si Google no lo reenvía.
    client.on('tokens', fresh => { client.credentials = { ...tokens, ...client.credentials, ...fresh } })
    try {
      return await action(client)
    } catch (error) {
      if (error instanceof HttpError) throw error
      const status = Number(error.response?.status || 0)
      const code = error.response?.data?.error
      if (status === 401 || code === 'invalid_grant') throw new HttpError(401, 'La autorización de Google venció o fue revocada. Vuelve a conectar esa cuenta.')
      if (status === 403) throw new HttpError(403, 'Google no permite consultar estos datos. Revisa el rol del curso, los permisos concedidos y las políticas de la universidad.')
      if (status === 404) throw new HttpError(404, 'El curso ya no está disponible para esta cuenta.')
      if (status === 429) throw new HttpError(429, 'Google limitó temporalmente las consultas. Intenta de nuevo más tarde.')
      throw new HttpError(502, 'No se pudo completar la consulta a Google Classroom. Intenta de nuevo.')
    } finally {
      // Solo el servidor recibe y guarda estas credenciales; nunca se envían a React.
      await onTokens({ ...tokens, ...client.credentials })
    }
  }

  async allPages(client, path, key, params = {}) {
    const items = []
    const seenTokens = new Set()
    let pageToken
    do {
      const { data } = await client.request({
        url: `${ROOT}${path}`, params: { ...params, pageSize: 100, ...(pageToken ? { pageToken } : {}) }, timeout: 20000
      })
      items.push(...(data[key] || []))
      pageToken = data.nextPageToken
      if (pageToken && seenTokens.has(pageToken)) throw new HttpError(502, 'Google devolvió una paginación repetida; no se importaron datos incompletos.')
      if (pageToken) seenTokens.add(pageToken)
    } while (pageToken)
    return items
  }

  async listCourses(client) {
    const [teaching, studying] = await Promise.all([
      this.allPages(client, 'courses', 'courses', { teacherId: 'me', courseStates: 'ACTIVE' }),
      this.allPages(client, 'courses', 'courses', { studentId: 'me', courseStates: 'ACTIVE' })
    ])
    const courses = new Map(studying.map(course => [course.id, { ...course, googleRole: 'student' }]))
    teaching.forEach(course => courses.set(course.id, { ...course, googleRole: 'teacher' }))
    return [...courses.values()]
  }

  async readCourse(client, courseId) {
    const id = encodeURIComponent(courseId)
    const { data } = await client.request({ url: `${ROOT}courses/${id}`, timeout: 20000 })
    return data
  }

  async roster(client, courseId, googleSub) {
    const course = await this.readCourse(client, courseId)
    if (course.courseState !== 'ACTIVE') throw new HttpError(409, 'Solo se importan cursos activos.')
    const id = encodeURIComponent(courseId)
    const teachers = await this.allPages(client, `courses/${id}/teachers`, 'teachers')
    if (!teachers.some(teacher => String(teacher.userId) === String(googleSub))) {
      throw new HttpError(403, 'Debes ser docente de este curso en Google Classroom para importar su lista de alumnos.')
    }
    // Si una página falla, no se confirma la importación ni se reemplaza la matrícula anterior.
    const students = await this.allPages(client, `courses/${id}/students`, 'students')
    return { ...course, teachers, students }
  }
}
