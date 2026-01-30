"use client"

type SystemInfo = {
  siteUrl: string
  authUrl: string
  databaseConfigured: boolean
  emailConfigured: boolean
  version: string
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="font-semibold text-gray-900">{title}</h2>
      <div className="space-y-2 text-sm text-gray-700">
        {children}
      </div>
    </section>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-gray-100 pb-2 last:border-0 last:pb-0">
      <span className="font-medium text-gray-600">{label}</span>
      <span className="text-right font-mono text-gray-900">{value}</span>
    </div>
  )
}

function StatusBadge({ configured }: { configured: boolean }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
      configured 
        ? 'bg-emerald-100 text-emerald-800' 
        : 'bg-gray-100 text-gray-600'
    }`}>
      {configured ? '已配置' : '未配置'}
    </span>
  )
}

export default function AdminSettingsClient() {
  const info: SystemInfo = {
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || '未配置',
    authUrl: process.env.NEXTAUTH_URL || '未配置',
    databaseConfigured: !!process.env.DATABASE_URL,
    emailConfigured: !!(process.env.RESEND_API_KEY || process.env.EMAIL_SERVER),
    version: '0.1.0',
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">系统设置</h1>
        <p className="mt-1 text-sm text-gray-600">查看系统配置信息（只读）</p>
      </div>

      <div className="space-y-4">
        <InfoCard title="站点信息">
          <InfoRow label="站点 URL" value={info.siteUrl} />
          <InfoRow label="认证 URL" value={info.authUrl} />
        </InfoCard>

        <InfoCard title="数据库">
          <div className="flex items-center justify-between">
            <span className="font-medium text-gray-600">连接状态</span>
            <StatusBadge configured={info.databaseConfigured} />
          </div>
          <p className="text-xs text-gray-500 mt-2">
            数据库连接字符串已{info.databaseConfigured ? '' : '未'}配置（出于安全考虑不显示实际值）
          </p>
        </InfoCard>

        <InfoCard title="邮件服务">
          <div className="flex items-center justify-between">
            <span className="font-medium text-gray-600">配置状态</span>
            <StatusBadge configured={info.emailConfigured} />
          </div>
          <p className="text-xs text-gray-500 mt-2">
            邮件服务（Resend 或 SMTP）已{info.emailConfigured ? '' : '未'}配置（出于安全考虑不显示 API 密钥）
          </p>
        </InfoCard>

        <InfoCard title="系统版本">
          <InfoRow label="当前版本" value={`v${info.version}`} />
        </InfoCard>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start gap-3">
          <svg className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="text-sm">
            <p className="font-medium text-amber-900">只读模式</p>
            <p className="mt-1 text-amber-700">
              此页面仅用于查看系统配置状态。如需修改配置，请编辑 <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-xs">.env.local</code> 文件并重启服务。
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
