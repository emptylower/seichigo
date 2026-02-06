export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerAuthSession } from '@/lib/auth/session'
import { SpokeGithubClient, getSpokeGithubConfigFromEnv } from '@/lib/seo/spokeFactory/github'

const bodySchema = z.object({
  mode: z.enum(['preview', 'generate']),
  locales: z.array(z.enum(['zh', 'en', 'ja'])).min(1),
  scope: z.literal('all'),
  maxTopics: z.number().int().min(1).max(30),
})

function isGenerateEnabled(): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env.SEO_AUTOMATION_ENABLE_GENERATE || '').toLowerCase())
}

export async function POST(request: Request) {
  const session = await getServerAuthSession()
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const body = await request.json().catch(() => null)
    const input = bodySchema.parse(body)

    if (input.mode === 'generate' && !isGenerateEnabled()) {
      return NextResponse.json(
        { error: 'Generate mode is disabled. Set SEO_AUTOMATION_ENABLE_GENERATE=1 to enable.' },
        { status: 403 }
      )
    }

    const config = getSpokeGithubConfigFromEnv()
    const client = new SpokeGithubClient({ token: config.token, repo: config.repo })
    const result = await client.dispatchAndResolveRun({
      workflowFile: config.workflowFile,
      ref: config.baseBranch,
      inputs: {
        mode: input.mode,
        locales: input.locales.join(','),
        scope: input.scope,
        maxTopics: String(input.maxTopics),
        baseBranch: config.baseBranch,
      },
      timeoutMs: 40000,
    })

    return NextResponse.json({
      runId: result.runId,
      runUrl: result.runUrl,
      mode: input.mode,
      queuedAt: new Date().toISOString(),
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || 'Invalid input' }, { status: 400 })
    }
    console.error('[api/admin/seo/spoke-factory/run] POST failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to dispatch workflow' },
      { status: 500 }
    )
  }
}
