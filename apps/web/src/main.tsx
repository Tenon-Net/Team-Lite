import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ConfigProvider } from '@arco-design/web-react'
import zhCN from '@arco-design/web-react/es/locale/zh-CN'
import '@arco-design/web-react/dist/css/arco.css'
import './i18n'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from '@/renderer/hooks/context/AuthContext'
import { LayoutProvider } from '@/renderer/hooks/context/LayoutContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider locale={zhCN}>
      <BrowserRouter>
        <AuthProvider>
          <LayoutProvider>
            <App />
          </LayoutProvider>
        </AuthProvider>
      </BrowserRouter>
    </ConfigProvider>
  </StrictMode>,
)
