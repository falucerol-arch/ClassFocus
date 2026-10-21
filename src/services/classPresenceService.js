import { signalingUrl } from './signalingUrl.js'

// Observa las clases sin entrar a una sala ni solicitar cámara o micrófono.
export class ClassPresence {
  constructor({ token, onState, onStarted, Socket = globalThis.WebSocket,
    url = signalingUrl, schedule = setTimeout, cancel = clearTimeout }) {
    Object.assign(this, { token, onState, onStarted, Socket, url })
    // Window exige su propio contexto; invocar setTimeout como método de esta clase falla.
    this.schedule = (...args) => schedule.call(globalThis, ...args)
    this.cancel = (...args) => cancel.call(globalThis, ...args)
    this.known = new Map()
    this.delay = 1000
    this.received = false
  }
  start() {
    if (this.closed || this.socket) return
    this.onState({ status: 'connecting', classes: [] })
    let socket
    try { socket = new this.Socket(this.url()) }
    catch { this.disconnected(); return }
    this.socket = socket
    this.timeout = this.schedule(() => {
      if (this.socket !== socket || this.closed) return
      socket.close()
      this.disconnected(socket)
    }, 10000)
    socket.onopen = () => {
      if (!this.closed && this.socket === socket && !this.terminal) socket.send(JSON.stringify({ type: 'authenticate', token: this.token }))
    }
    socket.onmessage = ({ data }) => {
      if (this.closed || this.socket !== socket) return
      try {
        const message = JSON.parse(data)
        if (message.type === 'authenticated') socket.send(JSON.stringify({ type: 'watch' }))
        if (message.type === 'classes') {
          if (!Array.isArray(message.classes)) throw new Error('Respuesta inválida')
          this.cancel(this.timeout)
          this.delay = 1000
          const current = new Map(message.classes.map(item => [item.subjectId, item]))
          const started = message.classes.filter(item => this.known.get(item.subjectId)?.instanceId !== item.instanceId)
          this.onState({ status: 'online', classes: message.classes })
          // Abrir el panel muestra las clases existentes; el aviso es para nuevas aperturas.
          if (this.received) started.forEach(item => this.onStarted?.(item))
          this.known = current
          this.received = true
        }
        if (message.type === 'error' || message.type === 'ended') {
          this.terminal = true
          this.cancel(this.timeout)
          this.onState({ status: 'unauthorized', classes: [], message: message.message })
          socket.close()
        }
      } catch { socket.close(); this.disconnected(socket) }
    }
    socket.onerror = () => { socket.close(); this.disconnected(socket) }
    socket.onclose = ({ code }) => {
      if (this.closed || this.socket !== socket || this.terminal) return
      if (code === 4001 || code === 4003) {
        this.terminal = true
        this.cancel(this.timeout)
        this.onState({ status: 'unauthorized', classes: [], message: 'Inicia sesión nuevamente para consultar las clases.' })
      } else this.disconnected(socket)
    }
  }
  disconnected(socket) {
    if (this.closed || this.terminal || (socket && this.socket !== socket)) return
    this.cancel(this.timeout)
    this.socket = null
    this.onState({ status: 'offline', classes: [] })
    // Un único temporizador por caída. No conserva como activa una clase sin confirmar.
    this.cancel(this.retry)
    this.retry = this.schedule(() => this.start(), this.delay)
    this.delay = Math.min(this.delay * 2, 15000)
  }
  stop() {
    if (this.closed) return
    this.closed = true
    this.cancel(this.retry)
    this.cancel(this.timeout)
    this.socket?.close()
    this.socket = null
    this.known.clear()
  }
}
