import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // expose on LAN so you can test on a real phone
    port: 6066,
    proxy: {
      // forward API + media (DB-stored files) to the Phase 2 backend in dev
      '/api': 'http://localhost:8787',
      '/uploads': 'http://localhost:8787',
      '/media': 'http://localhost:8787',
    },
  },
})
