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
      this.addTransceiver('video', { direction: 'recvonly' })
      this.addTransceiver('audio', { direction: 'recvonly' })
    }
    this.remoteDescription = value
  }
  async addIceCandidate(candidate) { assert.ok(this.remoteDescription); this.ice.push(candidate) }
  close() { this.closed = true }
}

test('WebRTC: reserva cámara, pantalla y audios aunque estén apagados', async () => {
  const messages = []
  const peer = new ClassPeer({ teacher: true, send: x => messages.push(x), onStreams() {}, onFailure() {}, Peer, Stream })
  await peer.offer(null, null, null)
  assert.deepEqual(peer.pc.slots.map(s => s.direction), ['sendrecv', 'sendrecv', 'sendonly', 'sendrecv', 'sendrecv'])
  assert.equal(messages[0].kind, 'offer')
  const camera = new Track('video'), mic = new Track('audio'), floor = new Track('audio')
  await peer.tracks(camera, mic, floor)
  assert.deepEqual(peer.pc.slots.map(s => s.sender.track), [camera, mic, floor, null, null])
  const screen = new Track('video')
  await peer.tracks(screen, mic, null)
  assert.deepEqual(peer.pc.slots.map(s => s.sender.track), [screen, mic, null, null, null])
  await peer.tracks(camera, mic, floor, screen)
  assert.deepEqual(peer.pc.slots.map(s => s.sender.track), [camera, mic, floor, screen, null])
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
  const camera = new Track('video'), screen = new Track('video')
  await peer.receive({ kind: 'offer', sdp: 'offer' }, camera, null, screen)
  assert.deepEqual(peer.pc.ice, [ice])
  assert.deepEqual(peer.pc.slots.map(s => s.direction), ['sendrecv', 'sendrecv', 'recvonly', 'sendrecv', 'sendrecv'])
  assert.equal(peer.pc.slots[0].sender.track, camera)
  assert.equal(peer.pc.slots[3].sender.track, screen)
  assert.equal(messages[0].kind, 'answer')
  assert.equal(streams[0][0].getTracks().length, 2)
  assert.equal(streams[0][1].getAudioTracks().length, 1)
  assert.equal(streams[0][2].getVideoTracks().length, 1)
  assert.equal(streams[0][2].getAudioTracks().length, 1)
  assert.notEqual(streams[0][0].getVideoTracks()[0], streams[0][2].getVideoTracks()[0])
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
  await assert.rejects(live.shareScreen(true), /Pide la palabra/)
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
  environment(t, async constraints => new Stream([new Track(constraints.video ? 'video' : 'audio')]))
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

for (const role of ['teacher', 'student']) {
  test(`cámara ${role}: anuncia apagado antes de que termine replaceTrack`, async t => {
    const camera = new Track('video')
    environment(t, async () => new Stream([camera]))
    const { live, states } = call(role)
    const messages = []
    live.socket = { readyState: 1, send: raw => messages.push(JSON.parse(raw)), close() {} }
    await live.cameraEnabled(true)
    let finish
    live.updateTracks = () => new Promise(resolve => { finish = resolve })
    const stopping = live.cameraEnabled(false)
    assert.equal(camera.stops, 1)
    assert.equal(states.at(-1).local, null)
    assert.equal(messages.at(-1).source, 'off')
    finish(); await stopping; live.stop()
  })
}

test('pantalla alumno: captura con turno y vuelve a su cámara al detener', async t => {
  const camera = new Track('video'), screen = new Track('video')
  let requests = 0
  environment(t, async () => new Stream([requests++ ? screen : camera]))
  const { live } = call()
  live.state.floorId = 'me'
  const messages = []
  live.socket = { readyState: 1, send: raw => messages.push(JSON.parse(raw)), close() {} }
  await live.cameraEnabled(true); await live.shareScreen(true)
  assert.equal(live.videoTrack(), camera)
  assert.equal(live.outboundScreen('teacher'), screen)
  assert.equal(live.camera.getVideoTracks()[0], camera)
  await live.shareScreen(false)
  assert.equal(live.videoTrack(), camera)
  assert.equal(screen.stops, 1)
  assert.equal(camera.stops, 0)
  assert.deepEqual(messages.filter(m => m.type === 'media').map(m => m.source), ['camera', 'screen', 'camera'])
  live.stop()
})

test('pantalla alumno: revocar el turno libera pantalla y conserva cámara', async t => {
  const camera = new Track('video'), screen = new Track('video')
  let requests = 0
  environment(t, async () => new Stream([requests++ ? screen : camera]))
  const { live } = call(); live.state.floorId = 'me'
  await live.cameraEnabled(true); await live.shareScreen(true)
  await live.receive({ type: 'room', teacher: { peerId: 'teacher' }, students: [{ peerId: 'me', video: { source: 'off' } }], floorId: null })
  assert.equal(live.screen, null)
  assert.equal(screen.stops, 1)
  assert.equal(live.videoTrack(), camera)
  live.stop()
})

test('pantalla alumno: pierde y recupera el turno durante el permiso, no publica la captura antigua', async t => {
  let resolve
  const screen = new Track('video')
  environment(t, () => new Promise(r => { resolve = r }))
  const { live } = call(); live.state.floorId = 'me'
  const waiting = live.shareScreen(true)
  await live.receive({ type: 'room', teacher: { peerId: 'teacher' }, students: [{ peerId: 'me' }], floorId: null })
  await live.receive({ type: 'room', teacher: { peerId: 'teacher' }, students: [{ peerId: 'me' }], floorId: 'me' })
  resolve(new Stream([screen])); await waiting
  assert.equal(screen.stops, 1)
  assert.ok(!live.screen)
  live.stop()
})

test('pantalla alumno: salir durante el permiso libera la captura recién aceptada', async t => {
  let resolve
  const screen = new Track('video')
  environment(t, () => new Promise(r => { resolve = r }))
  const { live } = call(); live.state.floorId = 'me'
  const waiting = live.shareScreen(true)
  live.stop(); resolve(new Stream([screen])); await waiting
  assert.equal(screen.stops, 1)
  assert.equal(live.screen, null)
})

test('pantalla alumno: el maestro tiene prioridad y el botón nativo también detiene la pantalla', async t => {
  let requests = 0
  const screen = new Track('video')
  environment(t, async () => { requests++; return new Stream([screen]) })
  const { live } = call(); live.state.floorId = 'me'; live.state.teacherVideo = { source: 'screen' }
  await assert.rejects(live.shareScreen(true), /El maestro está presentando/)
  assert.equal(requests, 0)
  live.state.teacherVideo.source = 'camera'
  await live.shareScreen(true)
  screen.onended(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(live.screen, null)
  assert.equal(screen.stops, 1)
  live.stop()
})

test('reenvío: comparte la pantalla autorizada, nunca otra cámara ni el video al propio presentador', async t => {
  environment(t, async () => new Stream())
  const { live } = call('teacher')
  const teacherCamera = new Track('video'), shared = new Track('video'), privateCamera = new Track('video')
  live.camera = new Stream([teacherCamera])
  live.remote.set('me', { stream: new Stream([privateCamera]), presentation: new Stream([shared]) })
  live.remote.set('other', { stream: new Stream([privateCamera]) })
  live.state.students = [{ peerId: 'me', video: { source: 'screen' } }, { peerId: 'other', video: { source: 'camera' } }]
  live.state.floorId = 'me'
  assert.equal(live.outboundScreen('other'), shared)
  assert.equal(live.outboundScreen('me'), null)
  let outgoing
  live.peers.set('other', { tracks: async (video, audio, floor, screen) => { assert.equal(video, teacherCamera); outgoing = screen }, close() {} })
  await live.updateTracks(); assert.equal(outgoing, shared)
  live.state.students[0].video.source = 'off'
  await live.updateTracks(); assert.equal(outgoing, null)
  live.state.floorId = 'other'
  assert.equal(live.outboundScreen('me'), null)
  live.stop()
})

test('cámara remota: el aviso de apagado llega a la UI antes de esperar replaceTrack', async t => {
  environment(t, async () => new Stream())
  const { live, states } = call('teacher')
  let finish
  live.peers.set('me', { tracks: () => new Promise(resolve => { finish = resolve }), close() {} })
  const updating = live.receive({ type: 'room', teacher: { peerId: 'teacher' },
    students: [{ peerId: 'me', video: { source: 'off', revision: 2 } }], floorId: null })
  assert.equal(states.at(-1).room.students[0].video.source, 'off')
  finish(); await updating; live.stop()
})

for (const role of ['teacher', 'student']) {
  test(`audio compartido ${role}: solicita audio y lo envía separado del micrófono`, async t => {
    const video = new Track('video'), sound = new Track('audio'), mic = new Track('audio')
    let constraints
    environment(t, async options => { constraints = options; return new Stream([video, sound]) })
    const { live, states } = call(role); live.state.floorId = 'me'
    let sent
    live.peers.set('receiver', { tracks: async (...tracks) => { sent = tracks }, close() {} })
    await live.shareScreen(true)
    assert.equal(constraints.audio, true)
    assert.equal(constraints.windowAudio, 'window')
    assert.equal(states.at(-1).screenAudio, true)
    assert.equal(sent[1], undefined, 'No captura ni abre el micrófono al compartir.')
    assert.equal(sent[4], sound)
    live.mic = mic
    await live.updateTracks()
    assert.equal(sent[1], mic)
    assert.equal(sent[4], sound)
    await live.microphone(false)
    assert.equal(sent[1], null)
    assert.equal(sent[4], sound, 'Silenciar la voz conserva el audio compartido.')
    await live.shareScreen(false)
    assert.equal(sent[4], null)
    assert.equal(sound.stops, 1)
    assert.equal(video.stops, 1)
    assert.equal(states.at(-1).screenAudio, false)
    live.stop()
  })
}

test('audio compartido: una fuente sin pista de audio permite continuar presentando', async t => {
  const video = new Track('video')
  environment(t, async () => new Stream([video]))
  const { live, states } = call('teacher')
  await live.shareScreen(true)
  assert.equal(states.at(-1).sharing, true)
  assert.equal(states.at(-1).screenAudio, false)
  assert.equal(live.outboundScreenAudio('other'), null)
  live.stop()
})

test('audio compartido: reenvía solo al grupo autorizado y lo retira al cambiar de turno', async t => {
  environment(t, async () => new Stream())
  const { live } = call('teacher')
  const sound = new Track('audio'), mic = new Track('audio')
  live.remote.set('me', { stream: new Stream([mic]), presentation: new Stream([new Track('video'), sound]) })
  live.state.students[0].video = { source: 'screen' }; live.state.floorId = 'me'
  assert.equal(live.outboundScreenAudio('other'), sound)
  assert.equal(live.outboundScreenAudio('me'), null, 'No devuelve el sonido a su emisor.')
  live.state.floorId = null
  assert.equal(live.outboundScreenAudio('other'), null)
  live.state.floorId = 'me'; live.state.students[0].video.source = 'camera'
  assert.equal(live.outboundScreenAudio('other'), null, 'No reenvía micrófonos por el canal de pantalla.')
  live.stop()
})

test('audio compartido: perder la palabra libera el audio y el video de la captura', async t => {
  const video = new Track('video'), sound = new Track('audio')
  environment(t, async () => new Stream([video, sound]))
  const { live } = call(); live.state.floorId = 'me'
  await live.shareScreen(true)
  await live.receive({ type: 'room', teacher: { peerId: 'teacher' }, students: [{ peerId: 'me', video: { source: 'off' } }], floorId: null })
  assert.equal(live.screen, null)
  assert.equal(sound.stops, 1)
  assert.equal(video.stops, 1)
  assert.equal(live.outboundScreenAudio('teacher'), null)
  live.stop()
})

test('audio compartido: terminar únicamente la pista de audio conserva el video', async t => {
  const video = new Track('video'), sound = new Track('audio')
  environment(t, async () => new Stream([video, sound]))
  const { live, states } = call('teacher')
  let outgoing
  live.peers.set('other', { tracks: async (...tracks) => { outgoing = tracks }, close() {} })
  await live.shareScreen(true)
  sound.readyState = 'ended'; sound.onended()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(states.at(-1).screenAudio, false)
  assert.equal(states.at(-1).sharing, true)
  assert.equal(outgoing[4], null)
  assert.equal(video.stops, 0)
  live.stop()
})

test('WebRTC: envía audio compartido por su propio canal al negociar y conserva las voces', async () => {
  const camera = new Track('video'), mic = new Track('audio'), sound = new Track('audio'), screen = new Track('video')
  const teacher = new ClassPeer({ teacher: true, send() {}, onStreams() {}, onFailure() {}, Peer, Stream })
  await teacher.offer(camera, mic, null, screen, sound)
  assert.deepEqual(teacher.pc.slots.map(slot => slot.sender.track), [camera, mic, null, screen, sound])
  const student = new ClassPeer({ teacher: false, send() {}, onStreams() {}, onFailure() {}, Peer, Stream })
  await student.receive({ kind: 'offer', sdp: 'offer' }, camera, mic, screen, sound)
  assert.deepEqual(student.pc.slots.map(slot => slot.sender.track), [camera, mic, null, screen, sound])
  teacher.close(); student.close()
})
