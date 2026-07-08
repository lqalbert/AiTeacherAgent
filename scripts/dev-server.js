import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { freePort } from './free-port.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const port = process.env.PORT || '3200'

await freePort(String(port))

const child = spawn('node', ['--watch', 'server/index.js'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, PORT: String(port) },
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})

process.on('SIGINT', () => child.kill('SIGINT'))
process.on('SIGTERM', () => child.kill('SIGTERM'))
