import {
  createToken,
  decryptUsername,
  encryptUsername,
  hashPassword,
  hashUsername,
  verifyPassword,
} from './crypto.js'
import * as store from '../db/store.js'

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

const DEFAULT_ACCOUNTS = [
  { username: 'admin1', password: 'admin123' },
  { username: 'admin2', password: 'admin123' },
]

export async function ensureDefaultUsers() {
  for (const acc of DEFAULT_ACCOUNTS) {
    const usernameHash = hashUsername(acc.username)
    if (store.findUserByUsernameHash(usernameHash)) continue
    const passwordHash = await hashPassword(acc.password)
    store.createUser({
      usernameHash,
      usernameCipher: encryptUsername(acc.username),
      passwordHash,
    })
    console.log(`[auth] seeded user ${acc.username}`)
  }
}

export async function login(username, password) {
  const user = store.findUserByUsernameHash(hashUsername(username))
  if (!user) return { ok: false, message: '账号或密码错误' }
  const match = await verifyPassword(password, user.password_hash)
  if (!match) return { ok: false, message: '账号或密码错误' }

  const token = createToken()
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString()
  store.createAuthToken(user.id, token, expiresAt)

  const plainUsername = decryptUsername(user.username_cipher) || username
  return {
    ok: true,
    data: {
      token,
      expiresAt,
      user: { id: user.id, username: plainUsername },
    },
  }
}

export function logout(token) {
  if (token) store.deleteAuthToken(token)
}

export function resolveAuthToken(raw) {
  if (!raw) return null
  const token = String(raw).replace(/^Bearer\s+/i, '').trim()
  if (!token) return null
  const row = store.getAuthToken(token)
  if (!row) return null
  if (row.expires_at && Date.parse(row.expires_at) < Date.now()) {
    store.deleteAuthToken(token)
    return null
  }
  const username = decryptUsername(row.username_cipher)
  return {
    token,
    userId: row.user_id,
    username: username || `user-${row.user_id}`,
  }
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization
  const queryToken = req.query?.token
  const auth = resolveAuthToken(header || queryToken)
  if (!auth) {
    return res.status(401).json({ message: '未登录或登录已过期' })
  }
  req.auth = auth
  next()
}

export function getSessionOwned(sessionId, userId) {
  const session = store.getSession(sessionId)
  if (!session) return { error: '课程不存在', status: 404 }
  if (Number(session.user_id) !== Number(userId)) {
    return { error: '无权访问该课程', status: 403 }
  }
  return { session }
}
