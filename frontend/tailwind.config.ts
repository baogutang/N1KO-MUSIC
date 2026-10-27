/** @type {import('tailwindcss').Config} */

/**
 * v5 暖纸：颜色 token 全是 oklch 的三个通道（见 index.css），
 * 这里统一包成 `oklch(var(--x) / <alpha-value>)`，`/40` 之类的不透明度修饰符因此处处有效。
 */
const c = (name: string) => `oklch(var(--${name}) / <alpha-value>)`

export default {
  darkMode: ['class'],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      /**
       * 断点按窗口宽度分三档（与 useWindowClass 一致）：
       *   compact < 600：底部标签栏（iPhone、Duo 外屏、窄分屏）
       *   regular 600–1023：侧边导航条（Duo 展开、iPad 竖屏、半屏分屏）
       *   wide ≥ 1024：侧栏 + 正在播放面板（iPad 横屏、桌面）
       */
      screens: {
        regular: '600px',
        wide: '1024px',
      },
      fontFamily: {
        sans: 'var(--font-sans)',
        serif: 'var(--font-serif)',
        display: 'var(--font-display)',
        figure: 'var(--font-figure)',
        mono: 'var(--font-mono)',
      },
      colors: {
        border: c('border'),
        input: c('input'),
        ring: c('ring'),
        background: c('background'),
        foreground: c('foreground'),
        primary: {
          DEFAULT: c('primary'),
          foreground: c('primary-foreground'),
        },
        // 青柠：只做填色（播放键、主按钮、进度、开关）；上面的字与图标用 vivid-foreground
        vivid: {
          DEFAULT: c('vivid'),
          deep: c('vivid-deep'),
          foreground: c('vivid-ink'),
        },
        sem: {
          playing: c('sem-playing'),
          connected: c('sem-connected'),
          fav: c('sem-fav'),
          error: c('sem-error'),
        },
        secondary: {
          DEFAULT: c('secondary'),
          foreground: c('secondary-foreground'),
        },
        destructive: {
          DEFAULT: c('destructive'),
          foreground: c('destructive-foreground'),
        },
        muted: {
          DEFAULT: c('muted'),
          foreground: c('muted-foreground'),
        },
        // shadcn 的 accent 是 hover 底面语义；品牌色：文字用 primary（叶绿），填色用 vivid（青柠）
        accent: {
          DEFAULT: c('accent-surface'),
          foreground: c('accent-surface-foreground'),
        },
        popover: {
          DEFAULT: c('popover'),
          foreground: c('popover-foreground'),
        },
        card: {
          DEFAULT: c('card'),
          foreground: c('card-foreground'),
        },
        paper: {
          DEFAULT: c('paper'),
          deep: c('paper-deep'),
          3: c('paper-3'),
        },
        sheet: c('sheet'),
        ink: {
          DEFAULT: c('ink'),
          soft: c('ink-soft'),
          faint: c('ink-faint'),
        },
        hair: {
          DEFAULT: c('hair'),
          soft: c('hair-soft'),
        },
        skeleton: c('skeleton'),
        surface: {
          DEFAULT: c('surface'),
          hover: c('surface-hover'),
        },
        candy: {
          ok: c('candy-ok'),
          'ok-fill': c('candy-ok-fill'),
          'ok-soft': c('candy-ok-soft'),
          'warn-fill': c('candy-warn-fill'),
          'warn-soft': c('candy-warn-soft'),
          danger: c('candy-danger'),
          'danger-fill': c('candy-danger-fill'),
          'danger-soft': c('candy-danger-soft'),
        },
      },
      borderRadius: {
        lg: 'var(--r-lg)',
        md: 'var(--r-md)',
        sm: 'var(--r-sm)',
        pill: 'var(--r-pill)',
      },
      borderWidth: {
        DEFAULT: 'var(--stroke)',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        float: 'var(--shadow-float)',
        press: 'var(--shadow-press)',
      },
      transitionTimingFunction: {
        paper: 'var(--ease)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in-scale': {
          from: { opacity: '0', transform: 'scale(0.95)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(20px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(24px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        'spin-slow': {
          from: { transform: 'rotate(0deg)' },
          to: { transform: 'rotate(360deg)' },
        },
        'pulse-glow': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
        /** 切歌：新曲目信息从下方轻轻落定 */
        'page-turn': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s var(--ease)',
        'accordion-up': 'accordion-up 0.2s var(--ease)',
        'fade-in': 'fade-in 0.35s var(--ease)',
        'fade-in-scale': 'fade-in-scale 0.25s var(--ease)',
        'slide-up': 'slide-up 0.4s var(--ease)',
        'slide-in-right': 'slide-in-right 0.3s var(--ease)',
        'spin-slow': 'spin-slow 8s linear infinite',
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'page-turn': 'page-turn 0.32s var(--ease)',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}
