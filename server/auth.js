import { createHash, randomBytes } from 'node:crypto'
import { HttpError } from './errors.js'

export const hashToken = value => createHash('sha256').update(value).digest('hex')

// La base guarda únicamente el hash de la sesión. La identidad nunca viene del cuerpo HTTP.
export function createSessionAuth(db) {
  return {
    async issue(userId) {
      const token = randomBytes(32).toString('base64url')
      await db.query('DELETE FROM app_sessions WHERE expires_at <= NOW()')
      await db.query(`INSERT INTO app_sessions (token_hash,user_id,expires_at)
        VALUES ($1,$2,NOW() + INTERVAL '8 hours')`, [hashToken(token), userId])
      return token
    },
    async requireUser(req, _res, next) {
      const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '')
      if (!match) throw new HttpError(401, 'Inicia sesión nuevamente para continuar.')
      const result = await db.query(`SELECT u.id,u.name,u.email,u.role,u.source,s.token_hash
        FROM app_sessions s JOIN users u ON u.id=s.user_id
        WHERE s.token_hash=$1 AND s.expires_at > NOW()`, [hashToken(match[1])])
      if (!result.rows[0]) throw new HttpError(401, 'La sesión venció. Inicia sesión nuevamente.')
      req.user = result.rows[0]
      next()
    }
  }
}

export const requireRole = (...roles) => (req, _res, next) => {
  if (!roles.includes(req.user.role)) throw new HttpError(403, 'Tu perfil no tiene permiso para esta acción.')
  next()
}
