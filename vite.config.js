import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import os from 'os'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'floor796-encoding',
      configureServer(server) {
        server.middlewares.use('/floor796.html', (req, res, next) => {
          res.setHeader('Content-Type', 'text/html; charset=windows-1251')
          res.setHeader('Cache-Control', 'public, max-age=86400')
          next()
        })
      }
    }
  ],
  // Store cache outside Dropbox so Dropbox doesn't lock it on startup
  cacheDir: path.join(os.tmpdir(), 'rthm-vite-cache'),
  server: {
    proxy: {
      '/api': 'http://localhost:3001'
    }
  }
})
