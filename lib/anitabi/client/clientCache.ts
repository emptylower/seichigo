import type { AnitabiMapTab } from '../types'
import type {
  CacheStore,
  CachedCardsPayload,
  CachedBangumiDetail,
} from './types'

const DB_NAME = 'anitabi-cache'
const DB_VERSION = 1
const STORE_CARDS = 'cards'
const STORE_DETAILS = 'details'
const META_KEY = '__datasetVersion__'

// ---------------------------------------------------------------------------
// In-memory fallback (Safari Private Browsing, SSR, missing IndexedDB, etc.)
// ---------------------------------------------------------------------------

class InMemoryCacheStore implements CacheStore {
  private cards = new Map<AnitabiMapTab, CachedCardsPayload>()
  private details = new Map<number, CachedBangumiDetail>()
  private version: string | null = null

  async getCards(tab: AnitabiMapTab): Promise<CachedCardsPayload | null> {
    return this.cards.get(tab) ?? null
  }

  async putCards(tab: AnitabiMapTab, payload: CachedCardsPayload): Promise<void> {
    const prev = this.version
    if (prev !== null && prev !== payload.datasetVersion) {
      this.details.clear()
    }
    this.version = payload.datasetVersion
    this.cards.set(tab, payload)
  }

  async getDetail(bangumiId: number): Promise<CachedBangumiDetail | null> {
    return this.details.get(bangumiId) ?? null
  }

  async putDetail(bangumiId: number, payload: CachedBangumiDetail): Promise<void> {
    if (this.version === null) this.version = payload.datasetVersion
    this.details.set(bangumiId, payload)
  }

  async getVersion(): Promise<string | null> {
    return this.version
  }

  async clear(): Promise<void> {
    this.cards.clear()
    this.details.clear()
    this.version = null
  }
}

// ---------------------------------------------------------------------------
// IndexedDB helpers
// ---------------------------------------------------------------------------

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_CARDS)) {
        db.createObjectStore(STORE_CARDS)
      }
      if (!db.objectStoreNames.contains(STORE_DETAILS)) {
        db.createObjectStore(STORE_DETAILS)
      }
    }

    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('IndexedDB blocked'))
  })
}

function idbGet<T>(db: IDBDatabase, store: string, key: IDBValidKey): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly')
    const req = tx.objectStore(store).get(key)
    req.onsuccess = () => resolve(req.result as T | undefined)
    req.onerror = () => reject(req.error)
  })
}

function idbPut(db: IDBDatabase, store: string, key: IDBValidKey, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

function idbClearStore(db: IDBDatabase, store: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// ---------------------------------------------------------------------------
// IndexedDB-backed CacheStore
// ---------------------------------------------------------------------------

class IDBCacheStore implements CacheStore {
  constructor(private db: IDBDatabase) {}

  async getCards(tab: AnitabiMapTab): Promise<CachedCardsPayload | null> {
    const val = await idbGet<CachedCardsPayload>(this.db, STORE_CARDS, tab)
    return val ?? null
  }

  async putCards(tab: AnitabiMapTab, payload: CachedCardsPayload): Promise<void> {
    const prev = await this.getVersion()
    if (prev !== null && prev !== payload.datasetVersion) {
      await idbClearStore(this.db, STORE_DETAILS)
    }
    await idbPut(this.db, STORE_CARDS, META_KEY, payload.datasetVersion)
    await idbPut(this.db, STORE_CARDS, tab, payload)
  }

  async getDetail(bangumiId: number): Promise<CachedBangumiDetail | null> {
    const val = await idbGet<CachedBangumiDetail>(this.db, STORE_DETAILS, bangumiId)
    return val ?? null
  }

  async putDetail(bangumiId: number, payload: CachedBangumiDetail): Promise<void> {
    const ver = await this.getVersion()
    if (ver === null) await idbPut(this.db, STORE_CARDS, META_KEY, payload.datasetVersion)
    await idbPut(this.db, STORE_DETAILS, bangumiId, payload)
  }

  async getVersion(): Promise<string | null> {
    const val = await idbGet<string>(this.db, STORE_CARDS, META_KEY)
    return val ?? null
  }

  async clear(): Promise<void> {
    await idbClearStore(this.db, STORE_CARDS)
    await idbClearStore(this.db, STORE_DETAILS)
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export async function createCacheStore(): Promise<CacheStore> {
  try {
    if (typeof indexedDB === 'undefined') {
      return new InMemoryCacheStore()
    }
    const db = await openDB()
    return new IDBCacheStore(db)
  } catch {
    return new InMemoryCacheStore()
  }
}

export { InMemoryCacheStore }
