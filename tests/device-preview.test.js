import test from 'node:test'
import assert from 'node:assert/strict'
import { DevicePreview } from '../src/services/devicePreviewService.js'
import { LiveClass } from '../src/services/liveClassService.js'

class Track {
  constructor(kind) { this.kind = kind; this.stops = 0 }
  stop() { this.stops++ }
}
class Stream {
  constructor(kind) { this.track = new Track(kind) }
  getTracks() { return [this.track] }
  getVideoTracks() { return this.track.kind === 'video' ? [this.track] : [] }
  getAudioTracks() { return this.track.kind === 'audio' ? [this.track] : [] }
}
function fixture(getUserMedia) {
  const states = [], requests = [], streams = []
  const mediaDevices = { enumerateDevices: async () => [{ deviceId: 'cam-1', kind: 'videoinput', label: 'Cámara' }],
    getUserMedia: async constraints => {
      requests.push(constraints)
      const stream = getUserMedia ? await getUserMedia(constraints) : new Stream(constraints.video ? 'video' : 'audio')
      streams.push(stream); return stream
    }, addEventListener() {}, removeEventListener() {} }
  const controller = new DevicePreview({ onChange: state => states.push(state), mediaDevices, Context: null })
  return { controller, requests, states, streams }
}
test('previa: consultar dispositivos no pide permisos ni crea una llamada', async () => {
  const { controller, requests, states } = fixture()
  await controller.refresh()
  assert.equal(requests.length, 0)
  assert.equal(states.at(-1).devices[0].label, 'Cámara')
  controller.stop()
})
test('previa: cambiar de cámara conserva la anterior si falla el nuevo dispositivo', async () => {
  let calls = 0
  const { controller, states, streams } = fixture(async () => {
    if (++calls === 2) throw { name: 'NotFoundError' }
    return new Stream('video')
  })
  await controller.enable('camera', true)
  await assert.rejects(controller.select('camera', 'missing'))
  assert.equal(controller.camera, streams[0])
  assert.equal(controller.cameraId, '')
  assert.equal(streams[0].track.stops, 0)
  assert.equal(states.at(-1).cameraId, '')
  controller.stop()
  assert.equal(streams[0].track.stops, 1)
})
test('previa: elegir otra cámara solicita su ID y libera únicamente la anterior', async () => {
  const { controller, streams, requests } = fixture()
  await controller.enable('camera', true)
  await controller.select('camera', 'cam-2')
  assert.equal(requests[1].video.deviceId.exact, 'cam-2')
  assert.equal(streams[0].track.stops, 1)
  assert.equal(streams[1].track.stops, 0)
  controller.stop()
})
test('previa: salir mientras se acepta un permiso no deja capturas abiertas', async () => {
  let resolve
  const stream = new Stream('video')
  const { controller } = fixture(() => new Promise(r => { resolve = r }))
  const pending = controller.enable('camera', true)
  controller.stop(); resolve(stream)
  await pending
  assert.equal(stream.track.stops, 1)
  assert.equal(controller.camera, null)
})
test('previa: el alumno transfiere su cámara y detiene el micrófono de prueba', async () => {
  const { controller, streams } = fixture()
  await controller.enable('camera', true); await controller.enable('microphone', true)
  const media = controller.takeForCall('student')
  controller.stop()
  assert.equal(media.camera, streams[0])
  assert.equal(media.microphone, null)
  assert.equal(streams[0].track.stops, 0)
  assert.equal(streams[1].track.stops, 1)
  media.camera.getTracks().forEach(track => track.stop())
})
test('previa: el maestro transfiere cámara y micrófono sin recapturarlos', async () => {
  const { controller, streams, requests } = fixture()
  await controller.enable('camera', true); await controller.enable('microphone', true)
  const media = controller.takeForCall('teacher')
  controller.stop()
  const call = new LiveClass({ role: 'teacher', subjectId: 'a', onChange() {}, onError() {} })
  call.adoptMedia(media)
  assert.equal(call.camera, streams[0]); assert.equal(call.mic, streams[1].track)
  assert.equal(requests.length, 2)
  call.stop()
  assert.deepEqual(streams.map(stream => stream.track.stops), [1, 1])
})
test('previa: la clase rechaza un micrófono inicial del alumno como defensa adicional', () => {
  const stream = new Stream('audio')
  const call = new LiveClass({ role: 'student', subjectId: 'a', onChange() {}, onError() {} })
  call.adoptMedia({ microphone: stream })
  assert.equal(call.mic, undefined)
  assert.equal(stream.track.stops, 1)
  call.stop()
})
test('previa: el medidor analiza la entrada sin reproducir la voz en altavoces', async () => {
  let destinationConnections = 0, closed = 0
  class Context {
    constructor() { this.destination = { output: true } }
    resume() { return Promise.resolve() }
    createMediaStreamSource() { return { connect: target => { if (target.output) destinationConnections++ }, disconnect() {} } }
    createAnalyser() { return { fftSize: 0, getByteTimeDomainData(buffer) { buffer.fill(145) } } }
    close() { closed++; return Promise.resolve() }
  }
  const { controller, states } = fixture()
  controller.Context = Context
  await controller.enable('microphone', true)
  await new Promise(resolve => setTimeout(resolve, 140))
  assert.ok(states.at(-1).level > 0)
  assert.equal(destinationConnections, 0)
  controller.stop()
  assert.equal(closed, 1)
})
test('previa: el sonido de prueba usa una onda local y se detiene al entrar', async () => {
  let played = 0, paused = 0
  const audio = { setSinkId: async id => { assert.equal(id, 'output-1') }, play: async () => { played++ }, pause: () => { paused++ } }
  const { controller } = fixture()
  controller.audioFactory = () => audio
  await controller.testSpeaker('output-1')
  assert.match(audio.src, /^data:audio\/wav;base64,UklGR/)
  assert.equal(played, 1)
  controller.takeForCall('student')
  assert.equal(paused, 1)
  controller.stop()
})
