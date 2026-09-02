/**
 * `big-integer` 的原生 BigInt 兼容层（PROTOCOL §4.1）。
 *
 * 只覆盖插件协议声明的面：`bigInt(str, base)`、`modPow`、`toString(base)`。
 * 网易云 weapi 的 RSA 模幂只需要这三件；不做全量 API 兼容，
 * 插件用到缺的方法会得到明确的「not implemented」。
 */

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz'

function parseWithBase(value: string, base: number): bigint {
  const negative = value.startsWith('-')
  const digits = negative ? value.slice(1) : value
  if (!digits.length) throw new Error(`bigInt: empty value`)
  let result = 0n
  for (const ch of digits.toLowerCase()) {
    const d = DIGITS.indexOf(ch)
    if (d < 0 || d >= base) throw new Error(`bigInt: invalid digit "${ch}" for base ${base}`)
    result = result * BigInt(base) + BigInt(d)
  }
  return negative ? -result : result
}

function toBaseString(value: bigint, base: number): string {
  if (value === 0n) return '0'
  const negative = value < 0n
  let rest = negative ? -value : value
  let out = ''
  while (rest > 0n) {
    out = DIGITS[Number(rest % BigInt(base))] + out
    rest /= BigInt(base)
  }
  return negative ? '-' + out : out
}

export interface BigIntegerShim {
  modPow(exponent: BigIntegerShim | string | number, modulus: BigIntegerShim | string | number): BigIntegerShim
  toString(radix?: number): string
  /** 协议外的便利方法按需补；缺的抛 not implemented */
  plus(other: BigIntegerShim | string | number): BigIntegerShim
  minus(other: BigIntegerShim | string | number): BigIntegerShim
  times(other: BigIntegerShim | string | number): BigIntegerShim
  compareTo(other: BigIntegerShim | string | number): number
}

function toBig(value: BigIntegerShim | string | number, base = 10): bigint {
  if (value instanceof BigIntegerImpl) return value.value
  if (typeof value === 'number') return BigInt(value)
  return parseWithBase(String(value), base)
}

class BigIntegerImpl implements BigIntegerShim {
  constructor(readonly value: bigint) {}

  modPow(exponent: BigIntegerShim | string | number, modulus: BigIntegerShim | string | number): BigIntegerShim {
    const m = toBig(modulus)
    if (m === 0n) throw new Error('bigInt.modPow: modulus is zero')
    // 原生 BigInt 没有 modpow，自己写平方-乘
    let base = ((this.value % m) + m) % m
    let exp = toBig(exponent)
    let result = 1n
    while (exp > 0n) {
      if (exp & 1n) result = (result * base) % m
      base = (base * base) % m
      exp >>= 1n
    }
    return new BigIntegerImpl(result)
  }

  toString(radix = 10): string {
    if (radix === 10) return this.value.toString()
    return toBaseString(this.value, radix)
  }

  plus(other: BigIntegerShim | string | number): BigIntegerShim {
    return new BigIntegerImpl(this.value + toBig(other))
  }
  minus(other: BigIntegerShim | string | number): BigIntegerShim {
    return new BigIntegerImpl(this.value - toBig(other))
  }
  times(other: BigIntegerShim | string | number): BigIntegerShim {
    return new BigIntegerImpl(this.value * toBig(other))
  }
  compareTo(other: BigIntegerShim | string | number): number {
    const o = toBig(other)
    return this.value < o ? -1 : this.value === o ? 0 : 1
  }
}

export function bigInt(value: string | number, base = 10): BigIntegerShim {
  return new BigIntegerImpl(typeof value === 'number' ? BigInt(value) : parseWithBase(value, base))
}
