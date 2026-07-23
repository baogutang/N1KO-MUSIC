import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'cn.baogutang.musicstreampro',
  appName: 'N1KO MUSIC',
  webDir: 'dist',
  backgroundColor: '#f4efe3',
  cleartext: true, // 允许明文 HTTP：用户自托管服务器常在局域网用 http://
  ios: {
    contentInset: 'never',
  },
  android: {
    allowMixedContent: true, // 用户自托管服务器可能是 http://
  },
  plugins: {
    Keyboard: {
      resize: 'native', // 输入时 WebView 随键盘缩放，避免遮挡登录/搜索输入框
    },
  },
}

export default config
