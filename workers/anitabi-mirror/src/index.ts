export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    void ctx
    const cronEnabled = String(env.MAP_IMAGE_MIRROR_CRON_ENABLED) === '1'

    if (!cronEnabled) {
      console.log('[mirror] cron disabled by flag')
      return
    }

    console.log(`[mirror] tick: cron=${controller.cron} scheduledTime=${controller.scheduledTime}`)

    if (controller.cron === '0 * * * *') {
      // delta cron path (placeholder; implemented in Task 3.5)
    } else {
      // 5-min seed cron path (placeholder; implemented in Tasks 3.2-3.4)
    }
  },
} satisfies ExportedHandler<Env>
