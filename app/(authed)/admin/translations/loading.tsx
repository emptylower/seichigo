import { AdminSkeleton } from '@/components/admin/state/AdminSkeleton'

export default function AdminTranslationsLoading() {
  return (
    <div className="space-y-4">
      <AdminSkeleton rows={3} compact />
      <AdminSkeleton rows={8} />
    </div>
  )
}
