import test from 'node:test'
import assert from 'node:assert/strict'
import { ClassPeer, LiveClass } from '../src/services/liveClassService.js'

class Track {
  constructor(kind) { this.kind = kind; this.stops = 0 }
  stop() { this.stops++ }
}
class Stream {
  constructor(tracks = []) { this.tracks = tracks }
  getTracks() { return this.tracks }
  getVideoTracks() { return this.tracks.filter(t => t.kind === 'video') }
  getAudioTracks() { return this.tracks.filter(t => t.kind === 'audio') }
}
class Peer {
  constructor() { this.slots = []; this.ice = [] }
  addTransceiver(kind, { direction }) {
    const slot = { direction, receiver: { track: new Track(kind) },
      sender: { track: null, async replaceTrack(track) { this.track = track } } }
    this.slots.push(slot)
    return slot
  }
  getTransceivers() { return this.slots }
  async createOffer() { return { type: 'offer', sdp: 'offer' } }
  async createAnswer() { return { type: 'answer', sdp: 'answer' } }
  async setLocalDescription(value) { this.localDescription = value }
  async setRemoteDescription(value) {
    if (!this.slots.length) {
      this.addTransceiver('video', { direction: 'recvonly' })
      this.addTransceiver('audio', { direction: 'recvonly' })
      this.addTransceiver('audio', { direction: 'recvonly' })
    }
    this.remoteDescription = value
  }
  async addIceCandidate(candidate) { assert.ok(this.remoteDescription); this.ice.push(candidate) }
  close() { this.closed = true }
}

test('WebRTC: reserva video, audio docente y audio del turno aunque estén apagados', async () => {
  const messages = []
  const peer = new ClassPeer({ teacher: true, send: x => messages.push(x), onStreams() {}, onFailure() {}, Peer, Stream })
  await peer.offer(null, null, null)
  assert.deepEqual(peer.pc.slots.map(s => s.direction), ['sendrecv', 'sendrecv', 'sendonly'])
  assert.equal(messages[0].kind, 'offer')
  const camera = new Track('video'), mic = new Track('audio'), floor = new Track('audio')
  await peer.tracks(camera, mic, floor)
  assert.deepEqual(peer.pc.slots.map(s => s.sender.track), [camera, mic, floor])
  const screen = new Track('video')
  await peer.tracks(screen, mic, null)
  assert.deepEqual(peer.pc.slots.map(s => s.sender.track), [screen, mic, null])
  assert.equal(messages.length, 1, 'Cambiar a pantalla no necesita otra oferta.')
  peer.close()
  assert.equal(peer.pc.closed, true)
})

test('WebRTC: conserva ICE adelantado y responde con canales correctos', async () => {
  const messages = [], streams = []
  const peer = new ClassPeer({ teacher: false, send: x => messages.push(x), onStreams: (...x) => streams.push(x), onFailure() {}, Peer, Stream })
  const ice = { candidate: 'candidate:early' }
  await peer.receive({ kind: 'ice', candidate: ice })
  assert.equal(peer.pc.ice.length, 0)
  const camera = new Track('video')
  await peer.receive({ kind: 'offer', sdp: 'offer' }, camera, null)
  assert.deepEqual(peer.pc.ice, [ice])
  assert.deepEqual(peer.pc.slots.map(s => s.direction), ['sendrecv', 'sendrecv', 'recvonly'])
  assert.equal(peer.pc.slots[0].sender.track, camera)
  assert.equal(messages[0].kind, 'answer')
  assert.equal(streams[0][0].getTracks().length, 2)
  assert.equal(streams[0][1].getAudioTracks().length, 1)
})

function environment(t, getUserMedia) {
  const previous = new Map()
  const properties = { navigator: { mediaDevices: { getUserMedia, getDisplayMedia: getUserMedia } },
    location: { protocol: 'http:', hostname: 'localhost' }, RTCPeerConnection: Peer, MediaStream: Stream }
  for (const [name, value] of Object.entries(properties)) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, value })
  }
  t.after(() => { for (const [name, value] of previous) {
    if (value) Object.defineProperty(globalThis, name, value)
    else delete globalThis[name]
  } })
}
function call(role = 'student') {
  const states = [], errors = []
  const live = new LiveClass({ subjectId: 'a', role, token: 'token', onChange: x => states.push(x), onError: x => errors.push(x) })
  live.peerId = 'me'; live.joined = true
  live.state = { teacher: { peerId: 'teacher' }, students: [{ peerId: 'me' }, { peerId: 'other' }], floorId: null }
  return { live, states, errors }
}

test('dispositivos: entrar no captura y un alumno sin turno no solicita micrófono', async t => {
  let requests = 0
  environment(t, async () => { requests++; return new Stream([new Track('audio')]) })
  const { live } = call()
  assert.equal(requests, 0)
  await assert.rejects(live.microphone(true), /Pide la palabra/)
  assert.equal(requests, 0)
  await assert.rejects(live.shareScreen(true), /Solo el maestro/)
  live.stop()
})

test('dispositivos: quitar el turno apaga y libera el micrófono', async t => {
  const mic = new Track('audio')
  environment(t, async () => new Stream([mic]))
  const { live } = call()
  live.state.floorId = 'me'
  await live.microphone(true)
  assert.equal(live.mic, mic)
  await live.receive({ type: 'room', teacher: { peerId: 'teacher' }, students: [{ peerId: 'me' }], floorId: null })
  assert.equal(live.mic, null)
  assert.equal(mic.stops, 1)
  assert.equal(live.media.size, 0)
  live.stop()
})

test('dispositivos: si se revoca el turno durante el permiso, no transmite', async t => {
  let resolve
  const mic = new Track('audio')
  environment(t, () => new Promise(r => { resolve = r }))
  const { live } = call()
  live.state.floorId = 'me'
  const permission = live.microphone(true)
  live.state.floorId = null
  resolve(new Stream([mic]))
  await permission
  assert.equal(live.mic, undefined)
  assert.equal(mic.stops, 1)
  live.stop()
})

test('dispositivos: salir durante el permiso libera la cámara recién aceptada', async t => {
  let resolve
  const track = new Track('video')
  environment(t, () => new Promise(r => { resolve = r }))
  const { live } = call()
  const permission = live.cameraEnabled(true)
  live.stop()
  resolve(new Stream([track]))
  await permission
  assert.equal(track.stops, 1)
  assert.equal(live.media.size, 0)
  assert.equal(live.camera, null)
})

test('clase: el maestro reenvía solo al participante autorizado, sin devolverle eco', async t => {
  environment(t, async () => new Stream())
  const { live } = call('teacher')
  const first = new Track('audio'), other = new Track('audio')
  live.remote.set('me', { stream: new Stream([first]) })
  live.remote.set('other', { stream: new Stream([other]) })
  live.state.floorId = 'me'
  assert.equal(live.floorTrack('other'), first)
  assert.equal(live.floorTrack('me'), null)
  live.state.floorId = 'other'
  assert.equal(live.floorTrack('me'), other)
  live.state.floorId = null
  assert.equal(live.floorTrack('me'), null)
  live.stop()
})

test('clase: detener libera cámara, micrófono, pantalla y conexiones una sola vez', async t => {
  const video = new Track('video'), audio = new Track('audio'), screen = new Track('video')
  let requests = 0
  environment(t, async () => new Stream([[video], [audio], [screen]][requests++]))
  const { live } = call('teacher')
  await live.cameraEnabled(true); await live.microphone(true); await live.shareScreen(true)
  let closed = 0
  live.peers.set('pupil', { close() { closed++ } })
  live.stop(); live.stop()
  assert.deepEqual([video.stops, audio.stops, screen.stops, closed], [1, 1, 1, 1])
  assert.equal(live.peers.size, 0)
  assert.equal(live.remote.size, 0)
})

test('clase: finalizar desde el servidor libera los dispositivos y muestra el motivo', async t => {
  const track = new Track('video')
  environment(t, async () => new Stream([track]))
  const { live, errors } = call()
  await live.cameraEnabled(true)
  await live.receive({ type: 'ended', message: 'Clase finalizada' })
  assert.equal(track.stops, 1)
  assert.equal(live.closed, true)
  assert.deepEqual(errors, ['Clase finalizada'])
})

test('presentación: detener sin cámara avisa apagado; con cámara avisa volver a cámara', async t => {
  environment(t, async constraints => new Stream([new Track(constraints.audio ? 'audio' : 'video')]))
  const { live } = call('teacher')
  const messages = []
  live.socket = { readyState: 1, send: raw => messages.push(JSON.parse(raw)), close() {} }
  await live.shareScreen(true)
  await live.shareScreen(false)
  await live.cameraEnabled(true)
  await live.shareScreen(true)
  await live.shareScreen(false)
  await live.cameraEnabled(false)
  assert.deepEqual(messages.filter(message => message.type === 'media').map(message => message.source), ['screen', 'off', 'camera', 'screen', 'camera', 'off'])
  live.stop()
})
test('presentación: el botón del navegador para dejar de compartir también avisa al alumno', async t => {
  const screen = new Track('video')
  environment(t, async () => new Stream([screen]))
  const { live } = call('teacher')
  const messages = []
  live.socket = { readyState: 1, send: raw => messages.push(JSON.parse(raw)), close() {} }
  await live.shareScreen(true)
  screen.onended()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(live.screen, null)
  assert.deepEqual(messages.filter(message => message.type === 'media').map(message => message.source), ['screen', 'off'])
  live.stop()
})
test('presentación: recibir el estado propio no genera un bucle de mensajes', async t => {
  environment(t, async () => new Stream())
  const { live } = call('teacher')
  const messages = []
  live.socket = { readyState: 1, send: raw => messages.push(JSON.parse(raw)), close() {} }
  const snapshot = { type: 'room', teacher: { peerId: 'me' }, students: [], teacherVideo: { source: 'off', revision: 0 }, floorId: null }
  await live.receive(snapshot)
  await live.receive({ ...snapshot, teacherVideo: { source: 'off', revision: 1 } })
  assert.equal(messages.filter(message => message.type === 'media').length, 1)
  live.stop()
})
