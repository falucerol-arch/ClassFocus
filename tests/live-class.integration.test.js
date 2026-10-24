import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { PGlite } from '@electric-sql/pglite'
import WebSocket from 'ws'
import { schema } from '../server/database.js'
import { createSessionAuth } from '../server/auth.js'
import { createSignalingServer } from '../server/signalingServer.js'

// WebSockets reales, permisos resueltos por PostgreSQL y clientes independientes.
// Los mensajes se guardan antes de esperar para no perder respuestas rápidas.
function inbox(socket) {
  const messages = []
  const waiters = []
  socket.on('message', raw => {
    const data = JSON.parse(raw)
    const index = waiters.findIndex(w => w.type === data.type)
    if (index >= 0) waiters.splice(index, 1)[0].resolve(data)
    else messages.push(data)
  })
  return {
    messages,
    next(type) {
      const index = messages.findIndex(m => m.type === type)
      if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0])
      return new Promise((resolve, reject) => {
        const waiter = { type, resolve: data => { clearTimeout(timer); resolve(data) } }
        const timer = setTimeout(() => { waiters.splice(waiters.indexOf(waiter), 1); reject(new Error(`Falta mensaje ${type}`)) }, 4000)
        waiters.push(waiter)
      })
    },
    send(data) { socket.send(JSON.stringify(data)) }
  }
}

test('clases: salas autenticadas, aislamiento, turnos, bajas y cierre', async t => {
  const db = new PGlite()
  await db.exec(schema)
  for (const [id, role] of [[1, 'student'], [2, 'teacher'], [3, 'student'], [4, 'teacher'], [5, 'student'], [6, 'admin']]) {
    await db.query('INSERT INTO users(id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5)', [id, `Persona ${id}`, `u${id}@test.local`, 'unused', role])
  }
  await db.exec("INSERT INTO subjects(id,name,code,default_teacher_id) VALUES('a','A','A',2),('b','B','B',4); INSERT INTO enrollments(student_id,teacher_id,subject_id) VALUES(1,2,'a'),(3,2,'a'),(5,4,'b')")
  const auth = createSessionAuth(db)
  const tokens = new Map()
  for (let id = 1; id <= 6; id++) tokens.set(id, await auth.issue(id))
  const server = createSignalingServer({ db, port: 0, heartbeatMs: 1000 })
  await once(server.wss, 'listening')
  const url = `ws://127.0.0.1:${server.wss.address().port}`
  t.after(async () => { await server.close(); await db.close() })
  async function client(id, subject) {
    const socket = new WebSocket(url, { origin: 'http://localhost:5173' })
    const box = inbox(socket)
    await once(socket, 'open')
    box.send({ type: 'authenticate', token: tokens.get(id) })
    const identity = await box.next('authenticated')
    if (subject) box.send({ type: 'join', subjectId: subject })
    return { socket, box, id: identity.peerId }
  }
  await t.test('no acepta identidades inventadas ni mensajes anónimos', async () => {
    const socket = new WebSocket(url)
    const box = inbox(socket)
    await once(socket, 'open')
    box.send({ type: 'join', subjectId: 'a', role: 'teacher', id: 2 })
    assert.match((await box.next('error')).message, /sesión/)
    const forged = new WebSocket(url)
    const other = inbox(forged)
    await once(forged, 'open')
    other.send({ type: 'authenticate', token: 'x'.repeat(43) })
    assert.match((await other.next('error')).message, /sesión/)
  })
  await t.test('el alumno espera al maestro y otro docente no entra a una materia ajena', async () => {
    const student = await client(1, 'a')
    assert.match((await student.box.next('error')).message, /todavía/)
    const outsider = await client(4, 'a')
    assert.match((await outsider.box.next('error')).message, /acceso/)
    const admin = await client(6, 'a')
    assert.match((await admin.box.next('error')).message, /acceso/)
  })
  const teacher = await client(2, 'a')
  await teacher.box.next('joined'); await teacher.box.next('room')
  const student = await client(1, 'a')
  await student.box.next('joined'); await student.box.next('room'); await teacher.box.next('room')
  const second = await client(3, 'a')
  await second.box.next('joined'); await second.box.next('room'); await teacher.box.next('room'); await student.box.next('room')
  const otherTeacher = await client(4, 'b')
  await otherTeacher.box.next('joined'); await otherTeacher.box.next('room')
  await t.test('duplica sesiones pero no alumnos dentro de la misma clase', async () => {
    const duplicate = await client(1, 'a')
    assert.match((await duplicate.box.next('error')).message, /otra pestaña/)
    const wrong = await client(5, 'a')
    assert.match((await wrong.box.next('error')).message, /acceso/)
  })
  await t.test('ofertas y respuestas van solo al destinatario de la misma sala', async () => {
    teacher.box.send({ type: 'signal', to: student.id, from: otherTeacher.id, data: { kind: 'offer', sdp: 'test-offer' } })
    const offer = await student.box.next('signal')
    assert.equal(offer.from, teacher.id)
    assert.equal(offer.data.sdp, 'test-offer')
    student.box.send({ type: 'signal', to: teacher.id, data: { kind: 'answer', sdp: 'test-answer' } })
    assert.equal((await teacher.box.next('signal')).from, student.id)
    teacher.box.send({ type: 'signal', to: student.id, data: { kind: 'ice', candidate: { candidate: 'candidate:test' } } })
    assert.equal((await student.box.next('signal')).data.kind, 'ice')
    assert.equal(second.box.messages.filter(m => m.type === 'signal').length, 0)
    assert.equal(otherTeacher.box.messages.filter(m => m.type === 'signal').length, 0)
  })
  await t.test('sincroniza cámara, presentación y apagado para todos los alumnos', async () => {
    let revision = 0
    for (const source of ['camera', 'screen', 'off', 'screen', 'camera']) {
      teacher.box.send({ type: 'media', source })
      const own = await teacher.box.next('room')
      assert.equal(own.teacherVideo.source, source)
      assert.ok(own.teacherVideo.revision > revision)
      revision = own.teacherVideo.revision
      assert.deepEqual((await student.box.next('room')).teacherVideo, own.teacherVideo)
      assert.deepEqual((await second.box.next('room')).teacherVideo, own.teacherVideo)
    }
    const observer = await client(1)
    observer.box.send({ type: 'watch' })
    const listing = await observer.box.next('classes')
    assert.equal(listing.classes[0].subjectId, 'a')
    assert.equal('teacherVideo' in listing.classes[0], false, 'Los avisos no necesitan datos de la transmisión.')
    observer.socket.close()
  })
  await t.test('pantalla del alumno: exige turno, se publica al grupo y se retira al revocarlo', async () => {
    const broadcast = async sender => {
      const rooms = await Promise.all([teacher.box.next('room'), student.box.next('room'), second.box.next('room')])
      assert.deepEqual(rooms[1], rooms[0]); assert.deepEqual(rooms[2], rooms[0]); return rooms[0]
    }
    teacher.box.send({ type: 'floor', peerId: student.id }); await broadcast()
    student.box.send({ type: 'media', source: 'camera' })
    const camera = await broadcast()
    assert.equal(camera.students.find(s => s.peerId === student.id).video.source, 'camera')
    student.box.send({ type: 'media', source: 'off' })
    const off = await broadcast()
    assert.equal(off.students.find(s => s.peerId === student.id).video.source, 'off')
    assert.ok(off.students.find(s => s.peerId === student.id).video.revision > camera.students.find(s => s.peerId === student.id).video.revision)
    student.box.send({ type: 'media', source: 'screen' })
    assert.equal((await broadcast()).presentation.peerId, student.id)
    teacher.box.send({ type: 'floor', peerId: null })
    const revoked = await broadcast()
    assert.equal(revoked.presentation, null)
    assert.equal(revoked.students.find(s => s.peerId === student.id).video.source, 'off')
    teacher.box.send({ type: 'floor', peerId: student.id }); await broadcast()
    student.box.send({ type: 'media', source: 'screen' }); await broadcast()
    student.box.send({ type: 'hand', raised: false })
    assert.equal((await broadcast()).presentation, null)
    teacher.box.send({ type: 'floor', peerId: student.id }); await broadcast()
    student.box.send({ type: 'media', source: 'screen' }); await broadcast()
    teacher.box.send({ type: 'media', source: 'screen' })
    const takeover = await broadcast()
    assert.equal(takeover.presentation.peerId, teacher.id)
    assert.equal(takeover.students.find(s => s.peerId === student.id).video.source, 'off')
    teacher.box.send({ type: 'media', source: 'camera' }); await broadcast()
    teacher.box.send({ type: 'floor', peerId: null }); await broadcast()
  })

  await t.test('el maestro concede y retira la palabra; el alumno puede devolverla', async () => {
    student.box.send({ type: 'hand', raised: true })
    assert.equal((await teacher.box.next('room')).students.find(s => s.peerId === student.id).hand, true)
    await student.box.next('room'); await second.box.next('room')
    teacher.box.send({ type: 'floor', peerId: student.id })
    assert.equal((await student.box.next('room')).floorId, student.id)
    await teacher.box.next('room'); await second.box.next('room')
    teacher.box.send({ type: 'floor', peerId: null })
    assert.equal((await student.box.next('room')).floorId, null)
    await teacher.box.next('room'); await second.box.next('room')
    teacher.box.send({ type: 'floor', peerId: student.id })
    await student.box.next('room'); await teacher.box.next('room'); await second.box.next('room')
    student.box.send({ type: 'hand', raised: false })
    assert.equal((await teacher.box.next('room')).floorId, null)
    await student.box.next('room'); await second.box.next('room')
  })
  await t.test('un alumno no se puede dar la palabra ni contactar a otro alumno', async () => {
    second.box.send({ type: 'floor', peerId: second.id })
    assert.match((await second.box.next('error')).message, /permitida/)
    await teacher.box.next('room'); await student.box.next('room')
    const reconnect = await client(3, 'a')
    await reconnect.box.next('joined'); await reconnect.box.next('room'); await teacher.box.next('room'); await student.box.next('room')
    reconnect.box.send({ type: 'signal', to: student.id, data: { kind: 'offer', sdp: 'forged' } })
    assert.match((await reconnect.box.next('error')).message, /Destino/)
    await teacher.box.next('room'); await student.box.next('room')
  })
  await t.test('un alumno no puede cambiar el estado de video del maestro', async () => {
    const attacker = await client(3, 'a')
    await attacker.box.next('joined'); await attacker.box.next('room'); await teacher.box.next('room'); await student.box.next('room')
    const before = { ...server.rooms.get('a').teacherVideo }
    attacker.box.send({ type: 'media', source: 'off' })
    const own = await attacker.box.next('room')
    assert.equal(own.students.find(s => s.peerId === attacker.id).video.source, 'off')
    await teacher.box.next('room'); await student.box.next('room')
    assert.deepEqual(server.rooms.get('a').teacherVideo, before)
    // Puede anunciar su propia cámara, pero no presentar sin permiso ni alterar al docente.
    attacker.box.send({ type: 'media', source: 'screen' })
    assert.match((await attacker.box.next('error')).message, /Pide la palabra/)
    await teacher.box.next('room'); await student.box.next('room')
  })
  await t.test('la eliminación de matrícula expulsa al alumno', async () => {
    await db.query("DELETE FROM enrollments WHERE student_id=1 AND subject_id='a'")
    student.box.send({ type: 'hand', raised: true })
    assert.match((await student.box.next('error')).message, /acceso/)
    assert.equal((await teacher.box.next('room')).students.length, 0)
  })
  await t.test('no deja enviar señales de una sala a otra', async () => {
    teacher.box.send({ type: 'signal', to: otherTeacher.id, data: { kind: 'offer', sdp: 'wrong-room' } })
    assert.match((await teacher.box.next('error')).message, /Destino/)
    assert.equal(server.rooms.has('a'), false)
    assert.equal(server.rooms.has('b'), true)
  })
  await t.test('cerrar al maestro avisa a alumnos y elimina la sala', async () => {
    const studentB = await client(5, 'b')
    await studentB.box.next('joined'); await studentB.box.next('room'); await otherTeacher.box.next('room')
    otherTeacher.box.send({ type: 'leave' })
    assert.match((await studentB.box.next('ended')).message, /finalizó/)
    assert.equal(server.rooms.size, 0)
  })
  await t.test('revocar la sesión desconecta sin esperar una acción del usuario', async () => {
    const expiring = await client(2, 'a')
    await expiring.box.next('joined'); await expiring.box.next('room')
    await db.query('DELETE FROM app_sessions WHERE user_id=2')
    assert.match((await expiring.box.next('ended')).message, /sesión/)
    assert.equal(server.rooms.size, 0)
  })
  await t.test('multirrol: usa el perfil de la sesión y expulsa al cambiarlo durante la llamada', async () => {
    await db.query("INSERT INTO user_roles(user_id,role) VALUES(2,'student')")
    await db.query("INSERT INTO enrollments(student_id,teacher_id,subject_id) VALUES(2,4,'b')")
    tokens.set(2, await auth.issue(2, 'student'))
    const host = await client(4, 'b')
    await host.box.next('joined'); await host.box.next('room')
    // users.role sigue siendo teacher, pero esta sesión entra como alumno.
    const pupil = await client(2, 'b')
    await pupil.box.next('joined'); await pupil.box.next('room'); await host.box.next('room')
    host.box.send({ type: 'floor', peerId: pupil.id })
    await host.box.next('room'); await pupil.box.next('room')
    pupil.box.send({ type: 'media', source: 'screen' })
    assert.equal((await host.box.next('room')).presentation.peerId, pupil.id)
    await pupil.box.next('room')
    await db.query("UPDATE app_sessions SET active_role='teacher' WHERE user_id=2")
    pupil.box.send({ type: 'hand', raised: true })
    assert.match((await pupil.box.next('error')).message, /perfil cambió/)
    assert.equal((await host.box.next('room')).students.length, 0)
    host.box.send({ type: 'leave' })
  })
})

test('avisos: estado inicial, inicio, fin y matrículas se actualizan sin entrar a la llamada', async t => {
  const db = new PGlite()
  await db.exec(schema)
  for (const [id, role] of [[1, 'student'], [2, 'teacher'], [3, 'student'], [4, 'teacher'], [5, 'student']]) {
    await db.query('INSERT INTO users(id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5)', [id, `Persona ${id}`, `u${id}@test.local`, 'unused', role])
  }
  await db.exec("INSERT INTO subjects(id,name,code,default_teacher_id) VALUES('a','A','A',2),('b','B','B',4); INSERT INTO enrollments(student_id,teacher_id,subject_id) VALUES(1,2,'a'),(3,4,'b')")
  const auth = createSessionAuth(db)
  const tokens = new Map()
  for (let id = 1; id <= 5; id++) tokens.set(id, await auth.issue(id))
  const server = createSignalingServer({ db, port: 0, heartbeatMs: 500 })
  await once(server.wss, 'listening')
  t.after(async () => { await server.close(); await db.close() })
  const url = `ws://127.0.0.1:${server.wss.address().port}`
  async function client(id) {
    const socket = new WebSocket(url)
    const box = inbox(socket)
    await once(socket, 'open')
    box.send({ type: 'authenticate', token: tokens.get(id) })
    await box.next('authenticated')
    return { socket, box }
  }
  async function watch(id) {
    const watcher = await client(id)
    watcher.box.send({ type: 'watch', subjectIds: ['a', 'b'] })
    return watcher
  }
  const watcher = await watch(1)
  await t.test('el panel arranca con estado confirmado aunque aún no haya clases', async () => {
    assert.deepEqual((await watcher.box.next('classes')).classes, [])
    assert.equal(server.rooms.size, 0, 'Observar no inicia una sala.')
  })
  const teacher = await client(2)
  let originalInstance
  await t.test('iniciar la clase avisa automáticamente sin publicar alumnos ni pistas', async () => {
    teacher.box.send({ type: 'join', subjectId: 'a' })
    await teacher.box.next('joined'); await teacher.box.next('room')
    const { classes } = await watcher.box.next('classes')
    assert.equal(classes.length, 1)
    assert.deepEqual(Object.keys(classes[0]).sort(), ['instanceId', 'subjectId', 'teacherName'])
    assert.equal(classes[0].subjectId, 'a')
    assert.equal(classes[0].teacherName, 'Persona 2')
    originalInstance = classes[0].instanceId
    assert.equal(server.rooms.get('a').students.size, 0, 'Observar no cuenta como alumno en la llamada.')
  })
  const otherWatcher = await watch(3)
  assert.deepEqual((await otherWatcher.box.next('classes')).classes, [])
  const otherTeacher = await client(4)
  otherTeacher.box.send({ type: 'join', subjectId: 'b' })
  await otherTeacher.box.next('joined'); await otherTeacher.box.next('room')
  await t.test('ignora materias solicitadas por el cliente y usa solo sus matrículas', async () => {
    assert.deepEqual((await otherWatcher.box.next('classes')).classes.map(c => c.subjectId), ['b'])
    const lateWatcher = await watch(1)
    assert.deepEqual((await lateWatcher.box.next('classes')).classes.map(c => c.subjectId), ['a'])
    lateWatcher.socket.close()
    const noSubjects = await watch(5)
    assert.deepEqual((await noSubjects.box.next('classes')).classes, [])
    noSubjects.socket.close()
    const forbidden = await watch(2)
    assert.match((await forbidden.box.next('error')).message, /perfil de alumno/)
    assert.equal(server.rooms.has('a'), true, 'Rechazar un observador no afecta la llamada del maestro.')
  })
  await t.test('finalizar y reiniciar produce un estado nuevo para el mismo curso', async () => {
    teacher.box.send({ type: 'leave' })
    assert.deepEqual((await watcher.box.next('classes')).classes, [])
    teacher.box.send({ type: 'join', subjectId: 'a' })
    await teacher.box.next('joined'); await teacher.box.next('room')
    const { classes } = await watcher.box.next('classes')
    assert.equal(classes[0].subjectId, 'a')
    assert.notEqual(classes[0].instanceId, originalInstance)
  })
  await t.test('retirar una matrícula elimina el aviso aun con la clase activa', async () => {
    await db.query("DELETE FROM enrollments WHERE student_id=1 AND subject_id='a'")
    assert.deepEqual((await watcher.box.next('classes')).classes, [])
    assert.equal(server.rooms.has('a'), true)
  })
  await t.test('la caída del maestro retira su clase del panel del alumno', async () => {
    otherTeacher.socket.terminate()
    assert.deepEqual((await otherWatcher.box.next('classes')).classes, [])
  })
  await t.test('una sesión revocada deja de recibir avisos', async () => {
    await db.query('DELETE FROM app_sessions WHERE user_id=3')
    assert.match((await otherWatcher.box.next('ended')).message, /sesión/)
  })
})


test('migración: conserva cuentas y permite varias por usuario después de retirar el índice único', async () => {
  const db = new PGlite()
  try {
    await db.exec(schema)
    await db.query("INSERT INTO users(id,name,email,password_hash,role) VALUES(1,'Alumno','student@test.local','unused','student')")
    await db.query("INSERT INTO classroom_connections(user_id,google_sub,email,display_name,encrypted_tokens) VALUES(1,'google-a','a@test.local','A','encrypted')")
    await db.exec('DROP INDEX idx_classroom_connections_user; CREATE UNIQUE INDEX idx_classroom_connections_user ON classroom_connections(user_id)')
    await db.exec(schema)
    await db.exec(schema)
    await db.query("INSERT INTO classroom_connections(user_id,google_sub,email,display_name,encrypted_tokens) VALUES(1,'google-b','b@test.local','B','encrypted')")
    assert.equal((await db.query('SELECT id FROM classroom_connections WHERE user_id=1')).rows.length, 2)
    assert.equal((await db.query("SELECT indisunique FROM pg_index WHERE indexrelid=to_regclass('idx_classroom_connections_user')")).rows[0].indisunique, false)
  } finally { await db.close() }
})
