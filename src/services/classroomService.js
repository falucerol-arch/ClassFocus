import { apiClient } from './apiClient'

// Google y sus credenciales se gestionan en Express. React solo recibe cuentas y cursos.
class ClassroomService {
  status() { return apiClient.request('/classroom/status') }

  async connect() {
    const { url } = await apiClient.request('/classroom/authorize', { method: 'POST' })
    window.location.assign(url)
  }

  listCourses(connectionId) {
    return apiClient.request(`/classroom/${encodeURIComponent(connectionId)}/courses`)
  }

  importCourse(connectionId, courseId) {
    return apiClient.request(`/classroom/${encodeURIComponent(connectionId)}/courses/${encodeURIComponent(courseId)}/import`, { method: 'POST' })
  }

  disconnect(connectionId) {
    return apiClient.request(`/classroom/${encodeURIComponent(connectionId)}`, { method: 'DELETE' })
  }
}

export const classroomService = new ClassroomService()
