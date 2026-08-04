# AdSense Canonical Host Decision

- Decision date: 2026-08-04
- Canonical host: `https://seichigo.com`
- Redirect policy: `https://www.seichigo.com/*` redirects permanently to the equivalent `https://seichigo.com/*` URL.
- Status code: `308` preferred (`301` is also acceptable if required by the Cloudflare rule type).
- Code impact: none. `lib/seo/site.ts`, sitemap URLs, canonical metadata, JSON-LD, and hreflang already use the apex host.

## Cloudflare Change

The previous redirect direction was `seichigo.com` to `www.seichigo.com`. The Cloudflare Redirect Rule must be reversed:

- Match: hostname equals `www.seichigo.com`
- Target: `https://seichigo.com${uri}`
- Preserve the path and query string.

The rule should be verified after deployment with an apex URL, the equivalent `www` URL, and an AdSense crawler user agent.
