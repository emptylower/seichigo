type Env = {
  MAP_IMAGE_CACHE: R2Bucket
  MAP_IMAGE_MIRROR_CRON_ENABLED: string
  DATABASE_URL: string
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    if (env.MAP_IMAGE_MIRROR_CRON_ENABLED !== '1') {
      console.log('[mirror] cron disabled by flag')
      return
    }

    console.log(`[mirror] tick: cron=${event.cron} scheduledTime=${event.scheduledTime}`)

    if (event.cron === '0 * * * *') {
      // delta cron path (placeholder; implemented in Task 3.5)
    } else {
      // 5-min seed cron path (placeholder; implemented in Tasks 3.2-3.4)
    }
  },
}
