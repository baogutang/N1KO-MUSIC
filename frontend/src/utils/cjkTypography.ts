/**
 * 中西文混排的排版细节。
 *
 * 「文字即界面」这句话能不能立住，很大程度上就取决于这一道工序：
 * 中西文之间的细空格是「排过版的中文」与「倒出来的中文」之间最容易辨认的分界，
 * 而它出现在这个 App 几乎每一个歌名里。
 *
 * 用 U+2009 THIN SPACE 而不是普通空格：宽度约为四分之一个全角，
 * 视觉上是「让一让」而不是「断开」。
 */

/** 中日韩表意文字、假名、注音等需要与西文拉开距离的区段 */
const CJK = '\\u2e80-\\u2eff\\u2f00-\\u2fdf\\u3040-\\u309f\\u30a0-\\u30ff\\u3100-\\u312f\\u3200-\\u32ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff'
/** 西文字母、数字，以及常见的度量单位符号 */
const LATIN = 'A-Za-z0-9@#$%^&*\\-+\\\\/=|'

const THIN_SPACE = ' '

const CJK_BEFORE_LATIN = new RegExp(`([${CJK}])([${LATIN}])`, 'g')
const LATIN_BEFORE_CJK = new RegExp(`([${LATIN}])([${CJK}])`, 'g')

/**
 * 在中西文边界插入细空格。
 *
 * 已经有空白的地方不再插入（正则的两个捕获组都要求是非空白字符）。
 * 幂等：细空格本身不属于 CJK 或 LATIN 区段，重复调用不会叠加。
 */
export function spaceCJK(input: string): string {
  if (!input) return input
  // 快速路径：没有 CJK 就没有可做的事，列表里大量纯西文曲名走这条
  if (!new RegExp(`[${CJK}]`).test(input)) return input
  return input
    .replace(CJK_BEFORE_LATIN, `$1${THIN_SPACE}$2`)
    .replace(LATIN_BEFORE_CJK, `$1${THIN_SPACE}$2`)
}
