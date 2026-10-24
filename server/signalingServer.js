import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { WebSocketServer } from 'ws'

import { pool } from './database.js'
import { hashToken } from './auth.js'


// =====================================================
// SERVIDOR DE SEÑALIZACIÓN
// =====================================================

// Las salas viven durante la llamada.
// Reiniciar este proceso finaliza todas las clases.
export function createSignalingServer({
  db = pool,
  port = 8787,
  host = '127.0.0.1',
  maxStudents = 8,
  origins = [
    process.env.FRONTEND_URL ||
    'http://localhost:5173'
  ],
  heartbeatMs = 30000
} = {}) {

  const rooms = new Map()

  const wss =
    new WebSocketServer({
      port,
      host,

      maxPayload:
        128 * 1024,

      verifyClient: ({
        origin
      }) =>
        !origin ||
        origins.includes(origin)
    })


  // ===================================================
  // ENVIAR MENSAJE
  // ===================================================

  const send =
    (
      socket,
      data
    ) => {
      if (
        socket.readyState === 1
      ) {
        socket.send(
          JSON.stringify(data)
        )
      }
    }


  // ===================================================
  // INFORMACIÓN PÚBLICA DE PARTICIPANTE
  // ===================================================

  const person =
    socket => ({
      peerId:
        socket.peerId,

      id:
        socket.user.id,

      name:
        socket.user.name,

      hand:
        !!socket.hand,

      video:
        socket.video || { source: 'off', revision: 0 }
    })


  // ===================================================
  // ESTADO DE SALA
  // ===================================================

  // La presentación del alumno se publica al grupo solo mientras conserva el turno.
  const presentation = room => {
    if (room.teacherVideo.source === 'screen') return { peerId: room.teacher.peerId, name: room.teacher.user.name, revision: room.teacherVideo.revision }
    const student = room.students.get(room.floorId)
    return student?.video?.source === 'screen'
      ? { peerId: student.peerId, name: student.user.name, revision: student.video.revision } : null
  }
  const setFloor = (room, peerId) => {
    const previous = room.students.get(room.floorId)
    if (previous && room.floorId !== peerId && previous.video?.source === 'screen') {
      previous.video = { source: 'off', revision: previous.video.revision + 1 }
    }
    room.floorId = peerId
  }


  const snapshot =
    room => ({
      type:
        'room',

      subjectId:
        room.subjectId,

      teacher:
        person(
          room.teacher
        ),

      students:
        [
          ...room.students.values()
        ].map(person),

      floorId:
        room.floorId,

      presentation:
        presentation(room),

      teacherVideo:
        room.teacherVideo
    })


  const broadcast =
    room => {
      [
        room.teacher,
        ...room.students.values()
      ].forEach(
        socket => {
          send(
            socket,
            snapshot(room)
          )
        }
      )
    }


  // =====================================================
  // IDENTIDAD + ROL ACTIVO
  // =====================================================

  async function identity(
    socket
  ) {

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
          socket.tokenHash
        ]
      )

    if (
      socket.readyState !== 1
    ) {
      throw new Error(
        'La conexión se cerró.'
      )
    }


    const user =
      result.rows[0]


    if (!user) {
      throw new Error(
        'La sesión venció. Inicia sesión nuevamente.'
      )
    }


    // El rol activo todavía debe
    // pertenecer al usuario.
    if (
      !user.roles.includes(
        user.role
      )
    ) {
      throw new Error(
        'Tu perfil ya no está asignado. Inicia sesión nuevamente.'
      )
    }


    // Si cambió de alumno a maestro
    // o viceversa mientras tenía abierta
    // una conexión WebSocket, obligamos
    // a crear una conexión nueva.
    if (
      socket.user &&
      socket.user.role !==
        user.role
    ) {
      throw new Error(
        'Tu perfil cambió. Vuelve a conectar la clase.'
      )
    }


    return user
  }


  // =====================================================
  // AUTORIZACIÓN PARA MATERIA
  // =====================================================

  async function authorized(
    socket,
    subjectId
  ) {

    const user =
      await identity(socket)


    const result =
      await db.query(
        `
        SELECT id

        FROM subjects

        WHERE id = $1

        AND (
          (
            $3 = 'teacher'

            AND (
              default_teacher_id = $2

              OR EXISTS (
                SELECT 1

                FROM enrollments

                WHERE
                  subject_id = $1

                AND
                  teacher_id = $2
              )
            )
          )

          OR

          (
            $3 = 'student'

            AND EXISTS (
              SELECT 1

              FROM enrollments

              WHERE
                subject_id = $1

              AND
                student_id = $2
            )
          )
        )
        `,
        [
          subjectId,
          user.id,
          user.role
        ]
      )


    if (
      socket.readyState !== 1
    ) {
      throw new Error(
        'La conexión se cerró.'
      )
    }


    if (
      !result.rows.length
    ) {
      throw new Error(
        'No tienes acceso a esta materia con el perfil seleccionado.'
      )
    }


    return user
  }


  // =====================================================
  // CLASES ACTIVAS PARA ALUMNOS
  // =====================================================

  async function sendClasses(
    socket
  ) {

    socket.user =
      await identity(socket)


    if (
      socket.user.role !==
      'student'
    ) {
      throw new Error(
        'Los avisos de clase son para el perfil de alumno.'
      )
    }


    const result =
      await db.query(
        `
        SELECT subject_id

        FROM enrollments

        WHERE student_id = $1
        `,
        [
          socket.user.id
        ]
      )


    if (
      socket.readyState !== 1
    ) {
      return
    }


    const allowed =
      new Set(
        result.rows.map(
          row =>
            row.subject_id
        )
      )


    const classes =
      [
        ...rooms.values()
      ]
        .filter(
          room =>
            allowed.has(
              room.subjectId
            )
        )
        .map(
          room => ({
            subjectId:
              room.subjectId,

            instanceId:
              room.instanceId,

            teacherName:
              room.teacher
                .user
                .name
          })
        )


    const payload =
      JSON.stringify({
        type:
          'classes',

        classes
      })


    if (
      payload !==
      socket.lastClasses
    ) {
      socket.lastClasses =
        payload

      socket.send(
        payload
      )
    }
  }


  // =====================================================
  // RECHAZAR CONEXIÓN
  // =====================================================

  function reject(
    socket,
    error
  ) {

    send(
      socket,
      {
        type:
          'error',

        message:
          error.message
      }
    )

    leave(socket)

    socket.close(
      4003,
      'Solicitud rechazada'
    )
  }


  // =====================================================
  // AVISAR CAMBIOS A LOS ALUMNOS
  // =====================================================

  function notifyWatchers() {

    for (
      const socket
      of wss.clients
    ) {

      if (
        socket.watching &&
        socket.readyState === 1
      ) {

        socket.queue =
          socket.queue
            .then(
              () =>
                sendClasses(
                  socket
                )
            )
            .catch(
              error =>
                reject(
                  socket,
                  error
                )
            )
      }
    }
  }


  // =====================================================
  // SALIR DE SALA
  // =====================================================

  function leave(
    socket
  ) {

    const room =
      rooms.get(
        socket.subjectId
      )

    socket.subjectId =
      null


    if (!room) {
      return
    }


    // Si se desconecta el maestro,
    // termina la clase completa.
    if (
      room.teacher ===
      socket
    ) {

      rooms.delete(
        room.subjectId
      )

      notifyWatchers()


      for (
        const student
        of room.students.values()
      ) {

        student.subjectId =
          null

        send(
          student,
          {
            type:
              'ended',

            message:
              'El maestro finalizó la clase o perdió la conexión.'
          }
        )
      }

      return
    }


    // Alumno sale.
    room.students.delete(
      socket.peerId
    )


    if (
      room.floorId ===
      socket.peerId
    ) {
      setFloor(room, null)
    }


    broadcast(room)
  }


  // =====================================================
  // RECIBIR MENSAJES
  // =====================================================

  async function receive(
    socket,
    message
  ) {

    if (
      socket.readyState !== 1
    ) {
      return
    }


    // ===================================================
    // AUTENTICACIÓN
    // ===================================================

    if (
      message.type ===
      'authenticate'
    ) {

      if (
        socket.user ||

        !/^[A-Za-z0-9_-]{43}$/
          .test(
            message.token ||
            ''
          )
      ) {
        throw new Error(
          'Sesión inválida.'
        )
      }


      socket.tokenHash =
        hashToken(
          message.token
        )


      socket.user =
        await identity(
          socket
        )


      clearTimeout(
        socket.authTimer
      )


      send(
        socket,
        {
          type:
            'authenticated',

          peerId:
            socket.peerId,

          user:
            socket.user
        }
      )

      return
    }


    if (
      !socket.user
    ) {
      throw new Error(
        'Inicia sesión antes de entrar.'
      )
    }


    // ===================================================
    // ESCUCHAR AVISOS
    // ===================================================

    if (
      message.type ===
      'watch'
    ) {

      if (
        socket.subjectId
      ) {
        throw new Error(
          'Sal de la clase antes de consultar avisos.'
        )
      }


      // Solo el perfil alumno
      // puede escuchar avisos.
      socket.user =
        await identity(socket)


      if (
        socket.user.role !==
        'student'
      ) {
        throw new Error(
          'Debes usar tu perfil de alumno para recibir avisos de clase.'
        )
      }


      socket.watching =
        true

      await sendClasses(
        socket
      )

      return
    }


    // ===================================================
    // ENTRAR / CREAR CLASE
    // ===================================================

    if (
      message.type ===
      'join'
    ) {

      if (
        socket.watching
      ) {
        throw new Error(
          'Los avisos no participan en la llamada.'
        )
      }


      if (
        socket.subjectId
      ) {
        throw new Error(
          'Ya estás en una clase.'
        )
      }


      const subjectId =
        String(
          message.subjectId ||
          ''
        )


      socket.user =
        await authorized(
          socket,
          subjectId
        )


      let room =
        rooms.get(
          subjectId
        )


      // =================================================
      // MAESTRO CREA SALA
      // =================================================

      if (
        socket.user.role ===
        'teacher'
      ) {

        if (room) {
          throw new Error(
            'Ya hay un maestro impartiendo esta clase.'
          )
        }


        room = {
          subjectId,

          instanceId:
            randomUUID(),

          teacher:
            socket,

          students:
            new Map(),

          floorId:
            null,

          teacherVideo: {
            source:
              'off',

            revision:
              0
          }
        }


        rooms.set(
          subjectId,
          room
        )
      }

      // =================================================
      // ALUMNO ENTRA
      // =================================================

      else if (
        socket.user.role ===
        'student'
      ) {

        if (!room) {
          throw new Error(
            'El maestro todavía no ha iniciado la clase. Intenta de nuevo cuando esté listo.'
          )
        }


        if (
          room.students.size >=
          maxStudents
        ) {
          throw new Error(
            `La sala admite hasta ${maxStudents} alumnos en esta versión.`
          )
        }


        if (
          [
            ...room.students.values()
          ].some(
            student =>
              student.user.id ===
              socket.user.id
          )
        ) {
          throw new Error(
            'Ya entraste a esta clase en otra pestaña.'
          )
        }


        room.students.set(
          socket.peerId,
          socket
        )
      }

      // =================================================
      // OTROS ROLES
      // =================================================

      else {
        throw new Error(
          'Debes utilizar el perfil de alumno o maestro para entrar a una clase.'
        )
      }


      socket.subjectId =
        subjectId


      send(
        socket,
        {
          type:
            'joined',

          peerId:
            socket.peerId
        }
      )


      broadcast(room)


      if (
        socket.user.role ===
        'teacher'
      ) {
        notifyWatchers()
      }


      return
    }


    // ===================================================
    // SALIR
    // ===================================================

    if (
      message.type ===
      'leave'
    ) {

      leave(socket)

      return
    }


    const room =
      rooms.get(
        socket.subjectId
      )


    if (!room) {
      throw new Error(
        'Entra primero a una clase.'
      )
    }


    // Revisar nuevamente sesión,
    // perfil y matrícula.
    socket.user =
      await authorized(
        socket,
        room.subjectId
      )


    const teacher =
      room.teacher ===
      socket


    // ---------------------------------------------------
    // VIDEO Y PRESENTACIONES AUTORIZADAS
    // ---------------------------------------------------

    if (message.type === 'media') {
      if (!['off', 'camera', 'screen'].includes(message.source)) throw new Error('Estado de video inválido.')
      if (!teacher && message.source === 'screen' && room.floorId !== socket.peerId) {
        throw new Error('Pide la palabra y espera la autorización del maestro para presentar.')
      }
      if (!teacher && message.source === 'screen' && room.teacherVideo.source === 'screen') {
        throw new Error('El maestro está presentando. Espera a que termine para compartir tu pantalla.')
      }
      if (teacher) {
        room.teacherVideo = { source: message.source, revision: room.teacherVideo.revision + 1 }
        // El docente tiene prioridad al comenzar una presentación.
        if (message.source === 'screen') {
          const student = room.students.get(room.floorId)
          if (student?.video?.source === 'screen') student.video = { source: 'off', revision: student.video.revision + 1 }
        }
      } else socket.video = { source: message.source, revision: (socket.video?.revision || 0) + 1 }
      broadcast(room)
    }

    // ===================================================
    // LEVANTAR MANO
    // ===================================================

    else if (
      message.type ===
        'hand' &&

      !teacher
    ) {

      socket.hand =
        message.raised ===
        true


      if (
        !socket.hand &&

        room.floorId ===
          socket.peerId
      ) {
        setFloor(room, null)
      }


      broadcast(room)
    }


    // ===================================================
    // DAR LA PALABRA
    // ===================================================

    else if (
      message.type ===
        'floor' &&

      teacher
    ) {

      if (
        message.peerId !==
          null &&

        !room.students.has(
          message.peerId
        )
      ) {
        throw new Error(
          'Ese alumno ya no está en la sala.'
        )
      }


      setFloor(room, message.peerId)


      if (
        message.peerId
      ) {
        room.students
          .get(
            message.peerId
          )
          .hand =
            false
      }


      broadcast(room)
    }


    // ===================================================
    // SEÑALIZACIÓN WEBRTC
    // ===================================================

    else if (
      message.type ===
      'signal'
    ) {

      const target =
        teacher
          ? room.students.get(
              message.to
            )
          : room.teacher


      if (
        !target ||

        (
          !teacher &&

          message.to !==
            target.peerId
        )
      ) {
        throw new Error(
          'Destino no permitido.'
        )
      }


      const data =
        message.data


      if (
        !data ||

        ![
          'offer',
          'answer',
          'ice'
        ].includes(
          data.kind
        )
      ) {
        throw new Error(
          'Señal inválida.'
        )
      }


      if (
        (
          data.kind ===
            'offer' &&

          !teacher
        ) ||

        (
          data.kind ===
            'answer' &&

          teacher
        )
      ) {
        throw new Error(
          'Negociación no permitida.'
        )
      }


      if (
        data.kind ===
        'ice'
      ) {

        if (
          typeof data
            .candidate
            ?.candidate !==
          'string'
        ) {
          throw new Error(
            'Candidato inválido.'
          )
        }

      } else if (
        typeof data.sdp !==
          'string' ||

        data.sdp.length >
          100000
      ) {
        throw new Error(
          'Descripción inválida.'
        )
      }


      send(
        target,
        {
          type:
            'signal',

          from:
            socket.peerId,

          data
        }
      )
    }


    // ===================================================
    // ACCIÓN NO VÁLIDA
    // ===================================================

    else {
      throw new Error(
        'Acción no permitida.'
      )
    }
  }


  // =====================================================
  // CONEXIONES WEBSOCKET
  // =====================================================

  wss.on(
    'connection',
    socket => {

      socket.peerId =
        randomUUID()

      socket.alive =
        true

      socket.queue =
        Promise.resolve()


      socket.authTimer =
        setTimeout(
          () =>
            socket.close(
              4001,
              'Autenticación requerida'
            ),

          8000
        )


      // =================================================
      // PONG
      // =================================================

      socket.on(
        'pong',
        () => {
          socket.alive =
            true
        }
      )


      // =================================================
      // MENSAJES
      // =================================================

      socket.on(
        'message',
        raw => {

          const now =
            Date.now()


          if (
            !socket.windowStart ||

            now -
              socket.windowStart >
              10000
          ) {
            socket.windowStart =
              now

            socket.messages =
              0
          }


          socket.messages++


          if (
            socket.messages >
            250
          ) {
            socket.close(
              4008,
              'Demasiados mensajes'
            )

            return
          }


          // Serializar mensajes evita
          // carreras entre autenticación,
          // entrada y WebRTC.
          socket.queue =
            socket.queue.then(
              async () => {

                try {

                  await receive(
                    socket,

                    JSON.parse(
                      raw.toString()
                    )
                  )

                } catch (error) {

                  reject(
                    socket,
                    error
                  )

                }
              }
            )
        }
      )


      // =================================================
      // ERROR
      // =================================================

      socket.on(
        'error',
        () => {
          leave(socket)
        }
      )


      // =================================================
      // CERRAR
      // =================================================

      socket.on(
        'close',
        () => {

          clearTimeout(
            socket.authTimer
          )

          leave(socket)
        }
      )
    }
  )


  // =====================================================
  // HEARTBEAT
  // =====================================================

  const timer =
    setInterval(
      () => {

        for (
          const socket
          of wss.clients
        ) {

          if (
            !socket.alive
          ) {

            leave(socket)

            socket.terminate()

            continue
          }


          socket.alive =
            false

          socket.ping()


          socket.queue =
            socket.queue.then(
              async () => {

                if (
                  !socket.user
                ) {
                  return
                }


                try {

                  if (
                    socket.watching
                  ) {

                    await sendClasses(
                      socket
                    )

                  } else if (
                    socket.subjectId
                  ) {

                    socket.user =
                      await authorized(
                        socket,
                        socket.subjectId
                      )

                  } else {

                    socket.user =
                      await identity(
                        socket
                      )

                  }

                } catch {

                  send(
                    socket,
                    {
                      type:
                        'ended',

                      message:
                        'Tu sesión, perfil o matrícula dejó de estar vigente.'
                    }
                  )


                  leave(socket)


                  socket.close(
                    4001
                  )

                }
              }
            )
        }
      },

      heartbeatMs
    )


  wss.on(
    'close',
    () => {
      clearInterval(
        timer
      )
    }
  )


  // =====================================================
  // CERRAR SERVIDOR
  // =====================================================

  return {
    wss,
    rooms,

    async close() {

      clearInterval(
        timer
      )


      for (
        const socket
        of wss.clients
      ) {

        clearTimeout(
          socket.authTimer
        )

        socket.terminate()
      }


      await new Promise(
        resolve =>
          wss.close(
            resolve
          )
      )
    }
  }
}


// =======================================================
// INICIAR SERVIDOR
// =======================================================

if (
  process.argv[1] &&

  import.meta.url ===
    pathToFileURL(
      process.argv[1]
    ).href
) {

  // Render proporciona PORT automáticamente.
  // En local se usa SIGNALING_PORT o 8787.
  const port =
    Number(
      process.env.PORT ||
      process.env.SIGNALING_PORT ||
      8787
    )


  // Render necesita 0.0.0.0.
  const host =
    process.env.SIGNALING_HOST ||
    '0.0.0.0'


  const { wss } =
    createSignalingServer({
      port,
      host
    })


  wss.on(
    'listening',
    () => {

      console.log(
        `✅ ClassFocus Signaling activo en puerto ${port}`
      )

      console.log(
        '✅ WebSocket listo para clases en vivo'
      )
    }
  )


  wss.on(
    'error',
    error => {

      console.error(
        '❌ No se pudo iniciar la señalización:',
        error.message
      )

      process.exitCode =
        1
    }
  )
}