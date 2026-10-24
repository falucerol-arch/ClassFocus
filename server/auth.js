import {
  createHash,
  randomBytes
} from 'node:crypto'

import { HttpError } from './errors.js'


// =====================================================
// HASH DEL TOKEN
// =====================================================

export const hashToken = value =>
  createHash('sha256')
    .update(value)
    .digest('hex')


// =====================================================
// AUTENTICACIÓN DE SESIÓN
// =====================================================

// La base guarda únicamente el hash de la sesión.
// La identidad nunca viene del cuerpo HTTP.
export function createSessionAuth(db) {

  // ---------------------------------------------------
  // Obtener todos los roles de un usuario
  // ---------------------------------------------------

  async function getUserRoles(userId) {
    const result = await db.query(
      `
      SELECT role
      FROM user_roles
      WHERE user_id = $1
      ORDER BY role
      `,
      [userId]
    )

    return result.rows.map(
      row => row.role
    )
  }


  // ---------------------------------------------------
  // Comprobar que un usuario tenga determinado rol
  // ---------------------------------------------------

  async function hasRole(
    userId,
    role
  ) {
    const result = await db.query(
      `
      SELECT 1
      FROM user_roles
      WHERE user_id = $1
      AND role = $2
      LIMIT 1
      `,
      [
        userId,
        role
      ]
    )

    return Boolean(
      result.rowCount
    )
  }


  return {

    // =================================================
    // CONSULTAR ROLES
    // =================================================

    async roles(userId) {
      return getUserRoles(
        userId
      )
    },


    // =================================================
    // CREAR SESIÓN
    // =================================================

    async issue(
      userId,
      requestedRole = null
    ) {

      // Limpiar sesiones vencidas.
      await db.query(
        `
        DELETE FROM app_sessions
        WHERE expires_at <= NOW()
        `
      )


      // Obtener usuario y rol antiguo.
      // users.role se conserva temporalmente
      // por compatibilidad.
      const userResult =
        await db.query(
          `
          SELECT
            id,
            role
          FROM users
          WHERE id = $1
          LIMIT 1
          `,
          [userId]
        )

      const user =
        userResult.rows[0]

      if (!user) {
        throw new HttpError(
          401,
          'El usuario ya no existe.'
        )
      }


      // Obtener los nuevos roles.
      let userRoles =
        await getUserRoles(
          userId
        )


      // Compatibilidad:
      // si por alguna razón todavía no existe
      // registro en user_roles, migramos el rol viejo.
      if (!userRoles.length) {

        await db.query(
          `
          INSERT INTO user_roles (
            user_id,
            role
          )
          VALUES ($1,$2)

          ON CONFLICT (
            user_id,
            role
          )
          DO NOTHING
          `,
          [
            userId,
            user.role
          ]
        )

        userRoles = [
          user.role
        ]
      }


      // Si el login todavía no envía rol,
      // utilizamos temporalmente users.role.
      const activeRole =
        requestedRole ||
        user.role ||
        userRoles[0]


      if (
        !userRoles.includes(
          activeRole
        )
      ) {
        throw new HttpError(
          403,
          'Este usuario no tiene asignado ese perfil.'
        )
      }


      const token =
        randomBytes(32)
          .toString(
            'base64url'
          )


      await db.query(
        `
        INSERT INTO app_sessions (
          token_hash,
          user_id,
          active_role,
          expires_at
        )

        VALUES (
          $1,
          $2,
          $3,
          NOW() + INTERVAL '8 hours'
        )
        `,
        [
          hashToken(token),
          userId,
          activeRole
        ]
      )


      return token
    },


    // =================================================
    // CAMBIAR PERFIL ACTIVO
    // =================================================

    async switchRole(
      token,
      newRole
    ) {

      const tokenHash =
        hashToken(token)


      const sessionResult =
        await db.query(
          `
          SELECT user_id

          FROM app_sessions

          WHERE token_hash = $1
          AND expires_at > NOW()

          LIMIT 1
          `,
          [
            tokenHash
          ]
        )


      const session =
        sessionResult.rows[0]


      if (!session) {
        throw new HttpError(
          401,
          'La sesión venció. Inicia sesión nuevamente.'
        )
      }


      const allowed =
        await hasRole(
          session.user_id,
          newRole
        )


      if (!allowed) {
        throw new HttpError(
          403,
          'No tienes asignado ese perfil.'
        )
      }


      await db.query(
        `
        UPDATE app_sessions

        SET active_role = $1

        WHERE token_hash = $2
        `,
        [
          newRole,
          tokenHash
        ]
      )


      return true
    },


    // =================================================
    // VALIDAR USUARIO
    // =================================================

    async requireUser(
      req,
      _res,
      next
    ) {

      const match =
        /^Bearer ([A-Za-z0-9_-]{43})$/
          .exec(
            req.headers
              .authorization ||
            ''
          )


      if (!match) {
        throw new HttpError(
          401,
          'Inicia sesión nuevamente para continuar.'
        )
      }


      const tokenHash =
        hashToken(
          match[1]
        )


      const result =
        await db.query(
          `
          SELECT
            u.id,
            u.name,
            u.email,

            COALESCE(
              s.active_role,
              u.role
            ) AS role,

            u.source,

            s.token_hash,

            COALESCE(
              (
                SELECT ARRAY_AGG(
                  ur.role
                  ORDER BY ur.role
                )

                FROM user_roles ur

                WHERE
                  ur.user_id = u.id
              ),

              ARRAY[u.role]::varchar[]
            ) AS roles

          FROM app_sessions s

          JOIN users u
            ON u.id = s.user_id

          WHERE
            s.token_hash = $1

          AND
            s.expires_at > NOW()

          LIMIT 1
          `,
          [
            tokenHash
          ]
        )


      const user =
        result.rows[0]


      if (!user) {
        throw new HttpError(
          401,
          'La sesión venció. Inicia sesión nuevamente.'
        )
      }


      // Seguridad extra:
      // comprobar que el rol activo siga
      // asignado al usuario.
      if (
        !user.roles.includes(
          user.role
        )
      ) {
        throw new HttpError(
          401,
          'Tu perfil cambió. Inicia sesión nuevamente.'
        )
      }


      req.user = user

      next()
    }
  }
}


// =====================================================
// PROTEGER RUTAS POR ROL ACTIVO
// =====================================================

export const requireRole =
  (...roles) =>
    (
      req,
      _res,
      next
    ) => {

      if (
        !roles.includes(
          req.user.role
        )
      ) {
        throw new HttpError(
          403,
          'Tu perfil no tiene permiso para esta acción.'
        )
      }

      next()
    }