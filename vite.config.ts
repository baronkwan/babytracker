import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 5180,
    strictPort: true,
    allowedHosts: [
      'baron-mac-mini',
      'baronmacmini.local',
      '.ts.net',
      '100.64.206.45',
    ],
  },
  preview: {
    host: '0.0.0.0',
    port: 5180,
    strictPort: true,
    allowedHosts: [
      'baron-mac-mini',
      'baronmacmini.local',
      '.ts.net',
      '100.64.206.45',
    ],
  },
})
