import { parseStartMinutes } from '../schedule'
import { validateExternalPlacePayload } from '@/lib/googlePlaces/places'
import type { EnrichContext, EnrichDay, EnrichReport } from './types'

/**
 * 用餐归一（回归第四轮 A6，enricher 链的第一个 runner）：
 * 模型把午餐/晚餐写成 free 且标题带「自理」时，餐厅补齐会被跳过。这里统一：
 * - 类型归一（R4 审查收紧）：只有**标题**命中用餐关键词、无 pointId、且不带
 *   合法 payload.place 的非 meal 条目才改为 meal（note 命中/站内点位/已带
 *   地点的一律不动，避免作品点位被吞）；
 * - 推断 payload.mealSlot：标题关键词优先（早餐/午饭/晚饭…），否则按
 *   timeHint/payload.schedule 解析出的时刻（< 10:30 早餐、< 16:00 午餐、
 *   其余晚餐），完全无法判断按午餐；已有合法 mealSlot 不改；
 * - 标题清洗：去掉「自理/自行安排/自行解决/自由用餐」与首尾标点，
 *   清洗后为空按 slot 写「早餐」「午餐」「晚餐」；
 * - 末尾为午餐/晚餐且无合法 place 的 meal 条目预留 places 预算（A6：
 *   place 兜底解析按 placesRemaining 判定，餐厅补齐在地点之后仍有点数）。
 * 幂等：连跑两次第二次 applied.meal 为 0。
 */

const MEAL_HINT_PATTERN = /(早餐|早饭|午餐|午饭|中饭|晚餐|晚饭|夜宵|用餐|就餐|吃饭|自理)/
const BREAKFAST_PATTERN = /早餐|早饭/
const LUNCH_PATTERN = /午餐|午饭|中饭/
const DINNER_PATTERN = /晚餐|晚饭|夜宵/
const TITLE_CLEANUP_PATTERN = /自理|自行安排|自行解决|自由用餐/g
const EDGE_PUNCTUATION_PATTERN = /^[\s·、，,。；;：:·!！?？\-—~～]+|[\s·、，,。；;：:·!！?？\-—~～]+$/g

type MealSlot = 'breakfast' | 'lunch' | 'dinner'

function isValidMealSlot(value: unknown): value is MealSlot {
  return value === 'breakfast' || value === 'lunch' || value === 'dinner'
}

function slotByTitle(title: string): MealSlot | null {
  if (BREAKFAST_PATTERN.test(title)) return 'breakfast'
  if (LUNCH_PATTERN.test(title)) return 'lunch'
  if (DINNER_PATTERN.test(title)) return 'dinner'
  return null
}

function slotByMinutes(minutes: number): MealSlot {
  if (minutes < 10 * 60 + 30) return 'breakfast'
  if (minutes < 16 * 60) return 'lunch'
  return 'dinner'
}

function cleanTitle(title: string): string {
  return title
    .replace(TITLE_CLEANUP_PATTERN, '')
    .replace(EDGE_PUNCTUATION_PATTERN, '')
    .trim()
}

function slotLabel(slot: MealSlot): string {
  return slot === 'breakfast' ? '早餐' : slot === 'lunch' ? '午餐' : '晚餐'
}

export function runMealEnricher(days: EnrichDay[], ctx: EnrichContext, report: EnrichReport): void {
  let changed = 0
  for (const day of days) {
    for (const item of day.items) {
      if (item.type === 'transit') continue
      let touched = false
      // 1) 类型归一（R4 审查收紧）：仅标题命中用餐关键词、无 pointId、且不带
      //    合法 place 的非 meal 条目才改类型（note 命中/站内点位/已带地点的不动）
      if (item.type !== 'meal') {
        if (!MEAL_HINT_PATTERN.test(item.title ?? '')) continue
        if (item.pointId) continue
        if (validateExternalPlacePayload(item.payload?.place) === null) continue
        item.type = 'meal'
        touched = true
      }
      // 2) mealSlot 推断：已有合法值不改
      if (!item.payload) item.payload = {}
      if (!isValidMealSlot(item.payload.mealSlot)) {
        item.payload.mealSlot = slotByTitle(item.title ?? '') ?? slotByMinutes(parseStartMinutes(item) ?? 12 * 60)
        touched = true
      }
      // 3) 标题清洗：去掉「自理」等与首尾标点；清洗后为空按 slot 写回
      const cleaned = cleanTitle(item.title ?? '')
      if (cleaned !== item.title) {
        item.title = cleaned || slotLabel(item.payload.mealSlot as MealSlot)
        touched = true
      }
      if (touched) changed += 1
    }
  }
  report.applied.meal += changed
  // 4) 预算预留：午餐/晚餐且无合法 place 的 meal 条目数（上限 places.max）
  if (ctx.budget) {
    let pending = 0
    for (const day of days) {
      for (const item of day.items) {
        if (item.type !== 'meal') continue
        if (item.payload?.mealSlot !== 'lunch' && item.payload?.mealSlot !== 'dinner') continue
        if (validateExternalPlacePayload(item.payload?.place) === null) continue
        pending += 1
      }
    }
    ctx.budget.places.reserved = Math.min(pending, ctx.budget.places.max)
  }
}
