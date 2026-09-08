import { describe, expect, it } from 'vitest'
import {
  buildCardFilename,
  buildLineShareUrl,
  buildRedditSubmitUrl,
  buildShareCaption,
  buildXIntentUrl,
  retargetCaptionChannel,
  toCityLevelAddress,
  toHashtag,
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

  it('#{anime} 里的作品名净化成 hashtag，{anime} 保持原样', () => {
    expect(
      buildShareCaption('{anime} pilgrimage: {point} #{anime}', {
        anime: 'Your Name.',
        point: 'B',
        city: '',
        url: 'U',
      }),
    ).toBe('Your Name. pilgrimage: B #YourName')
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

describe('buildCardFilename', () => {
  it('保留各国文字与数字，其余字符折叠成 -', () => {
    expect(buildCardFilename('须贺神社')).toBe('seichigo-须贺神社.jpg')
    expect(buildCardFilename('Your Name.')).toBe('seichigo-Your-Name-.jpg')
    expect(buildCardFilename('須賀神社/元宮')).toBe('seichigo-須賀神社-元宮.jpg')
  })

  it('名字部分截断到 40 字符', () => {
    expect(buildCardFilename('あ'.repeat(50))).toBe(`seichigo-${'あ'.repeat(40)}.jpg`)
  })
})

describe('toHashtag', () => {
  it('去掉空白与标点符号', () => {
    expect(toHashtag('Your Name.')).toBe('YourName')
    expect(toHashtag('天气之子')).toBe('天气之子')
    expect(toHashtag('Re:Creators')).toBe('ReCreators')
    expect(toHashtag('「进击的巨人」')).toBe('进击的巨人')
    expect(toHashtag('舞-HiME')).toBe('舞-HiME')
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

describe('toCityLevelAddress', () => {
  it('zh/ja 取前两级并去掉分隔空格', () => {
    expect(toCityLevelAddress('東京都 武蔵野市 中町一丁目', 'ja')).toBe('東京都武蔵野市')
    expect(toCityLevelAddress('东京都 武藏野市 中町一丁目', 'zh')).toBe('东京都武藏野市')
  })

  it('en 取最粗的两级（地址是由细到粗排的）', () => {
    expect(toCityLevelAddress('Nakacho 1-chome, Musashino, Tokyo', 'en')).toBe('Musashino, Tokyo')
  })

  it('只有两级时原样返回', () => {
    expect(toCityLevelAddress('山梨県 富士河口湖町', 'ja')).toBe('山梨県富士河口湖町')
    expect(toCityLevelAddress('Fujikawaguchiko, Yamanashi', 'en')).toBe('Fujikawaguchiko, Yamanashi')
  })

  it('只有一级时给一级', () => {
    expect(toCityLevelAddress('沖縄県', 'ja')).toBe('沖縄県')
    expect(toCityLevelAddress('Okinawa', 'en')).toBe('Okinawa')
  })

  it('空串与空白返回空串', () => {
    expect(toCityLevelAddress('', 'zh')).toBe('')
    expect(toCityLevelAddress('   ', 'en')).toBe('')
  })
})

describe('retargetCaptionChannel', () => {
  const BASE = 'https://seichigo.com/s/AbC12xYz'

  it('把文案里的短链换成带目标渠道参数的版本', () => {
    expect(retargetCaptionChannel(`看这里 ${BASE}?c=copy 完`, BASE, 'x')).toBe(
      `看这里 ${BASE}?c=x 完`,
    )
  })

  it('文案里是裸短链时也能挂上渠道', () => {
    expect(retargetCaptionChannel(`看这里 ${BASE} 完`, BASE, 'xhs')).toBe(`看这里 ${BASE}?c=xhs 完`)
  })

  it('多处出现全部替换', () => {
    expect(retargetCaptionChannel(`${BASE}?c=copy 和 ${BASE}`, BASE, 'ln')).toBe(
      `${BASE}?c=ln 和 ${BASE}?c=ln`,
    )
  })

  it('短链里的正则元字符（.）不会被当通配符', () => {
    const other = 'https://seichigoXcom/s/AbC12xYz'
    expect(retargetCaptionChannel(`${other}`, BASE, 'x')).toBe(other)
  })

  it('shareUrl 为空时原样返回', () => {
    expect(retargetCaptionChannel('原文', '', 'x')).toBe('原文')
  })

  it('文案里没有短链时原样返回', () => {
    expect(retargetCaptionChannel('原文', BASE, 'x')).toBe('原文')
  })
})
