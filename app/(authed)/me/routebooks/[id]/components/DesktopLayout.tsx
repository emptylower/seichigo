'use client'

import { DndContext, DragOverlay, closestCenter } from '@dnd-kit/core'
import type { ReactNode } from 'react'
import type { useTripDnd } from '../hooks/useTripDnd'

type Props = {
  header: ReactNode
  sidebar: ReactNode
  mapStage: ReactNode
  poolPanel: ReactNode
  dragOverlay: ReactNode
  dnd: ReturnType<typeof useTripDnd>
}

/** 桌面三栏编排：左（行程本选择器+天侧栏）/ 中（地图）/ 右（点位池）；拖拽上下文只在这层开 */
export function DesktopLayout({ header, sidebar, mapStage, poolPanel, dragOverlay, dnd }: Props) {
  return (
    <DndContext
      sensors={dnd.sensors}
      collisionDetection={closestCenter}
      onDragStart={dnd.handleDragStart}
      onDragOver={dnd.handleDragOver}
      onDragEnd={(event) => {
        void dnd.handleDragEnd(event)
      }}
      onDragCancel={dnd.handleDragCancel}
    >
      <DragOverlay>{dragOverlay}</DragOverlay>

      <section className="grid gap-5 lg:grid-cols-[420px_minmax(0,1fr)_420px] lg:min-h-[calc(100dvh-9.5rem)]">
        <div className="flex min-h-0 flex-col gap-4 lg:h-[calc(100dvh-9.5rem)]">
          {header}
          <div className="min-h-0 flex-1">{sidebar}</div>
        </div>
        <div className="min-h-0 lg:h-[calc(100dvh-9.5rem)]">{mapStage}</div>
        <div className="min-h-0 lg:h-[calc(100dvh-9.5rem)]">{poolPanel}</div>
      </section>
    </DndContext>
  )
}
