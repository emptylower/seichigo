# AdSense Canonical Host Decision

- Decision date: 2026-08-04
- Status: Task 9 Plan A completed on 2026-08-04.
- Canonical host: `https://seichigo.com`
- Redirect policy: `https://www.seichigo.com/*` redirects permanently to the equivalent `https://seichigo.com/*` URL.
- Status code: `308`.
- Code impact: none. `lib/seo/site.ts`, sitemap URLs, canonical metadata, JSON-LD, and hreflang already use the apex host.

## Implemented Cloudflare Routing

The implementation uses Worker Routes, not a Redirect Rule. Cloudflare Redirect Rules,
Bulk Redirects, and Page Rules have no active rule.

| Worker | Route | Custom Domains | Active version | Traffic | Responsibility |
|--------|-------|----------------|---------------|---------|----------------|
| `seichigo` | `seichigo.com/*` | none | -- | -- | Primary application and canonical apex traffic |
| `seichigo-apex-redirect` | `www.seichigo.com/*` | none | `a9a9b31b` | 100% | Redirect `www` traffic to the apex host |

The redirect Worker uses the URL API and a host allowlist. It returns a permanent
`308` from `www.seichigo.com` to the equivalent `https://seichigo.com` URL,
preserving the path and query string, and returns `404` for non-target hosts. The
script retains an apex-to-`www` transition/rollback branch, but the final route
does not send apex traffic to that Worker.

## Verification

- `https://seichigo.com/en/anime` returned a direct `200` under all three tested user agents.
- The `www` URL made one `308` hop to the apex and then returned `200`; query parameters were preserved.
- Six help/status URLs returned `200`.
- Privacy pages in Chinese, English, and Japanese were normal.
- In the first 20 sitemap URLs, 19 returned direct `200`; the root `/` still returns the existing locale-routing `307` to `/ja`, which remains a residual risk.
