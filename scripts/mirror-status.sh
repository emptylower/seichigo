#!/usr/bin/env bash
# Quick mirror status snapshot. Requires ADMIN_COOKIE env var with logged-in admin session cookie.
set -euo pipefail

if [[ -z "${ADMIN_COOKIE:-}" ]]; then
  echo "ADMIN_COOKIE env var required" >&2
  exit 1
fi

for cmd in curl jq; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
done

BASE_URL="${BASE_URL:-https://www.seichigo.com}"
STATUS_URL="${BASE_URL%/}/api/admin/anitabi/image-mirror/status"

curl -sS -b "$ADMIN_COOKIE" "$STATUS_URL" \
  | jq -er '
    def fmt_rate:
      if . == null then "0"
      elif . >= 1 then ((. * 100 | round) / 100 | tostring)
      else ((. * 1000 | round) / 1000 | tostring)
      end;
    def fmt_eta:
      if . == null then "unknown"
      elif . >= 10 then (round | tostring) + "h"
      else ((. * 10 | round) / 10 | tostring) + "h"
      end;
    if (.error? | type) == "string" then
      "API error: \(.error)" | halt_error(1)
    else
      .totals as $t |
      .bootstrap as $b |
      .rates as $r |
      "mirrored=\($t.mirrored // 0)/\($t.all // 0)  pending=\($t.pending // 0)  failed=\($t.failed // 0)  skipped_404=\($t.skipped_404 // 0)\n" +
      "bootstrap.bangumi=\($b.bangumiCompleted // false)  bootstrap.point=\($b.pointCompleted // false)\n" +
      "rate(1h)=\(($r.ratePerSec // 0) | fmt_rate)/s  ETA=\(($r.estimatedRemainingHours // null) | fmt_eta)"
    end
  '
