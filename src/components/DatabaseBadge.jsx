import { useEffect, useState } from 'react'
import { Database } from 'lucide-react'
import { apiClient } from '../services/apiClient'

export default function DatabaseBadge() {
  const [state, setState] = useState(() => window.__CLASSFOCUS_DB_STATUS__ || { status: 'checking', detail: 'Comprobando PostgreSQL' })

  useEffect(() => {
    const listener = event => setState(event.detail)
    window.addEventListener('classfocus-db-status', listener)
    apiClient.health().catch(() => {})
    return () => window.removeEventListener('classfocus-db-status', listener)
  }, [])

  const label = state.status === 'online' ? 'PostgreSQL' : state.status === 'offline' ? 'Modo local' : 'Base de datos'
  return (
    <div className={`db-badge ${state.status}`} title={state.detail || label}>
      <Database size={15} />
      <span>{label}</span>
      <i aria-hidden="true" />
    </div>
  )
}
