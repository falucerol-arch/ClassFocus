import { apiClient } from './apiClient'
import { academicService } from './academicService'
import { examService } from './examService'
import { storageService } from './storageService'

class DatabaseService {
  async initialize() {
    try {
      const data = await apiClient.bootstrap()
      academicService.hydrate(data.academic)
      examService.hydrate(data.exams)
      storageService.hydrate({ incidents: data.incidents, samples: data.samples })
      return { online: true }
    } catch (error) {
      console.warn('ClassFocus continuará en modo local porque PostgreSQL no respondió:', error.message)
      return { online: false, error }
    }
  }
}

export const databaseService = new DatabaseService()
