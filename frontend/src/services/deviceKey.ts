/**
 * 设备密钥：只存在于这台设备上、且**取不出来**的一把 AES-GCM 密钥。
 *
 * 服务器凭据（Subsonic 的 token/salt、Jellyfin 的 AccessToken）此前是明文躺在
 * localStorage 里的。任何一次能读到 localStorage 的机会——把浏览器配置目录拷走、
 * 一次性的 XSS 外传、共用电脑上顺手开一下 DevTools——拿到的就是可以直接拉流的凭据。
 *
 * 这里生成一把 `extractable: false` 的密钥放进 IndexedDB：
 * 浏览器只把它交给 Web Crypto 用来加解密，页面脚本无论如何也导不出密钥材料，
 * 各家浏览器落盘时还会再用自己管理的密钥把它包一层。于是
 *   - 把配置目录整个拷到另一台机器：解不开；
 *   - 一次性 dump localStorage：拿到的是密文；
 * 这两类被动攻击就不成立了。
 *
 * 说清楚它挡不住什么：**正在页面里执行的**恶意脚本可以直接调用同一把密钥去解密。
 * 纯前端应用没有任何办法防住这一点，本文件不假装能防。
 */

const DB_NAME = 'n1ko-music-keys'
const DB_VERSION = 1
const STORE = 'keys'
const KEY_ID = 'credential-key'
/** AES-GCM 的 nonce 长度，规范推荐 12 字节 */
const IV_BYTES = 12

function supported(): boolean {
  return typeof indexedDB !== 'undefined'
    && typeof crypto !== 'undefined'
    && !!crypto.subtle
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function idbGet(db: IDBDatabase, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function idbPut(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** 同一个页面里只解析一次，之后共用同一个 Promise */
let keyPromise: Promise<CryptoKey | null> | null = null

export function getDeviceKey(): Promise<CryptoKey | null> {
  if (keyPromise) return keyPromise
  keyPromise = (async () => {
    if (!supported()) return null
    try {
      const db = await openDb()
      const existing = await idbGet(db, KEY_ID)
      if (existing instanceof CryptoKey) {
        db.close()
        return existing
      }
      // extractable: false —— 这是整套方案的地基，改成 true 就等于没加密
      const key = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      )
      await idbPut(db, KEY_ID, key)
      db.close()
      return key
    } catch (error) {
      // 无痕模式、IndexedDB 被禁用、配额耗尽：退回明文并说明原因，
      // 而不是让用户连不上自己的服务器
      console.warn('[secure] 设备密钥不可用，凭据将以明文保存：', error)
      return null
    }
  })()
  return keyPromise
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** 密文的外形，iv 每次都新生成——AES-GCM 重用 nonce 会直接毁掉安全性 */
export interface SealedText {
  iv: string
  data: string
}

export async function sealText(plain: string): Promise<SealedText | null> {
  const key = await getDeviceKey()
  if (!key) return null
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plain)
  )
  return { iv: toBase64(iv), data: toBase64(new Uint8Array(cipher)) }
}

export async function openText(sealed: SealedText): Promise<string | null> {
  const key = await getDeviceKey()
  if (!key) return null
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(sealed.iv) },
      key,
      fromBase64(sealed.data)
    )
    return new TextDecoder().decode(plain)
  } catch {
    // 换了设备、清过 IndexedDB、或者密文被改过：当作没有凭据，
    // 用户重新登录一次即可，不能因此白屏
    return null
  }
}

/** 仅供测试重置模块级缓存 */
export function resetDeviceKeyCache(): void {
  keyPromise = null
}
