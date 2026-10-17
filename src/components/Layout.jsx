import { LogOut } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { authService } from '../services/authService'
import ThemeToggle from './ThemeToggle'
import BrandMark from './BrandMark'
import DatabaseBadge from './DatabaseBadge'

const ROLE_LABELS = {
  student: 'Alumno',
  teacher: 'Maestro',
  admin: 'Super Admin'
}

export default function Layout({ children, title, subtitle }) {
  const navigate = useNavigate()
  const user = authService.getCurrentUser()

  const logout = () => {
    authService.logout()
    navigate('/')
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <BrandMark />
        <div className="topbar-actions">
          <DatabaseBadge />
          <ThemeToggle compact />
          <div className="topbar-user">
            <div><strong>{user?.name}</strong><small>{ROLE_LABELS[user?.role] || 'Usuario'}</small></div>
            <button className="icon-button" onClick={logout} title="Cerrar sesión"><LogOut size={19} /></button>
          </div>
        </div>
      </header>
      <main className="content-wrap">
        <section className="page-head">
          <div><span className="eyebrow">CLASSFOCUS · UNIVERSIDAD</span><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
        </section>
        {children}
      </main>
    </div>
  )
}
