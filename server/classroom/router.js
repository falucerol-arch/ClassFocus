import { Router } from 'express'
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import { hashToken, requireRole } from '../auth.js'
import { HttpError } from '../errors.js'
import { classroomConfig, requireConfiguration } from './config.js'
import { GoogleGateway } from './googleGateway.js'
import { TokenVault } from './tokenVault.js'
import { importCourse } from './importCourse.js'

const cookieName = 'classfocus_oauth_nonce'
const sha256url = value => createHash('sha256').update(value).digest('base64url')
const scalar = value => typeof value === 'string' ? value : ''

export function createClassroomRouter({ db, transaction, auth, config = classroomConfig(), gateway = new GoogleGateway(config) }) {
  const router = Router()
  const cookiePath = config.configured ? new URL(config.redirectUri).pathname : '/api/classroom/callback'
  const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: config.redirectUri.startsWith('https:'), path: cookiePath }
  const vault = config.configured ? new TokenVault(config.encryptionKey) : null
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })

  // El callback no lleva Bearer: comprueba un state de un solo uso, la cookie y la sesión original.
  router.get('/callback', async (req, res) => {
    requireConfiguration(config)
    const state = scalar(req.query.state)
    const cookie = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) || ''
    if (!/^[A-Za-z0-9_-]{43}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(cookie)) throw new HttpError(400, 'La autorización no es válida. Inicia la conexión desde ClassFocus.')
    const attempt = await transaction(async client => {
      const result = await client.query(`SELECT o.*,u.role FROM classroom_oauth_states o
        JOIN app_sessions s ON s.token_hash=o.session_hash JOIN users u ON u.id=o.user_id
        WHERE o.state_hash=$1 AND o.expires_at>NOW() AND s.expires_at>NOW() FOR UPDATE OF o`, [hashToken(state)])
      const row = result.rows[0]
      if (!row || !timingSafeEqual(Buffer.from(row.nonce_hash, 'hex'), Buffer.from(hashToken(cookie), 'hex'))) throw new HttpError(400, 'La autorización venció o pertenece a otro navegador. Vuelve a conectar.')
      await client.query('DELETE FROM classroom_oauth_states WHERE state_hash=$1', [hashToken(state)])
      return row
    })
    res.clearCookie(cookieName, cookieOptions)
    const destination = new URL({ admin: '/admin', teacher: '/teacher', student: '/student' }[attempt.role], config.frontendUrl)
    if (req.query.error) {
      destination.searchParams.set('classroom', 'denied')
      return res.redirect(destination.href)
    }
    try {
      if (!scalar(req.query.code)) throw new HttpError(400, 'Google no devolvió el código de autorización.')
      const { tokens, profile } = await gateway.exchange(scalar(req.query.code), attempt.verifier)
      await transaction(async client => {
        const existing = await client.query('SELECT * FROM classroom_connections WHERE google_sub=$1 FOR UPDATE', [profile.sub])
        if (existing.rows[0] && Number(existing.rows[0].user_id) !== Number(attempt.user_id)) throw new HttpError(409, 'Esa cuenta de Google ya está vinculada a otro usuario de ClassFocus.')
        const previous = existing.rows[0] ? vault.open(existing.rows[0].encrypted_tokens) : {}
        const saved = { ...previous, ...tokens }
        if (!saved.refresh_token) throw new HttpError(409, 'Google no concedió acceso renovable. Revoca la conexión anterior en tu cuenta y vuelve a autorizar.')
        const savedConnection = await client.query(`INSERT INTO classroom_connections (user_id,google_sub,email,display_name,encrypted_tokens)
          VALUES ($1,$2,$3,$4,$5) ON CONFLICT (google_sub) DO UPDATE SET
          email=EXCLUDED.email,display_name=EXCLUDED.display_name,encrypted_tokens=EXCLUDED.encrypted_tokens,updated_at=NOW()
          WHERE classroom_connections.user_id=EXCLUDED.user_id RETURNING id`,
        [attempt.user_id, profile.sub, profile.email, profile.name || profile.email, vault.seal(saved)])
        if (!savedConnection.rowCount) throw new HttpError(409, 'Esa cuenta de Google ya está vinculada a otro usuario de ClassFocus.')
      })
      destination.searchParams.set('classroom', 'connected')
    } catch (error) {
      // No se incluyen errores del proveedor, códigos ni credenciales en la redirección.
      destination.searchParams.set('classroom', 'failed')
      if (error instanceof HttpError && error.status === 409) destination.searchParams.set('reason', 'account')
    }
    res.redirect(destination.href)
  })

  router.use(auth.requireUser)
  router.get('/status', async (req, res) => {
    const result = await db.query(`SELECT id,email,display_name,updated_at FROM classroom_connections
      WHERE user_id=$1 ORDER BY id`, [req.user.id])
    res.json({ configured: Boolean(config.configured), connections: result.rows })
  })
  router.use((_req, _res, next) => { requireConfiguration(config); next() })

  router.post('/authorize', async (req, res) => {
    const state = randomBytes(32).toString('base64url')
    const nonce = randomBytes(32).toString('base64url')
    const verifier = randomBytes(32).toString('base64url')
    await db.query('DELETE FROM classroom_oauth_states WHERE expires_at<=NOW()')
    await db.query(`INSERT INTO classroom_oauth_states (state_hash,nonce_hash,user_id,session_hash,verifier,expires_at)
      VALUES ($1,$2,$3,$4,$5,NOW()+INTERVAL '10 minutes')`, [hashToken(state), hashToken(nonce), req.user.id, req.user.token_hash, verifier])
    res.cookie(cookieName, nonce, { ...cookieOptions, maxAge: 600000 })
    res.json({ url: gateway.authorizationUrl(state, sha256url(verifier)) })
  })

  const withConnection = async (req, action) => {
    if (!/^\d+$/.test(req.params.connectionId)) throw new HttpError(400, 'Cuenta de Google no válida.')
    const result = await db.query('SELECT * FROM classroom_connections WHERE id=$1 AND user_id=$2', [req.params.connectionId, req.user.id])
    const connection = result.rows[0]
    if (!connection) throw new HttpError(404, 'La cuenta no está vinculada a tu usuario.')
    let tokens
    try { tokens = vault.open(connection.encrypted_tokens) } catch { throw new HttpError(503, 'No se pudo abrir la conexión. Revisa la clave de cifrado del servidor.') }
    return gateway.authorized(tokens, updated => db.query('UPDATE classroom_connections SET encrypted_tokens=$1 WHERE id=$2 AND user_id=$3', [vault.seal(updated), connection.id, req.user.id]), client => action(client, connection))
  }

  router.get('/:connectionId/courses', async (req, res) => {
    const courses = await withConnection(req, client => gateway.listCourses(client))
    res.json({ courses })
  })

  router.post('/:connectionId/courses/:courseId/import', requireRole('teacher'), async (req, res) => {
    if (!/^[\w-]{1,120}$/.test(req.params.courseId)) throw new HttpError(400, 'Curso de Google no válido.')
    const course = await withConnection(req, (client, connection) => gateway.roster(client, req.params.courseId, connection.google_sub))
    const summary = await importCourse({ transaction, course, user: req.user })
    // Este mensaje se envía después de COMMIT, nunca después de un guardado solo local.
    res.json({ ok: true, summary })
  })

  router.delete('/:connectionId', async (req, res) => {
    // Desvincula solo esta cuenta; conserva cursos, alumnos, evaluaciones e incidencias.
    // No revoca el consentimiento global de Google: otras conexiones del mismo proyecto pueden usarlo.
    const result = await db.query('DELETE FROM classroom_connections WHERE id::text=$1 AND user_id=$2 RETURNING id', [req.params.connectionId, req.user.id])
    if (!result.rowCount) throw new HttpError(404, 'La cuenta no está vinculada a tu usuario.')
    await db.query('DELETE FROM classroom_oauth_states WHERE user_id=$1', [req.user.id])
    res.json({ ok: true })
  })
  return router
}
