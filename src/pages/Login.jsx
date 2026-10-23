import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldCheck, UserRound, Crown, ScanFace, BookOpenCheck, BarChart3, Sparkles } from 'lucide-react'
import { authService } from '../services/authService'
import ThemeToggle from '../components/ThemeToggle'
import BrandMark from '../components/BrandMark'

const ROLE_DATA = {
  student: { email: 'student@classfocus.com', icon: UserRound, label: 'Alumno', route: '/student' },
  teacher: { email: 'teacher@classfocus.com', icon: ShieldCheck, label: 'Maestro', route: '/teacher' },
  admin: { email: 'admin@classfocus.com', icon: Crown, label: 'Super Admin', route: '/admin' }
}

export default function Login() {
  const navigate = useNavigate()
  const [role, setRole] = useState('student')
  const [email, setEmail] = useState(ROLE_DATA.student.email)
  const [password, setPassword] = useState('123456')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const changeRole = next => {
    setRole(next)
    setEmail(ROLE_DATA[next].email)
    setError('')
  }

  const submit = async e => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const user = await authService.login(email, password, role)
      navigate(ROLE_DATA[user.role].route)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-theme"><ThemeToggle /></div>
      <div className="login-hero">
        <BrandMark large />
        <span className="hero-kicker">EDUCACIÓN · TECNOLOGÍA · SUPERVISIÓN</span>
        <h1>Una clase virtual con señales que sí puedes entender.</h1>
        <p>ClassFocus integra supervisión facial, métricas académicas y Google Classroom en una experiencia inspirada en la identidad visual de Universidad San Pablo de Guatemala.</p>
        <div className="feature-strip">
          <div><ScanFace size={20}/><span><strong>Atención</strong><small>MediaPipe en tiempo real</small></span></div>
          <div><BookOpenCheck size={20}/><span><strong>Classroom</strong><small>Cursos y alumnos</small></span></div>
          <div><BarChart3 size={20}/><span><strong>Métricas</strong><small>Panel para docentes</small></span></div>
        </div>
      </div>
      <form className="login-card" onSubmit={submit}>
        <div className="login-card-head"><span>ACCESO ACADÉMICO</span><h2>Bienvenido a ClassFocus</h2><p>Selecciona el perfil con el que deseas ingresar.</p></div>
        <div className="role-switch three">
          {Object.entries(ROLE_DATA).map(([key, item]) => {
            const Icon = item.icon
            return <button key={key} type="button" className={role === key ? 'active' : ''} onClick={() => changeRole(key)}><Icon size={18}/> {item.label}</button>
          })}
        </div>
        <label>Correo<input value={email} onChange={e => setEmail(e.target.value)} type="email" required /></label>
        <label>Contraseña<input value={password} onChange={e => setPassword(e.target.value)} type="password" required /></label>
        {error && <div className="alert error">{error}</div>}
        <button className="primary-button login-submit" type="submit" disabled={loading}>{loading ? 'Conectando…' : 'Ingresar a ClassFocus'}</button>
        <button className="secondary-button login-demo-link" type="button" onClick={() => navigate('/demo')}><Sparkles size={17}/> Probar la demo en vivo (sin iniciar sesión)</button>
        <div className="demo-box"><strong>Accesos demo</strong><span>Alumno · student@classfocus.com</span><span>Maestro · teacher@classfocus.com</span><span>Super Admin · admin@classfocus.com</span><span>Contraseña · 123456</span></div>
      </form>
    </div>
  )
}
