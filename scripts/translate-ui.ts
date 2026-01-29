#!/usr/bin/env npx tsx
/**
 * translate-ui.ts
 * 
 * Translates UI strings from source locale to target locales using Gemini API.
 * Preserves JSON structure (keys unchanged, only values translated).
 * 
 * Usage:
 *   npx tsx scripts/translate-ui.ts --source=zh --target=en,ja
 *   npx tsx scripts/translate-ui.ts --source=zh --target=en --dry-run
 * 
 * Environment:
 *   GEMINI_API_KEY - Required. Your Gemini API key.
 */

import * as fs from 'fs'
import * as path from 'path'

// ============================================================================
// Types
// ============================================================================

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[]
interface JsonObject {
  [key: string]: JsonValue
}

interface TranslationResult {
  key: string
  original: string
  translated: string
}

interface CliArgs {
  source: string
  target: string[]
  dryRun: boolean
  help: boolean
}

// ============================================================================
// Constants
// ============================================================================

const LOCALES_DIR = path.join(process.cwd(), 'lib', 'i18n', 'locales')
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent'

const MAX_RETRIES = 5
const INITIAL_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 32000
const BATCH_SIZE = 20

const LANGUAGE_NAMES: Record<string, string> = {
  zh: 'Chinese (Simplified)',
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
  'zh-TW': 'Chinese (Traditional)',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
}

// ============================================================================
// CLI Parsing
// ============================================================================

function printHelp(): void {
  console.log(`
translate-ui.ts - Translate UI strings using Gemini API

USAGE:
  npx tsx scripts/translate-ui.ts --source=<locale> --target=<locales>

OPTIONS:
  --source=<locale>     Source locale code (e.g., zh, en)
  --target=<locales>    Comma-separated target locale codes (e.g., en,ja)
  --dry-run             Preview translations without writing files
  --help                Show this help message

EXAMPLES:
  # Translate Chinese to English and Japanese
  npx tsx scripts/translate-ui.ts --source=zh --target=en,ja

  # Preview translation to English only
  npx tsx scripts/translate-ui.ts --source=zh --target=en --dry-run

ENVIRONMENT:
  GEMINI_API_KEY        Required. Your Gemini API key.

NOTES:
  - Source file must exist at lib/i18n/locales/<source>.json
  - Target files will be created/overwritten at lib/i18n/locales/<target>.json
  - Only string values are translated; keys and structure are preserved
  - Implements exponential backoff for rate limit handling
`)
}

function parseArgs(args: string[]): CliArgs {
  const result: CliArgs = {
    source: '',
    target: [],
    dryRun: false,
    help: false,
  }

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      result.help = true
    } else if (arg === '--dry-run') {
      result.dryRun = true
    } else if (arg.startsWith('--source=')) {
      result.source = arg.slice('--source='.length)
    } else if (arg.startsWith('--target=')) {
      result.target = arg.slice('--target='.length).split(',').filter(Boolean)
    }
  }

  return result
}

function validateArgs(args: CliArgs): string | null {
  if (args.help) return null

  if (!args.source) {
    return 'Missing required argument: --source=<locale>'
  }

  if (args.target.length === 0) {
    return 'Missing required argument: --target=<locales>'
  }

  const sourceFile = path.join(LOCALES_DIR, `${args.source}.json`)
  if (!fs.existsSync(sourceFile)) {
    return `Source file not found: ${sourceFile}`
  }

  return null
}

// ============================================================================
// Gemini API
// ============================================================================

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function callGeminiWithRetry(
  apiKey: string,
  prompt: string,
  retryCount = 0
): Promise<string> {
  const backoffMs = Math.min(
    INITIAL_BACKOFF_MS * Math.pow(2, retryCount),
    MAX_BACKOFF_MS
  )

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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
      console.log(`  ⏳ Rate limited, waiting ${backoffMs}ms before retry ${retryCount + 1}/${MAX_RETRIES}...`)
      await sleep(backoffMs)
      return callGeminiWithRetry(apiKey, prompt, retryCount + 1)
    }

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Gemini API error (${response.status}): ${errorText}`)
    }

    const data = await response.json()
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text

    if (!text) {
      throw new Error('Empty response from Gemini API')
    }

    return text
  } catch (error) {
    if (error instanceof Error && error.message.includes('Rate limit')) {
    throw error
  }

  if (retryCount < MAX_RETRIES) {
      console.log(`  ⚠️ Error: ${error instanceof Error ? error.message : 'Unknown error'}, retrying in ${backoffMs}ms...`)
      await sleep(backoffMs)
      return callGeminiWithRetry(apiKey, prompt, retryCount + 1)
    }

    throw error
  }
}

async function translateBatch(
  apiKey: string,
  entries: Array<{ key: string; value: string }>,
  sourceLocale: string,
  targetLocale: string
): Promise<Map<string, string>> {
  const sourceLang = LANGUAGE_NAMES[sourceLocale] || sourceLocale
  const targetLang = LANGUAGE_NAMES[targetLocale] || targetLocale

  const prompt = `You are a professional translator for a web application UI. Translate the following UI strings from ${sourceLang} to ${targetLang}.

IMPORTANT RULES:
1. Translate ONLY the values, preserve the exact keys
2. Keep placeholders like {count}, {size}, {maxSize} unchanged
3. Maintain the same tone and formality level
4. Keep technical terms consistent
5. Output ONLY valid JSON, no markdown code blocks, no explanations

Input JSON:
${JSON.stringify(Object.fromEntries(entries.map(e => [e.key, e.value])), null, 2)}

Output the translated JSON:`

  const response = await callGeminiWithRetry(apiKey, prompt)
  
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

  try {
    const parsed = JSON.parse(jsonStr) as Record<string, string>
    return new Map(Object.entries(parsed))
  } catch (e) {
    console.error('  ❌ Failed to parse Gemini response:', jsonStr.slice(0, 200))
    throw new Error(`Failed to parse translation response: ${e instanceof Error ? e.message : 'Unknown error'}`)
  }
}

// ============================================================================
// JSON Processing
// ============================================================================

function flattenJson(obj: JsonObject, prefix = ''): Array<{ key: string; value: string }> {
  const result: Array<{ key: string; value: string }> = []

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key

    if (typeof value === 'string') {
      result.push({ key: fullKey, value })
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result.push(...flattenJson(value as JsonObject, fullKey))
    }
  }

  return result
}

function unflattenJson(entries: Map<string, string>): JsonObject {
  const result: JsonObject = {}

  for (const [key, value] of entries) {
    const parts = key.split('.')
    let current: JsonObject = result

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]
      if (!(part in current)) {
        current[part] = {}
      }
      current = current[part] as JsonObject
    }

    current[parts[parts.length - 1]] = value
  }

  return result
}

// ============================================================================
// Main Translation Logic
// ============================================================================

async function translateLocale(
  apiKey: string,
  sourceData: JsonObject,
  sourceLocale: string,
  targetLocale: string,
  dryRun: boolean
): Promise<void> {
  console.log(`\n📝 Translating ${sourceLocale} → ${targetLocale}...`)

  const entries = flattenJson(sourceData)
  console.log(`  Found ${entries.length} strings to translate`)

  const translatedEntries = new Map<string, string>()
  const batches = Math.ceil(entries.length / BATCH_SIZE)

  for (let i = 0; i < batches; i++) {
    const start = i * BATCH_SIZE
    const end = Math.min(start + BATCH_SIZE, entries.length)
    const batch = entries.slice(start, end)

    console.log(`  📦 Batch ${i + 1}/${batches} (${batch.length} strings)...`)

    const translations = await translateBatch(apiKey, batch, sourceLocale, targetLocale)

    for (const [key, value] of translations) {
      translatedEntries.set(key, value)
    }

    if (i < batches - 1) {
      await sleep(500)
    }
  }

  const translatedJson = unflattenJson(translatedEntries)

  if (dryRun) {
    console.log(`\n  🔍 DRY RUN - Preview of ${targetLocale}.json:`)
    console.log(JSON.stringify(translatedJson, null, 2))
  } else {
    const targetFile = path.join(LOCALES_DIR, `${targetLocale}.json`)
    fs.writeFileSync(targetFile, JSON.stringify(translatedJson, null, 2) + '\n', 'utf-8')
    console.log(`  ✅ Written to ${targetFile}`)
  }

  console.log(`\n  📋 Sample translations:`)
  const samples = Array.from(translatedEntries.entries()).slice(0, 5)
  for (const [key, value] of samples) {
    const original = entries.find(e => e.key === key)?.value || ''
    console.log(`    ${key}:`)
    console.log(`      ${sourceLocale}: ${original}`)
    console.log(`      ${targetLocale}: ${value}`)
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    printHelp()
    process.exit(0)
  }

  const validationError = validateArgs(args)
  if (validationError) {
    console.error(`❌ Error: ${validationError}`)
    console.error('Run with --help for usage information.')
    process.exit(1)
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    console.error('❌ Error: GEMINI_API_KEY environment variable is not set.')
    console.error('Please set your Gemini API key:')
    console.error('  export GEMINI_API_KEY=your-api-key')
    process.exit(1)
  }

  const sourceFile = path.join(LOCALES_DIR, `${args.source}.json`)
  console.log(`📂 Loading source: ${sourceFile}`)

  let sourceData: JsonObject
  try {
    const content = fs.readFileSync(sourceFile, 'utf-8')
    sourceData = JSON.parse(content) as JsonObject
  } catch (e) {
    console.error(`❌ Error reading source file: ${e instanceof Error ? e.message : 'Unknown error'}`)
    process.exit(1)
  }

  console.log(`🌐 Source locale: ${args.source}`)
  console.log(`🎯 Target locales: ${args.target.join(', ')}`)
  if (args.dryRun) {
    console.log('🔍 DRY RUN MODE - No files will be written')
  }

  for (const targetLocale of args.target) {
    if (targetLocale === args.source) {
      console.log(`\n⚠️ Skipping ${targetLocale} (same as source)`)
      continue
    }

    try {
      await translateLocale(apiKey, sourceData, args.source, targetLocale, args.dryRun)
    } catch (e) {
      console.error(`\n❌ Failed to translate to ${targetLocale}: ${e instanceof Error ? e.message : 'Unknown error'}`)
      process.exit(1)
    }
  }

  console.log('\n✨ Translation complete!')
}

main().catch(e => {
  console.error('❌ Unexpected error:', e)
  process.exit(1)
})
