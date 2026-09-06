import type { SupportedLocale } from '@/lib/i18n/types'

/**
 * §0.6 服务端固定文案三语字典：思维链状态短语、工具摘要、网络错误、
 * handler/route 的错误响应、餐食标签、ask 收尾备注。中文逐字取自改造前
 * 原文（不许改字）；en/ja 为简短口语译法。三语键集合必须一致（由
 * tests/planAgent/serverText.test.ts 递归比对兜底）。
 *
 * 注意：供模型自纠的错误信息（工具 result.error 等）不在本字典——设计
 * 明确它们保持中文不动，避免措辞变化影响规划质量。
 */
export type ServerTextDict = {
  status: {
    searchAnime: (query: string) => string
    searchBangumi: (keyword: string) => string
    listPoints: string
    clusterPoints: string
    estimateTransit: string
    travelDriving: string
    travelWalk: string
    travelTransit: string
    resolvePlace: (query: string) => string
    readPlan: string
    updateMeta: string
    savePlan: string
    askDate: string
    askWork: string
    askOpinion: string
    askGeneric: string
    processing: string
  }
  summary: {
    work: (query: string) => string
    keyword: (keyword: string) => string
    workId: (id: number | string) => string
    workIdMissing: string
    pointsDays: (points: number, days: number | string) => string
    fromTo: (from: string, to: string) => string
    travel: (from: string, to: string, mode: string) => string
    start: string
    end: string
    place: (query: string) => string
    readPlan: string
    updateFields: (fields: string[]) => string
    noChanges: string
    daysCount: (days: number) => string
    ask: (prompt: string) => string
  }
  result: {
    failed: (message: string) => string
    done: string
    foundPoints: (count: number) => string
    clusteredDays: (count: number) => string
    savedDays: (count: number) => string
    searchResults: (count: number) => string
    searchCandidates: (count: number) => string
    walkMin: (minutes: number) => string
    transitMin: (minutes: number) => string
    drivingMin: (minutes: number) => string
    located: (name: string) => string
  }
  netError: string
  errors: {
    notSignedIn: string
    planNotFound: string
    forbidden: string
    emptyMessage: string
    agentQuotaExhausted: string
    planBusy: string
    createQuotaExhausted: string
    invalidJson: string
    emptyTitle: string
    invalidStatus: string
  }
  meal: { breakfast: string; lunch: string; dinner: string }
  askUserNote: string
}

const ZH: ServerTextDict = {
  status: {
    searchAnime: (query) => `正在搜索作品「${query}」`,
    searchBangumi: (keyword) => `正在从 bgm.tv 搜索「${keyword}」`,
    listPoints: '正在获取点位列表',
    clusterPoints: '正在规划每日路线',
    estimateTransit: '正在估算交通方式',
    travelDriving: '正在查询自驾路线',
    travelWalk: '正在查询步行路线',
    travelTransit: '正在查询公共交通路线',
    resolvePlace: (query) => `正在解析地点「${query}」`,
    readPlan: '正在读取当前计划',
    updateMeta: '正在更新计划信息',
    savePlan: '正在保存行程',
    askDate: '正在询问出行日期',
    askWork: '正在请你选择作品',
    askOpinion: '正在征求你的意见',
    askGeneric: '正在向用户发起提问',
    processing: '正在处理…',
  },
  summary: {
    work: (query) => `作品「${query}」`,
    keyword: (keyword) => `关键词「${keyword}」`,
    workId: (id) => `作品 id ${id}`,
    workIdMissing: '作品 id 未指定',
    pointsDays: (points, days) => `${points} 个点位 · ${days} 天`,
    fromTo: (from, to) => `${from} → ${to}`,
    travel: (from, to, mode) => `${from} → ${to} · ${mode}`,
    start: '起点',
    end: '终点',
    place: (query) => `地点「${query}」`,
    readPlan: '读取当前计划',
    updateFields: (fields) => `更新 ${fields.join('、')}`,
    noChanges: '无变更',
    daysCount: (days) => `${days} 天行程`,
    ask: (prompt) => `提问「${prompt}」`,
  },
  result: {
    failed: (message) => `失败：${message}`,
    done: '已完成',
    foundPoints: (count) => `找到 ${count} 个点位`,
    clusteredDays: (count) => `分成 ${count} 天`,
    savedDays: (count) => `已保存 ${count} 天`,
    searchResults: (count) => `返回 ${count} 个结果`,
    searchCandidates: (count) => `返回 ${count} 个候选`,
    walkMin: (minutes) => `步行 ${minutes} 分钟`,
    transitMin: (minutes) => `公共交通 ${minutes} 分钟`,
    drivingMin: (minutes) => `自驾 ${minutes} 分钟`,
    located: (name) => `定位到「${name}」`,
  },
  netError: '网络连接不稳定，本轮回复被中断。已完成的规划内容和行程不会丢失，请再发一条消息继续即可。',
  errors: {
    notSignedIn: '未登录',
    planNotFound: '计划不存在',
    forbidden: '无权访问',
    emptyMessage: '消息不能为空',
    agentQuotaExhausted: '今日 AI 规划额度已用完，明天再来吧',
    planBusy: '这个计划正在规划中，等当前回复完成后再发送',
    createQuotaExhausted: '今日创建计划次数已达上限，明天再来吧',
    invalidJson: '请求体不是合法 JSON',
    emptyTitle: '标题不能为空',
    invalidStatus: '非法状态',
  },
  meal: { breakfast: '早餐', lunch: '午餐', dinner: '晚餐' },
  askUserNote: '已向用户发起结构化提问，本轮对话结束，等待用户通过下一条消息回答',
}

const EN: ServerTextDict = {
  status: {
    searchAnime: (query) => `Searching for "${query}"`,
    searchBangumi: (keyword) => `Searching bgm.tv for "${keyword}"`,
    listPoints: 'Loading spots',
    clusterPoints: 'Planning daily routes',
    estimateTransit: 'Estimating transit',
    travelDriving: 'Finding driving routes',
    travelWalk: 'Finding walking routes',
    travelTransit: 'Finding transit routes',
    resolvePlace: (query) => `Resolving place "${query}"`,
    readPlan: 'Reading current plan',
    updateMeta: 'Updating plan details',
    savePlan: 'Saving itinerary',
    askDate: 'Asking about your travel dates',
    askWork: 'Asking you to pick an anime',
    askOpinion: 'Asking for your opinion',
    askGeneric: 'Asking you a question',
    processing: 'Working…',
  },
  summary: {
    work: (query) => `Work "${query}"`,
    keyword: (keyword) => `Keyword "${keyword}"`,
    workId: (id) => `Work id ${id}`,
    workIdMissing: 'Work id missing',
    pointsDays: (points, days) => `${points} spots · ${days} days`,
    fromTo: (from, to) => `${from} → ${to}`,
    travel: (from, to, mode) => `${from} → ${to} · ${mode}`,
    start: 'start',
    end: 'end',
    place: (query) => `Place "${query}"`,
    readPlan: 'Read current plan',
    updateFields: (fields) => `Update ${fields.join(', ')}`,
    noChanges: 'No changes',
    daysCount: (days) => `${days}-day itinerary`,
    ask: (prompt) => `Ask "${prompt}"`,
  },
  result: {
    failed: (message) => `Failed: ${message}`,
    done: 'Done',
    foundPoints: (count) => `Found ${count} spots`,
    clusteredDays: (count) => `Split into ${count} days`,
    savedDays: (count) => `Saved ${count} days`,
    searchResults: (count) => `${count} results returned`,
    searchCandidates: (count) => `${count} candidates returned`,
    walkMin: (minutes) => `Walk ${minutes} min`,
    transitMin: (minutes) => `Transit ${minutes} min`,
    drivingMin: (minutes) => `Drive ${minutes} min`,
    located: (name) => `Located "${name}"`,
  },
  netError:
    'The network connection dropped and this reply was cut off. Everything saved so far is safe — just send another message to continue.',
  errors: {
    notSignedIn: 'Please sign in',
    planNotFound: 'Plan not found',
    forbidden: 'You do not have access to this plan',
    emptyMessage: 'Message cannot be empty',
    agentQuotaExhausted: "You've used up today's AI planning quota. Come back tomorrow!",
    planBusy: 'This plan is still being worked on. Wait for the current reply to finish before sending again.',
    createQuotaExhausted: "You've reached today's plan creation limit. Come back tomorrow!",
    invalidJson: 'Request body is not valid JSON',
    emptyTitle: 'Title cannot be empty',
    invalidStatus: 'Invalid status',
  },
  meal: { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' },
  askUserNote:
    'A structured question has been sent to the user. This turn ends here; the next message will carry the answer.',
}

const JA: ServerTextDict = {
  status: {
    searchAnime: (query) => `作品「${query}」を検索中`,
    searchBangumi: (keyword) => `bgm.tv で「${keyword}」を検索中`,
    listPoints: 'スポット一覧を取得中',
    clusterPoints: '毎日のルートを計画中',
    estimateTransit: '移動手段を調査中',
    travelDriving: '車でのルートを検索中',
    travelWalk: '徒歩ルートを検索中',
    travelTransit: '公共交通のルートを検索中',
    resolvePlace: (query) => `場所「${query}」を特定中`,
    readPlan: '現在のプランを読み込み中',
    updateMeta: 'プラン情報を更新中',
    savePlan: '行程を保存中',
    askDate: '出発日を確認中',
    askWork: '作品選びを確認中',
    askOpinion: 'あなたの意見を確認中',
    askGeneric: 'あなたに質問中',
    processing: '処理中…',
  },
  summary: {
    work: (query) => `作品「${query}」`,
    keyword: (keyword) => `キーワード「${keyword}」`,
    workId: (id) => `作品 id ${id}`,
    workIdMissing: '作品 id 未指定',
    pointsDays: (points, days) => `${points} スポット · ${days} 日`,
    fromTo: (from, to) => `${from} → ${to}`,
    travel: (from, to, mode) => `${from} → ${to} · ${mode}`,
    start: '出発点',
    end: '到着点',
    place: (query) => `場所「${query}」`,
    readPlan: '現在のプランを読み込む',
    updateFields: (fields) => `${fields.join('・')} を更新`,
    noChanges: '変更なし',
    daysCount: (days) => `${days} 日の行程`,
    ask: (prompt) => `質問「${prompt}」`,
  },
  result: {
    failed: (message) => `失敗：${message}`,
    done: '完了',
    foundPoints: (count) => `${count} 件のスポットを発見`,
    clusteredDays: (count) => `${count} 日に分割`,
    savedDays: (count) => `${count} 日分を保存済み`,
    searchResults: (count) => `${count} 件の結果を取得`,
    searchCandidates: (count) => `${count} 件の候補を取得`,
    walkMin: (minutes) => `徒歩 ${minutes} 分`,
    transitMin: (minutes) => `公共交通 ${minutes} 分`,
    drivingMin: (minutes) => `車 ${minutes} 分`,
    located: (name) => `「${name}」を特定`,
  },
  netError:
    'ネットワーク接続が不安定で、今回の返信が中断されました。保存済みのプランと行程は失われません。メッセージをもう一度送って続けてください。',
  errors: {
    notSignedIn: 'ログインしてください',
    planNotFound: 'プランが見つかりません',
    forbidden: 'このプランへのアクセス権がありません',
    emptyMessage: 'メッセージが空です',
    agentQuotaExhausted: '本日の AI プランニング回数を使い切りました。また明日お越しください。',
    planBusy: 'このプランは現在プランニング中です。現在の返信が終わってから送信してください。',
    createQuotaExhausted: '本日のプラン作成回数が上限に達しました。また明日お越しください。',
    invalidJson: 'リクエストボディが正しい JSON ではありません',
    emptyTitle: 'タイトルは空にできません',
    invalidStatus: '無効なステータスです',
  },
  meal: { breakfast: '朝食', lunch: '昼食', dinner: '夕食' },
  askUserNote: 'ユーザーに構造化された質問を送信しました。このターンはここで終了し、次のメッセージでの回答を待ちます。',
}

const DICTS: Record<SupportedLocale, ServerTextDict> = { zh: ZH, en: EN, ja: JA }

export function serverText(locale: SupportedLocale): ServerTextDict {
  return DICTS[locale]
}
