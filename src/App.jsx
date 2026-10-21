import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Database } from 'lucide-react'
import Login from './pages/Login'
import StudentDashboard from './pages/StudentDashboard'
import TeacherDashboard from './pages/TeacherDashboard'
import AdminDashboard from './pages/AdminDashboard'
import ExamPage from './pages/ExamPage'
import ClassSession from './pages/ClassSession'
import { authService } from './services/authService'
import { databaseService } from './services/databaseService'

const HOME_BY_ROLE = {
  student: '/student',
  teacher: '/teacher',
  admin: '/admin'
}

function ProtectedRoute({ role, children }) {
  const user = authService.getCurrentUser()
  if (!user) return <Navigate to="/" replace />
  if (role && user.role !== role) return <Navigate to={HOME_BY_ROLE[user.role] || '/'} replace />
  return children
}

export default function App() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    databaseService.initialize().finally(() => setReady(true))
  }, [])

  if (!ready) {
    return (
      <div className="database-loading">
        <Database size={34} />
        <strong>Conectando ClassFocus</strong>
        <span>Sincronizando datos con PostgreSQL…</span>
      </div>
    )
  }

  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/student" element={<ProtectedRoute role="student"><StudentDashboard /></ProtectedRoute>} />
      <Route path="/student/class" element={<ProtectedRoute role="student"><ClassSession /></ProtectedRoute>} />
      <Route path="/student/exam" element={<ProtectedRoute role="student"><ExamPage /></ProtectedRoute>} />
      <Route path="/teacher/class" element={<ProtectedRoute role="teacher"><ClassSession /></ProtectedRoute>} />
      <Route path="/teacher" element={<ProtectedRoute role="teacher"><TeacherDashboard /></ProtectedRoute>} />
      <Route path="/admin" element={<ProtectedRoute role="admin"><AdminDashboard /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
