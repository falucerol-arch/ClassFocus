import { apiClient } from './apiClient'
import { academicService } from './academicService'
import { examService } from './examService'
import { storageService } from './storageService'

class DatabaseService {
  async refresh() {
    // Propaga los errores para distinguir «importado» de «no se pudo actualizar el panel».
    const data = await apiClient.bootstrap()
    academicService.hydrate(data.academic)
    examService.hydrate(data.exams)
    storageService.hydrate({ incidents: data.incidents, samples: data.samples })
    return data
  }

  async initialize() {
    if (!sessionStorage.getItem('classfocus_api_token')) return { online: false }
    try {
      const { user } = await apiClient.request('/auth/me')
      sessionStorage.setItem('classfocus_session', JSON.stringify(user))
      await this.refresh()
      return { online: true }
    } catch (error) {
      if (error.status === 401) {
        sessionStorage.removeItem('classfocus_api_token')
        sessionStorage.removeItem('classfocus_session')
        Object.keys(sessionStorage).filter(key => key.startsWith('classfocus_')).forEach(key => sessionStorage.removeItem(key))
        Object.keys(localStorage).filter(key => key.startsWith('classfocus_')).forEach(key => localStorage.removeItem(key))
      }
      return { online: false, error }
    }
  }
}

export const databaseService = new DatabaseService()
