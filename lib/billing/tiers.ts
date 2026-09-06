/**
 * 三档能力表（设计 §5）。服务端唯一真值，三处卡点（工具暴露、补齐层、
 * 天数校验）都读这里，任何一处不得单独判断 tier。
 */
export type Tier = 'free' | 'standard' | 'pro'

export const TIERS: readonly Tier[] = ['free', 'standard', 'pro']

export const TIER_LABELS: Record<Tier, string> = { free: '免费', standard: '标准', pro: '高级' }

export type Entitlements = {
  tier: Tier
  /** 餐厅推荐：find_restaurants 工具 + restaurant enricher */
  restaurants: boolean
  /** 真实路线：estimate_travel 工具 + transport enricher 的 Directions 调用 */
  directions: boolean
  /** 单个行程天数上限 */
  maxDays: number
  /** 单 run Places 预算上限（EnrichBudget.places.max） */
  placesMax: number
  /** 单 run Directions 预算上限（EnrichBudget.directions.max；0 = 只走直线估算） */
  directionsMax: number
  priorityQueue: boolean
  /** 高级档模型选择（首期未实现，占位） */
  modelChoice: boolean
  /** 首期是否开放购买 */
  purchasable: boolean
}

export const TIER_ENTITLEMENTS: Record<Tier, Entitlements> = {
  free: {
    tier: 'free',
    restaurants: false,
    directions: false,
    maxDays: 3,
    placesMax: 15,
    directionsMax: 0,
    priorityQueue: false,
    modelChoice: false,
    purchasable: false,
  },
  standard: {
    tier: 'standard',
    restaurants: true,
    directions: true,
    maxDays: 7,
    placesMax: 40,
    directionsMax: 40,
    priorityQueue: false,
    modelChoice: false,
    purchasable: true,
  },
  pro: {
    tier: 'pro',
    restaurants: true,
    directions: true,
    maxDays: 14,
    placesMax: 40,
    directionsMax: 40,
    priorityQueue: true,
    modelChoice: true,
    purchasable: false,
  },
}

export function parseTier(value: unknown): Tier {
  return value === 'standard' || value === 'pro' ? value : 'free'
}

/** 该档位不注入模型、被调用时返回 tier_forbidden 的工具名 */
export function forbiddenToolsOf(e: Entitlements): Set<string> {
  const set = new Set<string>()
  if (!e.directions) set.add('estimate_travel')
  if (!e.restaurants) set.add('find_restaurants')
  return set
}

/** 拼进 system prompt 末尾的档位说明；所有档位都返回（G9：天数上限行对全档生效），免费档另含交通/餐厅两行 */
export function tierPromptNote(e: Entitlements): string {
  const lines: string[] = []
  if (!e.directions) lines.push('- 本档位交通只能用 estimate_transit 做直线估算，不要尝试查询真实路线；transit 条目照常写入，服务端会标注为参考估算。')
  if (!e.restaurants) lines.push('- 本档位不提供餐厅推荐，不要尝试搜索餐厅；meal 条目仍要输出（title 写「午餐」/「晚餐」），payload.place 留空。')
  lines.push(`- 本档位单个行程最多 ${e.maxDays} 天，用户要求更多天数时说明上限并建议分成多个行程。`)
  return `[档位限制]\n${lines.join('\n')}`
}
