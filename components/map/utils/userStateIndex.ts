type PointState = {
  pointId: string
  state: 'want_to_go' | 'planned' | 'checked_in'
}

export function buildUserStateIndex(
  meState: PointState[]
): Map<string, 'want_to_go' | 'planned' | 'checked_in'> {
  const index = new Map<string, 'want_to_go' | 'planned' | 'checked_in'>()
  for (const ps of meState) {
    index.set(ps.pointId, ps.state)
  }
  return index
}
