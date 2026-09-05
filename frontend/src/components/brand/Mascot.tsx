/**
 * 吉祥物「阿糯 / Nuo」—— 一只捏出来的软陶团子猫，戴一副过大的耳机。
 *
 * 造型（DESIGN v4 奶油·软陶那一档的语言）：只有胖圆体块、没有描边，
 * 每个体块左上一道高光、右下一层内阴影，表面哑光。全部内联 SVG，
 * 不引外部图、不用 emoji、不加依赖，只 import react。
 *
 * ── 几个不那么显然的决定 ─────────────────────────────────
 *
 * 1. 为什么用 useId 拼渐变 id：<linearGradient id> 是全文档唯一的。
 *    同一页放两个 Mascot（比如首页问候 + 空态）时，两份同名 id 会撞，
 *    后挂载的那份把先挂载的渐变覆盖掉，第一个吉祥物直接变色。
 *    所以 id 必须按实例生成。useId 的返回值形如 ":r3:"，冒号在
 *    CSS 选择器里非法（querySelector('#:r3:') 会抛），这里虽然只用在
 *    fill="url(#…)" 属性上、浏览器能吃，但为了将来能被 CSS/JS 选中，
 *    统一把非字母数字字符剔掉。
 *
 * 2. 为什么动效包在 @media (prefers-reduced-motion: no-preference)：
 *    前庭敏感的用户开了系统「减弱动态效果」就应该拿到一只完全静止的
 *    吉祥物。全局 index.css 里那条 reduce 兜底只是把时长压到 0.01ms、
 *    迭代改成 1 次——那是「瞬间跳到末帧」，不是「不动」。这里改成
 *    正向声明：只有在明确 no-preference 时才挂 animation。
 *
 * 3. 为什么颜色要分两层（token + 局部变量）：
 *    - 配件走 token（音符 = accent、z = ink-soft、耳罩内垫 = candy-warn-fill），
 *      换皮/明暗自动跟着走，吉祥物才像这套界面里长出来的东西。
 *    - 身体的粉彩绿不能走 token。token 的明暗是跟界面翻的，身体一翻
 *      就会在奶油底上发白、在深可可底上发灰——角色本身必须两种底都站得住。
 *      所以身体色是组件内的局部变量，另给 .dark 一档压深的版本。
 *
 * 4. token 消费一律带 fallback：只有 --paper / --ink 家族 / --accent(-deep)
 *    在 :root 有定义；--src-* 与 --candy-* 只存在于 pop 和 clay 两张皮，
 *    --accent-fill 更是只有 clay 有。在纸·墨·朱皮肤下裸写
 *    rgb(var(--candy-warn-fill)) 会解析失败 → 整条 fill 被丢弃 → 形状退回
 *    默认黑。所以写成 rgb(var(--candy-warn-fill, 248 215 126))。
 *
 * 5. listening 档的眼睛是「带高光的圆点」而不是闭合弧线：闭眼弧线在
 *    40px 下只剩两根发丝、糊成一团，认不出是脸。开心的情绪改由更大的
 *    笑弧 + 腮红承担，闭眼留给 sleep（那一档本来就不需要在小尺寸辨认）。
 *
 * 6. <style> 会随每个实例渲染一份：规则全部按 .n1ko-mascot 类名收口、
 *    内容逐字节相同，重复挂载是幂等的；唯一按实例变化的是渐变 id，
 *    而那是属性、不进样式表。
 */

import { useId } from 'react'

export type MascotPose = 'listening' | 'wave' | 'sleep'

export interface MascotProps {
  /** 边长（px），SVG 等比缩放。默认 120，40 也认得出。 */
  size?: number
  /** 追加到外层 span 上 */
  className?: string
  /** 姿势：听歌 / 打招呼 / 睡着了 */
  pose?: MascotPose
  /** 给了就是有含义的插图（role="img" + <title>）；不给就是纯装饰（aria-hidden） */
  title?: string
}

const CSS = `
.n1ko-mascot {
  display: inline-block;
  line-height: 0;

  /* 身体粉彩：组件自持，不跟界面明暗翻面（见文件头 §3） */
  --m-fur: 173 220 198;
  --m-fur-lite: 214 240 227;
  --m-fur-deep: 118 186 158;
  --m-cup: 172 203 228;
  --m-cup-deep: 118 158 197;
  --m-inner: 246 189 170;
  --m-blush: 243 160 136;
  --m-line: 52 60 54;
  --m-shade: 74 58 47;
  --m-gloss: 255 255 255 / 0.62;
}

.n1ko-mascot svg { display: block; }

/* 深色底：身体压深一档，五官保持深色——粉彩身体在两种底上都不会消失 */
.dark .n1ko-mascot {
  --m-fur: 150 202 178;
  --m-fur-lite: 186 224 205;
  --m-fur-deep: 99 158 133;
  --m-cup: 148 180 210;
  --m-cup-deep: 98 136 175;
  --m-inner: 226 167 150;
  --m-blush: 224 141 118;
  --m-line: 28 36 32;
  --m-shade: 0 0 0;
  --m-gloss: 255 255 255 / 0.4;
}

/* 软陶皮肤下直接吃它自己的粉彩色板（鼠尾草 / 雾蓝），
   两个复合选择器写法沿用 index.css 的约定：特异性 (0,3,1)，稳赢 .dark */
html[data-skin='clay']:not(.dark) .n1ko-mascot {
  --m-fur: var(--src-1);
  --m-fur-lite: 201 231 214;
  --m-fur-deep: 104 168 136;
  --m-cup: var(--src-2);
  --m-cup-deep: 122 158 194;
}
html[data-skin='clay'].dark .n1ko-mascot {
  --m-fur: var(--src-1);
  --m-fur-lite: 186 222 203;
  --m-fur-deep: 96 156 126;
  --m-cup: var(--src-2);
  --m-cup-deep: 108 144 178;
}

/* 渐变端点必须走 CSS：presentation attribute 不吃 var() */
.n1ko-mascot .nm-s-fur-lite { stop-color: rgb(var(--m-fur-lite)); }
.n1ko-mascot .nm-s-fur { stop-color: rgb(var(--m-fur)); }
.n1ko-mascot .nm-s-fur-deep { stop-color: rgb(var(--m-fur-deep)); }
.n1ko-mascot .nm-s-cup { stop-color: rgb(var(--m-cup)); }
.n1ko-mascot .nm-s-cup-deep { stop-color: rgb(var(--m-cup-deep)); }
.n1ko-mascot .nm-s-gloss { stop-color: rgb(var(--m-gloss)); }
.n1ko-mascot .nm-s-clear { stop-color: rgb(255 255 255 / 0); }
.n1ko-mascot .nm-s-shade { stop-color: rgb(var(--m-shade) / 0.26); }
.n1ko-mascot .nm-s-shade-0 { stop-color: rgb(var(--m-shade) / 0); }

.n1ko-mascot .nm-fur { fill: rgb(var(--m-fur)); }
.n1ko-mascot .nm-fur-deep { fill: rgb(var(--m-fur-deep)); }
.n1ko-mascot .nm-inner { fill: rgb(var(--m-inner)); }
.n1ko-mascot .nm-blush { fill: rgb(var(--m-blush)); opacity: 0.78; }
.n1ko-mascot .nm-line { fill: rgb(var(--m-line)); }
.n1ko-mascot .nm-spark { fill: rgb(255 255 255 / 0.92); }
/* 耳罩内垫 = 奶油黄。pop / clay 有这个 token，纸·墨·朱没有，所以给兜底值 */
.n1ko-mascot .nm-pad { fill: rgb(var(--candy-warn-fill, 248 215 126)); }

.n1ko-mascot .nm-smile {
  fill: none;
  stroke: rgb(var(--m-line));
  stroke-width: 2.7;
  stroke-linecap: round;
}
.n1ko-mascot .nm-tail {
  fill: none;
  stroke: rgb(var(--m-fur-deep));
  stroke-width: 7.5;
  stroke-linecap: round;
}
.n1ko-mascot .nm-band {
  fill: none;
  stroke: rgb(var(--m-cup-deep));
  stroke-width: 8.5;
  stroke-linecap: round;
}
.n1ko-mascot .nm-band-gloss {
  fill: none;
  stroke: rgb(var(--m-gloss));
  stroke-width: 2.6;
  stroke-linecap: round;
}
/* --accent-fill 只有 clay 有，回落到全皮肤都在的 --accent */
.n1ko-mascot .nm-note { fill: rgb(var(--accent-fill, var(--accent))); }
.n1ko-mascot .nm-note-line {
  fill: none;
  stroke: rgb(var(--accent-fill, var(--accent)));
  stroke-width: 2.8;
  stroke-linecap: round;
}
.n1ko-mascot .nm-z {
  fill: none;
  stroke: rgb(var(--ink-soft));
  stroke-width: 2.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* 动效：只在用户没要求减弱动态效果时才存在（见文件头 §2）。
   SVG 元素的 transform-origin 默认按 view-box 解析，下面的坐标就是 viewBox 用户单位。 */
@media (prefers-reduced-motion: no-preference) {
  .n1ko-mascot .nm-figure {
    animation: nm-bob 3.4s ease-in-out infinite;
  }
  .n1ko-mascot[data-pose='sleep'] .nm-figure {
    animation-duration: 5.4s;
  }
  .n1ko-mascot[data-pose='listening'] .nm-cup-l,
  .n1ko-mascot[data-pose='listening'] .nm-cup-r {
    animation: nm-pulse 1.55s ease-in-out infinite;
  }
  .n1ko-mascot .nm-cup-l { transform-origin: 21px 67px; }
  .n1ko-mascot .nm-cup-r { transform-origin: 89px 67px; }
  .n1ko-mascot .nm-note-g {
    transform-origin: 103px 24px;
    animation: nm-float 3.2s ease-in-out infinite;
  }
  .n1ko-mascot .nm-paw {
    transform-origin: 71px 52px;
    animation: nm-wave 1.25s ease-in-out infinite;
  }
  .n1ko-mascot .nm-z1 {
    transform-origin: 95px 30px;
    animation: nm-drift 3.6s ease-in-out infinite;
  }
  .n1ko-mascot .nm-z2 {
    transform-origin: 106px 15px;
    animation: nm-drift 3.6s ease-in-out infinite -1.8s;
  }
}

@keyframes nm-bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-2.6px); }
}
@keyframes nm-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.07); }
}
@keyframes nm-float {
  0%, 100% { transform: translate(0, 0) rotate(-5deg); opacity: 0.8; }
  50% { transform: translate(2px, -6px) rotate(7deg); opacity: 1; }
}
@keyframes nm-wave {
  0%, 100% { transform: rotate(-11deg); }
  50% { transform: rotate(13deg); }
}
@keyframes nm-drift {
  0% { transform: translateY(4px) scale(0.86); opacity: 0; }
  35% { opacity: 0.9; }
  100% { transform: translateY(-13px) scale(1.06); opacity: 0; }
}
`

export function Mascot({ size = 120, className, pose = 'listening', title }: MascotProps) {
  // 冒号等非字母数字字符剔掉，让 id 在 CSS / querySelector 里也是合法的（见文件头 §1）
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const gFur = `nm-fur-${uid}`
  const gCup = `nm-cup-${uid}`
  const gGloss = `nm-gloss-${uid}`
  const gShade = `nm-shade-${uid}`
  const titleId = `nm-title-${uid}`

  return (
    <span
      className={className ? `n1ko-mascot ${className}` : 'n1ko-mascot'}
      data-pose={pose}
    >
      <style>{CSS}</style>
      <svg
        viewBox="0 0 120 120"
        width={size}
        height={size}
        focusable="false"
        role={title ? 'img' : undefined}
        aria-labelledby={title ? titleId : undefined}
        aria-hidden={title ? undefined : true}
      >
        {title ? <title id={titleId}>{title}</title> : null}

        <defs>
          <linearGradient id={gFur} x1="16%" y1="4%" x2="82%" y2="98%">
            <stop offset="0%" className="nm-s-fur-lite" />
            <stop offset="46%" className="nm-s-fur" />
            <stop offset="100%" className="nm-s-fur-deep" />
          </linearGradient>
          <linearGradient id={gCup} x1="8%" y1="0%" x2="92%" y2="100%">
            <stop offset="0%" className="nm-s-cup" />
            <stop offset="100%" className="nm-s-cup-deep" />
          </linearGradient>
          <radialGradient id={gGloss}>
            <stop offset="0%" className="nm-s-gloss" />
            <stop offset="100%" className="nm-s-clear" />
          </radialGradient>
          <radialGradient id={gShade}>
            <stop offset="0%" className="nm-s-shade" />
            <stop offset="100%" className="nm-s-shade-0" />
          </radialGradient>
        </defs>

        {/* 落地投影：不跟着上下浮动，团子才像离地而不是整块画在飘 */}
        <ellipse cx="55" cy="107" rx="30" ry="5.5" fill={`url(#${gShade})`} />

        <g className="nm-figure">
          {/* 尾巴 */}
          <path className="nm-tail" d="M32 96C18 102 8 95 13 85" />

          {/* 耳朵（在头后面，所以用压深一档的色） */}
          <path className="nm-fur-deep" d="M28 48C24 26 31 13 42 20 49 25 52 36 53 45Z" />
          <path className="nm-inner" d="M34 44C31 29 36 21 42 27 46 31 48 37 48 43Z" />
          <path className="nm-fur-deep" d="M82 48C86 26 79 13 68 20 61 25 58 36 57 45Z" />
          <path className="nm-inner" d="M76 44C79 29 74 21 68 27 64 31 62 37 62 43Z" />

          {/* 头梁：从耳朵前面跨过去，耳尖露在梁上方——耳机压着猫耳的那个样子 */}
          <path className="nm-band" d="M20 68A35 40 0 0 1 90 68" />
          <path className="nm-band-gloss" d="M30 40A32 36 0 0 1 55 26" />

          {/* 身体（头身一体的团子） */}
          <ellipse cx="55" cy="68" rx="34" ry="33" fill={`url(#${gFur})`} />
          <ellipse
            cx="41"
            cy="55"
            rx="17"
            ry="11"
            transform="rotate(-26 41 55)"
            fill={`url(#${gGloss})`}
          />

          {/* 脚 */}
          <ellipse className="nm-fur" cx="40" cy="99" rx="9.5" ry="6.5" />
          <ellipse className="nm-fur" cx="70" cy="99" rx="9.5" ry="6.5" />

          {/* 耳罩：一半压在身体上、一半探出轮廓，才有「过大」的观感 */}
          <g className="nm-cup-l">
            <rect x="8" y="52" width="26" height="30" rx="13" fill={`url(#${gCup})`} />
            <ellipse className="nm-pad" cx="21" cy="67" rx="6.8" ry="8.8" />
          </g>
          <g className="nm-cup-r">
            <rect x="76" y="52" width="26" height="30" rx="13" fill={`url(#${gCup})`} />
            <ellipse className="nm-pad" cx="89" cy="67" rx="6.8" ry="8.8" />
          </g>

          {/* 打招呼的爪子：招财猫式贴身举爪。爪子和手腕各自吃一份 gFur 渐变，
              自带高光和暗面，才能从同色的身体上分出来（软陶的分体块靠光，不靠描边）。 */}
          {pose === 'wave' ? (
            <g className="nm-paw">
              {/* 前臂：从右肩伸出的一截，起点压在身体里、终点接上爪子。
                  没有这一截时爪子只是一个悬在耳罩上的疙瘩，读不出「举起手」。 */}
              <ellipse
                cx="79"
                cy="47"
                rx="10.5"
                ry="6.5"
                transform="rotate(-30 79 47)"
                fill={`url(#${gFur})`}
              />
              {/* 爪子：落在耳罩上缘之上、耳朵右侧的空档里，两样都不压住。
                  半径要够大——92px 显示下小于 7 就糊成一个点。 */}
              <circle cx="89" cy="40" r="8" fill={`url(#${gFur})`} />
              {/* 爪心：一点内阴影。软陶的体块靠光分层，不靠描边。 */}
              <ellipse className="nm-inner" cx="89" cy="42.4" rx="3.4" ry="2.4" />
            </g>
          ) : null}

          {/* 脸 */}
          <ellipse className="nm-blush" cx="36" cy="77" rx="6" ry="4" />
          <ellipse className="nm-blush" cx="74" cy="77" rx="6" ry="4" />
          {pose === 'sleep' ? (
            <>
              <path className="nm-smile" d="M39.5 63.5Q44 69.5 48.5 63.5" />
              <path className="nm-smile" d="M61.5 63.5Q66 69.5 70.5 63.5" />
            </>
          ) : (
            <>
              <circle className="nm-line" cx="44" cy="64" r="4.3" />
              <circle className="nm-line" cx="66" cy="64" r="4.3" />
              <circle className="nm-spark" cx="42.4" cy="62.2" r="1.5" />
              <circle className="nm-spark" cx="64.4" cy="62.2" r="1.5" />
            </>
          )}
          <ellipse className="nm-inner" cx="55" cy="72" rx="2.6" ry="2" />
          <path className="nm-smile" d="M48.6 76.5Q55 83.5 61.4 76.5" />
        </g>

        {/* 姿势小配件：听歌飘一个音符，睡着飘两个 z */}
        {pose === 'listening' ? (
          <g className="nm-note-g">
            <ellipse className="nm-note" cx="99" cy="30" rx="5.2" ry="4.2" />
            <path className="nm-note-line" d="M103.9 29V13" />
            <path className="nm-note-line" d="M103.9 13C109 15 111.5 19.5 109.5 24" />
          </g>
        ) : null}
        {pose === 'sleep' ? (
          <>
            <path className="nm-z nm-z1" d="M89 25H100L89 36H100" />
            <path className="nm-z nm-z2" d="M102 11H110L102 19H110" />
          </>
        ) : null}
      </svg>
    </span>
  )
}
