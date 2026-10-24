import { apiClient } from './apiClient'

// Google y sus credenciales se gestionan en Express. React solo recibe cuentas y cursos.
class ClassroomService {
  status() { return apiClient.request('/classroom/status') }

  async connect() {
    const token = sessionStorage.getItem('classfocus_api_token')
    if (!token) throw new Error('Inicia sesión nuevamente para conectar Google Classroom.')

    // Una navegación real permite crear la cookie de seguridad en el sitio de la API.
    // fetch entre dominios con SameSite=Lax puede perderla. No se envía el token en la URL.
    const form = document.createElement('form')
    form.method = 'POST'
    form.target = '_self'
    form.action = `${apiClient.baseUrl}/classroom/launch`
    form.hidden = true
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = 'sessionToken'
    input.value = token
    form.appendChild(input)
    document.body.appendChild(form)
    try { form.submit() } finally { form.remove() }
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
