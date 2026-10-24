import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

// Se prueba el servicio real con un DOM mínimo: el navegador debe navegar, no hacer fetch.
const built = await build({
  entryPoints: ['src/services/classroomService.js'], bundle: true, write: false,
  format: 'esm', platform: 'browser',
  define: { 'import.meta.env': JSON.stringify({ VITE_API_URL: 'https://classfocus-api.onrender.com/api' }) }
})
const { classroomService } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`)

function browser(t, token, submitError) {
  const previous = new Map()
  const nodes = []
  let removed = 0, submitted = 0
  const document = {
    createElement(tag) {
      const node = { tag, children: [], appendChild(child) { this.children.push(child) },
        submit() { submitted++; if (submitError) throw submitError }, remove() { removed++ } }
      nodes.push(node)
      return node
    },
    body: { appendChild() {} }
  }
  for (const [key, value] of Object.entries({ document, sessionStorage: { getItem: () => token } })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { value, configurable: true })
  }
  t.after(() => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  return { nodes, removed: () => removed, submitted: () => submitted }
}

test('Classroom: navega por POST a la API sin poner la sesión en la URL', async t => {
  const token = 'private-session-token'
  const state = browser(t, token)
  await classroomService.connect()
  const form = state.nodes.find(node => node.tag === 'form')
  assert.equal(form.method, 'POST')
  assert.equal(form.target, '_self')
  assert.equal(form.action, 'https://classfocus-api.onrender.com/api/classroom/launch')
  assert.equal(form.hidden, true)
  assert.equal(form.children[0].name, 'sessionToken')
  assert.equal(form.children[0].value, token)
  assert.ok(!form.action.includes(token))
  assert.equal(state.submitted(), 1)
  assert.equal(state.removed(), 1)
})

test('Classroom: sin sesión no crea ni envía el formulario', async t => {
  const state = browser(t, null)
  await assert.rejects(classroomService.connect(), /Inicia sesión nuevamente/)
  assert.equal(state.nodes.length, 0)
})

test('Classroom: retira el formulario incluso si el navegador impide enviarlo', async t => {
  const state = browser(t, 'session', new Error('Navegación bloqueada'))
  await assert.rejects(classroomService.connect(), /Navegación bloqueada/)
  assert.equal(state.removed(), 1)
})
