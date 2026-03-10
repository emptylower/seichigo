'use client'

import AnitabiMapLayout from './anitabi/AnitabiMapLayout'
import { useAnitabiMapController } from './anitabi/useAnitabiMapController'
import type { Props } from './anitabi/shared'

export default function AnitabiMapPageClientImpl(props: Props) {
  const layoutProps = useAnitabiMapController(props)
  return <AnitabiMapLayout {...layoutProps} />
}
