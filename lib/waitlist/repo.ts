export type WaitlistEntry = {
  id: string
  userId: string
  email: string
  createdAt: Date
}

export interface WaitlistRepo {
  upsertForUser: (userId: string, email: string) => Promise<WaitlistEntry>
  findByUserId: (userId: string) => Promise<WaitlistEntry | null>
  listAll: () => Promise<WaitlistEntry[]>
  listPage: (input: { page: number; pageSize: number; q?: string }) => Promise<{
    items: WaitlistEntry[]
    total: number
    page: number
    pageSize: number
  }>
}
