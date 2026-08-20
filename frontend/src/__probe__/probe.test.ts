import { describe, it, expect } from 'vitest'
import { mapSongExtras } from '../api/adapters/subsonic'

describe('contributors robustness', () => {
  it('null element', () => {
    const parsed = JSON.parse('{"contributors":[null]}')
    expect(() => mapSongExtras(parsed)).not.toThrow()
  })
  it('string element', () => {
    expect(mapSongExtras({ contributors: ['bob'] })).toBeUndefined()
  })
  it('number element', () => {
    expect(() => mapSongExtras({ contributors: [123] })).not.toThrow()
  })
  it('mixed good+null', () => {
    const parsed = JSON.parse('{"contributors":[{"role":"producer","name":"X"},null]}')
    expect(() => mapSongExtras(parsed)).not.toThrow()
  })
})
