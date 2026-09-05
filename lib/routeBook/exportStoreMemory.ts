import type { RouteBookExportCreateInput, RouteBookExportStore } from './exportStore'

export type MemoryRouteBookExportRecord = RouteBookExportCreateInput & { id: string }

export class MemoryRouteBookExportStore implements RouteBookExportStore {
  readonly books: MemoryRouteBookExportRecord[] = []
  private seq = 0

  async findBySourcePlanId(userId: string, sourcePlanId: string): Promise<{ id: string } | null> {
    const found = this.books.find((book) => {
      if (book.userId !== userId) return false
      const metadata = book.metadata as { sourcePlanId?: unknown } | null
      return metadata?.sourcePlanId === sourcePlanId
    })
    return found ? { id: found.id } : null
  }

  async createWithPoints(input: RouteBookExportCreateInput): Promise<{ id: string }> {
    this.seq += 1
    const record: MemoryRouteBookExportRecord = {
      id: `rb-${this.seq}`,
      userId: input.userId,
      title: input.title,
      status: input.status,
      metadata: structuredClone(input.metadata),
      points: structuredClone(input.points),
    }
    this.books.push(record)
    return { id: record.id }
  }
}
