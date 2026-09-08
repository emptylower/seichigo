import { describe, expect, it } from 'vitest'
import { foldTitleText, stripAnimeTitlePrefix } from '@/lib/share/displayName'

describe('foldTitleText', () => {
  it('全角 ASCII 折半角并小写，长度不变', () => {
    expect(foldTitleText('ＳＥＡＳＯＮ　3')).toBe('season 3')
    expect(foldTitleText('ＳＥＡＳＯＮ　3')).toHaveLength('ＳＥＡＳＯＮ　3'.length)
  })

  it('全角冒号折成半角冒号', () => {
    expect(foldTitleText('：')).toBe(':')
  })

  it('CJK 原样保留', () => {
    expect(foldTitleText('摇曳露营△')).toBe('摇曳露营△')
  })

  it('小写后长度会变的字符放弃折叠（土耳其 İ）', () => {
    // 'İ'.toLowerCase() 是 'i' + 组合上点（两个码位），会破坏下标映射，必须整字符保留
    expect(foldTitleText('İX カフェ')).toBe('İx カフェ')
    expect(foldTitleText('İX カフェ')).toHaveLength('İX カフェ'.length)
  })
})

describe('stripAnimeTitlePrefix', () => {
  it('去掉『作品名』前缀', () => {
    expect(stripAnimeTitlePrefix('『摇曳露营△ SEASON 3』葡萄牛奶', ['摇曳露营△ SEASON 3'])).toBe('葡萄牛奶')
  })

  it('去掉《作品名》前缀', () => {
    expect(stripAnimeTitlePrefix('《孤独摇滚！》下北泽 SHELTER', ['孤独摇滚！'])).toBe('下北泽 SHELTER')
  })

  it('去掉「作品名」与【作品名】前缀', () => {
    expect(stripAnimeTitlePrefix('「ゆるキャン△」本栖湖', ['ゆるキャン△'])).toBe('本栖湖')
    expect(stripAnimeTitlePrefix('【你的名字。】须贺神社', ['你的名字。'])).toBe('须贺神社')
  })

  it('去掉「作品名 + 空格」前缀', () => {
    expect(stripAnimeTitlePrefix('你的名字。 须贺神社', ['你的名字。'])).toBe('须贺神社')
  })

  it('去掉「作品名 + 全角/半角冒号」前缀', () => {
    expect(stripAnimeTitlePrefix('ラブライブ！：神田明神', ['ラブライブ！'])).toBe('神田明神')
    expect(stripAnimeTitlePrefix('ラブライブ!: 神田明神', ['ラブライブ！'])).toBe('神田明神')
  })

  it('全角半角与大小写不敏感', () => {
    expect(stripAnimeTitlePrefix('『ＹＵＲＵ ＣＡＭＰ』湖畔', ['yuru camp'])).toBe('湖畔')
  })

  it('命中的是候选标题里的任意一个（三语标题变体）', () => {
    const titles = ['摇曳露营△ 三期', 'ゆるキャン△ SEASON3', 'Laid-Back Camp Season 3']
    expect(stripAnimeTitlePrefix('『Laid-Back Camp Season 3』Budo Milk', titles)).toBe('Budo Milk')
  })

  it('去掉后为空则保留原名', () => {
    expect(stripAnimeTitlePrefix('《孤独摇滚！》', ['孤独摇滚！'])).toBe('《孤独摇滚！》')
    expect(stripAnimeTitlePrefix('你的名字。 ', ['你的名字。'])).toBe('你的名字。')
  })

  it('没有前缀就原样返回', () => {
    expect(stripAnimeTitlePrefix('须贺神社', ['你的名字。'])).toBe('须贺神社')
    expect(stripAnimeTitlePrefix('须贺神社', [])).toBe('须贺神社')
    expect(stripAnimeTitlePrefix('须贺神社', ['', '   '])).toBe('须贺神社')
  })

  it('空点位名返回空串', () => {
    expect(stripAnimeTitlePrefix('   ', ['你的名字。'])).toBe('')
  })
})
