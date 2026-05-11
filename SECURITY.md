# Security Policy / 安全策略

Thank you for helping keep SeichiGo and its users safe.
感谢你为 SeichiGo 与其用户的安全所做的努力。

## Supported Versions

Only the latest deployed release on `main` is actively patched.
Older branches and forks are not covered by this policy.

只有部署在 `main` 上的最新版本会持续接收安全补丁。
旧分支与 fork 不在本策略覆盖范围内。

## Reporting a Vulnerability / 漏洞上报

**Please do not file a public GitHub issue for security problems.**
**请不要通过公开 issue 上报安全问题。**

Instead, email the maintainer privately:

私下邮件联系维护者：

- **Contact:** `ljj231428@gmail.com`
- **Subject prefix:** `[seichigo-security]`
- **PGP:** on request

Include, where possible:
邮件中尽可能包含：

1. A short description of the issue and its impact / 问题简述与影响面
2. Reproduction steps or proof-of-concept / 复现步骤或 PoC
3. Affected URLs, commits, or files / 受影响的 URL / commit / 文件
4. Any suggested mitigation / 任何建议的缓解方案

## Disclosure Process / 披露流程

| Stage | Target SLA |
|-------|------------|
| Acknowledgement / 收到回执 | within 72 hours / 72 小时内 |
| Initial triage / 初步定性 | within 7 days / 7 天内 |
| Fix or mitigation / 修复或缓解 | within 30 days for high severity / 高危 30 天内 |
| Public disclosure / 公开披露 | coordinated, after fix is deployed / 修复部署后协同披露 |

We aim to credit reporters in `CHANGELOG.md` and release notes
unless you request anonymity.

我们会在 `CHANGELOG.md` 与发布说明中致谢上报者，除非你希望匿名。

## In Scope / 受理范围

- The deployed application at <https://seichigo.com>
- Source code in this repository on `main`
- Cloudflare Worker deployment and bindings declared in `wrangler.jsonc`
- Anitabi sync / R2 mirror pipelines (`lib/anitabi`, `workers/`)
- Authentication and admin moderation flows

## Out of Scope / 不受理范围

- Vulnerabilities in upstream dependencies that already have a public CVE
  (please report them upstream)
- Self-XSS that requires the victim to paste content into devtools
- Reports based purely on missing security headers without an exploit chain
- Denial-of-service relying on volumetric attacks
- Findings from automated scanners without a reproducible exploit

## Hall of Fame / 致谢墙

Reporters who help us harden SeichiGo will be listed here after
coordinated disclosure (opt-in).

经协同披露后的致谢清单将持续在此更新（自愿）。
