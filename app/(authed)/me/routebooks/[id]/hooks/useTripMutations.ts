'use client'

import { useItemMutations } from './useItemMutations'
import { useDayMutations } from './useDayMutations'
import { usePlaceLodgingMutations } from './usePlaceLodgingMutations'
import type { MutationDeps } from './useMutationBase'

/** 所有写操作：乐观更新 + 失败回滚 + 撤销环入栈（reorder/addItem/deleteItem/optimizeDay）。
 *  实现拆在 useItemMutations / useDayMutations / usePlaceLodgingMutations，这里只做组合。 */
export function useTripMutations(deps: MutationDeps) {
  const itemMutations = useItemMutations(deps)
  const dayMutations = useDayMutations(deps)
  const placeLodgingMutations = usePlaceLodgingMutations(deps)

  return {
    ...dayMutations,
    ...itemMutations,
    ...placeLodgingMutations,
  }
}
