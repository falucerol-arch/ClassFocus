import { apiClient } from './apiClient'
import { databaseService } from './databaseService'

const SESSION_KEY = 'classfocus_session'
const TOKEN_KEY = 'classfocus_api_token'

class AuthService {
  clearCache() {
    // Al cambiar de usuario no deben quedar matrículas ni métricas de la sesión anterior.
    // sessionStorage aísla la caché de cada pestaña y permite probar maestro/alumno por separado.
    Object.keys(sessionStorage).filter(key => key.startsWith('classfocus_') && key !== SESSION_KEY && key !== TOKEN_KEY).forEach(key => sessionStorage.removeItem(key))
    Object.keys(localStorage).filter(key => key.startsWith('classfocus_')).forEach(key => localStorage.removeItem(key))
  }

  async login(email, password, role) {
    const result = await apiClient.login({ email, password, role })
    this.clearCache()
    sessionStorage.setItem(TOKEN_KEY, result.token)
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(result.user))
    try {
      // Los paneles se abren con datos confirmados por la API, nunca con una importación demo.
      await databaseService.refresh()
      return result.user
    } catch (error) {
      sessionStorage.removeItem(TOKEN_KEY)
      sessionStorage.removeItem(SESSION_KEY)
      throw error
    }
  }

  async logout() {
    try { await apiClient.request('/auth/logout', { method: 'POST' }) } catch { /* La sesión remota también vence por tiempo. */ }
    sessionStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(SESSION_KEY)
    this.clearCache()
  }

  getCurrentUser() {
    try {
      if (!sessionStorage.getItem(TOKEN_KEY)) return null
      return JSON.parse(sessionStorage.getItem(SESSION_KEY))
    } catch { return null }
  }
}

export const authService = new AuthService()
