# anitabi-mirror Worker

Cron-driven worker that backfills R2 with anitabi cover/point images.
Spec: docs/superpowers/specs/2026-05-03-map-image-pr3-r2-mirror-design.md

Deploy: `npm run deploy` from this directory.
Before enabling cron in Cloudflare, set the required secret with `npm exec wrangler -- secret put DATABASE_URL`.
