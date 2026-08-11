import type { LegalDocument, LegalLocale } from '@/lib/legal/content'
import { CONTACT_EMAIL } from '@/lib/email/addresses'

export type InfoDocumentType = 'help' | 'status'

const UPDATED = '2026-08-04'

const zhHelp: LegalDocument = {
  title: '帮助中心',
  summary:
    'SeichiGo 是一个动漫圣地巡礼攻略站。这里汇总了最常见的使用问题：怎么找到想去的地点、路线信息从哪来、如何投稿与纠错、以及图片版权与下架申请的处理方式。',
  effectiveDateLabel: '首次发布',
  updatedDateLabel: '最近更新',
  contactLabel: '联系我们',
  effectiveDate: '2026-08-04',
  updatedDate: UPDATED,
  contactEmail: CONTACT_EMAIL,
  sections: [
    {
      heading: '1. 快速上手：三种找地点的方式',
      bullets: [
        '按作品找：进入「作品」页，选择动画后可以看到该作品已收录的全部巡礼地点与对应攻略长文。',
        '按城市找：进入「城市」页，适合已经确定旅行目的地、想知道当地有哪些作品取景的场景。',
        '按地图找：进入「地图」页，可以在地图上直接浏览地点分布，适合规划一天之内的连续行程。',
      ],
    },
    {
      heading: '2. 攻略里的路线信息怎么读',
      bullets: [
        '每篇攻略的地点表包含「顺序 / 地点 / 最近车站 / 建议用时」四列，顺序是按实际步行与换乘效率排过的。',
        '「最近车站」指的是从该站步行可达的距离，具体步行时间以站内标注为准。',
        '导航按钮会打开 Google 地图，你可以在页面内直接切换步行、公共交通或驾车模式。',
        '建议用时只包含在该地点停留与拍摄的时间，不含点与点之间的移动时间。',
      ],
    },
    {
      heading: '3. 投稿、纠错与账号',
      bullets: [
        '投稿需要先登录。登录支持邮箱验证码与密码两种方式。',
        '所有投稿都会进入人工审核队列，审核通过后才会公开显示。',
        '发现地点信息过时（店铺关闭、车站改名、场景已拆除）时，请通过页面底部的联系邮箱告诉我们，注明文章链接与具体段落。',
        '昵称、头像、个人简介与社交链接可以在「我的设置」中修改。',
        '当前版本没有站内一键注销功能，需要注销账号请发邮件申请。',
      ],
    },
    {
      heading: '4. 图片版权与下架申请',
      paragraphs: [
        '巡礼类内容需要把动画画面与实景照片并列对照，这是本站攻略的核心表达方式。站内出现的动画截图版权归各自的著作权人所有，我们仅在场景对照与评论说明的必要范围内引用，不用于独立售卖或再分发。',
      ],
      bullets: [
        '实景照片由站方或投稿者拍摄，版权归拍摄者所有。',
        '若你是动画画面或照片的著作权人（或其授权代理人），认为站内某处引用超出了合理范围，请发送邮件至上方联系邮箱。',
        '为便于快速处理，请在邮件中提供：作品名称与具体画面、涉及的页面链接、你的权利证明或授权关系说明、以及你希望的处理方式（署名补充 / 替换 / 下架）。',
        '我们会在收到完整信息后 7 个工作日内回复并处理，处理期间可先行隐藏争议内容。',
      ],
    },
    {
      heading: '5. 巡礼礼仪',
      paragraphs: [
        '大量取景地是私人住宅、在营业的商铺或学校。请在到访前阅读「圣地巡礼礼仪」页，遵守当地规则，不打扰居民与经营者。这是这份爱好能长期存在的前提。',
      ],
    },
    {
      heading: '6. 没找到答案？',
      paragraphs: [
        '以上没有覆盖到的问题，欢迎直接发邮件。我们会把高频问题补充进这一页。',
      ],
    },
  ],
  closingNote: '本页内容随功能变化更新，更新日期见页首。',
}

const enHelp: LegalDocument = {
  title: 'Help Center',
  summary:
    'SeichiGo is a guide site for anime pilgrimage (seichi junrei). This page collects the most common questions: how to find the locations you want to visit, where the route information comes from, how to submit or correct content, and how image copyright and takedown requests are handled.',
  effectiveDateLabel: 'First published',
  updatedDateLabel: 'Last updated',
  contactLabel: 'Contact us',
  effectiveDate: '2026-08-04',
  updatedDate: UPDATED,
  contactEmail: CONTACT_EMAIL,
  sections: [
    {
      heading: '1. Getting started: three ways to find locations',
      bullets: [
        'By anime: open the Anime page, pick a title, and you will see every pilgrimage location we have catalogued for it along with the full guide articles.',
        'By city: open the Cities page. This works best when you already know your destination and want to know which anime were filmed there.',
        'By map: open the Map page to browse locations geographically - useful for planning a continuous one-day route.',
      ],
    },
    {
      heading: '2. How to read the route information in a guide',
      bullets: [
        'Each guide has a location table with four columns: order, location, nearest station, and suggested time. The order is sequenced for walking and transfer efficiency.',
        '"Nearest station" means the station from which the location is reachable on foot; refer to the note in the article for the actual walking time.',
        'The navigation button opens Google Maps, and you can switch between walking, transit and driving modes directly on the page.',
        'Suggested time covers only time spent at the location itself, not travel between locations.',
      ],
    },
    {
      heading: '3. Submissions, corrections and accounts',
      bullets: [
        'You need to sign in before submitting. Both email verification codes and passwords are supported.',
        'Every submission enters a human review queue and is published only after approval.',
        'If you find outdated information (a shop has closed, a station was renamed, a location no longer exists), email us using the address above and include the article link and the specific passage.',
        'Display name, avatar, bio and social links can be edited under My Settings.',
        'This version has no self-service account deletion; email us to request account closure.',
      ],
    },
    {
      heading: '4. Image copyright and takedown requests',
      paragraphs: [
        'Pilgrimage content requires placing anime frames next to real-world photographs - that side-by-side comparison is the core form of our guides. Anime frames appearing on this site remain the property of their respective copyright holders, and we quote them only to the extent necessary for scene comparison and commentary. We do not sell or redistribute them independently.',
      ],
      bullets: [
        'Real-world photographs are taken by the site or by contributors and remain the property of the photographer.',
        'If you are the copyright holder (or an authorised agent) of an anime frame or photograph and believe a use on this site exceeds fair quotation, please email the address above.',
        'To help us act quickly, please include: the title and the specific frame, the page URL concerned, evidence of your rights or authorisation, and your preferred remedy (added attribution / replacement / removal).',
        'We will respond and act within 7 business days of receiving complete information, and can hide the disputed content while the request is being processed.',
      ],
    },
    {
      heading: '5. Pilgrimage etiquette',
      paragraphs: [
        'Many locations are private homes, operating businesses or schools. Please read the Pilgrimage Etiquette page before visiting, follow local rules, and do not disturb residents or business owners. This is what allows the hobby to continue existing.',
      ],
    },
    {
      heading: '6. Still stuck?',
      paragraphs: [
        'For anything not covered above, email us directly. We add frequently asked questions to this page as they come up.',
      ],
    },
  ],
  closingNote: 'This page is updated as features change; see the date at the top.',
}

const jaHelp: LegalDocument = {
  title: 'ヘルプセンター',
  summary:
    'SeichiGo はアニメ聖地巡礼のガイドサイトです。このページでは、行きたい場所の探し方、ルート情報の読み方、投稿・修正の方法、画像の著作権と削除依頼の取り扱いについて、よくある質問をまとめています。',
  effectiveDateLabel: '初回公開',
  updatedDateLabel: '最終更新',
  contactLabel: 'お問い合わせ',
  effectiveDate: '2026-08-04',
  updatedDate: UPDATED,
  contactEmail: CONTACT_EMAIL,
  sections: [
    {
      heading: '1. はじめに：場所を探す 3 つの方法',
      bullets: [
        '作品から探す：「作品」ページでアニメを選ぶと、その作品について収録済みのすべての巡礼スポットとガイド記事が表示されます。',
        '都市から探す：「都市」ページは、行き先がすでに決まっていて、その土地でどの作品がロケされたかを知りたい場合に便利です。',
        '地図から探す：「地図」ページではスポットの分布を地図上で確認できます。1 日で回る連続ルートを組むときに向いています。',
      ],
    },
    {
      heading: '2. ガイド内のルート情報の読み方',
      bullets: [
        '各ガイドのスポット表は「順序 / 場所 / 最寄り駅 / 所要時間」の 4 列で構成され、順序は徒歩と乗り換えの効率を考慮して並べています。',
        '「最寄り駅」はそのスポットまで徒歩で行ける駅を指します。実際の徒歩時間は記事内の記載をご確認ください。',
        'ナビボタンから Google マップが開きます。ページ内で徒歩・公共交通機関・自動車のモードを切り替えられます。',
        '所要時間はそのスポットでの滞在と撮影の時間のみで、スポット間の移動時間は含みません。',
      ],
    },
    {
      heading: '3. 投稿・修正・アカウント',
      bullets: [
        '投稿にはログインが必要です。メール認証コードとパスワードの両方に対応しています。',
        'すべての投稿は人手による審査を経て、承認後に公開されます。',
        '情報が古くなっている場合（店舗の閉店、駅名の変更、現存しないロケ地など）は、上記のメールアドレスまで記事リンクと該当箇所を添えてご連絡ください。',
        '表示名・アイコン・自己紹介・SNS リンクは「マイ設定」から変更できます。',
        '現在のバージョンにはサイト内での退会機能がありません。アカウント削除はメールでご依頼ください。',
      ],
    },
    {
      heading: '4. 画像の著作権と削除依頼',
      paragraphs: [
        '聖地巡礼のコンテンツは、アニメの画面と実景写真を並べて比較することが表現の核になります。当サイトに掲載されるアニメ画面の著作権はそれぞれの権利者に帰属し、場面の対比と解説に必要な範囲でのみ引用しています。単独での販売や再配布は行いません。',
      ],
      bullets: [
        '実景写真は当サイトまたは投稿者が撮影したもので、著作権は撮影者に帰属します。',
        'アニメ画面または写真の著作権者（もしくは正当な代理人）の方で、当サイトでの引用が適正な範囲を超えているとお考えの場合は、上記アドレスまでご連絡ください。',
        '迅速な対応のため、作品名と該当画面、対象ページの URL、権利関係を示す資料、ご希望の対応（クレジット追加 / 差し替え / 削除）をお知らせください。',
        '必要な情報がそろい次第、7 営業日以内に回答し対応します。対応期間中は該当箇所を非表示にすることも可能です。',
      ],
    },
    {
      heading: '5. 巡礼マナー',
      paragraphs: [
        '多くのロケ地は個人の住宅、営業中の店舗、学校です。訪問前に「聖地巡礼マナー」ページをお読みいただき、現地のルールを守り、住民や事業者の方のご迷惑にならないようご協力ください。この趣味が続いていくための前提です。',
      ],
    },
    {
      heading: '6. 解決しない場合',
      paragraphs: [
        '上記で解決しない場合は、直接メールでお問い合わせください。よくいただく質問はこのページに追記していきます。',
      ],
    },
  ],
  closingNote: '本ページは機能の変更に応じて更新されます。更新日はページ上部をご確認ください。',
}

const zhStatus: LegalDocument = {
  title: '系统状态',
  summary:
    '本页记录 SeichiGo 各项服务的当前状态、已知问题与历史事件。本页由人工维护，不是实时监控面板——最后核对时间见页首。遇到本页未记录的故障，请通过下方邮箱告诉我们。',
  effectiveDateLabel: '本页启用',
  updatedDateLabel: '最后核对',
  contactLabel: '故障报告',
  effectiveDate: '2026-08-04',
  updatedDate: UPDATED,
  contactEmail: CONTACT_EMAIL,
  sections: [
    {
      heading: '1. 服务组件与当前状态',
      bullets: [
        '网站主站（文章、作品、城市、资源页）：正常运行。',
        '地图与地点浏览：正常运行。',
        '账号登录与邮箱验证码：正常运行。',
        '投稿、审核与评论：正常运行。',
        '图片上传与图床：正常运行。',
        '每日数据同步任务：正常运行。',
      ],
    },
    {
      heading: '2. 已知问题',
      paragraphs: [
        '当前没有影响正常使用的已知问题。发现新问题时会在这里列出，并标注影响范围与预计恢复时间。',
      ],
    },
    {
      heading: '3. 历史事件',
      paragraphs: [
        '本页自 2026-08-04 起启用，此前的运维事件未在此记录。后续所有影响用户访问的事件都会按时间倒序追加在这一节。',
      ],
    },
    {
      heading: '4. 如何报告故障',
      bullets: [
        '请发送邮件至上方地址，标题注明「故障报告」。',
        '为便于定位，请提供：出问题的页面链接、你使用的浏览器与设备、发生时间，以及可能的话一张截图。',
        '我们会在确认问题后把它登记到「已知问题」一节，并在修复后移入「历史事件」。',
      ],
    },
    {
      heading: '5. 计划内维护',
      paragraphs: [
        '需要停机的维护会提前在这一节公告，包含时间窗口与受影响的功能。目前没有计划内维护。',
      ],
    },
  ],
  closingNote: '本页由人工维护，状态信息以「最后核对」时间为准，不代表实时可用性保证。',
}

const enStatus: LegalDocument = {
  title: 'System Status',
  summary:
    'This page records the current status, known issues and incident history of SeichiGo services. This page is maintained manually and is not a real-time monitoring dashboard — see the "last verified" timestamp above. If you encounter an issue not listed here, please let us know at the email address below.',
  effectiveDateLabel: 'Page live since',
  updatedDateLabel: 'Last verified',
  contactLabel: 'Report an issue',
  effectiveDate: '2026-08-04',
  updatedDate: UPDATED,
  contactEmail: CONTACT_EMAIL,
  sections: [
    {
      heading: '1. Service components and current status',
      bullets: [
        'Main website (articles, anime, cities and resource pages): Operational.',
        'Map and location browsing: Operational.',
        'Account sign-in and email verification codes: Operational.',
        'Submissions, reviews and comments: Operational.',
        'Image uploads and image hosting: Operational.',
        'Daily data synchronization jobs: Operational.',
      ],
    },
    {
      heading: '2. Known issues',
      paragraphs: [
        'There are currently no known issues affecting normal use. New issues will be listed here with their scope of impact and estimated recovery time.',
      ],
    },
    {
      heading: '3. Incident history',
      paragraphs: [
        'This page has been active since 2026-08-04; operational incidents before that date are not recorded here. Future incidents affecting user access will be added to this section in reverse chronological order.',
      ],
    },
    {
      heading: '4. How to report an issue',
      bullets: [
        'Email the address above with "Issue report" in the subject line.',
        'To help us investigate, include the affected page URL, your browser and device, when the issue occurred, and a screenshot if possible.',
        'After confirming the issue, we will record it under Known issues and move it to Incident history once resolved.',
      ],
    },
    {
      heading: '5. Planned maintenance',
      paragraphs: [
        'Maintenance requiring downtime will be announced in this section in advance, including the time window and affected features. There is currently no planned maintenance.',
      ],
    },
  ],
  closingNote:
    'This page is maintained manually. Status information is current as of the "last verified" timestamp and is not a guarantee of real-time availability.',
}

const jaStatus: LegalDocument = {
  title: 'システムステータス',
  summary:
    'SeichiGo の各サービスの現在の稼働状況、既知の問題、過去の障害を記録しています。本ページは人手で更新しており、リアルタイム監視ダッシュボードではありません。最終確認日時はページ上部をご覧ください。本ページに記載のない障害が発生した場合は、下記のメールアドレスまでお知らせください。',
  effectiveDateLabel: 'ページ公開日',
  updatedDateLabel: '最終確認',
  contactLabel: '障害のご報告',
  effectiveDate: '2026-08-04',
  updatedDate: UPDATED,
  contactEmail: CONTACT_EMAIL,
  sections: [
    {
      heading: '1. サービス構成と現在のステータス',
      bullets: [
        'ウェブサイト本体（記事、作品、都市、リソースページ）：正常稼働。',
        '地図とスポット閲覧：正常稼働。',
        'アカウントログインとメール認証コード：正常稼働。',
        '投稿、審査、コメント：正常稼働。',
        '画像アップロードと画像ホスティング：正常稼働。',
        '日次データ同期ジョブ：正常稼働。',
      ],
    },
    {
      heading: '2. 既知の問題',
      paragraphs: [
        '現在、通常のご利用に影響する既知の問題はありません。新たな問題が見つかった場合は、影響範囲と復旧見込みを添えて本節に掲載します。',
      ],
    },
    {
      heading: '3. 障害履歴',
      paragraphs: [
        '本ページは 2026-08-04 に公開され、それ以前の運用上の障害は記録していません。今後、ユーザーのアクセスに影響する障害はすべて新しい順に本節へ追加します。',
      ],
    },
    {
      heading: '4. 障害の報告方法',
      bullets: [
        '上記のメールアドレス宛てに、件名を「障害報告」としてお送りください。',
        '調査のため、問題が発生したページの URL、ご利用のブラウザと端末、発生日時、可能であればスクリーンショットをお知らせください。',
        '問題を確認後、「既知の問題」に掲載し、解決後に「障害履歴」へ移します。',
      ],
    },
    {
      heading: '5. メンテナンス予定',
      paragraphs: [
        '停止を伴うメンテナンスは、実施時間と影響を受ける機能を添えて事前に本節でお知らせします。現在、予定されているメンテナンスはありません。',
      ],
    },
  ],
  closingNote:
    '本ページは人手で更新しています。ステータス情報は「最終確認」時点のものであり、リアルタイムの可用性を保証するものではありません。',
}

const helpDocuments: Record<LegalLocale, LegalDocument> = {
  zh: zhHelp,
  en: enHelp,
  ja: jaHelp,
}

export function getHelpDocument(locale: LegalLocale): LegalDocument {
  return helpDocuments[locale]
}

const statusDocuments: Record<LegalLocale, LegalDocument> = {
  zh: zhStatus,
  en: enStatus,
  ja: jaStatus,
}

export function getStatusDocument(locale: LegalLocale): LegalDocument {
  return statusDocuments[locale]
}
