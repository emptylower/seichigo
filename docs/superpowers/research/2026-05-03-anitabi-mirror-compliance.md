# Anitabi Mirror Compliance Research (D0 for PR3)

**Date:** 2026-05-03
**Author:** PR3 implementation
**Source documentation:** https://github.com/anitabi/anitabi.cn-document (commit `adb62b65ef7f5c18e6c98051a6b69000d5e02013`)

## Findings
1. **Rate limit / QPS**: No documented limit was found in `README.md`, `api.md`, or any repository file matching `镜像|mirror|rate|User-Agent|robots`. PR3's planned `5 req/s` remains a self-imposed conservative limit rather than an upstream requirement.
2. **User-Agent requirements**: No documented `User-Agent` requirement was found in the documentation repo or the fetched `robots.txt` endpoints.
3. **Attribution requirements**: `api.md` explicitly says consumers of point-detail image data should display `origin` text and link `originURL`, and states the shared data follows `CC BY-NC-SA 4.0`. This is the only explicit usage/compliance requirement found in the docs.
4. **Cache TTL minimums**: No documented minimum cache TTL was found. PR3's `s-maxage=86400` does not conflict with any published requirement.
5. **Disallowed resources**: `api.md` explicitly says not to request the main domain `https://anitabi.cn/` for resources or data structures because stability is not guaranteed. `api.md` also warns against using full-size screenshots in display UIs because heavy full-size traffic puts pressure on the server.
6. **Contact channel**: No direct mirror/compliance contact channel was documented. The repo exposes GitHub issues as a public discussion path, and the README says to "contact" the maintainer for admin access but gives no handle or email.

## Source notes
- `README.md` contains no mirror/rate/UA/robots policy text beyond a generic maintainer-contact note and the docs/API links.
- `api.md` is the only relevant primary source for image usage policy:
  - `api.md:8-11` publishes `https://api.anitabi.cn/` and `https://image.anitabi.cn/` as the stable bases and says not to request the main domain.
  - `api.md:87-90` warns that full-size screenshot requests create server pressure and are not recommended for display interfaces.
  - `api.md:107-112` requires `origin` + `originURL` attribution behavior and cites `CC BY-NC-SA 4.0`.

## robots.txt snapshot

Timestamp: `2026-05-03 02:29:23 CST (+0800)`

```text
$ curl -sS https://image.anitabi.cn/robots.txt
error code: 520
```

Timestamp: `2026-05-03 02:29:23 CST (+0800)`

```text
$ curl -sS https://anitabi.cn/robots.txt
```

Follow-up transport checks used for interpretation:
- `curl -i -sS https://image.anitabi.cn/robots.txt` returned `HTTP/2 520` from Cloudflare with body `error code: 520`.
- `curl -i -sS https://anitabi.cn/robots.txt` returned `HTTP/2 301` redirecting to `https://www.anitabi.cn/` with an empty body.
- `curl -i -L -sS https://www.anitabi.cn/robots.txt` returned `HTTP/2 200` and:

```text
User-agent: *
allow: /
```

## Compliance verdict
- [x] GREEN — proceed with PR3 §4 throttling values as designed
- [ ] YELLOW — adjust throttle to <X req/s>; UA to <value>; expected backfill timeline shifts to ~<N> days
- [ ] RED — abort D4-γ; replan with D4-α/β

Rationale:
- No published Anitabi policy contradicts `5 req/s`, the planned custom `User-Agent`, or `s-maxage=86400`.
- The only hard documented boundary is to avoid the apex site domain for resource fetching. PR3 mirrors `image.anitabi.cn` resources and should keep all crawler/fetch code on the documented API/image hosts.
- Attribution is an actual compliance requirement, but it is already compatible with PR3's existing D5-γ direction rather than a reason to change throttle values.

## Parameter alignment table
| Spec value | Anitabi requirement | Final PR3 value |
|---|---|---|
| 5 req/s | No documented QPS limit | 5 req/s |
| UA `SeichiGoMirror/1.0 (+https://seichigo.com)` | No documented UA requirement | `SeichiGoMirror/1.0 (+https://seichigo.com)` |
| s-maxage 86400 | No documented minimum TTL | `s-maxage=86400` |

## Evidence index
- Docs repo commit: `adb62b65ef7f5c18e6c98051a6b69000d5e02013`
- Relevant files searched: `README.md`, `api.md`, `admin-tutorial/import-from-google.md`, plus repo-wide `rg -n -i '镜像|mirror|rate|user-agent|robots'`
- Key excerpts:
  - `api.md:8-11`
  - `api.md:87-90`
  - `api.md:107-112`
  - `README.md:15-17`
  - `admin-tutorial/import-from-google.md:46`
