import { COMPLETE_AVATAR_MAX_ZOOM } from './shared'

export function shouldLoadCompleteModeCovers(
  detailBangumiId: number | null,
  currentZoom: number,
): boolean {
  return detailBangumiId == null && currentZoom < COMPLETE_AVATAR_MAX_ZOOM
}
