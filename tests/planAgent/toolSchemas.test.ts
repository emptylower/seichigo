import { describe, it, expect } from 'vitest'
import type OpenAI from 'openai'
import { PLAN_AGENT_TOOLS } from '@/lib/planAgent/tools'
import { SAVE_PLAN_DAYS_PARAMETERS, assertToolSchemasGeminiSafe } from '@/lib/planAgent/toolSchemas'

/**
 * A1：404gemini（Gemini 后端）严格校验工具 schema：每个 type:'array' 必须带
 * items；$schema / const / anyOf 等关键字不受支持。这里全量断言
 * PLAN_AGENT_TOOLS，任何新工具/新字段只要漏了 items 就会在本文件炸出来。
 */

type JsonSchema = Record<string, unknown>

function walkSchema(node: unknown, visit: (schema: JsonSchema) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walkSchema(child, visit)
    return
  }
  if (typeof node !== 'object' || node === null) return
  const schema = node as JsonSchema
  visit(schema)
  for (const value of Object.values(schema)) walkSchema(value, visit)
}

describe('toolSchemas: PLAN_AGENT_TOOLS Gemini 兼容', () => {
  it('每个 type:"array" 节点都带 items', () => {
    const offenders: string[] = []
    walkSchema(PLAN_AGENT_TOOLS, (schema) => {
      if (schema.type === 'array' && schema.items === undefined) offenders.push(JSON.stringify(schema).slice(0, 120))
    })
    expect(offenders).toEqual([])
  })

  it('不含 Gemini 不支持的关键字 $schema / const / anyOf / additionalProperties / examples / $ref', () => {
    const banned = ['$schema', 'const', 'anyOf', 'additionalProperties', 'examples', '$ref']
    const found: string[] = []
    walkSchema(PLAN_AGENT_TOOLS, (schema) => {
      for (const key of banned) if (key in schema) found.push(key)
    })
    expect(found).toEqual([])
  })

  it('assertToolSchemasGeminiSafe 对全量工具通过，对缺 items / 含违禁关键字的 schema 抛错', () => {
    expect(() => assertToolSchemasGeminiSafe(PLAN_AGENT_TOOLS)).not.toThrow()
    expect(() =>
      assertToolSchemasGeminiSafe([
        { type: 'function', function: { name: 'bad', description: 'x', parameters: { type: 'object', properties: { xs: { type: 'array' } } } } },
      ] satisfies OpenAI.Chat.Completions.ChatCompletionTool[]),
    ).toThrow(/items/)
    expect(() =>
      assertToolSchemasGeminiSafe([
        { type: 'function', function: { name: 'bad', description: 'x', parameters: { type: 'object', properties: { x: { anyOf: [{ type: 'string' }] } } } } },
      ] satisfies OpenAI.Chat.Completions.ChatCompletionTool[]),
    ).toThrow(/anyOf/)
  })

  it('M3：守卫按位置查关键字——properties 里的字段名（如 const）不报错，schema 位置出现 additionalProperties 才报错', () => {
    // 字段名撞上黑名单关键字：位置是 properties 的键名，不是 schema 关键字
    expect(() =>
      assertToolSchemasGeminiSafe([
        {
          type: 'function',
          function: {
            name: 'field-named-const',
            description: 'x',
            parameters: { type: 'object', properties: { const: { type: 'string' }, $ref: { type: 'string' } } },
          },
        },
      ] satisfies OpenAI.Chat.Completions.ChatCompletionTool[]),
    ).not.toThrow()
    // schema 位置（某字段的 schema 上）出现 additionalProperties → 报错
    expect(() =>
      assertToolSchemasGeminiSafe([
        {
          type: 'function',
          function: {
            name: 'bad-kw',
            description: 'x',
            parameters: {
              type: 'object',
              properties: { x: { type: 'object', properties: { y: { type: 'string' } }, additionalProperties: true } },
            },
          },
        },
      ] satisfies OpenAI.Chat.Completions.ChatCompletionTool[]),
    ).toThrow(/additionalProperties/)
    // items / oneOf / allOf 的值按 schema 递归检查
    expect(() =>
      assertToolSchemasGeminiSafe([
        {
          type: 'function',
          function: {
            name: 'bad-nested',
            description: 'x',
            parameters: {
              type: 'object',
              properties: {
                xs: { type: 'array', items: { type: 'object', properties: { $ref: { type: 'string' } }, examples: [] } },
                y: { oneOf: [{ type: 'string', const: 'a' }] },
              },
            },
          },
        },
      ] satisfies OpenAI.Chat.Completions.ChatCompletionTool[]),
    ).toThrow(/examples|const/)
  })

  it('save_plan_days 的 parameters 即 SAVE_PLAN_DAYS_PARAMETERS（单一来源）', () => {
    const tool = PLAN_AGENT_TOOLS.find((t) => t.type === 'function' && t.function.name === 'save_plan_days')
    expect(tool).toBeDefined()
    expect(tool?.type === 'function' && tool.function.parameters).toBe(SAVE_PLAN_DAYS_PARAMETERS)
  })
})

describe('toolSchemas: transport 数组 items 细节', () => {
  const transportProps = (() => {
    const params = SAVE_PLAN_DAYS_PARAMETERS as {
      properties: { days: { items: { properties: { items: { items: { properties: { payload: { properties: { transport: { properties: Record<string, JsonSchema> } } } } } } } } } }
    }
    return params.properties.days.items.properties.items.items.properties.payload.properties.transport.properties
  })()

  it('M2：legs.items 覆盖 itemPayload 的 leg 字段且不含 additionalProperties（Gemini Schema 无该关键字）', () => {
    const legs = transportProps.legs as { type: string; items: JsonSchema & { properties: Record<string, { type: string }> } }
    expect(legs.type).toBe('array')
    expect(legs.items.type).toBe('object')
    expect(Object.keys(legs.items.properties)).toEqual(
      expect.arrayContaining([
        'mode',
        'durationMin',
        'distanceKm',
        'instruction',
        'line',
        'fromStop',
        'toStop',
        'numStops',
        'headsign',
        'departureTime',
        'arrivalTime',
      ]),
    )
    expect('additionalProperties' in legs.items).toBe(false)
  })

  it('polyline.items 是 [number, number] 坐标对', () => {
    const polyline = transportProps.polyline as JsonSchema & { items: JsonSchema & { items: { type: string }; minItems: number; maxItems: number } }
    expect(polyline.type).toBe('array')
    expect(polyline.items.type).toBe('array')
    expect(polyline.items.items).toEqual({ type: 'number' })
    expect(polyline.items.minItems).toBe(2)
    expect(polyline.items.maxItems).toBe(2)
  })
})
