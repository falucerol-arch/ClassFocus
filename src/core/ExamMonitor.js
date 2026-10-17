export class ExamMonitor {
  constructor({ onIncident }) {
    this.onIncident = onIncident
    this.cooldowns = new Map()
    this.handleVisibility = this.handleVisibility.bind(this)
    this.handleFullscreen = this.handleFullscreen.bind(this)
  }

  start() {
    document.addEventListener('visibilitychange', this.handleVisibility)
    document.addEventListener('fullscreenchange', this.handleFullscreen)
  }

  stop() {
    document.removeEventListener('visibilitychange', this.handleVisibility)
    document.removeEventListener('fullscreenchange', this.handleFullscreen)
  }

  handleVisibility() {
    if (document.hidden) this.emit('tab', 'Cambio de pestaña detectado', 'high', 0)
  }

  handleFullscreen() {
    if (!document.fullscreenElement) this.emit('fullscreen', 'Salida de pantalla completa', 'medium', 2500)
  }

  processFaceMetric(metric) {
    if (!metric) return
    if (!metric.hasFace) {
      this.emit('no-face', 'No se detecta el rostro', 'high', 7000)
      return
    }
    if (metric.attention < 55) {
      this.emit('gaze', `Mirada desviada: ${metric.gaze}`, 'medium', 7000)
    }
  }

  emit(type, message, severity, cooldown = 5000) {
    const now = Date.now()
    const last = this.cooldowns.get(type) || 0
    if (now - last < cooldown) return
    this.cooldowns.set(type, now)

    this.onIncident?.({
      id: crypto.randomUUID?.() || String(now),
      type,
      message,
      severity,
      timestamp: new Date().toISOString()
    })
  }
}
