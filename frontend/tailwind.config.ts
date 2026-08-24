/** @type {import('tailwindcss').Config} */
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
      },
      // 纸面杂志不需要大圆角（DESIGN §4）
      borderRadius: {
        lg: '8px',
        md: '6px',
        sm: '4px',
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
  plugins: [require('tailwindcss-animate')],
}
