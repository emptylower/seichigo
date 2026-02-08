# 已发布文章抓取说明（2026-02-07）

## 抓取目标
- 来源接口：`https://seichigo.com/api/ai/articles?status=published&language=zh`
- 认证方式：AI API Token（`Authorization: Bearer ...`）
- 抓取范围：中文已发布文章最新 3 篇（含完整 `contentJson` + `contentHtml`）

## 已抓取文章
1. `cmkj44gvj00036ffyj0xkn4u9`  
   标题：`《你的名字》圣地巡礼 Part 3 ｜从飞驒到诹访`  
   目录：`doc/template-source/2026-02-07/_-your-name-tokyo-from-hida-to-suwa`

2. `cmkhtjwh00001lom1qnr8c7x9`  
   标题：`《你的名字 》圣地寻礼 part2 | 东京 · 港区篇`  
   目录：`doc/template-source/2026-02-07/_-your-name-tokyo-minato-ward`

3. `cmj7xm9ei00019gdl6crx969m`  
   标题：`《你的名字 》 圣地寻礼  part1 |  东京 · 新宿篇`  
   目录：`doc/template-source/2026-02-07/_-your-name-seichigo-tokyo-shinjuku`

## 每篇文章文件内容
- `list-item.json`：列表接口返回（无正文）
- `detail.json`：详情接口完整返回
- `content.json`：正文 TipTap JSON
- `content.html`：正文 HTML（发布渲染源）
- `public-page.html`：线上公开页面 HTML 快照

## 分析文件
- `doc/template-source/2026-02-07/selected-summary.json`
- `doc/template-source/2026-02-07/structure-analysis.json`
- `doc/template-source/2026-02-07/fixed-writing-template.zh.md`
- `doc/template-source/2026-02-07/ai-writing-assistant-playbook.zh.md`（单文档总手册，推荐直接喂给 AI）
