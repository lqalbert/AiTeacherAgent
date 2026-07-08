import { execSync } from 'node:child_process'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getPids(port) {
  try {
    return execSync(`lsof -t -i :${port}`, { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(Number)
      .filter((n) => n > 0 && n !== process.pid)
  } catch {
    return []
  }
}

function killPids(pids, signal) {
  for (const pid of pids) {
    try {
      process.kill(pid, signal)
    } catch {
      // already gone
    }
  }
}

export async function freePort(port = '3200') {
  let pids = getPids(port)
  if (pids.length === 0) return

  killPids(pids, 'SIGTERM')
  await sleep(250)

  pids = getPids(port)
  if (pids.length > 0) {
    killPids(pids, 'SIGKILL')
    await sleep(150)
  }

  if (getPids(port).length === 0) {
    console.log(`[free-port] 已释放端口 ${port}`)
  }
}

const isCli = process.argv[1]?.endsWith('free-port.js')
if (isCli) {
  await freePort(process.argv[2] || '3200')
}
