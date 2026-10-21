import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

// AES-GCM cifra los tokens y verifica que no hayan sido modificados. La clave vive en .env.
export class TokenVault {
  constructor(hexKey) {
    if (!/^[a-f\d]{64}$/i.test(hexKey)) throw new Error('La clave de cifrado debe tener 64 caracteres hexadecimales.')
    this.key = Buffer.from(hexKey, 'hex')
  }

  seal(tokens) {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(tokens), 'utf8'), cipher.final()])
    return [iv, cipher.getAuthTag(), ciphertext].map(part => part.toString('base64url')).join('.')
  }

  open(value) {
    const [iv, tag, ciphertext] = value.split('.').map(part => Buffer.from(part, 'base64url'))
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv)
    decipher.setAuthTag(tag)
    return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'))
  }
}
