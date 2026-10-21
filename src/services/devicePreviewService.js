// La previa es local: no crea conexiones ni envía audio/video al servidor.
export class DevicePreview {
  constructor({ onChange, mediaDevices = globalThis.navigator?.mediaDevices,
    Context = globalThis.AudioContext || globalThis.webkitAudioContext, audioFactory = () => new Audio() }) {
    Object.assign(this, { onChange, mediaDevices, Context, audioFactory })
    this.devices = []; this.cameraId = ''; this.microphoneId = ''; this.outputId = ''
    this.revisions = { camera: 0, microphone: 0 }
    this.changed = () => { this.refresh().catch(() => {}) }
    mediaDevices?.addEventListener?.('devicechange', this.changed)
  }
  notify() {
    if (!this.closed) this.onChange({ camera: this.camera || null, microphone: !!this.microphone,
      devices: this.devices, cameraId: this.cameraId, microphoneId: this.microphoneId, outputId: this.outputId,
      meterAvailable: !!this.analyser, level: this.level || 0 })
  }
  async refresh() {
    const devices = await this.mediaDevices?.enumerateDevices?.()
    if (this.closed) return
    if (devices) this.devices = devices.map(({ deviceId, kind, label }) => ({ deviceId, kind, label }))
    this.notify()
  }
  release(stream) {
    stream?.getTracks().forEach(track => { track.onended = null; track.stop() })
  }
  async enable(kind, enabled) {
    if (this.closed || this.transferred) throw new Error('La previa ya está cerrada.')
    const revision = ++this.revisions[kind]
    if (!enabled) {
      if (kind === 'microphone') this.stopMeter()
      this.release(this[kind]); this[kind] = null; this.notify(); return
    }
    if (!this.mediaDevices?.getUserMedia) throw new Error('Abre la app en localhost o HTTPS con un navegador compatible.')
    const id = kind === 'camera' ? this.cameraId : this.microphoneId
    const selected = id ? { deviceId: { exact: id } } : {}
    const stream = await this.mediaDevices.getUserMedia(kind === 'camera'
      ? { video: { width: { ideal: 640 }, height: { ideal: 360 }, ...selected }, audio: false }
      : { audio: { echoCancellation: true, noiseSuppression: true, ...selected }, video: false })
    // Cerrar la página o cambiar de selección durante el permiso no deja capturas huérfanas.
    if (this.closed || this.transferred || revision !== this.revisions[kind]) { this.release(stream); return }
    if (kind === 'microphone') this.stopMeter()
    this.release(this[kind]); this[kind] = stream
    stream.getTracks().forEach(track => { track.onended = () => { this.enable(kind, false).catch(() => {}) } })
    if (kind === 'microphone') this.startMeter(stream)
    this.notify()
    // enumerateDevices puede fallar sin invalidar una cámara o micrófono ya concedidos.
    this.refresh().catch(() => {})
  }
  async select(kind, id) {
    const key = `${kind}Id`, previous = this[key]
    this[key] = id
    try { if (this[kind]) await this.enable(kind, true); else this.notify() }
    catch (error) { this[key] = previous; this.notify(); throw error }
  }
  startMeter(stream) {
    if (!this.Context) return
    try {
      this.context = new this.Context()
      this.context.resume?.().catch(() => {})
      this.source = this.context.createMediaStreamSource(stream)
      this.analyser = this.context.createAnalyser()
      this.analyser.fftSize = 256
      // No conectar al destino: el usuario ve el nivel, pero no oye su voz con eco.
      this.source.connect(this.analyser)
      const buffer = new Uint8Array(this.analyser.fftSize)
      this.meterTimer = setInterval(() => {
        if (this.closed || !this.analyser) return
        this.analyser.getByteTimeDomainData(buffer)
        const rms = Math.sqrt(buffer.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / buffer.length)
        this.level = Math.min(100, Math.round(rms * 350))
        this.notify()
      }, 100)
    } catch { this.stopMeter() }
  }
  stopMeter() {
    clearInterval(this.meterTimer)
    this.source?.disconnect()
    this.context?.close().catch(() => {})
    this.context = this.source = this.analyser = null
    this.level = 0
  }
  async testSpeaker(outputId = '') {
    this.stopSpeaker()
    this.outputId = outputId
    const audio = this.audioFactory()
    this.speaker = audio
    audio.src = testTone()
    if (outputId && audio.setSinkId) await audio.setSinkId(outputId)
    if (this.closed || this.transferred || this.speaker !== audio) { audio.pause(); return }
    await audio.play()
    this.notify()
  }
  stopSpeaker() { this.speaker?.pause(); this.speaker = null }
  takeForCall(role) {
    if (this.closed || this.transferred) return {}
    this.transferred = true
    this.revisions.camera++; this.revisions.microphone++
    this.stopMeter(); this.stopSpeaker()
    const result = { camera: this.camera, microphone: role === 'teacher' ? this.microphone : null,
      cameraId: this.cameraId, microphoneId: this.microphoneId, outputId: this.outputId }
    // El alumno siempre entra silenciado aunque haya probado el micrófono en la previa.
    if (role !== 'teacher') this.release(this.microphone)
    for (const stream of [result.camera, result.microphone]) stream?.getTracks().forEach(track => { track.onended = null })
    this.camera = this.microphone = null
    return result
  }
  stop() {
    if (this.closed) return
    this.closed = true
    this.revisions.camera++; this.revisions.microphone++
    this.mediaDevices?.removeEventListener?.('devicechange', this.changed)
    this.stopMeter(); this.stopSpeaker()
    this.release(this.camera); this.release(this.microphone)
    this.camera = this.microphone = null
  }
}

// Un tono breve generado aquí, sin descargar archivos ni grabar la voz del usuario.
function testTone() {
  const rate = 22050, count = Math.round(rate * .35), buffer = new ArrayBuffer(44 + count * 2)
  const view = new DataView(buffer)
  const word = (at, value) => [...value].forEach((letter, index) => view.setUint8(at + index, letter.charCodeAt(0)))
  word(0, 'RIFF'); view.setUint32(4, 36 + count * 2, true); word(8, 'WAVE'); word(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  word(36, 'data'); view.setUint32(40, count * 2, true)
  for (let i = 0; i < count; i++) view.setInt16(44 + i * 2, Math.round(Math.sin(i * 2 * Math.PI * 660 / rate) * Math.sin(Math.PI * i / count) * 2600), true)
  let binary = ''
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte)
  return `data:audio/wav;base64,${btoa(binary)}`
}
