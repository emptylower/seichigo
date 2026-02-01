import fs from 'fs'
import path from 'path'

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
const MAX_RETRIES = 5
const INITIAL_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 32000
const BATCH_SIZE = 15
const MAX_BATCH_CHARS = 3000

const LANGUAGE_NAMES: Record<string, string> = {
  zh: 'Chinese (Simplified)',
  en: 'English',
  ja: 'Japanese',
}

type Glossary = Record<string, Record<string, string>>

let glossaryCache: Glossary | null = null

function loadGlossary(): Glossary {
  if (glossaryCache) return glossaryCache
  
  const glossaryPath = path.join(process.cwd(), 'lib/i18n/glossary.json')
  if (!fs.existsSync(glossaryPath)) {
    console.warn('⚠️  Glossary not found, term protection disabled')
    glossaryCache = {}
    return glossaryCache
  }
  
  glossaryCache = JSON.parse(fs.readFileSync(glossaryPath, 'utf-8')) as Glossary
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

export async function callGemini(prompt: string, retryCount = 0): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not set')
  }

  const backoffMs = Math.min(
    INITIAL_BACKOFF_MS * Math.pow(2, retryCount),
    MAX_BACKOFF_MS
  )

  try {
    const response = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 8192,
        },
      }),
    })

    if (response.status === 429) {
      if (retryCount >= MAX_RETRIES) {
        throw new Error(`Rate limit exceeded after ${MAX_RETRIES} retries`)
      }
      await sleep(backoffMs)
      return callGemini(prompt, retryCount + 1)
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

    if (retryCount < MAX_RETRIES) {
      await sleep(backoffMs)
      return callGemini(prompt, retryCount + 1)
    }

    throw error
  }
}

export async function translateText(text: string, targetLang: string): Promise<string> {
  if (!text || !text.trim()) {
    throw new Error('Text to translate cannot be empty')
  }

  const glossary = loadGlossary()
  const { protectedText, terms } = protectTerms(text, glossary)
  
  const targetLangName = LANGUAGE_NAMES[targetLang] || targetLang
  const prompt = `Translate the following text to ${targetLangName}. Preserve any placeholders like {{TERM_0}}. Only return the translation, no explanations:\n\n${protectedText}`
  
  const translated = await callGemini(prompt)
  
  let cleanedTranslation = translated.trim()
  if (cleanedTranslation.startsWith('```')) {
    cleanedTranslation = cleanedTranslation.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim()
  }
  
  return restoreTerms(cleanedTranslation, terms, glossary, targetLang)
}

export async function translateTextBatch(texts: string[], targetLang: string): Promise<Map<string, string>> {
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
  
  const response = await callGemini(prompt)
  
  // Strip markdown code blocks
  let jsonStr = response.trim()
  if (jsonStr.startsWith('```json')) {
    jsonStr = jsonStr.slice(7)
  } else if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.slice(3)
  }
  if (jsonStr.endsWith('```')) {
    jsonStr = jsonStr.slice(0, -3)
  }
  jsonStr = jsonStr.trim()
  
  // Parse JSON response
  let parsed: Record<string, string>
  try {
    parsed = JSON.parse(jsonStr) as Record<string, string>
  } catch (e) {
    throw new Error(`Failed to parse translation response: ${e instanceof Error ? e.message : 'Unknown error'}`)
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
