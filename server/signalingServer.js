import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { WebSocketServer } from 'ws'
import { pool } from './database.js'
import { hashToken } from './auth.js'

// Las salas viven durante la llamada. Reiniciar este proceso finaliza todas las clases.
export function createSignalingServer({ db = pool, port = 8787, host = '127.0.0.1', maxStudents = 8,
  origins = [process.env.FRONTEND_URL || 'http://localhost:5173'], heartbeatMs = 30000 } = {}) {
  const rooms = new Map()
  const wss = new WebSocketServer({ port, host, maxPayload: 128 * 1024,
    verifyClient: ({ origin }) => !origin || origins.includes(origin) })
  const send = (socket, data) => { if (socket.readyState === 1) socket.send(JSON.stringify(data)) }
  const snapshot = room => ({ type: 'room', subjectId: room.subjectId,
    teacher: person(room.teacher), students: [...room.students.values()].map(person), floorId: room.floorId, teacherVideo: room.teacherVideo })
  const person = socket => ({ peerId: socket.peerId, id: socket.user.id, name: socket.user.name, hand: !!socket.hand })
  const broadcast = room => [room.teacher, ...room.students.values()].forEach(s => send(s, snapshot(room)))

  async function identity(socket) {
    const result = await db.query(`SELECT u.id,u.name,u.role FROM app_sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=$1 AND s.expires_at>NOW()`, [socket.tokenHash])
    if (socket.readyState !== 1) throw new Error('La conexión se cerró.')
    if (!result.rows[0]) throw new Error('La sesión venció. Inicia sesión nuevamente.')
    if (socket.user && socket.user.role !== result.rows[0].role) throw new Error('Tu perfil cambió. Inicia sesión nuevamente.')
    return result.rows[0]
  }
  async function authorized(socket, subjectId) {
    const user = await identity(socket)
    const result = await db.query(`SELECT id FROM subjects WHERE id=$1 AND (
      ($3='teacher' AND (default_teacher_id=$2 OR EXISTS
        (SELECT 1 FROM enrollments WHERE subject_id=$1 AND teacher_id=$2))) OR
      ($3='student' AND EXISTS (SELECT 1 FROM enrollments WHERE subject_id=$1 AND student_id=$2)))`,
    [subjectId, user.id, user.role])
    if (socket.readyState !== 1) throw new Error('La conexión se cerró.')
    if (!result.rows.length) throw new Error('No tienes acceso a esta materia.')
    return user
  }
  async function sendClasses(socket) {
    await identity(socket)
    if (socket.user.role !== 'student') throw new Error('Los avisos de clase son para alumnos.')
    const result = await db.query('SELECT subject_id FROM enrollments WHERE student_id=$1', [socket.user.id])
    if (socket.readyState !== 1) return
    const allowed = new Set(result.rows.map(row => row.subject_id))
    // Nunca se publica la lista global ni las cámaras o nombres de otros alumnos.
    const classes = [...rooms.values()].filter(room => allowed.has(room.subjectId)).map(room => ({
      subjectId: room.subjectId, instanceId: room.instanceId, teacherName: room.teacher.user.name
    }))
    const payload = JSON.stringify({ type: 'classes', classes })
    if (payload !== socket.lastClasses) {
      socket.lastClasses = payload
      socket.send(payload)
    }
  }
  function reject(socket, error) {
    send(socket, { type: 'error', message: error.message })
    leave(socket)
    socket.close(4003, 'Solicitud rechazada')
  }
  function notifyWatchers() {
    for (const socket of wss.clients) if (socket.watching && socket.readyState === 1) {
      // La cola toma una instantánea actual tras consultar la matrícula. Evita avisos atrasados.
      socket.queue = socket.queue.then(() => sendClasses(socket)).catch(error => reject(socket, error))
    }
  }
  function leave(socket) {
    const room = rooms.get(socket.subjectId)
    socket.subjectId = null
    if (!room) return
    if (room.teacher === socket) {
      rooms.delete(room.subjectId)
      notifyWatchers()
      for (const student of room.students.values()) {
        student.subjectId = null
        send(student, { type: 'ended', message: 'El maestro finalizó la clase o perdió la conexión.' })
      }
    } else {
      room.students.delete(socket.peerId)
      if (room.floorId === socket.peerId) room.floorId = null
      broadcast(room)
    }
  }
  async function receive(socket, message) {
    if (socket.readyState !== 1) return
    if (message.type === 'authenticate') {
      if (socket.user || !/^[A-Za-z0-9_-]{43}$/.test(message.token || '')) throw new Error('Sesión inválida.')
      socket.tokenHash = hashToken(message.token)
      socket.user = await identity(socket)
      clearTimeout(socket.authTimer)
      send(socket, { type: 'authenticated', peerId: socket.peerId, user: socket.user })
      return
    }
    if (!socket.user) throw new Error('Inicia sesión antes de entrar.')
    if (message.type === 'watch') {
      if (socket.subjectId) throw new Error('Sal de la clase antes de consultar avisos.')
      socket.watching = true
      await sendClasses(socket)
      return
    }
    if (message.type === 'join') {
      if (socket.watching) throw new Error('Los avisos no participan en la llamada.')
      if (socket.subjectId) throw new Error('Ya estás en una clase.')
      const subjectId = String(message.subjectId || '')
      socket.user = await authorized(socket, subjectId)
      let room = rooms.get(subjectId)
      if (socket.user.role === 'teacher') {
        if (room) throw new Error('Ya hay un maestro impartiendo esta clase.')
        room = { subjectId, instanceId: randomUUID(), teacher: socket, students: new Map(), floorId: null, teacherVideo: { source: 'off', revision: 0 } }
        rooms.set(subjectId, room)
      } else {
        if (!room) throw new Error('El maestro todavía no ha iniciado la clase. Intenta de nuevo cuando esté listo.')
        if (room.students.size >= maxStudents) throw new Error(`La sala admite hasta ${maxStudents} alumnos en esta versión.`)
        if ([...room.students.values()].some(s => s.user.id === socket.user.id)) throw new Error('Ya entraste a esta clase en otra pestaña.')
        room.students.set(socket.peerId, socket)
      }
      socket.subjectId = subjectId
      send(socket, { type: 'joined', peerId: socket.peerId })
      broadcast(room)
      if (socket.user.role === 'teacher') notifyWatchers()
      return
    }
    if (message.type === 'leave') { leave(socket); return }
    const room = rooms.get(socket.subjectId)
    if (!room) throw new Error('Entra primero a una clase.')
    // También se revisan matrículas y sesiones al usar la sala, no solo al entrar.
    await authorized(socket, room.subjectId)
    const teacher = room.teacher === socket
    if (message.type === 'media' && teacher) {
      if (!['off', 'camera', 'screen'].includes(message.source)) throw new Error('Estado de video inválido.')
      // Estado del docente compartido con todos, incluidos quienes entran tarde a la clase.
      room.teacherVideo = { source: message.source, revision: room.teacherVideo.revision + 1 }
      broadcast(room)
    } else if (message.type === 'hand' && !teacher) {
      socket.hand = message.raised === true
      if (!socket.hand && room.floorId === socket.peerId) room.floorId = null
      broadcast(room)
    } else if (message.type === 'floor' && teacher) {
      if (message.peerId !== null && !room.students.has(message.peerId)) throw new Error('Ese alumno ya no está en la sala.')
      room.floorId = message.peerId
      if (message.peerId) room.students.get(message.peerId).hand = false
      broadcast(room)
    } else if (message.type === 'signal') {
      const target = teacher ? room.students.get(message.to) : room.teacher
      if (!target || (!teacher && message.to !== target.peerId)) throw new Error('Destino no permitido.')
      const data = message.data
      if (!data || !['offer', 'answer', 'ice'].includes(data.kind)) throw new Error('Señal inválida.')
      if ((data.kind === 'offer' && !teacher) || (data.kind === 'answer' && teacher)) throw new Error('Negociación no permitida.')
      if (data.kind === 'ice') {
        if (typeof data.candidate?.candidate !== 'string') throw new Error('Candidato inválido.')
      } else if (typeof data.sdp !== 'string' || data.sdp.length > 100000) throw new Error('Descripción inválida.')
      send(target, { type: 'signal', from: socket.peerId, data })
    } else throw new Error('Acción no permitida.')
  }
  wss.on('connection', socket => {
    socket.peerId = randomUUID()
    socket.alive = true
    socket.queue = Promise.resolve()
    socket.authTimer = setTimeout(() => socket.close(4001, 'Autenticación requerida'), 8000)
    socket.on('pong', () => { socket.alive = true })
    socket.on('message', raw => {
      // Serializar evita que una oferta adelante a la autenticación o a la entrada.
      const now = Date.now()
      if (!socket.windowStart || now - socket.windowStart > 10000) { socket.windowStart = now; socket.messages = 0 }
      if (++socket.messages > 250) { socket.close(4008, 'Demasiados mensajes'); return }
      socket.queue = socket.queue.then(async () => {
        try { await receive(socket, JSON.parse(raw.toString())) }
        catch (error) {
          // Un error no deja medios ni participantes huérfanos en la sala.
          reject(socket, error)
        }
      })
    })
    socket.on('error', () => leave(socket))
    socket.on('close', () => { clearTimeout(socket.authTimer); leave(socket) })
  })
  const timer = setInterval(() => {
    for (const socket of wss.clients) {
      if (!socket.alive) { leave(socket); socket.terminate(); continue }
      socket.alive = false
      socket.ping()
      socket.queue = socket.queue.then(async () => {
        if (!socket.user) return
        try {
          if (socket.watching) await sendClasses(socket)
          else if (socket.subjectId) await authorized(socket, socket.subjectId)
          else await identity(socket)
        }
        catch { send(socket, { type: 'ended', message: 'Tu sesión o matrícula dejó de estar vigente.' }); leave(socket); socket.close(4001) }
      })
    }
  }, heartbeatMs)
  wss.on('close', () => clearInterval(timer))
  return { wss, rooms, async close() {
    clearInterval(timer)
    for (const socket of wss.clients) { clearTimeout(socket.authTimer); socket.terminate() }
    await new Promise(resolve => wss.close(resolve))
  } }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.SIGNALING_PORT || 8787)
  const host = process.env.SIGNALING_HOST || '127.0.0.1'
  const { wss } = createSignalingServer({ port, host })
  wss.on('listening', () => console.log(`ClassFocus: clases en vivo en ws://${host}:${port}`))
  wss.on('error', error => { console.error('No se pudo iniciar la señalización:', error.message); process.exitCode = 1 })
}
