import { describe, it, expect } from 'vitest'
import { extractPlaceQuery } from '@/lib/planAgent/placeQuery'

/**
 * 回归第三轮 A1：参考类条目（泊宿参考/心斋桥一带/京都站到关西机场/自由安排）
 * 也要能解析出地点查询词。规则：payload.placeQuery 优先；否则从标题剥修饰词
 * （前后缀词表 + 冒号/括号/箭头说明），A到B 形式取目的地 B；剥完为空才跳过
 * （原 VAGUE 整词跳过规则废除）。
 */

describe('extractPlaceQuery', () => {
  it('payload.placeQuery 优先：非空时 trim 后原样返回，不解析标题', () => {
    expect(extractPlaceQuery('第一晚住宿', '  新千歳空港  ')).toBe('新千歳空港')
    expect(extractPlaceQuery('任意标题', 'ＮＥＷ ＣｈｉｔｓｅＯ空港')).toBe('ＮＥＷ ＣｈｉｔｓｅＯ空港')
  })

  it('placeQuery 为空串/空白时回落到标题解析', () => {
    expect(extractPlaceQuery('心斋桥一带', '   ')).toBe('心斋桥')
    expect(extractPlaceQuery('心斋桥一带', '')).toBe('心斋桥')
  })

  it('冒号前的说明剥掉：「泊宿参考：难波」→ 难波（全角/半角冒号都支持）', () => {
    expect(extractPlaceQuery('泊宿参考：难波')).toBe('难波')
    expect(extractPlaceQuery('参考: 心斋桥')).toBe('心斋桥')
  })

  it('前后缀修饰词剥掉：「心斋桥一带」→ 心斋桥；「入住难波」→ 难波', () => {
    expect(extractPlaceQuery('心斋桥一带')).toBe('心斋桥')
    expect(extractPlaceQuery('入住难波')).toBe('难波')
    expect(extractPlaceQuery('夜宿京都站')).toBe('京都站')
    expect(extractPlaceQuery('难波周边')).toBe('难波')
    expect(extractPlaceQuery('涩谷推荐')).toBe('涩谷')
    expect(extractPlaceQuery('梅田区域')).toBe('梅田')
  })

  it('A到B 形式取目的地 B：到/至/→/- 四种分隔符，取最后一个分隔符右侧', () => {
    expect(extractPlaceQuery('京都站到关西机场')).toBe('关西机场')
    expect(extractPlaceQuery('京都站至关西机场')).toBe('关西机场')
    expect(extractPlaceQuery('京都站→关西机场')).toBe('关西机场')
    expect(extractPlaceQuery('京都站-关西机场')).toBe('关西机场')
    // 多段行程取最后一段的目的地
    expect(extractPlaceQuery('大阪到京都到关西机场')).toBe('关西机场')
  })

  it('A到B 与修饰词组合：先取 B 再剥修饰词', () => {
    expect(extractPlaceQuery('酒店到关西机场一带')).toBe('关西机场')
    expect(extractPlaceQuery('泊宿参考：京都站到关西机场')).toBe('关西机场')
  })

  it('动词「到」不是路线分隔符：B 以「的」开头时不拆分', () => {
    expect(extractPlaceQuery('查不到的店')).toBe('查不到的店')
    expect(extractPlaceQuery('买不到的限定商品')).toBe('买不到的限定商品')
  })

  it('括号内容剥掉：「难波（参考）」→ 难波', () => {
    expect(extractPlaceQuery('难波（参考）')).toBe('难波')
    expect(extractPlaceQuery('关西机场(KIX)')).toBe('关西机场')
  })

  it('纯修饰词标题剥完为空 → 返回空串（交给 A3 邻近图兜底）', () => {
    expect(extractPlaceQuery('自由安排')).toBe('')
    expect(extractPlaceQuery('自由时间')).toBe('')
    expect(extractPlaceQuery('自由活动')).toBe('')
    expect(extractPlaceQuery('自由漫步')).toBe('')
    expect(extractPlaceQuery('机动')).toBe('')
    expect(extractPlaceQuery('休息')).toBe('')
    expect(extractPlaceQuery('泊宿参考')).toBe('')
    expect(extractPlaceQuery('  ')).toBe('')
    expect(extractPlaceQuery('')).toBe('')
  })

  it('裸「自由」子串不误伤：「自由が丘」保持原样', () => {
    expect(extractPlaceQuery('自由が丘')).toBe('自由が丘')
  })

  it('具体地名标题保持原样（不剥中间词）', () => {
    expect(extractPlaceQuery('东京迪士尼海洋')).toBe('东京迪士尼海洋')
    expect(extractPlaceQuery('京都セントラルホテル')).toBe('京都セントラルホテル')
  })

  it('A4：散步/逛街/时段修饰词剥掉（长词优先）', () => {
    expect(extractPlaceQuery('傍晚新宿街头散步')).toBe('新宿')
    expect(extractPlaceQuery('上午浅草寺周边')).toBe('浅草寺')
    expect(extractPlaceQuery('自由が丘散步')).toBe('自由が丘')
    expect(extractPlaceQuery('晚上心斋桥逛街')).toBe('心斋桥')
    expect(extractPlaceQuery('清晨鸭川漫步')).toBe('鸭川')
    expect(extractPlaceQuery('中午道顿堀附近闲逛')).toBe('道顿堀')
    expect(extractPlaceQuery('夜晚购物')).toBe('')
  })
})
