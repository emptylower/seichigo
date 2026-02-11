## SeichiGo (MVP)

Code-first Next.js App Router blog for anime pilgrimage content.

**Tech**
- Next.js (App Router, TypeScript)
- Tailwind CSS (pink theme)
- MDX content (self-built content layer)
- Rich text editor (TipTap, Feishu-like bubble/block menus)
- Auth.js (NextAuth) with Email OTP + Prisma
- Supabase Postgres (via `DATABASE_URL`)
- Giscus comments
- SEO: sitemap/robots + dynamic OG

**Getting Started**
- Copy `.env.example` to `.env.local` and fill:
  - `SITE_URL`
  - `DATABASE_URL` (Postgres connection string)
  - `DATABASE_URL_UNPOOLED` (optional but recommended; direct/non-pooling URL for Prisma migrations)
  - `NEXTAUTH_URL`, `NEXTAUTH_SECRET`
  - Email: `RESEND_API_KEY` (recommended) or SMTP (`EMAIL_SERVER` / host+port+user+pass)
  - Giscus public envs
  - `ADMIN_EMAILS` (管理员邮箱白名单)
- Prisma CLI reads `.env` by default. For local dev, you can:
  - `cp .env.local .env`
- Install deps and run:
  - npm install
  - npm run dev
- Run migrations (Prisma):
  - npm run db:generate && npm run db:migrate:dev

**Local Postgres (Docker)**
- Start:
  - docker run --name seichigo-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=seichigo -p 5432:5432 -v seichigo_pg:/var/lib/postgresql/data -d postgres:16
- Set:
  - DATABASE_URL=postgresql://postgres:postgres@localhost:5432/seichigo?schema=public

**Anitabi Sync On Vercel (store in Vercel Postgres / Nano DB)**
- Required env vars in Vercel Project:
  - `DATABASE_URL` / `DATABASE_URL_UNPOOLED` (point to your Vercel Postgres)
  - `ANITABI_CRON_SECRET` (random long secret)
  - Optional: `ANITABI_API_BASE_URL`, `ANITABI_SITE_BASE_URL`
- This repo schedules:
  - Daily full: `/api/cron/anitabi/daily` at `10 3 * * *` (UTC)
- Note for Vercel Hobby:
  - Hourly crons are not supported. Use the daily full sync above, and call `/api/cron/anitabi/hourly` manually or from an external scheduler if you still need delta updates.
- One-time manual bootstrap after deploy:
  - `curl -H "Authorization: Bearer $ANITABI_CRON_SECRET" https://<your-domain>/api/cron/anitabi/daily`
- Quick check:
  - Open `https://<your-domain>/api/anitabi/bootstrap?locale=zh&tab=latest`
  - If `cards` is non-empty, sync data is already in your Vercel DB.

**Admin Login**
- Visit `/auth/signin` and use an email listed in `ADMIN_EMAILS`.
- Default password: `112233` (override via `ADMIN_DEFAULT_PASSWORD`).
- First successful login forces password change at `/auth/change-password`.
- Manual reset (accepted): set the admin user's `passwordHash` to `NULL` and `mustChangePassword=true` in DB, then login again with default password.

**Content**
- Place Chinese articles at `content/zh/posts/*.mdx`.
- See template and components in `content/zh/posts/README.md`.

**SEO Audit**
- Audit deployed site (auto-discover URLs from sitemap):
  - `npm run seo:audit -- --base-url https://seichigo.com`
- Audit local dev server:
  - `npm run dev -- -p 3000`
  - `npm run seo:audit -- --base-url http://localhost:3000 --include-private`

**Notes**
- Email sign-in: in development, if neither Resend nor SMTP is configured, the OTP email content is logged to server console.
- Accounts created via email OTP without a password are redirected to `/auth/set-password` on first login.
- Author center: `/submit` (drafts + richtext editor + submit/withdraw).
- Admin review: `/admin/review` (approve/reject in_review articles).
- Images: `/assets/:id` supports `?w=<width>&q=<quality>` to serve resized WebP variants; public posts use progressive loading (blur → ~480p → ~720p) and load original only on click.
- Legacy submissions API: `/api/submissions` has basic anti-abuse (per-user/IP per day). Tune with env vars.
