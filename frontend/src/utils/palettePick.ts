/**
 * 徽标 / 装饰色选取的小工具（PLAN 2.1 来源徽标用）。
 *
 * 把 id 稳定地映射到 0..buckets-1 的档位；具体颜色全在 CSS token 侧
 * （index.css 的 .src-p1..pN），这里不碰任何颜色值。纯函数、无副作用。
 */

/**
 * 稳定档位：同 id 永远同档，不随安装顺序或渲染次数变。
 * 字符按字典序分段取素数权重再求和——不碰码点运算，装饰用途
 * 分布足够均匀（顺序敏感性弱是可接受的：最坏只是换位串同色）。
 */
export function stablePick(text: string, buckets: number): number {
  let total = 0
  for (const ch of text) {
    if (ch < '4') total += 1
    else if (ch < '9') total += 2
    else if (ch < 'f') total += 3
    else if (ch < 'p') total += 5
    else if (ch < 'z') total += 7
    else total += 11
  }
  return total % buckets
}
