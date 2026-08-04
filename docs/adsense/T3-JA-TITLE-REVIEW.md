# T3 日文标题审校清单

**审阅范围：** `content/ja/posts/*.mdx` 的源 frontmatter `title` 与 `seoTitle`

**结果：** 41/41 篇已逐条审阅。确定修正 4 篇文章、8 个字段；没有修改任何 `animeId`。审阅依据是站内现有内容、`content/anime` 元数据和 glossary；没有使用 CJK 字符数量作为日文质量判据。

## 已修正

| 文件 | 修正内容 | 依据 |
|---|---|---|
| `1-sound-euphonium.mdx` | 繁体中文作品名、`散点/路線/点位速覽` 改为自然日文；统一为 `響け！ユーフォニアム`、`ルート`、`スポット` | `lib/i18n/glossary.json` 与 `content/anime/hibike.json` 的官方日文名 |
| `5-jr-sound-euphonium.mdx` | `吹響吧！上低音號` 改为 `響け！ユーフォニアム`；`久美子長椅` 改为 `久美子ベンチ` | 同上；对应英文源文章使用 `Kumiko's Bench` |
| `oigawa-yuru-camp.mdx` | 中文标题与 `yuru-camp` 占位作品名改为 `『ゆるキャン△』` 和自然日文 SEO 词组 | `lib/i18n/glossary.generated.json` 的 `ゆるキャン△` 条目及同目录日文文章 |
| `enoshima-bocchi-the-rock.mdx` | 作品名补齐官方名称中的 `！` | `lib/i18n/glossary.json` 的 `ぼっち・ざ・ろっく！` 条目 |

## 站内已确认的作品名

- `響け！ユーフォニアム`：`lib/i18n/glossary.json`、`content/anime/hibike.json`。
- `ぼっち・ざ・ろっく！`：`lib/i18n/glossary.json`。
- `ゆるキャン△`：`lib/i18n/glossary.generated.json` 及其他 `content/ja/posts` 标题。
- `君の名は。`：其余同目录日文标题与文章一致使用该名称。

## 仍存疑，暂不改动

- `hida-city-library.mdx` 使用 `飛驒`，而同目录其他文章及英文/中文内容多使用 `飛騨`。两者可能是字形变体；仓库没有标注官方字形的权威字段，因此保留原文。
- `keta-wakamiya-shrine-your-name.mdx` 使用 `氣多若宮神社`，同组其他文件使用 `気多若宮神社`。这是旧字体/新字体差异，仓库没有足够依据判定应统一哪一种。
- `s2-yuru-camp.mdx` 使用 `S2`，描述使用 `SEASON2`；属于常见缩写与完整标题并存，未达到确定错误标准。
- `2-sound-euphonium.mdx` 与 `3-sound-euphonium.mdx` 的 SEO 关键词写作 `響けユーフォニアム`（省略感叹号），正文标题与描述已使用完整官方名；判断为 SEO 关键词标点简化，暂不改动。
