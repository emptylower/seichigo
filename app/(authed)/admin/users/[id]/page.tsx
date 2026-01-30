import { Suspense } from 'react'
import AdminUserDetailClient from './ui'

export default async function AdminUserDetailPage({ 
  params 
}: { 
  params: Promise<{ id: string }> 
}) {
  const { id } = await params
  
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <AdminUserDetailClient id={id} />
    </Suspense>
  )
}
