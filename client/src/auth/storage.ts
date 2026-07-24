const TOKEN_KEY = 'aiteacher_token'

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage
  } catch {
    return null
  }
}

function sessionFallback(): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.sessionStorage
  } catch {
    return null
  }
}

export function getStoredToken() {
  try {
    return storage()?.getItem(TOKEN_KEY) || sessionFallback()?.getItem(TOKEN_KEY) || null
  } catch {
    return null
  }
}

export function setStoredToken(token: string) {
  const local = storage()
  if (local) {
    try {
      local.setItem(TOKEN_KEY, token)
      return
    } catch {
      /* 隐私模式等：回退 sessionStorage */
    }
  }
  const session = sessionFallback()
  if (session) {
    session.setItem(TOKEN_KEY, token)
    return
  }
  throw new Error('浏览器禁止本地存储，无法保持登录，请关闭无痕模式后重试')
}

export function clearStoredToken() {
  try {
    storage()?.removeItem(TOKEN_KEY)
  } catch {
    /* ignore */
  }
  try {
    sessionFallback()?.removeItem(TOKEN_KEY)
  } catch {
    /* ignore */
  }
}

export { TOKEN_KEY }
