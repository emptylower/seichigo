import { getSiteOrigin } from '@/lib/seo/site'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request) {
  const origin = getSiteOrigin()
  return Response.redirect(`${origin}/brand/web-logo.png`, 302)
}
