/**
 * 插件音源封面的尺寸提示。
 *
 * 为什么需要它：插件按协议给的是一条封面 URL，而网易云的原图是 4000×4000、
 * 2 MB 一张——首页「今天听什么」二十行就是 40 MB 下载加 3 亿像素的解码，
 * Chrome 会把缩略框先画成白块、几秒后才慢慢填上，手机上更是直接卡住。
 * 两家 CDN 都有现成的缩放约定，宿主按调用方要的尺寸改写即可，插件不用管。
 *
 * 只认这两家，其它域名原样返回；尺寸按 2 倍（视网膜屏）取，并在各家支持的
 * 档位里向上取整。
 */

/** QQ 图床支持的方形档位（photo_new/T002R{n}x{n}M000…）*/
const QQ_SIZES = [150, 300, 500, 800]

/** 网易云 `?param=WyH` 接受任意尺寸，只封顶（原图本来就到 4000） */
const NETEASE_MAX = 1000

function targetSize(size: number): number {
  return Math.max(1, Math.round(size * 2))
}

export function artworkSizeHint(url: string, size: number | undefined): string {
  if (!size || !Number.isFinite(size) || size <= 0) return url
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return url
  }
  const host = u.hostname.toLowerCase()
  const want = targetSize(size)

  if (host === 'music.126.net' || host.endsWith('.music.126.net')) {
    const s = Math.min(want, NETEASE_MAX)
    u.searchParams.set('param', `${s}y${s}`)
    return u.href
  }

  if ((host === 'y.qq.com' || host.endsWith('.gtimg.cn')) && /\/T0\d{2}R\d+x\d+M000/.test(u.pathname)) {
    const s = QQ_SIZES.find(n => n >= want) ?? QQ_SIZES[QQ_SIZES.length - 1]
    u.pathname = u.pathname.replace(/(\/T0\d{2})R\d+x\d+(M000)/, `$1R${s}x${s}$2`)
    return u.href
  }

  return url
}
