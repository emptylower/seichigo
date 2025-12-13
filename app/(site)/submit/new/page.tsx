import { getServerAuthSession } from '@/lib/auth/session'
import NewArticleClient from './ui'

export const metadata = { title: '新建文章' }

export default async function NewArticlePage() {
  const session = await getServerAuthSession()
  const user = session?.user?.id ? { id: session.user.id, email: session.user.email } : null
  return <NewArticleClient user={user} />
}

