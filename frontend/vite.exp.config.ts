import base from './vite.config'
export default async (env: any) => {
  const cfg: any = typeof base === 'function' ? await (base as any)(env) : base
  cfg.plugins = cfg.plugins.filter((p: any) => !p || !String(p?.name || '').includes('pwa'))
  cfg.build = { ...(cfg.build||{}), outDir: 'dist-exp',
    rollupOptions: { output: { manualChunks(id: string) {
      if (!id.includes('node_modules')) return
      if (/node_modules\/(react|react-dom|scheduler|use-sync-external-store|react-is)\//.test(id)) return 'react-core'
      if (/node_modules\/react-router(-dom)?\//.test(id)) return 'router'
      if (id.includes('@tanstack/')) return 'react-query'
      if (id.includes('@radix-ui')) return 'radix-ui'
      if (id.includes('@phosphor-icons')) return   // let rollup split naturally
      return 'vendor'
    } } } }
  return cfg
}
