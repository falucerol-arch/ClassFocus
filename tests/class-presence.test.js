import test from 'node:test'
import assert from 'node:assert/strict'
import { ClassPresence } from '../src/services/classPresenceService.js'

function fixture() {
  const sockets = [], states = [], notices = [], timers = new Map()
  let timerId = 0
  class Socket {
    constructor(url) { this.url = url; this.sent = []; sockets.push(this) }
    send(message) { this.sent.push(JSON.parse(message)) }
    close() { this.closed = true }
    message(message) { this.onmessage({ data: JSON.stringify(message) }) }
  }
  const observer = new ClassPresence({ token: 'session', Socket, url: () => 'ws://test',
    onState: state => states.push(state), onStarted: item => notices.push(item),
    schedule: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId },
    cancel: id => timers.delete(id) })
  const live = (instanceId = 'first') => ({ subjectId: 'a', instanceId, teacherName: 'Docente' })
  return { observer, sockets, states, notices, timers, live }
}

test('avisos: autentica antes de observar; no entra a una sala ni usa WebRTC', () => {
  const { observer, sockets, states } = fixture()
  observer.start()
  const socket = sockets[0]
  socket.onopen()
  assert.deepEqual(socket.sent, [{ type: 'authenticate', token: 'session' }])
  socket.message({ type: 'authenticated' })
  assert.deepEqual(socket.sent[1], { type: 'watch' })
  socket.message({ type: 'classes', classes: [] })
  assert.equal(states.at(-1).status, 'online')
  observer.stop()
})

test('avisos: muestra clases existentes y anuncia aperturas nuevas una sola vez', () => {
  const { observer, sockets, states, notices, live } = fixture()
  observer.start()
  const socket = sockets[0]
  socket.message({ type: 'classes', classes: [live()] })
  assert.equal(states.at(-1).classes.length, 1)
  assert.equal(notices.length, 0, 'La instantánea inicial no es un inicio nuevo.')
  socket.message({ type: 'classes', classes: [live()] })
  assert.equal(notices.length, 0)
  socket.message({ type: 'classes', classes: [] })
  socket.message({ type: 'classes', classes: [live('second')] })
  socket.message({ type: 'classes', classes: [live('second')] })
  assert.equal(notices.length, 1)
  assert.equal(notices[0].instanceId, 'second')
  observer.stop()
})

test('avisos: desconectar borra los indicadores y reconecta sin duplicar notificaciones', () => {
  const { observer, sockets, states, notices, timers, live } = fixture()
  observer.start()
  sockets[0].message({ type: 'classes', classes: [live()] })
  sockets[0].onclose({ code: 1006 })
  assert.deepEqual(states.at(-1), { status: 'offline', classes: [] })
  const [id, retry] = [...timers][0]
  assert.equal(retry.delay, 1000)
  timers.delete(id); retry.callback()
  assert.equal(sockets.length, 2)
  sockets[1].message({ type: 'classes', classes: [live()] })
  assert.equal(notices.length, 0)
  sockets[1].message({ type: 'classes', classes: [live('new')] })
  assert.equal(notices.length, 1)
  observer.stop()
  assert.equal(timers.size, 0)
})

test('avisos: expiración de sesión muestra el motivo y no insiste con un token inválido', () => {
  const { observer, sockets, states, timers } = fixture()
  observer.start()
  sockets[0].message({ type: 'ended', message: 'Tu sesión venció' })
  sockets[0].onclose({ code: 4001 })
  assert.deepEqual(states.at(-1), { status: 'unauthorized', classes: [], message: 'Tu sesión venció' })
  assert.equal(timers.size, 0)
  observer.stop()
})

test('avisos: cerrar el panel cancela reintentos y descarta mensajes tardíos', () => {
  const { observer, sockets, states, notices, timers, live } = fixture()
  observer.start()
  sockets[0].onerror()
  assert.equal(timers.size, 1)
  observer.stop()
  const count = states.length
  sockets[0].message({ type: 'classes', classes: [live()] })
  assert.equal(states.length, count)
  assert.equal(notices.length, 0)
  assert.equal(timers.size, 0)
})

test('avisos: una conexión que no responde tiene plazo y un solo reintento', () => {
  const { observer, sockets, states, timers } = fixture()
  observer.start()
  const [id, timeout] = [...timers][0]
  assert.equal(timeout.delay, 10000)
  timers.delete(id); timeout.callback()
  sockets[0].onclose({ code: 1006 })
  assert.equal(timers.size, 1)
  assert.equal(states.at(-1).status, 'offline')
  observer.stop()
})

test('avisos: conserva el contexto global de los temporizadores del navegador', () => {
  const timers = new Map()
  let id = 0
  class Socket { close() {} }
  // Los temporizadores de Window validan el receptor; Node no detectaba este fallo.
  function schedule(callback, delay) {
    assert.equal(this, globalThis, 'setTimeout debe ejecutarse con el contexto global.')
    timers.set(++id, { callback, delay })
    return id
  }
  function cancel(timer) {
    assert.equal(this, globalThis, 'clearTimeout debe ejecutarse con el contexto global.')
    timers.delete(timer)
  }
  const observer = new ClassPresence({ token: 'session', Socket, url: () => 'ws://test',
    onState() {}, schedule, cancel })
  observer.start()
  observer.socket.onmessage({ data: JSON.stringify({ type: 'classes', classes: [] }) })
  observer.stop()
  assert.equal(timers.size, 0)
})
