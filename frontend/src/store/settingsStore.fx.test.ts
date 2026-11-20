/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { STORAGE_KEYS } from '@/services/storageKeys'
import { FX_PRESETS } from '@/audio/effects/model'
import { useSettingsStore } from './settingsStore'

/** 写一份「旧版本存下来的」设置，再让 store 从存档里读回来 */
async function rehydrateFrom(state: Record<string, unknown>) {
  localStorage.setItem(STORAGE_KEYS.settingsStore, JSON.stringify({ state, version: 2 }))
  await useSettingsStore.persist.rehydrate()
  return useSettingsStore.getState()
}

describe('音效设置从存档读回来', () => {
  beforeEach(() => localStorage.clear())

  const liveLevels = [FX_PRESETS.live.bass, FX_PRESETS.live.clarity, FX_PRESETS.live.width, FX_PRESETS.live.loudness]

  it('选着内置预设：按新版本的预设定义刷新参数，不沿用存档里的旧数值', async () => {
    const state = await rehydrateFrom({
      fxEnabled: true,
      fxPreset: 'live',
      fxBands: [0, 0, 0, 0, -1, 0, 0, 1, 1, 1],
      fxBass: 1,
      fxClarity: 2,
      fxWidth: 3,
      fxLoudness: 9,
    })
    expect(state.fxEnabled).toBe(true)
    expect(state.fxPreset).toBe('live')
    expect(state.fxBands).toEqual(FX_PRESETS.live.bands)
    expect([state.fxBass, state.fxClarity, state.fxWidth, state.fxLoudness]).toEqual(liveLevels)
  })

  it('选着已经拿掉的「高清增强」：改套「现场」', async () => {
    const state = await rehydrateFrom({ fxEnabled: true, fxPreset: 'hd', fxBands: [0, 0, 0, -1, -1, 0, 0, 0, 1, 1], fxBass: 1 })
    expect(state.fxEnabled).toBe(true)
    expect(state.fxPreset).toBe('live')
    expect(state.fxBands).toEqual(FX_PRESETS.live.bands)
    expect([state.fxBass, state.fxClarity, state.fxWidth, state.fxLoudness]).toEqual(liveLevels)
  })

  it('手动调过（自定义）：原样保留', async () => {
    const bands = [5, 4, 3, 2, 1, 0, -1, -2, -3, -4]
    const state = await rehydrateFrom({ fxPreset: 'custom', fxBands: bands, fxBass: 7, fxClarity: 1, fxWidth: 9, fxLoudness: 4 })
    expect(state.fxPreset).toBe('custom')
    expect(state.fxBands).toEqual(bands)
    expect([state.fxBass, state.fxClarity, state.fxWidth, state.fxLoudness]).toEqual([7, 1, 9, 4])
  })

  it('不认识的预设名：不覆盖，也不报错', async () => {
    const state = await rehydrateFrom({ fxPreset: 'cinema', fxBass: 3 })
    expect(state.fxPreset).toBe('cinema')
    expect(state.fxBass).toBe(3)
  })
})
