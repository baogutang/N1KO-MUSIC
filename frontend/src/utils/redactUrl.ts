/**
 * 从 URL 里抹掉凭据再打日志。
 *
 * Subsonic 的流地址带着 `t=`（密码的 MD5）和 `s=`（salt），Jellyfin/Emby 带
 * `api_key`。把这样一条完整 URL 打进 console，等于把凭据留在浏览器控制台里——
 * 用户为了排查问题把日志截图或复制给别人时，账号就跟着出去了。
 *
 * 保留路径和无害参数（id、format、maxBitRate 这些正是排查时要看的），
 * 只把敏感参数换成 ***。
 */

/** 这些参数一旦出现就必须抹掉 */
const SECRET_PARAMS = new Set([
  't', 's', 'p', 'token', 'salt', 'password',
  'api_key', 'apikey', 'x-emby-token', 'accesstoken',
])

export function redactUrl(input: string): string {
  try {
    const url = new URL(input)
    let touched = false
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_PARAMS.has(key.toLowerCase())) {
        url.searchParams.set(key, '***')
        touched = true
      }
    }
    return touched ? url.toString() : input
  } catch {
    // 不是一个能解析的 URL：宁可不打，也不要赌它里面没有凭据
    return '(unparseable url)'
  }
}
