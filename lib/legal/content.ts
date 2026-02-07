export type LegalLocale = 'zh' | 'en' | 'ja'
export type LegalDocumentType = 'privacy' | 'terms'

export type LegalSection = {
  heading: string
  paragraphs?: string[]
  bullets?: string[]
}

export type LegalDocument = {
  title: string
  summary: string
  effectiveDateLabel: string
  updatedDateLabel: string
  contactLabel: string
  effectiveDate: string
  updatedDate: string
  contactEmail: string
  sections: LegalSection[]
  closingNote?: string
}

const CONTACT_EMAIL = 'ljj231428@gmail.com'

const documents: Record<LegalLocale, Record<LegalDocumentType, LegalDocument>> = {
  zh: {
    privacy: {
      title: '隐私政策',
      summary:
        '本政策说明 SeichiGo 在你使用网站过程中如何收集、使用、存储和保护个人信息。内容依据当前项目实现编写，覆盖登录、投稿、评论、收藏、图片上传与分析统计等功能。',
      effectiveDateLabel: '生效日期',
      updatedDateLabel: '最近更新',
      contactLabel: '联系我们',
      effectiveDate: '2026-02-07',
      updatedDate: '2026-02-07',
      contactEmail: CONTACT_EMAIL,
      sections: [
        {
          heading: '1. 适用范围',
          paragraphs: [
            '本政策适用于 SeichiGo 主站（含中文、英文、日文页面）及与账号、内容互动相关的 API 能力。',
            '你访问或使用本服务，即表示你已阅读并理解本政策。',
          ],
        },
        {
          heading: '2. 我们收集的信息',
          bullets: [
            '账号与身份信息：邮箱地址、账号昵称、头像 URL、认证会话信息（基于 NextAuth）。',
            '安全认证数据：密码登录场景下的密码哈希（scrypt）；邮箱验证码场景下的验证码哈希与盐值。',
            '个人资料信息：你在“我的设置”中主动填写的简介与社交链接（如 GitHub、X、微博、B 站）。',
            '内容与互动信息：投稿、文章修订、评论、评论点赞、收藏、候补列表（waitlist）状态。',
            '上传文件信息：你上传的图片文件本体、文件名和 MIME 类型。',
            '风控信息：为验证码发送和投稿限流计算的 IP 哈希（明文 IP 不作为业务展示数据保存）。',
            '设备与访问信息：浏览器基础信息、请求头中的国家/地区标记（用于首访语言重定向）。',
          ],
        },
        {
          heading: '3. 我们如何使用信息',
          bullets: [
            '提供账号登录、身份验证、会话维持和账号安全能力。',
            '支持投稿、审核、评论、收藏、个人资料管理等社区功能。',
            '执行风控与反滥用（如验证码冷却、提交频率限制）。',
            '发送验证码邮件、账号安全相关通知。',
            '改进产品体验与内容质量（例如语言偏好、页面访问统计）。',
          ],
        },
        {
          heading: '4. Cookie 与分析工具',
          bullets: [
            '我们使用 `NEXT_LOCALE` Cookie 记录你的语言偏好，用于后续访问自动进入对应语言页面。',
            '我们使用 Google Analytics（测量 ID：`G-F7E894BEWR`）统计访问表现，用于产品与内容优化。',
            '认证能力依赖会话 Cookie；若你禁用相关 Cookie，部分登录能力将不可用。',
          ],
        },
        {
          heading: '5. 信息共享与第三方处理',
          paragraphs: [
            '我们不会出售你的个人信息。仅在实现服务所必需或法律要求时，向以下类别第三方提供数据：',
          ],
          bullets: [
            '基础设施与数据库服务商（用于网站托管、数据存储与访问）。',
            '邮件服务商（Resend 或你部署时配置的 SMTP 服务商）用于发送验证码邮件。',
            '分析服务商（Google Analytics）用于聚合统计分析。',
            '在管理员启用相关功能时，内容可能被发送到外部 AI/SEO 服务（如 Gemini、Google Search Console、SerpAPI）以完成翻译或 SEO 任务。',
            '司法机关、监管机构或法律要求的其他披露场景。',
          ],
        },
        {
          heading: '6. 数据存储与安全',
          bullets: [
            '数据主要存储在你部署时配置的 PostgreSQL 数据库中。',
            '密码以哈希形式存储，不保存明文密码；验证码以哈希形式保存并设定过期时间。',
            '我们采用服务端校验、权限控制与输入清洗（如富文本安全过滤）降低安全风险。',
            '互联网传输和存储不存在绝对安全，我们会持续改进安全措施。',
          ],
        },
        {
          heading: '7. 数据保留',
          bullets: [
            '账号、投稿、评论、收藏等数据会在服务运营期间保留，除非你提出删除请求或法律另有要求。',
            '邮箱验证码记录带有有效期，过期或使用后即失效。',
            '为安全和运营目的，部分日志信息会在合理期限内保留。',
          ],
        },
        {
          heading: '8. 你的权利',
          bullets: [
            '你可以在“我的设置”中修改昵称、头像、个人简介和社交链接。',
            '你可以联系我们申请访问、更正或删除与你相关的数据。',
            '当前版本暂未提供站内“一键销号”功能，如需注销请通过联系邮箱提交申请。',
          ],
        },
        {
          heading: '9. 未成年人',
          paragraphs: [
            '若你为未成年人，请在监护人指导下使用本服务。若监护人认为我们在未经同意情况下收集了未成年人信息，请联系我们处理。',
          ],
        },
        {
          heading: '10. 政策更新',
          paragraphs: [
            '我们可能根据产品迭代、法律法规变化更新本政策，并在本页更新“最近更新”日期。重大变更将以站内公告或其他合理方式提示。',
          ],
        },
      ],
      closingNote:
        '本政策用于说明当前 SeichiGo 项目实现中的数据处理方式，不构成任何司法辖区下的个案法律意见。',
    },
    terms: {
      title: '用户协议',
      summary:
        '本协议约定你使用 SeichiGo 服务时的权利与义务，涵盖账号、内容发布、社区互动、知识产权、责任限制与违规处理规则。',
      effectiveDateLabel: '生效日期',
      updatedDateLabel: '最近更新',
      contactLabel: '联系我们',
      effectiveDate: '2026-02-07',
      updatedDate: '2026-02-07',
      contactEmail: CONTACT_EMAIL,
      sections: [
        {
          heading: '1. 协议接受',
          paragraphs: [
            '你访问或使用 SeichiGo，即表示你同意遵守本协议及与本服务相关的其他规则。',
            '若你不同意本协议任一条款，请停止访问和使用本服务。',
          ],
        },
        {
          heading: '2. 账号与安全',
          bullets: [
            '你应提供真实、准确、可用的邮箱信息并妥善保管登录凭据。',
            '你应对使用你账号发生的行为负责；发现异常应及时联系我们。',
            '我们可在必要时要求你完成额外验证，或对风险账号采取限制措施。',
          ],
        },
        {
          heading: '3. 用户内容与行为规范',
          bullets: [
            '你发布的投稿、评论、图片及其他内容应合法、真实且不侵犯他人权利。',
            '禁止发布违法违规、诽谤、骚扰、仇恨、色情、恶意营销、恶意脚本或其他不当内容。',
            '你应尊重圣地巡礼相关场所与居民，不得发布鼓励危险、破坏秩序或侵扰他人的内容。',
            '你不得以自动化或攻击性方式滥用接口、绕过限流或破坏服务稳定性。',
          ],
        },
        {
          heading: '4. 内容审核与处置',
          bullets: [
            'SeichiGo 对投稿和评论保留审核、编辑、拒绝发布、下架或删除的权利。',
            '对于违反协议或存在风险的账号，我们可采取警告、限流、禁用功能或封禁等措施。',
            '管理员在必要时可基于社区治理和合规要求处理用户内容。',
          ],
        },
        {
          heading: '5. 知识产权与授权',
          bullets: [
            '你对自己依法享有权利的原创内容保留权利。',
            '为提供服务，你授予 SeichiGo 在全球范围内、非独占、可再许可的许可，用于存储、展示、分发、改编和推广你提交的内容（仅限服务相关用途）。',
            'SeichiGo 的站点结构、品牌标识、程序代码与平台内容受相关知识产权法律保护。',
          ],
        },
        {
          heading: '6. 第三方服务与外部链接',
          paragraphs: [
            '本服务可能包含第三方链接或集成（如邮件服务、统计服务、地图链接等）。第三方服务由其自身条款和政策约束，SeichiGo 不对其独立行为承担责任。',
          ],
        },
        {
          heading: '7. 服务可用性与责任限制',
          bullets: [
            '服务按“现状”和“可用”提供，我们不承诺服务持续无中断、无错误或绝对满足你的特定目标。',
            '在法律允许范围内，对于因你使用或无法使用本服务导致的间接损失、附带损失或利润损失，我们不承担责任。',
            '因不可抗力、第三方服务故障、网络与系统故障导致的服务异常，我们将在合理范围内处理，但不承担超出法定义务的责任。',
          ],
        },
        {
          heading: '8. 协议变更、终止与适用规则',
          bullets: [
            '我们可根据业务和法规变化更新本协议，更新后将发布在本页面。',
            '若你在协议更新后继续使用服务，视为接受更新后的协议。',
            '若你严重违反本协议，我们可暂停或终止向你提供部分或全部服务。',
            '本协议的解释和争议处理应遵守运营主体所在地适用法律；如与强制性法律规定冲突，以强制性规定为准。',
          ],
        },
      ],
      closingNote:
        '若你对协议条款有疑问，或需要提交侵权、违规与账号处理申诉，请通过联系邮箱与我们沟通。',
    },
  },
  en: {
    privacy: {
      title: 'Privacy Policy',
      summary:
        'This policy explains how SeichiGo collects, uses, stores, and protects personal data in our current implementation, including login, submissions, comments, favorites, uploads, and analytics.',
      effectiveDateLabel: 'Effective Date',
      updatedDateLabel: 'Last Updated',
      contactLabel: 'Contact',
      effectiveDate: 'February 7, 2026',
      updatedDate: 'February 7, 2026',
      contactEmail: CONTACT_EMAIL,
      sections: [
        {
          heading: '1. Scope',
          paragraphs: [
            'This policy applies to the SeichiGo website (Chinese, English, and Japanese pages) and related account/content APIs.',
            'By using SeichiGo, you acknowledge this policy.',
          ],
        },
        {
          heading: '2. Data We Collect',
          bullets: [
            'Account and identity data: email address, display name, avatar URL, and session data (NextAuth).',
            'Authentication security data: password hash (scrypt) for password login, OTP hash and salt for email code login.',
            'Profile data you provide: bio and social links (for example GitHub, X, Weibo, Bilibili).',
            'Content and interactions: submissions, revisions, comments, comment likes, favorites, and waitlist status.',
            'Upload data: image file bytes, file name, and MIME type.',
            'Abuse-prevention data: hashed IP used for OTP and submission rate limiting.',
            'Technical request data: browser basics and country/region header used for first-visit locale redirect.',
          ],
        },
        {
          heading: '3. How We Use Data',
          bullets: [
            'To provide login, authentication, session management, and account security.',
            'To operate submissions, moderation, comments, favorites, and profile features.',
            'To enforce anti-abuse controls such as OTP cooldown and submission rate limits.',
            'To send verification emails and account-related notices.',
            'To improve product and content quality through language preference and traffic analysis.',
          ],
        },
        {
          heading: '4. Cookies and Analytics',
          bullets: [
            'We use the `NEXT_LOCALE` cookie to remember your language preference.',
            'We use Google Analytics (Measurement ID: `G-F7E894BEWR`) for aggregate traffic analytics.',
            'Authentication relies on session cookies; disabling them may break sign-in features.',
          ],
        },
        {
          heading: '5. Sharing and Third-Party Processing',
          paragraphs: [
            'We do not sell personal data. We share data only when required to provide the service or by law.',
          ],
          bullets: [
            'Infrastructure and database providers for hosting and storage.',
            'Email providers (Resend or configured SMTP provider) for OTP delivery.',
            'Analytics provider (Google Analytics) for aggregated reporting.',
            'If enabled by admins, content may be sent to external AI/SEO services (for example Gemini, Google Search Console, SerpAPI) for translation or SEO workflows.',
            'Regulators, courts, or law enforcement where legally required.',
          ],
        },
        {
          heading: '6. Storage and Security',
          bullets: [
            'Data is stored in the PostgreSQL database configured by deployment.',
            'Passwords are stored as hashes; OTP values are hashed and time-limited.',
            'We use server-side validation, access control, and content sanitization to reduce security risks.',
            'No method of storage or transmission is absolutely secure, and we continue improving controls.',
          ],
        },
        {
          heading: '7. Retention',
          bullets: [
            'Account, submission, comment, and favorite data may be retained while the service is active unless deletion is requested or required by law.',
            'OTP records expire and become invalid after use or timeout.',
            'Operational/security logs may be retained for a reasonable period.',
          ],
        },
        {
          heading: '8. Your Choices',
          bullets: [
            'You can update profile fields in account settings.',
            'You can request access, correction, or deletion by contacting us.',
            'One-click self-service account deletion is not available in the current version.',
          ],
        },
        {
          heading: '9. Children',
          paragraphs: [
            'If you are under applicable age requirements, please use the service with guardian guidance. Guardians can contact us regarding child data concerns.',
          ],
        },
        {
          heading: '10. Policy Changes',
          paragraphs: [
            'We may update this policy due to product or legal changes. We will revise the "Last Updated" date on this page and provide additional notice when required.',
          ],
        },
      ],
      closingNote:
        'This policy reflects current SeichiGo implementation details and does not constitute case-specific legal advice.',
    },
    terms: {
      title: 'Terms of Service',
      summary:
        'These Terms define your rights and obligations when using SeichiGo, including account rules, user content, moderation, intellectual property, and liability limitations.',
      effectiveDateLabel: 'Effective Date',
      updatedDateLabel: 'Last Updated',
      contactLabel: 'Contact',
      effectiveDate: 'February 7, 2026',
      updatedDate: 'February 7, 2026',
      contactEmail: CONTACT_EMAIL,
      sections: [
        {
          heading: '1. Acceptance',
          paragraphs: [
            'By accessing or using SeichiGo, you agree to these Terms and related rules.',
            'If you do not agree, you must stop using the service.',
          ],
        },
        {
          heading: '2. Accounts and Security',
          bullets: [
            'You must provide a valid email and keep your credentials secure.',
            'You are responsible for activity under your account.',
            'We may require additional verification or apply restrictions to suspicious accounts.',
          ],
        },
        {
          heading: '3. User Content and Conduct',
          bullets: [
            'You may submit content only if it is lawful, accurate, and does not infringe the rights of others.',
            'No illegal, abusive, hateful, harassing, pornographic, malicious, or deceptive content.',
            'Respect real-world locations and residents related to anime pilgrimage topics.',
            'Do not abuse APIs, evade rate limits, scrape aggressively, or disrupt service stability.',
          ],
        },
        {
          heading: '4. Moderation and Enforcement',
          bullets: [
            'SeichiGo may review, edit, reject, unpublish, or remove user content.',
            'We may warn, rate-limit, suspend, or terminate accounts for violations or safety risks.',
            'Admin actions may be taken for legal compliance and community governance.',
          ],
        },
        {
          heading: '5. Intellectual Property and License',
          bullets: [
            'You retain rights to content you lawfully own.',
            'You grant SeichiGo a worldwide, non-exclusive, sublicensable license to host, display, distribute, adapt, and promote submitted content for service operation.',
            'SeichiGo brand assets, code, and platform materials are protected by applicable intellectual property laws.',
          ],
        },
        {
          heading: '6. Third-Party Services',
          paragraphs: [
            'The service may include external links or third-party integrations (for example email, analytics, and maps). Those services are governed by their own terms and policies.',
          ],
        },
        {
          heading: '7. Disclaimer and Liability Limits',
          bullets: [
            'The service is provided on an "as is" and "as available" basis without guarantees of uninterrupted operation or fitness for your specific purpose.',
            'To the extent permitted by law, SeichiGo is not liable for indirect, incidental, special, or consequential damages from use of the service.',
            'We are not liable beyond mandatory legal obligations for failures caused by force majeure, network outages, or third-party service incidents.',
          ],
        },
        {
          heading: '8. Changes, Termination, and Governing Rules',
          bullets: [
            'We may update these Terms and publish the latest version on this page.',
            'Continued use after updates means acceptance of revised Terms.',
            'We may suspend or terminate access for serious violations.',
            'Interpretation and disputes are governed by laws applicable to the operator location, subject to mandatory law.',
          ],
        },
      ],
      closingNote:
        'For infringement reports, policy questions, or account-related appeals, contact us by email.',
    },
  },
  ja: {
    privacy: {
      title: 'プライバシーポリシー',
      summary:
        '本ポリシーは、SeichiGo の現行実装に基づき、ログイン、投稿、コメント、お気に入り、画像アップロード、分析機能における個人情報の取り扱いを説明します。',
      effectiveDateLabel: '施行日',
      updatedDateLabel: '最終更新日',
      contactLabel: 'お問い合わせ',
      effectiveDate: '2026年2月7日',
      updatedDate: '2026年2月7日',
      contactEmail: CONTACT_EMAIL,
      sections: [
        {
          heading: '1. 適用範囲',
          paragraphs: [
            '本ポリシーは SeichiGo 本体（中国語・英語・日本語ページ）および関連 API に適用されます。',
            '本サービスを利用することで、本ポリシーに同意したものとみなされます。',
          ],
        },
        {
          heading: '2. 収集する情報',
          bullets: [
            'アカウント情報：メールアドレス、表示名、アバター URL、セッション情報（NextAuth）。',
            '認証関連情報：パスワードログイン時のハッシュ（scrypt）、メール OTP のハッシュとソルト。',
            'プロフィール情報：自己紹介、SNS リンク（GitHub、X、微博、Bilibili など）。',
            '投稿・交流情報：投稿、改稿、コメント、コメントいいね、お気に入り、ウェイトリスト状態。',
            'アップロード情報：画像ファイル本体、ファイル名、MIME タイプ。',
            '不正利用対策情報：OTP 送信・投稿制限のための IP ハッシュ。',
            '技術情報：ブラウザ基本情報、初回言語振り分けで使用する国/地域ヘッダー。',
          ],
        },
        {
          heading: '3. 利用目的',
          bullets: [
            'ログイン、認証、セッション管理、アカウント保護の提供。',
            '投稿、審査、コメント、お気に入り、プロフィール機能の運用。',
            'OTP クールダウンや投稿レート制限などの不正利用対策。',
            '認証メールやセキュリティ通知の送信。',
            '言語設定やアクセス分析に基づくサービス改善。',
          ],
        },
        {
          heading: '4. Cookie と分析',
          bullets: [
            '`NEXT_LOCALE` Cookie を利用し、言語設定を保持します。',
            'Google Analytics（測定 ID: `G-F7E894BEWR`）を利用し、集計ベースのアクセス分析を行います。',
            '認証機能はセッションクッキーに依存するため、無効化すると一部機能が利用できない場合があります。',
          ],
        },
        {
          heading: '5. 第三者提供・外部処理',
          paragraphs: [
            '当社は個人情報を販売しません。サービス提供または法令上必要な場合に限り、第三者へ情報を提供します。',
          ],
          bullets: [
            'ホスティング・データベース提供事業者（運用基盤のため）。',
            'メール配信事業者（Resend または設定済み SMTP）による OTP 送信。',
            '分析事業者（Google Analytics）による集計分析。',
            '管理機能で有効化された場合、翻訳・SEO 処理のため Gemini / Google Search Console / SerpAPI 等へコンテンツを送信する場合があります。',
            '法令・司法・行政機関からの適法な開示要請に基づく提供。',
          ],
        },
        {
          heading: '6. 保存とセキュリティ',
          bullets: [
            'データはデプロイ時に設定された PostgreSQL に保存されます。',
            'パスワードはハッシュ化して保存し、OTP はハッシュ化かつ有効期限付きで管理します。',
            'サーバー側検証、権限制御、コンテンツサニタイズでリスク低減を図ります。',
            'ただし通信・保存の完全な安全性を保証することはできません。',
          ],
        },
        {
          heading: '7. 保存期間',
          bullets: [
            'アカウント、投稿、コメント、お気に入り等は、運用上必要な期間または法令上必要な期間保持されます。',
            'OTP 記録は期限切れまたは使用済みで無効化されます。',
            '運用・安全確保のためのログは合理的期間保持される場合があります。',
          ],
        },
        {
          heading: '8. ユーザーの権利',
          bullets: [
            '設定画面でプロフィール情報を更新できます。',
            '開示・訂正・削除の依頼はメールで受け付けます。',
            '現行バージョンではワンクリック退会機能は提供していません。',
          ],
        },
        {
          heading: '9. 未成年者の利用',
          paragraphs: [
            '未成年の方は保護者の指導のもとで利用してください。未成年者情報に関する懸念がある場合はご連絡ください。',
          ],
        },
        {
          heading: '10. 改定',
          paragraphs: [
            '法令・サービス変更に応じて本ポリシーを更新することがあります。更新時は本ページの最終更新日を改定します。',
          ],
        },
      ],
      closingNote:
        '本ポリシーは SeichiGo の現行実装に基づく説明であり、個別事案に対する法的助言ではありません。',
    },
    terms: {
      title: '利用規約',
      summary:
        '本規約は SeichiGo の利用条件を定めるものです。アカウント、投稿、コミュニティ行動、知的財産、責任制限、違反時対応を含みます。',
      effectiveDateLabel: '施行日',
      updatedDateLabel: '最終更新日',
      contactLabel: 'お問い合わせ',
      effectiveDate: '2026年2月7日',
      updatedDate: '2026年2月7日',
      contactEmail: CONTACT_EMAIL,
      sections: [
        {
          heading: '1. 規約への同意',
          paragraphs: [
            'SeichiGo を利用することで、本規約および関連ルールに同意したものとみなされます。',
            '同意しない場合は、サービスの利用を中止してください。',
          ],
        },
        {
          heading: '2. アカウントと安全管理',
          bullets: [
            '有効なメールアドレスを登録し、認証情報を適切に管理してください。',
            'アカウントで行われた行為については、原則として利用者が責任を負います。',
            '不正利用が疑われる場合、追加認証または機能制限を行う場合があります。',
          ],
        },
        {
          heading: '3. 投稿内容と行動基準',
          bullets: [
            '投稿・コメント・画像等は、適法かつ権利侵害のない内容である必要があります。',
            '違法、有害、差別的、嫌がらせ、スパム、悪意あるコード等の投稿は禁止します。',
            '聖地巡礼に関連する地域住民・施設への配慮を前提にコンテンツを作成してください。',
            'API の乱用、レート制限回避、サービス妨害行為は禁止します。',
          ],
        },
        {
          heading: '4. モデレーションと措置',
          bullets: [
            'SeichiGo は投稿・コメントを審査し、編集、非公開化、削除する権利を有します。',
            '規約違反または安全上の懸念がある場合、警告、制限、停止、アカウント無効化を実施できます。',
            '法令遵守およびコミュニティ運営のために管理者が必要な対応を行う場合があります。',
          ],
        },
        {
          heading: '5. 知的財産と利用許諾',
          bullets: [
            '利用者は自己が適法に権利を有するコンテンツの権利を保持します。',
            'サービス提供のため、利用者は SeichiGo に対し、投稿コンテンツを保存、表示、配信、編集、紹介するための非独占的・全世界的・再許諾可能な利用許諾を付与します。',
            'SeichiGo のブランド、コード、プラットフォーム素材は関連法令により保護されます。',
          ],
        },
        {
          heading: '6. 外部サービス',
          paragraphs: [
            '本サービスには外部リンクや第三者サービス連携（メール、分析、地図等）が含まれる場合があります。これらは各提供者の規約に従います。',
          ],
        },
        {
          heading: '7. 免責と責任制限',
          bullets: [
            '本サービスは「現状有姿」かつ「提供可能な範囲」で提供され、無停止・無瑕疵を保証しません。',
            '法令で認められる範囲で、間接損害、特別損害、付随的損害について責任を負いません。',
            '不可抗力、通信障害、第三者サービス障害に起因する不具合について、法的義務を超える責任は負いません。',
          ],
        },
        {
          heading: '8. 改定・終了・準拠ルール',
          bullets: [
            '当社は本規約を改定でき、最新版を本ページで公開します。',
            '改定後も利用を継続した場合、改定規約に同意したものとみなされます。',
            '重大な違反がある場合、当社は利用の全部または一部を停止・終了できます。',
            '本規約の解釈および紛争処理は運営主体所在地の適用法に従います（強行法規がある場合はそれを優先）。',
          ],
        },
      ],
      closingNote:
        '規約内容、権利侵害申告、アカウント措置に関する異議申立てはメールで受け付けます。',
    },
  },
}

export function getLegalDocument(type: LegalDocumentType, locale: LegalLocale): LegalDocument {
  return documents[locale][type]
}
