import { describe, it, expect } from 'vitest'
import { createReasoningExtractor } from '@/lib/llm/reasoningExtract'

/**
 * A2：openai 协议思考字段统一口径。此前只读 delta.reasoning_content（DeepSeek
 * 私有），OpenRouter/中转的 delta.reasoning、reasoning_details[].text 与
 * <think>…</think> 内嵌标签全部漏掉。这里覆盖 §0 契约全部形态。
 */

describe('createReasoningExtractor', () => {
  it('reasoning_content 字符串作为思考增量', () => {
    const extractor = createReasoningExtractor()
    expect(extractor.consume({ reasoning_content: '先想想' })).toEqual({ reasoning: '先想想' })
    expect(extractor.consume({ reasoning_content: '……再想想' })).toEqual({ reasoning: '……再想想' })
  })

  it('delta.reasoning 字符串（OpenRouter/中转）作为思考增量', () => {
    const extractor = createReasoningExtractor()
    expect(extractor.consume({ reasoning: 'step 1' })).toEqual({ reasoning: 'step 1' })
  })

  it('reasoning_details[].text 拼接为思考增量', () => {
    const extractor = createReasoningExtractor()
    // 个别形态带 type 等额外字段，只取 text
    const details = [{ type: 'thinking', text: 'a' }, { text: 'b' }, {}] as Array<{ text?: unknown }>
    const out = extractor.consume({ reasoning_details: details })
    expect(out).toEqual({ reasoning: 'ab' })
  })

  it('无 think 标签时 content 原样透传', () => {
    const extractor = createReasoningExtractor()
    expect(extractor.consume({ content: '你好' })).toEqual({ content: '你好' })
    expect(extractor.consume({ content: '，世界' })).toEqual({ content: '，世界' })
  })

  it('<think> 跨两个 chunk 切开：开标签被正确识别，前后内容归类正确', () => {
    const extractor = createReasoningExtractor()
    // chunk1 以 "<thi" 结尾——不能当成正文吐出，要挂起等待下一片
    expect(extractor.consume({ content: '答案前<thi' })).toEqual({ content: '答案前' })
    // chunk2 补全 "<think>" 并给出思考正文开头
    expect(extractor.consume({ content: 'nk>让我算算' })).toEqual({ reasoning: '让我算算' })
    // </think> 后的正文照常作为 content
    expect(extractor.consume({ content: '1+1=2</think>结论是 2' })).toEqual({ reasoning: '1+1=2', content: '结论是 2' })
  })

  it('闭标签 </think> 同样允许跨 chunk 切开', () => {
    const extractor = createReasoningExtractor()
    expect(extractor.consume({ content: '<think>思考中</thi' })).toEqual({ reasoning: '思考中' })
    expect(extractor.consume({ content: 'nk>正文' })).toEqual({ content: '正文' })
  })

  it('挂起的疑似标签最终证明不是标签：按正文补吐', () => {
    const extractor = createReasoningExtractor()
    expect(extractor.consume({ content: '<thi' })).toEqual({})
    expect(extractor.consume({ content: 'ngs happened' })).toEqual({ content: '<things happened' })
  })

  it('流结束时 flush 把挂起尾巴按当前状态吐出', () => {
    const extractor = createReasoningExtractor()
    expect(extractor.consume({ content: '正文<thi' })).toEqual({ content: '正文' })
    expect(extractor.flush()).toEqual({ content: '<thi' })
  })

  it('非字符串字段（null/对象）不炸且不产出', () => {
    const extractor = createReasoningExtractor()
    expect(extractor.consume({ reasoning_content: null, reasoning: null, content: null })).toEqual({})
    // 个别供应商把 request 侧参数回显到 delta.reasoning（对象形态）：不是思考增量
    expect(extractor.consume({ reasoning: { effort: 'high' } as unknown as string })).toEqual({})
  })

  // ---- A2 补充：Gemini 官方 OpenAI 兼容端点的思考摘要形态 ----

  it('extra_content.google.thought === true 时该 content 归入思考（无标签也成立）', () => {
    const extractor = createReasoningExtractor()
    expect(
      extractor.consume({ content: '先想一下', extra_content: { google: { thought: true } } }),
    ).toEqual({ reasoning: '先想一下' })
    expect(extractor.consume({ content: '普通正文' })).toEqual({ content: '普通正文' })
  })

  it('thought 标记不是 true / 缺 google 层时不影响归类', () => {
    const extractor = createReasoningExtractor()
    expect(
      extractor.consume({ content: '正文', extra_content: { google: { thought: false } } }),
    ).toEqual({ content: '正文' })
    expect(extractor.consume({ content: '也正文', extra_content: { google: {} } })).toEqual({
      content: '也正文',
    })
    expect(extractor.consume({ content: '还正文', extra_content: null })).toEqual({ content: '还正文' })
  })

  it('<thought> 跨 chunk 切开：开/闭标签都能被识别', () => {
    const extractor = createReasoningExtractor()
    expect(extractor.consume({ content: '前<tho' })).toEqual({ content: '前' })
    expect(extractor.consume({ content: 'ught>推理中' })).toEqual({ reasoning: '推理中' })
    expect(extractor.consume({ content: '……好了</thou' })).toEqual({ reasoning: '……好了' })
    expect(extractor.consume({ content: 'ght>结论' })).toEqual({ content: '结论' })
  })

  it('</thought> 位于正文第一个 chunk 开头（实测形态）：剥离标签后正文照常', () => {
    const extractor = createReasoningExtractor()
    expect(extractor.consume({ content: '<thought>思考摘要' })).toEqual({ reasoning: '思考摘要' })
    expect(extractor.consume({ content: '</thought>你好！' })).toEqual({ content: '你好！' })
  })

  it('<think> 与 <thought> 互不误认：前缀在第三个字符分叉', () => {
    const extractor = createReasoningExtractor()
    // "<thin" 只能是 <think> 的前缀，补全后按 <think> 处理
    expect(extractor.consume({ content: '<thin' })).toEqual({})
    expect(extractor.consume({ content: 'k>想想' })).toEqual({ reasoning: '想想' })
    expect(extractor.consume({ content: '</think>完' })).toEqual({ content: '完' })
    // 紧接着出现 <thought> 块也能再次进入思考
    expect(extractor.consume({ content: '<thought>又想' })).toEqual({ reasoning: '又想' })
    expect(extractor.consume({ content: '</thought>终' })).toEqual({ content: '终' })
  })
})
