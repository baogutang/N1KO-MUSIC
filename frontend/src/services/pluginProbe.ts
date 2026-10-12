/**
 * 插件用户探测的唯一实现（阶段 4.4）。
 *
 * 此前 5 处各写一遍（超时分别 无 / 4s 判 null / 4s 判 timeout / 6s），
 * setTimeout 都不清——探针结果晚到时覆盖新状态。合成一个入口：
 * - ok：getUser 返回了用户（凭据有效）
 * - expired：插件按协议报 unauthorized（凭据失效）
 * - unknown：超时/网络/其他——不猜
 */
import type { PluginHost } from '@/plugins/host/PluginHost'
import { PluginCallError } from '@/plugins/host/PluginHost'

export type PluginProbeResult = 'ok' | 'expired' | 'unknown'

export async function probePluginUser(
  host: PluginHost,
  timeoutMs = 5000
): Promise<PluginProbeResult> {
  if (!host.hasMethod('n1ko.auth.getUser')) return 'unknown'
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    const verdict = await Promise.race([
      host.call<unknown>('n1ko.auth.getUser').then(
        user => (user ? 'ok' as const : 'expired' as const),
        (err: unknown) => {
          if (err instanceof PluginCallError && err.code === 'unauthorized') return 'expired' as const
          return 'unknown' as const
        }
      ),
      new Promise<'unknown'>(
        resolve => { timer = setTimeout(() => resolve('unknown'), timeoutMs) }
      ),
    ])
    return verdict
  } catch {
    return 'unknown'
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}
