/** @type {import('tailwindcss').Config} */
import plugin from 'tailwindcss/plugin'

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
      fontFamily: {
        sans: 'var(--font-sans)',
        serif: 'var(--font-serif)',
        mono: 'var(--font-mono)',
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        // shadcn 的 accent 是 hover 底面语义（paper-deep）；
        // 品牌朱红用 primary / paper-ink 语义色
        accent: {
          DEFAULT: 'hsl(var(--accent-surface))',
          foreground: 'hsl(var(--accent-surface-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // 编辑风设计 token（RGB 通道，见 index.css :root）
        paper: {
          DEFAULT: 'rgb(var(--paper) / <alpha-value>)',
          deep: 'rgb(var(--paper-deep) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--ink) / <alpha-value>)',
          soft: 'rgb(var(--ink-soft) / <alpha-value>)',
          faint: 'rgb(var(--ink-faint) / <alpha-value>)',
        },
        hair: {
          DEFAULT: 'rgb(var(--hair))',
          soft: 'rgb(var(--hair-soft))',
        },
        skeleton: 'rgb(var(--skeleton) / <alpha-value>)',
        surface: {
          DEFAULT: 'hsl(var(--surface))',
          hover: 'hsl(var(--surface-hover))',
        },
        /**
         * 糖果色（DESIGN v3 §1.3）。只在 pop 皮肤下有定义，
         * 因此必须配 `pop:` 变体使用——`pop:bg-candy-ok-soft`。
         * 直接裸用会在编辑风下解析成空值，边框/底色整条失效。
         */
        candy: {
          ok: 'rgb(var(--candy-ok) / <alpha-value>)',
          'ok-fill': 'rgb(var(--candy-ok-fill) / <alpha-value>)',
          'ok-soft': 'rgb(var(--candy-ok-soft) / <alpha-value>)',
          'warn-fill': 'rgb(var(--candy-warn-fill) / <alpha-value>)',
          'warn-soft': 'rgb(var(--candy-warn-soft) / <alpha-value>)',
          danger: 'rgb(var(--candy-danger) / <alpha-value>)',
          'danger-fill': 'rgb(var(--candy-danger-fill) / <alpha-value>)',
          'danger-soft': 'rgb(var(--candy-danger-soft) / <alpha-value>)',
        },
      },
      /**
       * 圆角与描边宽度都改成 token 驱动（DESIGN v3 §7）。
       * 这是「换皮不只换颜色」的关键一步：全站 150+ 处 rounded-sm/md/lg
       * 与 170+ 处 border 无需逐个改写，跟着皮肤自动变形。
       *   编辑风 4/6/8px、1px 描边
       *   波普   10/12/16px、2px 描边
       */
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
        float: 'var(--shadow-float)',
        press: 'var(--shadow-press)',
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
        /**
         * 翻页。
         *
         * 切歌时新曲目信息不是淡入，而是像纸页被翻过来一样从边缘立起。
         * transform-origin 由使用方给（左缘翻页），这里只描述动作本身；
         * 幅度刻意压得很小——它是一次翻页，不是一个特效。
         */
        'page-turn': {
          from: { opacity: '0', transform: 'rotateY(-7deg) translateX(-6px)' },
          to: { opacity: '1', transform: 'rotateY(0deg) translateX(0)' },
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
        'page-turn': 'page-turn 0.42s var(--ease)',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
      },
    },
  },
  plugins: [
    require('tailwindcss-animate'),
    /**
     * 皮肤变体。`pop:` / `editorial:` 让调用方在需要时按皮肤分支，
     * 而不必在 TSX 里读 store 再拼 className——换皮是纯 CSS 的事，
     * 组件不应该知道当前是哪张皮。
     */
    plugin(({ addVariant }: { addVariant: (name: string, def: string) => void }) => {
      addVariant('pop', "html[data-skin='pop'] &")
      addVariant('editorial', "html[data-skin='editorial'] &")
    }),
  ],
}
