import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  fetchArtistProfile, isValidMbid, clearProfileCache, PROFILE_TTL_MS,
  setMinRequestIntervalForTests,
} from './musicbrainz'

// 限速是对 MusicBrainz 的礼貌，不是本文件要验的东西
setMinRequestIntervalForTests(0)

const MBID = '83d91898-7763-47d7-b03b-b92132375c47'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value) },
  removeItem: (key: string) => { store.delete(key) },
})

beforeEach(() => {
  store.clear()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
  })
})

const RESPONSE = {
  type: 'Group',
  'life-span': { begin: '1965-06', end: '1995-01-01' },
  area: { name: 'United Kingdom' },
  'begin-area': { name: 'London' },
  relations: [
    { type: 'member of band', artist: { name: 'A Player' }, begin: '1970', end: '1980' },
    { type: 'member of band', artist: { name: 'Early Player' }, begin: '1965' },
    { type: 'official homepage', url: { resource: 'https://example.test' } },
    { type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Q1' } },
    { type: 'allmusic', url: { resource: 'https://allmusic.test' } },
  ],
}

function stubOk(body: unknown = RESPONSE) {
  const spy = vi.fn(async (_url: string) => new Response(JSON.stringify(body), { status: 200 }))
  vi.stubGlobal('fetch', spy)
  return spy
}

describe('isValidMbid', () => {
  it('只认 UUID 形状——外部来的值不该直接拼进 URL', () => {
    expect(isValidMbid(MBID)).toBe(true)
    expect(isValidMbid('../../admin')).toBe(false)
    expect(isValidMbid('')).toBe(false)
    expect(isValidMbid('83d91898-7763-47d7-b03b')).toBe(false)
  })
})

describe('fetchArtistProfile', () => {
  it('把生平、地区、成员和链接映射出来', async () => {
    stubOk()
    const profile = (await fetchArtistProfile(MBID))!
    expect(profile.beginYear).toBe(1965)
    expect(profile.endYear).toBe(1995)
    expect(profile.area).toBe('United Kingdom')
    expect(profile.beginArea).toBe('London')
    expect(profile.members.map(m => m.name)).toEqual(['Early Player', 'A Player'])
  })

  it('只保留有意义的外部链接，数据库互链丢掉', async () => {
    stubOk()
    const profile = (await fetchArtistProfile(MBID))!
    // 存的是文案 key 不是文案：档案缓存 30 天，不该把语言一起腌进去
    expect(profile.links.map(l => l.labelKey).sort()).toEqual(['link.homepage', 'link.wikidata'])
  })

  it('MBID 形状不对时一个请求都不发', async () => {
    const spy = stubOk()
    expect(await fetchArtistProfile('not-a-mbid')).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('第二次调用命中缓存，不再发请求', async () => {
    const spy = stubOk()
    await fetchArtistProfile(MBID)
    await fetchArtistProfile(MBID)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('缓存过期后重新查询', async () => {
    const spy = stubOk()
    await fetchArtistProfile(MBID, { now: 0 })
    await fetchArtistProfile(MBID, { now: PROFILE_TTL_MS + 1 })
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('网络失败时返回旧缓存而不是抛错', async () => {
    stubOk()
    await fetchArtistProfile(MBID)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const profile = await fetchArtistProfile(MBID, { now: PROFILE_TTL_MS + 1 })
    expect(profile?.beginYear).toBe(1965)
  })

  it('没有缓存又失败时返回 null，让歌手页照常渲染', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    expect(await fetchArtistProfile(MBID)).toBeNull()
  })

  it('服务端返回 404 时不写缓存', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    expect(await fetchArtistProfile(MBID)).toBeNull()
    expect(store.get('msp-musicbrainz-cache')).toBeUndefined()
  })

  it('字段缺失时不产生 NaN 年份', async () => {
    stubOk({ 'life-span': { begin: 'unknown' }, relations: [] })
    const profile = (await fetchArtistProfile(MBID))!
    expect(profile.beginYear).toBeUndefined()
    expect(profile.members).toEqual([])
  })

  it('relations 缺失时不抛错', async () => {
    stubOk({})
    expect(await fetchArtistProfile(MBID)).not.toBeNull()
  })

  it('清缓存之后会重新查询', async () => {
    const spy = stubOk()
    await fetchArtistProfile(MBID)
    clearProfileCache()
    await fetchArtistProfile(MBID)
    expect(spy).toHaveBeenCalledTimes(2)
  })
})
