/**
 * QQ 音乐签名与哈希测试（PLAN 阶段 4）。
 * 期望值由 QQMusicApi 仓库（luren-dc/QQMusicApi，Python）原算法在
 * 本机直接算出后钉死在测试里——参考实现不进仓库依赖。
 */

import { test } from 'node:test'
import assert from 'node:assert'
import { loadPlugin } from './harness.mjs'

test('插件加载与 _crypto 导出', async () => {
  const { plugin, manifest } = await loadPlugin('plugins/qqmusic')
  assert.equal(manifest.id, 'qqmusic')
  assert.equal(plugin.platform, 'qqmusic')
  assert.ok(plugin._crypto.hash33)
  assert.ok(plugin._crypto.zzcSign)
  assert.ok(plugin.n1ko.auth.createQr)
  assert.ok(plugin.n1ko.auth.checkQr)
})

test('hash33 与 Python 参考一致（含逐步取模等价性）', async () => {
  const { plugin } = await loadPlugin('plugins/qqmusic')
  // QQMusicApi utils/common.py hash33 在本机的输出
  assert.equal(plugin._crypto.hash33('AbCdEfGh1234567890==', 0), 1233592107)
  assert.equal(plugin._crypto.hash33('XYZtest', 5381), 1342019056)
})

test('zzcSign 与 Python 参考一致', async () => {
  const { plugin } = await loadPlugin('plugins/qqmusic')
  // QQMusicApi algorithms/sign.py zzc_sign 在本机的输出
  assert.equal(plugin._crypto.zzcSign('n1ko-test'), 'zzc6f9136btawaaowbawjdwin0rdll38zlk3ed3bfd5')
  assert.equal(plugin._crypto.zzcSign('{}'), 'zzcf8e26805gyafigxmxjehoe02mvsjjgtwzw6f1a05f9')
  assert.equal(
    plugin._crypto.zzcSign('{"comm":{"ct":24}}'),
    'zzce52634cbcpispnllkwa6oyvlivnkbgmhts353ac54b'
  )
  assert.match(plugin._crypto.zzcSign('x'), /^zzc[a-z0-9]+$/)
})

test('ptuiCB / query 参数解析（切分实现，纯逻辑）', async () => {
  const { plugin } = await loadPlugin('plugins/qqmusic')
  const args = plugin._crypto.parsePtuiArgs(`ptuiCB('66','0','0','0','二维码未失效。','')`)
  assert.deepEqual(args.slice(0, 2), ['66', '0'])
  assert.equal(plugin._crypto.parsePtuiArgs('garbage'), null)

  const redirect = 'https://graph.qq.com/oauth2.0/login_jump?code=ABC123&state=x'
  assert.equal(plugin._crypto.queryValue(redirect, 'code', null), 'ABC123')
  const login = 'https://x.com/check?ptsigx=SIG1&s_url=y&uin=12345&service=z'
  assert.equal(plugin._crypto.queryValue(login, 'ptsigx', 's_url'), 'SIG1')
  assert.equal(plugin._crypto.queryValue(login, 'uin', 'service'), '12345')
})
