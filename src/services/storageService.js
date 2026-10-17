import { DEFAULT_METRICS } from '../data/mockData'
import { authService } from './authService'
import { apiClient } from './apiClient'

const LEGACY_INCIDENTS_KEY = 'classfocus_incidents'
const LEGACY_SAMPLES_KEY = 'classfocus_attention_samples'
const INCIDENTS_PREFIX = 'classfocus_incidents_v2_'
const SAMPLES_PREFIX = 'classfocus_attention_samples_v2_'

class StorageService {
  resolveStudentId(studentId) {
    if (studentId !== undefined && studentId !== null) return Number(studentId)
    const current = authService.getCurrentUser()
    return current?.role === 'student' ? Number(current.id) : 1
  }

  read(key, fallback = []) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback } catch { return fallback }
  }

  getIncidents(studentId, subjectId = 'all') {
    const id = this.resolveStudentId(studentId)
    const scopedKey = `${INCIDENTS_PREFIX}${id}`
    let items = this.read(scopedKey)

    if (!items.length && id === 1) items = this.read(LEGACY_INCIDENTS_KEY)
    if (subjectId && subjectId !== 'all') items = items.filter(item => item.subjectId === subjectId)
    return items
  }

  addIncident(incident, studentId) {
    const id = this.resolveStudentId(studentId)
    const key = `${INCIDENTS_PREFIX}${id}`
    const items = this.read(key)
    items.unshift(incident)
    localStorage.setItem(key, JSON.stringify(items.slice(0, 100)))
    apiClient.addIncident(id, incident).catch(() => {})
  }

  clearIncidents(studentId) {
    const id = this.resolveStudentId(studentId)
    localStorage.removeItem(`${INCIDENTS_PREFIX}${id}`)
  }

  getSamples(studentId, subjectId = 'all') {
    const id = this.resolveStudentId(studentId)
    const scopedKey = `${SAMPLES_PREFIX}${id}`
    let items = this.read(scopedKey)

    if (!items.length && id === 1) items = this.read(LEGACY_SAMPLES_KEY)
    if (subjectId && subjectId !== 'all') items = items.filter(item => item.subjectId === subjectId)
    return items
  }

  addSample(sample, studentId) {
    const id = this.resolveStudentId(studentId)
    const key = `${SAMPLES_PREFIX}${id}`
    const samples = this.read(key)
    samples.push(sample)
    localStorage.setItem(key, JSON.stringify(samples.slice(-240)))
    apiClient.addSample(id, sample).catch(() => {})
  }

  hydrate({ incidents = [], samples = [] } = {}) {
    const incidentsByStudent = new Map()
    incidents.forEach(item => {
      const id = Number(item.studentId)
      const arr = incidentsByStudent.get(id) || []
      arr.push({
        id: item.id,
        subjectId: item.subjectId,
        examId: item.examId,
        type: item.type,
        message: item.message,
        severity: item.severity,
        timestamp: item.timestamp
      })
      incidentsByStudent.set(id, arr)
    })
    for (const [studentId, rows] of incidentsByStudent) {
      localStorage.setItem(`${INCIDENTS_PREFIX}${studentId}`, JSON.stringify(rows.slice(0, 100)))
    }

    const samplesByStudent = new Map()
    samples.forEach(item => {
      const id = Number(item.studentId)
      const arr = samplesByStudent.get(id) || []
      arr.push({
        subjectId: item.subjectId,
        attention: Number(item.attention),
        expression: item.expression,
        gaze: item.gaze,
        label: item.label,
        timestamp: item.timestamp
      })
      samplesByStudent.set(id, arr)
    })
    for (const [studentId, rows] of samplesByStudent) {
      rows.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      localStorage.setItem(`${SAMPLES_PREFIX}${studentId}`, JSON.stringify(rows.slice(-240)))
    }
  }

  getMetrics(studentId, subjectId = 'all') {
    const incidents = this.getIncidents(studentId, subjectId)
    const samples = this.getSamples(studentId, subjectId)
    const average = samples.length
      ? Math.round(samples.reduce((sum, x) => sum + x.attention, 0) / samples.length)
      : DEFAULT_METRICS.attentionAverage

    return {
      ...DEFAULT_METRICS,
      attentionAverage: average,
      gazeAlerts: incidents.filter(x => x.type === 'gaze').length,
      tabChanges: incidents.filter(x => x.type === 'tab').length,
      faceAbsences: incidents.filter(x => x.type === 'no-face').length,
      fullscreenExits: incidents.filter(x => x.type === 'fullscreen').length,
      lastExpression: samples.at(-1)?.expression || DEFAULT_METRICS.lastExpression
    }
  }
}

export const storageService = new StorageService()
