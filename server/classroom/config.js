import { HttpError } from '../errors.js'

export function classroomConfig(env = process.env) {
  const clientId = env.GOOGLE_CLIENT_ID || ''
  const clientSecret = env.GOOGLE_CLIENT_SECRET || ''
  const encryptionKey = env.GOOGLE_TOKEN_ENCRYPTION_KEY || ''
  const frontendUrl = env.FRONTEND_URL || 'http://localhost:5173'
  const redirectUri = env.GOOGLE_REDIRECT_URI || 'http://localhost:8788/api/classroom/callback'
  const isLocalOrHttps = value => {
    try {
      const url = new URL(value)
      return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
    } catch { return false }
  }
  const configured = clientId.endsWith('.apps.googleusercontent.com') && !/TU_CLIENT|example/i.test(clientId)
    && Boolean(clientSecret) && /^[a-f\d]{64}$/i.test(encryptionKey)
    && isLocalOrHttps(frontendUrl) && isLocalOrHttps(redirectUri)
  return { clientId, clientSecret, encryptionKey, frontendUrl, redirectUri, configured }
}

export function requireConfiguration(config) {
  if (!config.configured) throw new HttpError(503, 'Configura las credenciales de Google Classroom en el servidor. Consulta GOOGLE_CLASSROOM_SETUP.md.')
}
