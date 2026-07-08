import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, rootDir, '')
  const serverPort = Number(env.PORT) || 3200

  return {
    plugins: [react()],
    define: {
      'import.meta.env.VITE_SERVER_PORT': JSON.stringify(String(serverPort)),
    },
    server: {
      port: 5173,
      proxy: {
        '/api': { target: `http://localhost:${serverPort}`, changeOrigin: true },
        '/uploads': { target: `http://localhost:${serverPort}`, changeOrigin: true },
        '/ws': { target: `ws://localhost:${serverPort}`, ws: true },
      },
    },
  }
})
