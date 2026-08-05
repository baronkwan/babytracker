import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from '@appica/ui-react/providers/theme-provider'
import { ToastProvider, Toaster } from '@appica/ui-react/toast'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="light" enableSystem={false}>
      <ToastProvider>
        <App />
        <Toaster position="bottom-center" />
      </ToastProvider>
    </ThemeProvider>
  </StrictMode>,
)
