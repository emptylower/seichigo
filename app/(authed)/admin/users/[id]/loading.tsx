import { AdminSkeleton } from '@/components/admin/state/AdminSkeleton'

export default function AdminUserDetailLoading() {
  return (
    <div className="space-y-4">
      <AdminSkeleton rows={2} compact />
      <AdminSkeleton rows={8} />
    </div>
  )
}
