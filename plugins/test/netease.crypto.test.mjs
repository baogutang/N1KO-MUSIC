/**
 * 网易云 weapi/eapi 加密对照测试（PLAN 阶段 3）：
 * 用临时目录安装的参考包（@neteasecloudmusicapienhanced/api，不进仓库依赖）
 * 逐字段比对移植实现。参考包没装时（CI）整文件跳过。
 *
 *   mkdir -p /tmp/ncm-ref && cd /tmp/ncm-ref && npm i @neteasecloudmusicapienhanced/api
 *   NCM_REF_DIR=/tmp/ncm-ref npm run test:plugins
 */

import { test } from 'node:test'
import assert from 'node:assert'
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import { loadPlugin } from './harness.mjs'

const REF_DIR = process.env.NCM_REF_DIR || '/tmp/ncm-ref'
const hasRef = fs.existsSync(path.join(REF_DIR, 'node_modules', '@neteasecloudmusicapienhanced', 'api', 'util', 'crypto.js'))
const refRequire = createRequire(path.join(REF_DIR, 'package.json'))

test('插件加载与 _crypto 导出', async () => {
  const { plugin, manifest } = await loadPlugin('plugins/netease')
  assert.equal(manifest.id, 'netease')
  assert.equal(plugin.platform, 'netease')
  assert.ok(plugin._crypto.weapi)
  assert.ok(plugin._crypto.eapi)
})

test('modPow 与原生 BigInt 幂模一致', async () => {
  const { plugin } = await loadPlugin('plugins/netease')
  // modPow 没有直接导出——经 encSecKey 间接验证（见 weapi 对照），
  // 这里先用 eapi 的确定性做个冒烟：同输入同输出
  const a = plugin._crypto.eapi('/api/x', { hello: '世界' })
  const b = plugin._crypto.eapi('/api/x', { hello: '世界' })
  assert.equal(a.params, b.params)
  assert.match(a.params, /^[0-9A-F]+$/)
})

/**
 * encSecKey 的定长性（不依赖参考包）。
 *
 * 裸 RSA 的密文恒为 128 字节，但 BigInt.toString(16) 会吃掉高位的零字节。
 * 随机密钥里约 1/16 会撞上前导零，服务端解不开就回空体——表现为
 * 「搜索偶尔一次没结果」的间歇故障。所以这里要同时断言两件事：
 * 1) 任何密钥下 encSecKey 都是 256 个十六进制字符；
 * 2) 用到的密钥里**确实**出现过前导零（否则这条测试等于没测）。
 *
 * 密钥用固定种子的 LCG 生成，结果确定可复现。
 */
test('encSecKey 恒为 256 位 hex（前导零必须补齐）', async () => {
  const { plugin } = await loadPlugin('plugins/netease')
  const seededRand = (seed) => {
    let state = seed >>> 0
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      return state % 62
    }
  }

  let leadingZero = 0
  for (let seed = 1; seed <= 200; seed++) {
    const { encSecKey } = plugin._crypto.weapi({ s: 'test', type: 1 }, seededRand(seed))
    assert.equal(encSecKey.length, 256, `seed ${seed} 的 encSecKey 不是 256 位：${encSecKey.length}`)
    assert.match(encSecKey, /^[0-9a-f]{256}$/, `seed ${seed} 的 encSecKey 不是小写 hex`)
    if (encSecKey[0] === '0') leadingZero += 1
  }
  assert.ok(leadingZero > 0, '200 个密钥里一个前导零都没撞上——这条测试没有真的覆盖补零')
})

test('weapi/eapi 与参考实现逐字段一致', { skip: !hasRef }, async () => {
  const ref = refRequire('@neteasecloudmusicapienhanced/api/util/crypto.js')
  const forge = refRequire('node-forge')
  const { plugin } = await loadPlugin('plugins/netease')

  // ---- eapi：完全确定性，直接全等 ----
  for (const [url, obj] of [
    ['/api/cloudsearch/pc', { s: '海阔天空', type: 1, limit: 30, offset: 0 }],
    ['/api/toplist', {}],
    ['/api/song/lyric/v1', { id: 347230, cp: false, tv: 0, lv: 0, rv: 0, kv: 0, yv: 0, ytv: 0, yrv: 0 }],
  ]) {
    assert.deepEqual(plugin._crypto.eapi(url, obj), ref.eapi(url, obj), `eapi ${url}`)
  }

  // ---- weapi：固定 secretKey 后逐字段比对 ----
  const fixedKey = 'abcdefghijklmnop'
  let cursor = 0
  const rand = () => {
    const idx = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.indexOf(fixedKey[cursor])
    cursor += 1
    return idx
  }
  const payload = { csrf_token: '', e_r: false, s: 'summer', type: 1 }
  const mine = plugin._crypto.weapi(payload, rand)
  assert.equal(cursor, 16, 'secretKey 取了 16 个字符')

  // params：双重 AES-CBC，参考侧用导出的 aesEncrypt 复算
  const text = JSON.stringify(payload)
  const iv = '0102030405060708'
  const inner = ref.aesEncrypt(text, 'cbc', '0CoJUm6Qyw8W8jud', iv)
  assert.equal(mine.params, ref.aesEncrypt(inner, 'cbc', fixedKey, iv), 'weapi params')

  // encSecKey：裸 RSA（forge NONE padding）加密反转后的 secretKey
  const pem = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB
-----END PUBLIC KEY-----`
  const expected = forge.util.bytesToHex(
    forge.pki.publicKeyFromPem(pem).encrypt(fixedKey.split('').reverse().join(''), 'NONE')
  )
  assert.equal(mine.encSecKey, expected, 'weapi encSecKey（原生 BigInt 模幂 vs node-forge）')
})
