import fs from 'fs'
import path from 'path'

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
const MAX_RETRIES = 5
const INITIAL_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 32000
export const BATCH_SIZE = 15
export const MAX_BATCH_CHARS = 3000

const LANGUAGE_NAMES: Record<string, string> = {
  zh: 'Chinese (Simplified)',
  en: 'English',
  ja: 'Japanese',
}

type Glossary = Record<string, Record<string, string>>

let glossaryCache: Glossary | null = null

function loadGlossary(): Glossary {
  if (glossaryCache) return glossaryCache
  
  const manualPath = path.join(process.cwd(), 'lib/i18n/glossary.json')
  const generatedPath = path.join(process.cwd(), 'lib/i18n/glossary.generated.json')
  
  let manual: Glossary = {}
  let generated: Glossary = {}
  
  if (fs.existsSync(manualPath)) {
    manual = JSON.parse(fs.readFileSync(manualPath, 'utf-8')) as Glossary
  } else {
    console.warn('⚠️  Manual glossary not found')
  }
  
  if (fs.existsSync(generatedPath)) {
    generated = JSON.parse(fs.readFileSync(generatedPath, 'utf-8')) as Glossary
  }
  
  // Merge: manual entries always win over generated
  glossaryCache = { ...generated, ...manual }
  
  if (Object.keys(glossaryCache).length === 0) {
    console.warn('⚠️  No glossary entries loaded, term protection disabled')
  }
  
  return glossaryCache
}

function protectTerms(text: string, glossary: Glossary): { protectedText: string; terms: Map<string, string> } {
  const terms = new Map<string, string>()
  let protectedText = text
  let index = 0
  
  for (const [term] of Object.entries(glossary)) {
    if (protectedText.includes(term)) {
      const placeholder = `{{TERM_${index}}}`
      terms.set(placeholder, term)
      protectedText = protectedText.replaceAll(term, placeholder)
      index++
    }
  }
  
  return { protectedText, terms }
}

function restoreTerms(text: string, terms: Map<string, string>, glossary: Glossary, targetLang: string): string {
  let restored = text
  
  for (const [placeholder, originalTerm] of terms.entries()) {
    const translation = glossary[originalTerm]?.[targetLang] || originalTerm
    // Extract the index from placeholder like {{TERM_0}}
    const match = placeholder.match(/TERM_(\d+)/)
    if (match) {
      const index = match[1]
      // Match variations: {{TERM_0}}, {{ TERM_0 }}, {{term_0}}, etc.
      const regex = new RegExp(`\\{\\{\\s*TERM_${index}\\s*\\}\\}`, 'gi')
      restored = restored.replaceAll(regex, translation)
    }
  }
  
  return restored
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

type CallGeminiOptions = {
  responseMimeType?: string
  initialBackoffMs?: number
  maxBackoffMs?: number
  maxRetries?: number
  requestTimeoutMs?: number
}

export async function callGemini(prompt: string, retryCount = 0, options: CallGeminiOptions = {}): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not set')
  }

  const maxRetries = Number.isFinite(options.maxRetries)
    ? Math.max(0, Math.floor(Number(options.maxRetries)))
    : MAX_RETRIES
  const initialBackoffMs = Number.isFinite(options.initialBackoffMs)
    ? Math.max(0, Math.floor(Number(options.initialBackoffMs)))
    : INITIAL_BACKOFF_MS
  const maxBackoffMs = Number.isFinite(options.maxBackoffMs)
    ? Math.max(initialBackoffMs, Math.floor(Number(options.maxBackoffMs)))
    : MAX_BACKOFF_MS
  const backoffMs = Math.min(
    initialBackoffMs * Math.pow(2, retryCount),
    maxBackoffMs
  )

  try {
    const timeoutMs = Number.isFinite(options.requestTimeoutMs)
      ? Math.max(1, Math.floor(Number(options.requestTimeoutMs)))
      : null
    const response = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 8192,
          ...(options.responseMimeType ? { responseMimeType: options.responseMimeType } : {}),
        },
      }),
    })

    if (response.status === 429) {
      if (retryCount >= maxRetries) {
        throw new Error(`Rate limit exceeded after ${maxRetries} retries`)
      }
      await sleep(backoffMs)
      return callGemini(prompt, retryCount + 1, options)
    }

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Gemini API error (${response.status}): ${errorText}`)
    }

    const data = await response.json()

    // Check for safety blocks
    if (data.promptFeedback?.blockReason) {
      console.error('[callGemini] Prompt blocked:', data.promptFeedback)
      throw new Error(`Prompt blocked: ${data.promptFeedback.blockReason}`)
    }

    // Check candidates exist
    if (!data.candidates || data.candidates.length === 0) {
      console.error('[callGemini] No candidates in response:', JSON.stringify(data))
      throw new Error('No candidates in Gemini API response')
    }

    const candidate = data.candidates[0]

    // Check for safety finish reason
    if (candidate.finishReason === 'SAFETY') {
      console.error('[callGemini] Response blocked by safety:', candidate.safetyRatings)
      throw new Error('Response blocked by safety filters')
    }

    // Extract text parts, filtering out thinking parts (Gemini 2.5 feature)
    const parts = candidate.content?.parts || []
    const textParts = parts.filter((part: any) => part.text && !part.thought)

    let text = ''
    if (textParts.length > 0) {
      // Concatenate all non-thinking text parts
      text = textParts.map((part: any) => part.text).join('')
    } else {
      // Fallback: try to get any text if no non-thinking parts found
      const anyTextPart = parts.find((part: any) => part.text)
      text = anyTextPart?.text || ''
    }

    if (!text) {
      console.error('[callGemini] Empty text in response:', JSON.stringify(data))
      throw new Error('Empty response from Gemini API')
    }

    return text
  } catch (error) {
    if (error instanceof Error && error.message.includes('Rate limit')) {
      throw error
    }

    if (retryCount < maxRetries) {
      await sleep(backoffMs)
      return callGemini(prompt, retryCount + 1, options)
    }

    throw error
  }
}

type TranslateTextOptions = {
  callOptions?: CallGeminiOptions
}

export async function translateText(
  text: string,
  targetLang: string,
  options: TranslateTextOptions = {}
): Promise<string> {
  if (!text || !text.trim()) {
    throw new Error('Text to translate cannot be empty')
  }

  const glossary = loadGlossary()
  const { protectedText, terms } = protectTerms(text, glossary)
  
  const targetLangName = LANGUAGE_NAMES[targetLang] || targetLang
  const prompt = `Translate the following text to ${targetLangName}. Preserve any placeholders like {{TERM_0}}. Only return the translation, no explanations:\n\n${protectedText}`
  
  const translated = await callGemini(prompt, 0, options.callOptions)
  
  let cleanedTranslation = translated.trim()
  if (cleanedTranslation.startsWith('```')) {
    cleanedTranslation = cleanedTranslation.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim()
  }
  
  return restoreTerms(cleanedTranslation, terms, glossary, targetLang)
}

function stripCodeBlock(input: string): string {
  let text = input.trim()
  if (text.startsWith('```json')) {
    text = text.slice(7)
  } else if (text.startsWith('```')) {
    text = text.slice(3)
  }
  if (text.endsWith('```')) {
    text = text.slice(0, -3)
  }
  return text.trim()
}

function extractFirstJsonObject(input: string): string | null {
  const text = input.trim()
  const start = text.indexOf('{')
  if (start < 0) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }

    if (ch === '{') {
      depth += 1
      continue
    }

    if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        return text.slice(start, i + 1)
      }
    }
  }

  return null
}

function normalizeBatchJson(parsed: unknown): Record<string, string> | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null
  }
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === 'string') {
      out[key] = value
    } else if (value == null) {
      out[key] = ''
    } else {
      out[key] = String(value)
    }
  }
  return out
}

function parseBatchJsonResponse(response: string): Record<string, string> | null {
  const primary = stripCodeBlock(response)
  try {
    return normalizeBatchJson(JSON.parse(primary))
  } catch {
    const extracted = extractFirstJsonObject(primary)
    if (!extracted) return null
    try {
      return normalizeBatchJson(JSON.parse(extracted))
    } catch {
      return null
    }
  }
}

type TranslateTextBatchOptions = {
  callOptions?: CallGeminiOptions
  fallbackMode?: 'single' | 'error'
}

async function fallbackTranslateTextIndividually(
  texts: string[],
  targetLang: string,
  options: TranslateTextBatchOptions = {}
): Promise<Map<string, string>> {
  const uniqueTexts = Array.from(new Set(texts.map((text) => String(text || ''))))
  const result = new Map<string, string>()

  for (const text of uniqueTexts) {
    try {
      result.set(
        text,
        await translateText(text, targetLang, {
          callOptions: options.callOptions,
        })
      )
    } catch (error) {
      console.error('[translateTextBatch] fallback single translation failed', error)
      result.set(text, text)
    }
  }

  return result
}

export async function translateTextBatch(
  texts: string[],
  targetLang: string,
  options: TranslateTextBatchOptions = {}
): Promise<Map<string, string>> {
  if (!texts || texts.length === 0) {
    return new Map()
  }

  const glossary = loadGlossary()
  
  // Apply glossary protection per-text before batching
  const protectedEntries = texts.map((text, index) => {
    const { protectedText, terms } = protectTerms(text, glossary)
    return { index: index.toString(), protectedText, terms }
  })
  
  // Build indexed JSON input
  const inputJson = Object.fromEntries(
    protectedEntries.map(e => [e.index, e.protectedText])
  )
  
  const targetLangName = LANGUAGE_NAMES[targetLang] || targetLang
  const prompt = `Translate the following texts to ${targetLangName}. Preserve any placeholders like {{TERM_0}}. Output ONLY valid JSON, no markdown code blocks, no explanations.

Input JSON:
${JSON.stringify(inputJson, null, 2)}

Output the translated JSON:`
  
  const response = await callGemini(prompt, 0, {
    ...options.callOptions,
    responseMimeType: 'application/json',
  })
  const parsed = parseBatchJsonResponse(response)
  if (!parsed) {
    if (options.fallbackMode === 'error') {
      throw new Error('Batch translation returned malformed JSON')
    }
    console.error('[translateTextBatch] failed to parse batch JSON response, fallback to single mode')
    return fallbackTranslateTextIndividually(texts, targetLang, options)
  }
  
  // Restore glossary terms per-text and build result map
  const result = new Map<string, string>()
  for (const entry of protectedEntries) {
    const translatedText = parsed[entry.index]
    if (translatedText !== undefined) {
      const restored = restoreTerms(translatedText, entry.terms, glossary, targetLang)
      result.set(texts[parseInt(entry.index)], restored)
    }
  }
  
  return result
}
