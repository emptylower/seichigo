import { describe, expect, it } from 'vitest'
import {
  buildLineShareUrl,
  buildRedditSubmitUrl,
  buildShareCaption,
  buildXIntentUrl,
  withShareChannel,
} from '@/components/share/shareText'

describe('buildShareCaption', () => {
  it('填充四个占位符', () => {
    expect(
      buildShareCaption('《{anime}》圣地巡礼｜{point}（{city}）{url} #圣地巡礼 #{anime}', {
        anime: '你的名字。',
        point: '须贺神社',
        city: '东京',
        url: 'https://seichigo.com/s/AbC12xYz?c=xhs',
      }),
    ).toBe('《你的名字。》圣地巡礼｜须贺神社（东京）https://seichigo.com/s/AbC12xYz?c=xhs #圣地巡礼 #你的名字。')
  })

  it('城市缺失时不留空括号/空逗号', () => {
    expect(
      buildShareCaption('《{anime}》圣地巡礼｜{point}（{city}）{url}', {
        anime: 'A',
        point: 'B',
        city: '',
        url: 'U',
      }),
    ).toBe('《A》圣地巡礼｜B U')
    expect(
      buildShareCaption('{anime} anime pilgrimage: {point}, {city} {url}', {
        anime: 'A',
        point: 'B',
        city: '',
        url: 'U',
      }),
    ).toBe('A anime pilgrimage: B U')
  })
})

describe('withShareChannel', () => {
  it('在没有 query 的短链上追加 ?c=', () => {
    expect(withShareChannel('https://seichigo.com/s/AbC12xYz', 'x')).toBe(
      'https://seichigo.com/s/AbC12xYz?c=x',
    )
  })

  it('已有 c 参数时覆盖而不是追加第二个', () => {
    expect(withShareChannel('https://seichigo.com/s/AbC12xYz?c=save', 'wx')).toBe(
      'https://seichigo.com/s/AbC12xYz?c=wx',
    )
  })
})

describe('平台 URL', () => {
  const text = '《你的名字。》圣地巡礼 https://seichigo.com/s/AbC12xYz?c=x'
  const url = 'https://seichigo.com/s/AbC12xYz?c=rd'

  it('X', () => {
    expect(buildXIntentUrl(text)).toBe(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`,
    )
  })

  it('Reddit', () => {
    expect(buildRedditSubmitUrl(url, '须贺神社｜《你的名字。》')).toBe(
      `https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent('须贺神社｜《你的名字。》')}`,
    )
  })

  it('LINE', () => {
    expect(buildLineShareUrl(url, text)).toBe(
      `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
    )
  })
})
