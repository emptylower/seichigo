# /about 媒体与引用段落 + AI 辅助文章提示

分支：`feat/about-press-and-ai-notice`（已创建并切换）。**不要 git commit，不要 git push，不要 deploy。**

两个独立改动，都是前端 + i18n 文案。全部文案已在下面给出，**逐字使用，不要改写、不要补充任何其他工具/网站名称，不要加任何比较性措辞**。

---

## A. /about 新增「媒体与引用」段落

### 位置
三个 about 页面各加一个 section：
- `app/(site)/about/page.tsx`（zh）
- `app/ja/about/page.tsx`（ja）
- `app/en/about/page.tsx`（en）

插在现有「未来 / 联系我们」那个双栏 section（`futureTitle` + `contactTitle` 所在的 section）**之前**，作为独立的一个 section。三个文件结构近似（各 ~145 行，locale 硬编码），照各自文件现有的 section 写法与 Tailwind 风格来写，保持与相邻 section 一致的容器宽度与上下间距。

### 结构
```
<section>  （浅色背景，与 whyTitle 那个 section 同风格）
  <h2>{t('pages.about.pressTitle', locale)}</h2>
  <p>{t('pages.about.pressWhatWeAre', locale)}</p>
  <h3>{t('pages.about.pressCiteTitle', locale)}</h3>
  <ul>
    <li>{t('pages.about.pressCiteText', locale)}</li>
    <li>{t('pages.about.pressCitePhotos', locale)}</li>
    <li>{t('pages.about.pressCiteFrames', locale)}</li>
  </ul>
  <p>{t('pages.about.pressContact', locale)} <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></p>
</section>
```
`CONTACT_EMAIL` 来自 `@/lib/email/addresses`，三个页面里已经在 import（zh 页第 5 行），ja/en 页确认一下有没有 import，没有就加。

### i18n
在 `lib/i18n/locales/{zh,ja,en}.json` 的 `pages.about` 对象里追加以下 key（三个文件都要加，`t()` 找不到 key 会原样返回 key 字符串）：

**zh.json**
```json
"pressTitle": "媒体与引用",
"pressWhatWeAre": "SeichiGo 是动漫圣地巡礼的行程工具与攻略站。全球巡礼地图收录 5 万+ 点位、1,500+ 部作品；输入作品与天数，AI 行程规划会生成含交通衔接的逐日路线。支持简体中文、繁体中文、日语、英语。",
"pressCiteTitle": "引用与素材",
"pressCiteText": "欢迎媒体与个人引用本站内容：请注明来源「SeichiGo」并链接到对应页面。",
"pressCitePhotos": "本站自行拍摄的实景照片，可在注明来源的前提下用于报道与非商业用途。",
"pressCiteFrames": "动画画面版权归各著作权人所有，本站仅在场景对照范围内引用，无法授权二次使用。",
"pressContact": "媒体合作、素材申请与数据说明，请联系"
```

**ja.json**
```json
"pressTitle": "メディア・引用について",
"pressWhatWeAre": "SeichiGo はアニメ聖地巡礼のルート作成ツールとガイドサイトです。世界の巡礼スポット 5 万件以上・作品 1,500 本以上を収録した地図をもとに、作品と日数を入力すると、交通の接続を含む日別ルートを AI が作成します。日本語・英語・中国語（簡体・繁体）に対応しています。",
"pressCiteTitle": "引用と素材について",
"pressCiteText": "本サイトの内容は、出典「SeichiGo」と該当ページへのリンクを明記のうえ、ご自由に引用いただけます。",
"pressCitePhotos": "本サイトが撮影した実景写真は、出典明記を条件に報道・非商用目的でご利用いただけます。",
"pressCiteFrames": "アニメの場面画像は各著作権者に帰属し、本サイトは場面対照の範囲でのみ引用しています。二次利用の許諾はできません。",
"pressContact": "取材・素材のご依頼、データに関するお問い合わせは"
```

**en.json**
```json
"pressTitle": "Press & Citation",
"pressWhatWeAre": "SeichiGo is a route-planning tool and guide site for anime pilgrimage. On top of a global map of 50,000+ locations across 1,500+ anime, the AI planner turns an anime and a number of days into a day-by-day route with transit connections. Available in English, Japanese, and Simplified and Traditional Chinese.",
"pressCiteTitle": "Citing our content",
"pressCiteText": "You're welcome to cite our content. Please credit \"SeichiGo\" and link to the page you're citing.",
"pressCitePhotos": "Our own on-location photos may be used for editorial and non-commercial purposes with credit.",
"pressCiteFrames": "Anime frames belong to their respective rights holders. We reproduce them only for scene comparison and cannot license further use.",
"pressContact": "For press, image requests or questions about our data, contact"
```

---

## B. AI 辅助文章的提示条

### 判定
文章数据里 `tags` 含 `'seo-spoke'` ⇒ AI 辅助文章。三个 post 页面里 `tags` 已在作用域中（zh 页 `app/(site)/posts/[slug]/page.tsx` 约第 250–253 行：`const tags = found.source === 'mdx' ? found.post.frontmatter.tags : found.article.tags`；ja/en 页同构）。不要改 schema、不要改 MDX、不要重新生成 `content/generated/*`。

### 组件
新建 `components/legal/AiAssistedNotice.tsx`，**照抄 `components/legal/CopyrightNotice.tsx` 的写法**：`SiteLocale` prop、内联 `TEXT` 表、`prefixPath('/help', locale)` 生成帮助中心链接、`<aside className="not-prose …">`。视觉上比 CopyrightNotice 更轻：一行文字、浅色底、左侧细边，不要图标、不要按钮。

文案（逐字）：
- zh：`本文由 AI 辅助整理，实地信息持续校对中。发现有误请通过` + 链接文字 `帮助中心` + `反馈。`
- ja：`この記事は AI の補助で作成しており、現地情報は継続的に確認・更新しています。誤りにお気づきの際は` + 链接文字 `ヘルプセンター` + `からお知らせください。`
- en：`This article was prepared with AI assistance; on-site details are being verified and updated. Spotted an error? Let us know via the ` + 链接文字 `Help Center` + `.`

### 渲染位置
三个 post 页面，在 `<PostMeta …>` 之后、分享按钮行之前（zh 页约第 338 行；ja 约 340；en 约 338），条件渲染：
```tsx
{tags?.includes('seo-spoke') && <AiAssistedNotice locale="zh" />}
```
ja / en 页分别传 `"ja"` / `"en"`。

### 测试
在 `tests/public/` 下加一个最小测试（参考同目录现有测试的写法，例如 `db-public-notice.test.ts`），断言：
1. 带 `seo-spoke` 标签的 MDX 文章页面渲染出提示文案；
2. 不带该标签的 DB 文章（fixture slug 可用 `你的名字-your-name-seichigo-tokyo-shinjuku`，同目录已有测试用它）不渲染提示。
如果现有测试基础设施做不到页面级渲染断言，就退而测组件本身三种 locale 的输出，并在汇报里说明。

---

## 完成标准
依次通过：
```
npm run typecheck
npx vitest run tests/public
npm run lint
```
不要跑 `npm run build`、不要跑 dev server。

汇报（中文，简短）：改动文件列表、三条命令的结果、测试覆盖到了哪一层（页面级还是组件级）。
