import { academicService } from './academicService'
import { apiClient } from './apiClient'

const SESSION_KEY = 'classfocus_session'

class AuthService {
  async login(email, password, role) {
    try {
      const result = await apiClient.login({ email, password, role })
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(result.user))
      return result.user
    } catch (error) {
      if (error.status === 401) throw error
      const user = academicService.getUsers().find(
        item => item.email.toLowerCase() === email.toLowerCase() && item.password === password && item.role === role
      )
      if (!user) throw new Error('Credenciales incorrectas o rol inválido.')
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(user))
      return user
    }
  }

  logout() {
    sessionStorage.removeItem(SESSION_KEY)
  }

  getCurrentUser() {
    try {
      return JSON.parse(sessionStorage.getItem(SESSION_KEY))
    } catch {
      return null
    }
  }
}

export const authService = new AuthService()
