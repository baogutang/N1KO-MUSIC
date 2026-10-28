/** @type {import('tailwindcss').Config} */

/**
 * v6 舞台光：颜色 token 全是 oklch 的三个通道（见 index.css），
 * 这里统一包成 `oklch(var(--x) / <alpha-value>)`，`/40` 之类的不透明度修饰符因此处处有效。
 * 新组件用新名字（ground / surface / fill / ink-2 / lime / leaf / wash …）；
 * 旧名字（paper / sheet / vivid / primary …）仍然可用，指向同一组值。
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
        sans: 'var(--font-ui)',
        ui: 'var(--font-ui)',
        serif: 'var(--font-display)',
        display: 'var(--font-display)',
        figure: 'var(--font-display)',
        mono: 'var(--font-ui)',
      },
      fontSize: {
        micro: ['11px', { lineHeight: '14px' }],
        caption: ['12px', { lineHeight: '16px' }],
        meta: ['13px', { lineHeight: '18px' }],
        small: ['14px', { lineHeight: '20px' }],
        body: ['15px', { lineHeight: '22px' }],
        'title-sm': ['17px', { lineHeight: '22px', letterSpacing: '-0.01em' }],
        title: ['20px', { lineHeight: '26px', letterSpacing: '-0.015em' }],
        headline: ['26px', { lineHeight: '30px', letterSpacing: '-0.02em' }],
        page: ['34px', { lineHeight: '38px', letterSpacing: '-0.025em' }],
        'page-wide': ['44px', { lineHeight: '48px', letterSpacing: '-0.03em' }],
        hero: ['56px', { lineHeight: '58px', letterSpacing: '-0.035em' }],
      },
      colors: {
        border: c('border'),
        input: c('input'),
        ring: c('ring'),
        background: c('background'),
        foreground: c('foreground'),

        /* ----- v6 名字 ----- */
        ground: c('ground'),
        surface: {
          DEFAULT: c('surface'),
          2: c('surface-2'),
          hover: c('surface-hover'),
        },
        fill: {
          DEFAULT: c('fill'),
          2: c('fill-2'),
        },
        edge: c('edge'),
        lime: {
          DEFAULT: c('lime'),
          deep: c('lime-deep'),
          ink: c('lime-ink'),
        },
        leaf: {
          DEFAULT: c('leaf'),
          deep: c('leaf-deep'),
        },
        'on-solid': c('on-solid'),
        danger: c('danger'),
        warn: c('warn'),
        ok: c('ok'),
        wash: {
          DEFAULT: c('wash'),
          2: c('wash-2'),
          strong: c('wash-strong'),
        },
        stage: {
          DEFAULT: c('stage'),
          2: c('stage-2'),
          deep: c('stage-deep'),
          ink: c('stage-ink'),
        },

        /* ----- 旧名字（指向同一组值） ----- */
        primary: {
          DEFAULT: c('primary'),
          foreground: c('primary-foreground'),
        },
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
          2: c('ink-2'),
          3: c('ink-3'),
          soft: c('ink-soft'),
          faint: c('ink-faint'),
        },
        hair: {
          DEFAULT: c('hair'),
          soft: c('hair-soft'),
        },
        skeleton: c('skeleton'),
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
        xs: 'var(--r-xs)',
        sm: 'var(--r-sm)',
        md: 'var(--r-md)',
        lg: 'var(--r-lg)',
        xl: 'var(--r-xl)',
        pill: 'var(--r-pill)',
        cover: 'var(--r-cover)',
      },
      borderWidth: {
        DEFAULT: 'var(--stroke)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        cover: 'var(--shadow-cover)',
        card: 'var(--shadow-md)',
        float: 'var(--shadow-lg)',
        press: 'var(--shadow-sm)',
        hair: 'var(--ring-hair)',
      },
      zIndex: {
        raised: 'var(--z-raised)',
        sticky: 'var(--z-sticky)',
        dock: 'var(--z-dock)',
        overlay: 'var(--z-overlay)',
        modal: 'var(--z-modal)',
        toast: 'var(--z-toast)',
        tooltip: 'var(--z-tooltip)',
      },
      transitionTimingFunction: {
        out: 'var(--ease-out)',
        press: 'var(--ease-press)',
        snappy: 'var(--ease-snappy)',
        smooth: 'var(--ease-smooth)',
        paper: 'var(--ease-out)',
      },
      transitionDuration: {
        1: '90ms',
        2: '160ms',
        3: '240ms',
        4: '360ms',
        5: '520ms',
        /* 与 --dur-press 同值：按键回弹。任意值 duration-[…] 会和 tailwindcss-animate 的同名工具类撞车而不生成，一律用命名档 */
        press: '460ms',
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
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in-scale': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(16px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(20px)' },
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
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        /** 吉祥物待机：呼吸 */
        breathe: {
          '0%, 100%': { transform: 'translateY(0) scale(1, 1)' },
          '50%': { transform: 'translateY(-2%) scale(1.01, 0.99)' },
        },
        /* ----- 浮层：入场按弹簧（--ease-snappy），退场比入场快 ----- */
        'wash-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'route-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        /** 吉祥物眨眼：4.8 秒里只有 120ms 是闭眼帧 */
        'mascot-blink': {
          '0%, 93%, 96%, 100%': { opacity: '0' },
          '94%, 95.5%': { opacity: '1' },
        },
        'heart-pop': {
          '0%': { transform: 'scale(0.6)' },
          '45%': { transform: 'scale(1.28)' },
          '100%': { transform: 'scale(1)' },
        },
        'heart-ring': {
          from: { opacity: '0.9', transform: 'scale(0.4)' },
          to: { opacity: '0', transform: 'scale(1.15)' },
        },
        /* 遮罩只动底色，不动透明度：祖先的 opacity < 1 会让里面的毛玻璃失效 */
        'overlay-in': { from: { backgroundColor: 'transparent' } },
        'overlay-out': { to: { backgroundColor: 'transparent' } },
        'dialog-in': {
          from: { opacity: '0', transform: 'translateY(10px) scale(0.96)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'dialog-out': {
          from: { opacity: '1', transform: 'scale(1)' },
          to: { opacity: '0', transform: 'scale(0.98)' },
        },
        'sheet-in': {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
        'sheet-out': {
          from: { transform: 'translateY(0)' },
          to: { transform: 'translateY(100%)' },
        },
        'menu-in': {
          from: { opacity: '0', transform: 'scale(0.92)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'menu-out': {
          from: { opacity: '1', transform: 'scale(1)' },
          to: { opacity: '0', transform: 'scale(0.96)' },
        },
        'toast-in': {
          from: { opacity: '0', transform: 'translateY(16px) scale(0.94)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'toast-out': {
          from: { opacity: '1', transform: 'scale(1)' },
          to: { opacity: '0', transform: 'scale(0.94)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.24s var(--ease-out)',
        'accordion-up': 'accordion-up 0.2s var(--ease-out)',
        'fade-in': 'fade-in 0.36s var(--ease-out) both',
        'fade-in-scale': 'fade-in-scale 0.28s var(--ease-out) both',
        'slide-up': 'slide-up 0.42s var(--ease-out) both',
        'slide-in-right': 'slide-in-right 0.32s var(--ease-out) both',
        'spin-slow': 'spin-slow 8s linear infinite',
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'page-turn': 'page-turn 0.36s var(--ease-out) both',
        breathe: 'breathe 3.2s ease-in-out infinite',
        'wash-in': 'wash-in 1.1s var(--ease-out) both',
        'route-in': 'route-in 0.28s var(--ease-out) both',
        'mascot-blink': 'mascot-blink 4.8s steps(1, end) infinite',
        'heart-pop': 'heart-pop 0.5s var(--ease-out) both',
        'heart-ring': 'heart-ring 0.6s var(--ease-out) both',
        'overlay-in': 'overlay-in 0.24s var(--ease-out) both',
        'overlay-out': 'overlay-out 0.22s var(--ease-in) both',
        'dialog-in': 'dialog-in 0.36s var(--ease-snappy) both',
        'dialog-out': 'dialog-out 0.14s var(--ease-in) both',
        'sheet-in': 'sheet-in 0.45s var(--ease-smooth) both',
        'sheet-out': 'sheet-out 0.22s var(--ease-in) both',
        'menu-in': 'menu-in 0.3s var(--ease-snappy) both',
        'menu-out': 'menu-out 0.12s var(--ease-in) both',
        'toast-in': 'toast-in 0.42s var(--ease-snappy) both',
        'toast-out': 'toast-out 0.16s var(--ease-in) both',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}
