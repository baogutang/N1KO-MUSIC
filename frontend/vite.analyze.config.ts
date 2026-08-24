import base from './vite.config'
export default async (env: any) => {
  const cfg: any = typeof base === 'function' ? await (base as any)(env) : base
  cfg.plugins = cfg.plugins.filter((p: any) => !p || !String(p?.name || '').includes('pwa'))
  cfg.build = { ...(cfg.build||{}), sourcemap: true, outDir: 'dist-analyze' }
  return cfg
}
