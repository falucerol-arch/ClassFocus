import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
// Se renderizan los componentes React reales. Solo se sustituye la captura y el transporte.
const transport = `
export class LiveClass {
  static instances = []
  constructor(options) {
    this.options = options; LiveClass.instances.push(this); this.stops = 0;
    this.state = { joined: true, local: null, microphone: false, sharing: false,
      peerId: options.role === 'teacher' ? 't' : 'a', remotes: new Map(),
      room: { teacher: { peerId:'t', name:'Docente Demo' }, floorId:'a', students: [
        { peerId:'a', name:'Alumno Demo', hand:true }, { peerId:'b', name:'Segundo Alumno', hand:false }] } };
  }
  emit() { this.options.onChange({ ...this.state }); }
  adoptMedia(media = {}) { this.adopted = media; this.state.local = media.camera || null; this.state.microphone = !!media.microphone; }
  async connect() { this.emit(); }
  async microphone(enabled) { if (this.micError) throw this.micError; this.state.microphone = enabled; this.emit(); }
  async cameraEnabled() {}
  async shareScreen(enabled) {
    this.state.sharing = enabled; this.state.presentation = enabled ? { getVideoTracks: () => [] } : null; this.emit();
  }
  floor(id) { this.state.room.floorId = id; this.emit(); }
  hand(raised) { this.state.room.students[0].hand = raised; this.emit(); }
  stop() { if (this.closed) return; this.closed = true; this.stops++; for (const stream of [this.adopted?.camera, this.adopted?.microphone]) stream?.getTracks().forEach(track => track.stop()); this.options.onClose(); }
}
`
const directory = await mkdtemp(join(tmpdir(), 'classfocus-ui-'))
const output = join(directory, 'components.mjs')
await build({ stdin: { contents: `export { default as Meeting } from './src/components/LiveClassroom.jsx';
  export { default as Launcher } from './src/components/LiveStudentMonitor.jsx';
  export { ThemeProvider } from './src/context/ThemeContext.jsx';
  export { LiveClass as TestCall } from './src/services/liveClassService';`, resolveDir: process.cwd() },
  outfile: output, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic',
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" }, loader: { '.css': 'empty' },
  plugins: [{ name: 'test-dependencies', setup(builder) {
    builder.onResolve({ filter: /^react(?:$|\/)|^react-dom(?:$|\/)|^react-router-dom$/ }, args => { const file = require.resolve(args.path); return { path: args.kind === 'require-call' || args.kind === 'require-resolve' ? file : pathToFileURL(file).href, external: true } })
    builder.onResolve({ filter: /(?:services\/liveClassService|\.\/src\/services\/liveClassService)$/ }, () => ({ path: 'transport', namespace: 'test' }))
    builder.onResolve({ filter: /core\/FaceAnalyzer$/ }, () => ({ path: 'analyzer', namespace: 'test' }))
    builder.onLoad({ filter: /.*/, namespace: 'test' }, args => ({ contents: args.path === 'transport' ? transport : 'export class FaceAnalyzer { async initialize() {} close() {} analyze() { return null } }' }))
  } }] })
const { Meeting, Launcher, ThemeProvider, TestCall } = await import(pathToFileURL(output))
const { MemoryRouter, Route, Routes, useLocation } = await import('react-router-dom')
test.after(() => rm(directory, { recursive: true, force: true }))

function environment(t, mediaDevices) {
  const old = new Map(), events = new Map()
  const storage = { getItem: key => key === 'classfocus_theme' ? 'dark' : 'session', setItem() {} }
  const document = { documentElement: { dataset: {}, style: {} }, fullscreenElement: null,
    addEventListener: (key, fn) => events.set(key, fn), removeEventListener: key => events.delete(key),
    async exitFullscreen() { this.fullscreenElement = null; events.get('fullscreenchange')?.() } }
  const window = { addEventListener() {}, removeEventListener() {} }
  for (const [key, value] of Object.entries({ document, window, navigator: { mediaDevices }, sessionStorage: storage, localStorage: storage })) {
    old.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  }
  const restore = () => { for (const [key, value] of old) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key] } }
  return { document, events, restore }
}
function text(node) { return typeof node === 'string' || typeof node === 'number' ? String(node) : (node.children || []).map(text).join('') }
function button(tree, label) { return tree.root.findAllByType('button').find(node => node.props['aria-label'] === label || text(node).trim() === label) }
async function click(tree, label) {
  const target = button(tree, label)
  assert.ok(target, `Existe el botón ${label}`)
  await act(async () => { target.props.onClick() })
}
async function render(t, role = 'teacher', mediaDevices) {
  const { document, events, restore } = environment(t, mediaDevices)
  let exits = 0, fullscreenRequests = 0
  const audioCalls = []
  const main = { async requestFullscreen() { fullscreenRequests++; document.fullscreenElement = main; events.get('fullscreenchange')?.() } }
  let tree
  await act(async () => { tree = Renderer.create(React.createElement(ThemeProvider, null,
    React.createElement(Meeting, { role, user: { name: role === 'teacher' ? 'Docente Demo' : 'Alumno Demo' },
      subject: { id: 'prog1', name: 'Programación I', code: 'SIS-101' }, onExit: () => { exits++ } })), {
      createNodeMock: element => element.type === 'main' ? main : element.type === 'dialog' ? { showModal() {}, close() {} } :
        element.type === 'audio' ? { srcObject: null, setSinkId: async id => audioCalls.push(['sink', id]), play: async () => { audioCalls.push(['play']) }, pause: () => audioCalls.push(['pause']) } :
        element.type === 'video' ? { srcObject: null, play: async () => {}, pause() {} } : { focus() {} } }) })
  t.after(async () => { try { await act(async () => tree.unmount()) } finally { restore() } })
  return { tree, document, audioCalls, lastCall: () => TestCall.instances.at(-1), exits: () => exits, fullscreenRequests: () => fullscreenRequests }
}

test('aula: cambiar de vista, fijar y ampliar no reinicia la llamada', async t => {
  const { tree, lastCall, fullscreenRequests } = await render(t)
  await click(tree, 'Iniciar clase')
  const call = lastCall()
  assert.equal(tree.root.findByProps({ 'aria-label': 'Videos de la clase' }).props['data-layout'], 'grid')
  await click(tree, 'Enfoque')
  await click(tree, 'Fijar a Segundo Alumno')
  assert.equal(tree.root.findByProps({ 'aria-label': 'Videos de la clase' }).props['data-layout'], 'focus')
  await click(tree, 'Ampliar a Segundo Alumno')
  assert.equal(fullscreenRequests(), 1)
  await click(tree, 'Mosaico')
  assert.equal(call.stops, 0)
  assert.equal(lastCall(), call)
})
// Ambos perfiles comparten el control del video; ampliar y reducir no debe cerrar la llamada.
for (const role of ['teacher', 'student']) {
  test(`aula: ${role} amplía y reduce desde el mismo botón del video`, async t => {
    const { tree, document, lastCall, fullscreenRequests } = await render(t, role)
    await click(tree, role === 'teacher' ? 'Iniciar clase' : 'Entrar a clase')
    const call = lastCall()
    const name = role === 'teacher' ? 'Alumno Demo' : 'Docente Demo'
    await click(tree, `Ampliar a ${name}`)
    assert.equal(fullscreenRequests(), 1)
    assert.ok(document.fullscreenElement)
    assert.ok(button(tree, 'Salir de pantalla completa'))
    assert.ok(button(tree, `Reducir a ${name}`).findAllByProps({ className: 'lucide lucide-minimize2' }).length)
    await click(tree, `Reducir a ${name}`)
    assert.equal(document.fullscreenElement, null)
    assert.ok(button(tree, `Ampliar a ${name}`))
    assert.ok(button(tree, 'Pantalla completa'))
    assert.equal(fullscreenRequests(), 1)
    assert.equal(call.stops, 0)
    assert.equal(lastCall(), call)
  })
}
test('aula: salir con Escape o desde el encabezado sincroniza el botón del video', async t => {
  const { tree, document, fullscreenRequests } = await render(t)
  await click(tree, 'Iniciar clase')
  await click(tree, 'Ampliar a Alumno Demo')
  // Simula la salida nativa y su evento fullscreenchange, como al pulsar Escape.
  await act(async () => { await document.exitFullscreen() })
  assert.ok(button(tree, 'Ampliar a Alumno Demo'))
  await click(tree, 'Ampliar a Alumno Demo')
  await click(tree, 'Salir de pantalla completa')
  assert.ok(button(tree, 'Ampliar a Alumno Demo'))
  assert.equal(document.fullscreenElement, null)
  assert.equal(fullscreenRequests(), 2)
})
test('aula: micrófono inexistente muestra español y permite seguir en la clase', async t => {
  const { tree, lastCall } = await render(t)
  await click(tree, 'Iniciar clase')
  lastCall().micError = { name: 'NotFoundError', message: 'Requested device not found' }
  await click(tree, 'Activar micrófono')
  assert.match(text(tree.root.findByProps({ role: 'alert' })), /ningún micrófono disponible/)
  assert.doesNotMatch(text(tree.root.findByProps({ role: 'alert' })), /Requested/)
  assert.equal(lastCall().stops, 0)
  await click(tree, 'Cerrar error')
  assert.equal(tree.root.findAllByProps({ role: 'alert' }).length, 0)
})
test('aula: compartir pantalla abre Presentación y al terminar restaura la vista', async t => {
  const { tree, lastCall } = await render(t)
  await click(tree, 'Iniciar clase')
  await click(tree, 'Compartir pantalla')
  assert.equal(tree.root.findByProps({ 'aria-label': 'Videos de la clase' }).props['data-layout'], 'presentation')
  await click(tree, 'Dejar de compartir')
  assert.equal(tree.root.findByProps({ 'aria-label': 'Videos de la clase' }).props['data-layout'], 'grid')
  assert.equal(lastCall().stops, 0)
})
test('aula: el maestro confirma antes de finalizar y puede cancelar', async t => {
  const { tree, lastCall, exits } = await render(t)
  await click(tree, 'Iniciar clase')
  await click(tree, 'Finalizar clase')
  assert.equal(lastCall().stops, 0)
  await click(tree, 'Continuar en clase')
  assert.equal(lastCall().stops, 0)
  await click(tree, 'Volver al panel')
  await click(tree, 'Finalizar para todos')
  assert.equal(lastCall().stops, 1)
  assert.equal(exits(), 1)
})
test('aula: el alumno no renderiza videos de otros alumnos al cambiar la distribución', async t => {
  const { tree, lastCall } = await render(t, 'student')
  await click(tree, 'Entrar a clase')
  await click(tree, 'Mosaico')
  const tiles = tree.root.findAllByType('article')
  assert.deepEqual(tiles.map(item => item.props['aria-label']), ['Docente Demo', 'Alumno Demo (tú)'])
  assert.equal(button(tree, 'Compartir pantalla'), undefined)
  await click(tree, 'Enfoque')
  assert.equal(lastCall().stops, 0)
})
test('panel docente: Abrir aula navega a una ruta independiente conservando la materia', async t => {
  const { restore } = environment(t)
  let tree
  function Destination() { return React.createElement('p', null, useLocation().search) }
  await act(async () => { tree = Renderer.create(React.createElement(MemoryRouter, { initialEntries: ['/teacher'], future: { v7_startTransition: true, v7_relativeSplatPath: true } },
    React.createElement(Routes, null,
      React.createElement(Route, { path: '/teacher', element: React.createElement(Launcher, { subjects: [{ id: 'curso #1', name: 'Curso' }] }) }),
      React.createElement(Route, { path: '/teacher/class', element: React.createElement(Destination) })))) })
  t.after(async () => { try { await act(async () => tree.unmount()) } finally { restore() } })
  assert.equal(tree.root.findAllByType('video').length, 0)
  await click(tree, 'Abrir aula')
  assert.equal(text(tree.root.findByType('p')), '?subject=curso%20%231')
})

test('participantes: los turnos solo aparecen al seleccionar al alumno correcto', async t => {
  const { tree, lastCall } = await render(t)
  await click(tree, 'Iniciar clase')
  assert.equal(button(tree, 'Dar la palabra'), undefined)
  await click(tree, 'Seleccionar a Segundo Alumno')
  assert.ok(tree.root.findByProps({ 'aria-label': 'Acciones para Segundo Alumno' }))
  await click(tree, 'Dar la palabra')
  assert.equal(lastCall().state.room.floorId, 'b')
  await click(tree, 'Quitar la palabra')
  assert.equal(lastCall().state.room.floorId, null)
  await click(tree, 'Cerrar acciones del alumno')
  assert.equal(button(tree, 'Dar la palabra'), undefined)
})
test('participantes: los tres puntos del video abren las acciones de ese alumno', async t => {
  const { tree } = await render(t)
  await click(tree, 'Iniciar clase')
  await click(tree, 'Cerrar participantes')
  await click(tree, 'Gestionar a Alumno Demo')
  assert.ok(tree.root.findByProps({ 'aria-label': 'Acciones para Alumno Demo' }))
  assert.equal(button(tree, 'Seleccionar a Alumno Demo').props['aria-pressed'], true)
})

test('previa React: un micrófono ausente no impide entrar sin dispositivos', async t => {
  const devices = { enumerateDevices: async () => [], getUserMedia: async () => { throw { name: 'NotFoundError', message: 'Requested device not found' } } }
  const { tree, lastCall } = await render(t, 'teacher', devices)
  await click(tree, 'Probar micrófono')
  assert.match(text(tree.root.findByProps({ role: 'alert' })), /ningún micrófono disponible/)
  assert.equal(button(tree, 'Iniciar clase').props.disabled, false)
  await click(tree, 'Iniciar clase')
  assert.equal(lastCall().state.microphone, false)
})
test('previa React: conserva la cámara probada del alumno y entra con el micrófono apagado', async t => {
  const camera = { kind: 'video', readyState: 'live', muted: false, stops: 0, stop() { this.stops++ }, addEventListener() {}, removeEventListener() {} }
  const mic = { kind: 'audio', stops: 0, stop() { this.stops++ } }
  const stream = track => ({ getTracks: () => [track], getVideoTracks: () => track.kind === 'video' ? [track] : [], getAudioTracks: () => track.kind === 'audio' ? [track] : [] })
  const cameraStream = stream(camera)
  let captures = 0
  const devices = { enumerateDevices: async () => [], getUserMedia: async constraints => { captures++; return constraints.video ? cameraStream : stream(mic) } }
  const { tree, lastCall } = await render(t, 'student', devices)
  await click(tree, 'Probar cámara')
  await click(tree, 'Probar micrófono')
  await click(tree, 'Entrar a clase')
  assert.equal(lastCall().state.local, cameraStream)
  assert.equal(lastCall().state.microphone, false)
  assert.equal(captures, 2)
  assert.equal(camera.stops, 0)
  assert.equal(mic.stops, 1)
})

test('participantes: ocho alumnos mantienen una sola ficha de acciones y retiran la ficha de quien sale', async t => {
  const { tree, lastCall } = await render(t)
  await click(tree, 'Iniciar clase')
  const call = lastCall()
  const names = Array.from({ length: 8 }, (_, index) => `Alumno ${index} con nombre completo largo`)
  await act(async () => { call.state.room.students = names.map((name, index) => ({ peerId: `s${index}`, name, hand: index === 0 })); call.emit() })
  const list = tree.root.findByProps({ 'aria-label': 'Lista de participantes' })
  assert.equal(list.findAllByType('button').length, 8)
  assert.equal(button(tree, 'Dar la palabra'), undefined)
  await click(tree, `Seleccionar a ${names[0]}`)
  await click(tree, `Seleccionar a ${names[7]}`)
  const details = tree.root.findAll(node => typeof node.props['aria-label'] === 'string' && node.props['aria-label'].startsWith('Acciones para '))
  assert.equal(details.length, 1)
  assert.equal(details[0].props['aria-label'], `Acciones para ${names[7]}`)
  await act(async () => { call.state.room.students = call.state.room.students.filter(student => student.peerId !== 's7'); call.emit() })
  assert.equal(button(tree, 'Dar la palabra'), undefined)
})

test('audio: la salida elegida se aplica antes de reproducir la voz de la llamada', async t => {
  const { tree, lastCall, audioCalls } = await render(t)
  await click(tree, 'Iniciar clase')
  audioCalls.length = 0
  await act(async () => {
    lastCall().state.outputId = 'output-1'
    lastCall().state.remotes.set('a', { stream: { getVideoTracks: () => [] } })
    lastCall().emit()
  })
  assert.deepEqual(audioCalls.filter(([action]) => action !== 'pause'), [['sink', 'output-1'], ['play']])
  assert.ok(tree.root.findAllByType('audio').every(audio => !audio.props.autoPlay))
})

test('presentación: el alumno retira el video al finalizar y recupera la vista anterior', async t => {
  const { tree, lastCall } = await render(t, 'student')
  await click(tree, 'Entrar a clase')
  const call = lastCall()
  await act(async () => { call.state.remotes.set('t', { stream: { getVideoTracks: () => [] } }); call.state.room.teacherVideo = { source: 'screen', revision: 1 }; call.emit() })
  assert.equal(tree.root.findByProps({ 'aria-label': 'Videos de la clase' }).props['data-layout'], 'presentation')
  await act(async () => { call.state.room.teacherVideo = { source: 'off', revision: 2 }; call.emit() })
  assert.equal(tree.root.findByProps({ 'aria-label': 'Videos de la clase' }).props['data-layout'], 'focus')
  assert.ok(text(tree.root.findByProps({ 'aria-label': 'Videos de la clase' })).includes('Cámara apagada'))
  assert.equal(call.stops, 0)
  await act(async () => { call.state.room.teacherVideo = { source: 'camera', revision: 3 }; call.emit() })
  assert.equal(tree.root.findByProps({ 'aria-label': 'Videos de la clase' }).props['data-layout'], 'focus')
})
