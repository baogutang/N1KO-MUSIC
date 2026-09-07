/** Isolated runtime update probe. No real plugin or credentials are loaded. */
import { expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({
  version: '1.0.0', reads: 0, hosts: [] as any[],
}))
vi.mock('@/plugins/host/pluginStore', () => ({
  usePluginStore: { getState: () => ({ getInstalled: async () => {
    fixture.reads++
    return { manifest: { id: 'fixture', version: fixture.version, platform: 'fixture', hosts: [] }, code: `version-${fixture.version}`, codeHash: fixture.version }
  } }) },
}))
vi.mock('@/plugins/host/PluginHost', () => ({
  PluginHost: class {
    manifest: any; compromised = false; code = ''; credentials = null
    constructor(manifest: any) { this.manifest = manifest; fixture.hosts.push(this) }
    async init(code: string) { this.code = code }
    dispose() {}
    hasMethod() { return false }
  },
  PluginCallError: Error,
}))
import { ensurePluginHost, disposePluginHost } from '@/plugins/host/pluginRuntime'

it('reproduces: updated installed code does not replace live host when credentials are unchanged', async () => {
  const config = { id: 'fixture-server', type: 'plugin', pluginId: 'fixture', credentials: 'mock-only' } as any
  const old = await ensurePluginHost(config)
  fixture.version = '2.0.0'
  const afterUpdate = await ensurePluginHost(config)
  expect(afterUpdate).toBe(old)
  expect((afterUpdate as any).manifest.version).toBe('1.0.0')
  expect(fixture.reads).toBe(1)
  disposePluginHost(config.id)
})
