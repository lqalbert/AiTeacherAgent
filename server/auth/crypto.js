import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'

const SALT_ROUNDS = 10

function authSecret() {
  return process.env.AUTH_SECRET || 'aiteacher-agent-dev-secret-change-me'
}

/** 账号哈希：库中不存明文用户名，登录时用哈希匹配 */
export function hashUsername(username) {
  return crypto.createHash('sha256').update(String(username).trim().toLowerCase()).digest('hex')
}

export function encryptUsername(username) {
  const key = crypto.createHash('sha256').update(authSecret()).digest()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(String(username), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64')
}

export function decryptUsername(cipherText) {
  try {
    const buf = Buffer.from(String(cipherText), 'base64')
    const iv = buf.subarray(0, 12)
    const tag = buf.subarray(12, 28)
    const data = buf.subarray(28)
    const key = crypto.createHash('sha256').update(authSecret()).digest()
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

export async function hashPassword(password) {
  return bcrypt.hash(String(password), SALT_ROUNDS)
}

export async function verifyPassword(password, passwordHash) {
  return bcrypt.compare(String(password), String(passwordHash))
}

export function createToken() {
  return crypto.randomBytes(32).toString('hex')
}
