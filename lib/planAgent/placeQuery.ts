/**
 * 回归第三轮 A1：参考类条目的地点查询词提取。
 *
 * 模型经常把「泊宿参考：难波」「心斋桥一带」「京都站到关西机场」「自由安排」
 * 这类非结构化标题写成条目；placeBackstop 需要从中剥出可解析的地名。
 * 规则（剥完为空才跳过——原 VAGUE 整词直接跳过的规则废除）：
 * - payload.placeQuery 非空时优先（trim 后原样返回，归一化交给调用方判断）；
 * - 否则从标题剥修饰词：冒号前的说明（「泊宿参考：难波」→ 难波）、括号内容
 *   （「难波（参考）」→ 难波）、前后缀修饰词（一带/周边/入住/参考…）；
 * - 标题形如 A到B / A→B / A-B / A至B 时取最后一个分隔符右侧的目的地 B
 *   （「京都站到关西机场」→ 关西机场；多段行程取最后一段）；
 * - 只剥前缀/后缀，不剥中间词（「自由が丘」不受裸「自由」子串误伤）。
 */

/** 前后缀修饰词（长词优先，避免「住宿参考」被「参考」截断成残词；A4 新增时段/散步类词同样长词在前） */
const MODIFIER_WORDS = [
  '泊宿参考',
  '住宿参考',
  '自由安排',
  '自由活动',
  '自由时间',
  '自由漫步',
  '街头散步',
  '散步',
  '漫步',
  '闲逛',
  '逛街',
  '购物',
  '街头',
  '清晨',
  '早上',
  '上午',
  '中午',
  '下午',
  '傍晚',
  '晚上',
  '夜晚',
  '夜间',
  '参考',
  '一带',
  '周边',
  '附近',
  '方向',
  '区域',
  '入住',
  '夜宿',
  '推荐',
  '建议',
  '机动',
  '休息',
]

/** A到B 形式的分隔符（取最后一个，多段行程取最后目的地） */
const ROUTE_SEPARATORS = new Set(['到', '至', '→', '-'])

/** 首尾待清理的连接符/标点（剥修饰词后残留的孤立符号） */
const EDGE_TRIM_PATTERN = /^[\s到至→\-·、，,。；;：:]+|[\s到至→\-·、，,。；;：:]+$/g

function isColon(ch: string): boolean {
  return ch === '：' || ch === ':'
}

function isRouteSeparator(ch: string): boolean {
  return ROUTE_SEPARATORS.has(ch)
}

/** 剥掉冒号前的说明（「泊宿参考：难波」→ 难波）；无冒号原样返回 */
function stripLabelBeforeColon(text: string): string {
  let last = -1
  for (let i = 0; i < text.length; i++) {
    if (isColon(text[i])) last = i
  }
  return last >= 0 ? text.slice(last + 1) : text
}

/**
 * A到B 形式取目的地 B（最后一个分隔符右侧）；两侧任一为空、或 B 以助词
 * 「的」开头（「查不到的店」里的动词到，不是路线分隔）视为不匹配返回 null。
 */
function takeRouteDestination(text: string): string | null {
  let last = -1
  for (let i = text.length - 1; i >= 0; i--) {
    if (isRouteSeparator(text[i])) {
      last = i
      break
    }
  }
  if (last <= 0) return null
  const destination = text.slice(last + 1).trim()
  const origin = text.slice(0, last).trim()
  if (!destination || !origin) return null
  if (destination.startsWith('的')) return null
  return destination
}

/** 反复剥首尾修饰词，直到剥不动为止 */
function stripModifiers(text: string): string {
  let result = text
  let changed = true
  while (changed) {
    changed = false
    for (const word of MODIFIER_WORDS) {
      if (result.startsWith(word)) {
        result = result.slice(word.length).trim()
        changed = true
        break
      }
      if (result.endsWith(word)) {
        result = result.slice(0, -word.length).trim()
        changed = true
        break
      }
    }
  }
  return result
}

/**
 * 提取地点查询词：placeQuery 优先；否则按上述规则剥标题。
 * 返回剥完后的查询词（可能为空串——调用方以"归一化后长度 < 2"判定跳过）。
 */
export function extractPlaceQuery(title: string, placeQuery?: string | null): string {
  const explicit = typeof placeQuery === 'string' ? placeQuery.trim() : ''
  if (explicit) return explicit
  let text = String(title ?? '').trim()
  if (!text) return ''
  text = stripLabelBeforeColon(text).trim()
  const destination = takeRouteDestination(text)
  if (destination !== null) text = destination
  text = text.replace(/[（(][^（）()]*[）)]/g, '').trim()
  text = stripModifiers(text)
  return text.replace(EDGE_TRIM_PATTERN, '').trim()
}
