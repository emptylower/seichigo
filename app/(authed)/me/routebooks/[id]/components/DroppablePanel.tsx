import { type ReactNode } from 'react'
import { useDroppable } from '@dnd-kit/core'

export function DroppablePanel({
  id,
  className,
  activeClassName,
  children,
}: {
  id: string
  className: string
  activeClassName: string
  children: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id })

  return (
    <div ref={setNodeRef} className={`${className} ${isOver ? activeClassName : ''}`}>
      {children}
    </div>
  )
}
