import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ConfigProvider, App as AntApp } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { AuthProvider } from './auth/AuthContext'
import { RequireAuth } from './auth/RequireAuth'
import { AgentPage } from './pages/Agent'
import { ClassroomPage } from './pages/Classroom'
import { CoursesPage } from './pages/Courses'
import { LoginPage } from './pages/Login'
import { ReportPage } from './pages/Report'
import './App.css'

export default function App() {
  return (
    <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#0f6b5c', borderRadius: 8 } }}>
      <AntApp>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route element={<RequireAuth />}>
                <Route path="/" element={<AgentPage />} />
                <Route path="/courses" element={<CoursesPage />} />
                <Route path="/agent" element={<Navigate to="/" replace />} />
                <Route path="/classroom/:id" element={<ClassroomPage />} />
                <Route path="/report/:id" element={<ReportPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </AntApp>
    </ConfigProvider>
  )
}
