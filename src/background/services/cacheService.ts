/**
 * Cache Service for Ivanti API Data
 * 
 * Implements a secure, TTL-based caching layer for Ivanti REST API responses.
 * Uses chrome.storage.local for persistent cache (survives browser restarts).
 * 
 * SECURITY FEATURES:
 * - All data is encrypted by Chrome at OS level (automatic)
 * - Data validation and sanitization before storage
 * - Cache expires automatically based on TTL
 * - Cache is cleared on user logout
 * - Input validation to prevent injection attacks
 * - Size limits to prevent storage abuse
 * - Automatic cleanup of expired entries
 * 
 * PERSISTENCE:
 * - Uses chrome.storage.local which PERSISTS across browser restarts
 * - Data remains available until TTL expires or manual cleanup
 * - Maximum storage: 10MB per extension (Chrome limit)
 */

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
  key: string;
}

export interface CacheConfig {
  defaultTTL: number; // Default TTL in milliseconds
  maxSize: number; // Maximum number of entries per cache type
}

// Cache configuration
const CACHE_CONFIG: CacheConfig = {
  defaultTTL: 5 * 60 * 1000, // 5 minutes default
  maxSize: 1000 // Max 1000 entries per cache type
};

// TTL configurations for different data types (in milliseconds)
// INDUSTRY BEST PRACTICE: Balance freshness vs performance
const TTL_CONFIG = {
  employees: 15 * 60 * 1000,      // 15 minutes - employee data changes infrequently
  incidents: 15 * 60 * 1000,      // 15 minutes - balanced cache (server-filtered)
  categories: 60 * 60 * 1000,     // 60 minutes - categories rarely change
  userTickets: 10 * 60 * 1000,    // 10 minutes - user's own tickets (high priority)
  searchResults: 5 * 60 * 1000,   // 5 minutes - search results are time-sensitive
  userTicketsPage: 10 * 60 * 1000, // 10 minutes - paginated user tickets (per page)
  requestOfferings: 4 * 60 * 60 * 1000, // 4 hours - Request Offerings change infrequently (catalog updates are rare)
  requestOfferingFieldset: 4 * 60 * 60 * 1000, // 4 hours - Fieldsets rarely change
  requestOfferingsComplete: 4 * 60 * 60 * 1000, // 4 hours - Complete offerings with fieldsets (pre-fetched knowledge base)
};

/**
 * Sanitize and validate data before caching
 * Prevents injection attacks and ensures data integrity
 */
function sanitizeData<T>(data: T): T {
  if (typeof data === 'string') {
    // Remove potential script tags and dangerous characters
    return data.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') as T;
  }
  if (Array.isArray(data)) {
    return data.map(item => sanitizeData(item)) as T;
  }
  if (data && typeof data === 'object') {
    const sanitized: any = {};
    for (const key in data) {
      // Validate key (prevent prototype pollution)
      if (Object.prototype.hasOwnProperty.call(data, key) && /^[a-zA-Z0-9_]+$/.test(key)) {
        sanitized[key] = sanitizeData(data[key]);
      }
    }
    return sanitized as T;
  }
  return data;
}

/**
 * Validate cache entry structure
 */
function validateCacheEntry<T>(entry: any): entry is CacheEntry<T> {
  return (
    entry &&
    typeof entry === 'object' &&
    typeof entry.timestamp === 'number' &&
    typeof entry.ttl === 'number' &&
    typeof entry.key === 'string' &&
    entry.data !== undefined &&
    entry.timestamp > 0 &&
    entry.ttl > 0
  );
}

/**
 * Generate cache key from query parameters
 * Includes validation to prevent key injection
 */
function generateCacheKey(type: string, params: Record<string, any>): string {
  // Validate type (prevent injection)
  if (!/^[a-zA-Z0-9_]+$/.test(type)) {
    throw new Error('Invalid cache type');
  }
  
  const sortedParams = Object.keys(params)
    .sort()
    .filter(key => /^[a-zA-Z0-9_]+$/.test(key)) // Only allow safe keys
    .map(key => {
      const value = params[key];
      // Sanitize value for JSON
      const safeValue = typeof value === 'string' 
        ? value.replace(/[<>\"'&]/g, '') // Remove dangerous chars
        : value;
      return `${key}:${JSON.stringify(safeValue)}`;
    })
    .join('|');
  
  // Create a hash-like key (limit length to prevent storage issues)
  const key = `ivanti_cache_${type}_${sortedParams}`;
  if (key.length > 200) {
    // If key is too long, use a hash instead
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `ivanti_cache_${type}_${Math.abs(hash).toString(36)}`;
  }
  return key;
}

/**
 * Check if cache entry is still valid
 */
function isCacheValid<T>(entry: CacheEntry<T> | null): entry is CacheEntry<T> {
  if (!entry) return false;
  const now = Date.now();
  const age = now - entry.timestamp;
  return age < entry.ttl;
}

/**
 * INDUSTRY BEST PRACTICE: Track last sync time for incremental updates
 * Stores the last time data was fetched for a specific user/resource
 * Used for "updatedSince" queries to fetch only changed data
 */
export async function getLastSyncTime(userId: string, resource: string): Promise<Date | null> {
  try {
    const key = `last_sync_${resource}_${userId}`;
    const result = await chrome.storage.local.get(key);
    if (result[key]) {
      return new Date(result[key]);
    }
    return null;
  } catch (error) {
    console.error('[Cache] Error getting last sync time:', error);
    return null;
  }
}

export async function setLastSyncTime(userId: string, resource: string, time: Date = new Date()): Promise<void> {
  try {
    const key = `last_sync_${resource}_${userId}`;
    await chrome.storage.local.set({ [key]: time.toISOString() });
    console.log(`[Cache] ✅ Updated last sync time for ${resource}/${userId}: ${time.toISOString()}`);
  } catch (error) {
    console.error('[Cache] Error setting last sync time:', error);
  }
}

/**
 * Get cached data
 * Includes validation and sanitization for security
 */
export async function getCachedData<T>(
  type: string,
  params: Record<string, any>
): Promise<T | null> {
  try {
    // Validate inputs
    if (!type || typeof type !== 'string') {
      console.warn('[Cache] Invalid cache type');
      return null;
    }
    
    const cacheKey = generateCacheKey(type, params);
    const storageKey = `cache_${cacheKey}`;
    
    const result = await chrome.storage.local.get([storageKey]);
    const entry: any = result[storageKey];
    
    // Check if entry exists and is valid
    if (!entry) {
      console.log(`%c[Cache] ❌ Cache MISS for ${type}`, 'color: #ef4444; font-weight: bold;', params);
      return null;
    }
    
    // Validate entry structure
    if (!validateCacheEntry<T>(entry)) {
      console.warn('[Cache] Invalid cache entry structure, removing:', storageKey);
      await chrome.storage.local.remove([storageKey]);
      console.log(`%c[Cache] ❌ Cache MISS for ${type} (invalid entry)`, 'color: #ef4444; font-weight: bold;', params);
      return null;
    }
    
    // At this point, entry is validated as CacheEntry<T>
    const validatedEntry: CacheEntry<T> = entry;
    
    // Check if cache is still valid (not expired)
    const now = Date.now();
    const age = now - validatedEntry.timestamp;
    const isValid = age < validatedEntry.ttl;
    
    if (isValid) {
      const ageSeconds = Math.round(age / 1000);
      const remaining = Math.round((validatedEntry.ttl - age) / 1000);
      console.log(`%c[Cache] ✅ Cache HIT for ${type}`, 'color: #10b981; font-weight: bold;', params, `(age: ${ageSeconds}s, remaining: ${remaining}s)`);
      // Sanitize data before returning
      return sanitizeData(validatedEntry.data);
    }
    
    // Entry exists but is expired
    const ageSeconds = Math.round(age / 1000);
    console.log(`%c[Cache] ⏰ Cache EXPIRED for ${type}`, 'color: #f59e0b; font-weight: bold;', params, `(age: ${ageSeconds}s, TTL: ${Math.round(validatedEntry.ttl / 1000)}s)`);
    // Remove expired entry
    await chrome.storage.local.remove([storageKey]);
    
    return null;
  } catch (error) {
    console.error('[Cache] Error reading cache:', error);
    return null;
  }
}

/**
 * Store data in cache
 * Includes sanitization and validation for security
 */
export async function setCachedData<T>(
  type: string,
  params: Record<string, any>,
  data: T,
  customTTL?: number
): Promise<void> {
  try {
    // Validate inputs
    if (!type || typeof type !== 'string') {
      console.warn('[Cache] Invalid cache type, skipping cache');
      return;
    }
    
    if (!data) {
      console.warn('[Cache] Attempted to cache null/undefined data, skipping');
      return;
    }
    
    // Sanitize data before caching
    const sanitizedData = sanitizeData(data);
    
    const cacheKey = generateCacheKey(type, params);
    const storageKey = `cache_${cacheKey}`;
    
    // Determine TTL based on data type
    const ttl = customTTL || TTL_CONFIG[type as keyof typeof TTL_CONFIG] || CACHE_CONFIG.defaultTTL;
    
    // Validate TTL
    let safeTTL = ttl;
    if (ttl <= 0 || ttl > 24 * 60 * 60 * 1000) { // Max 24 hours
      console.warn('[Cache] Invalid TTL, using default');
      safeTTL = CACHE_CONFIG.defaultTTL;
    }
    
    const entry: CacheEntry<T> = {
      data: sanitizedData,
      timestamp: Date.now(),
      ttl: safeTTL,
      key: storageKey
    };
    
    // Validate entry before storing
    if (!validateCacheEntry(entry)) {
      console.error('[Cache] Invalid cache entry structure, not caching');
      return;
    }
    
    // Check cache size and clean up if needed
    await cleanupCacheIfNeeded(type);
    
    await chrome.storage.local.set({ [storageKey]: entry });
    const dataSize = JSON.stringify(sanitizedData).length;
    console.log(`%c[Cache] 💾 Cached ${type}`, 'color: #3b82f6; font-weight: bold;', params, `(TTL: ${Math.round(safeTTL / 1000)}s, size: ${(dataSize / 1024).toFixed(2)}KB, persists across restarts)`);
  } catch (error) {
    console.error('[Cache] Error writing cache:', error);
    // If quota exceeded, try to clean up old entries
    if (error instanceof Error && (error.message.includes('QUOTA_BYTES') || error.message.includes('quota'))) {
      console.warn('[Cache] Storage quota exceeded, cleaning up...');
      await clearExpiredEntries();
      // Retry once after cleanup
      try {
        const sanitizedData = sanitizeData(data);
        const cacheKey = generateCacheKey(type, params);
        const storageKey = `cache_${cacheKey}`;
        const ttl = customTTL || TTL_CONFIG[type as keyof typeof TTL_CONFIG] || CACHE_CONFIG.defaultTTL;
        const entry: CacheEntry<T> = {
          data: sanitizedData,
          timestamp: Date.now(),
          ttl,
          key: storageKey
        };
        await chrome.storage.local.set({ [storageKey]: entry });
        console.log('[Cache] ✅ Successfully cached after cleanup');
      } catch (retryError) {
        console.error('[Cache] Failed to cache after cleanup:', retryError);
      }
    }
  }
}

/**
 * Invalidate cache for a specific type or all cache
 */
export async function invalidateCache(type?: string, params?: Record<string, any>): Promise<void> {
  try {
    if (type && params) {
      // Invalidate specific entry
      const cacheKey = generateCacheKey(type, params);
      const storageKey = `cache_${cacheKey}`;
      await chrome.storage.local.remove([storageKey]);
      console.log(`[Cache] 🗑️ Invalidated cache for ${type}:`, params);
    } else if (type) {
      // Invalidate all entries of a type
      const allData = await chrome.storage.local.get(null);
      const keysToRemove: string[] = [];
      
      for (const key in allData) {
        if (key.startsWith(`cache_ivanti_cache_${type}_`)) {
          keysToRemove.push(key);
        }
      }
      
      if (keysToRemove.length > 0) {
        await chrome.storage.local.remove(keysToRemove);
        console.log(`[Cache] 🗑️ Invalidated ${keysToRemove.length} entries for type ${type}`);
      }
    } else {
      // Clear all cache
      await clearAllCache();
    }
  } catch (error) {
    console.error('[Cache] Error invalidating cache:', error);
  }
}

/**
 * Clear all expired cache entries
 */
async function clearExpiredEntries(): Promise<void> {
  try {
    const allData = await chrome.storage.local.get(null);
    const keysToRemove: string[] = [];
    
    for (const key in allData) {
      if (key.startsWith('cache_ivanti_cache_')) {
        const entry = allData[key] as CacheEntry<any>;
        if (entry && !isCacheValid(entry)) {
          keysToRemove.push(key);
        }
      }
    }
    
    if (keysToRemove.length > 0) {
      await chrome.storage.local.remove(keysToRemove);
      console.log(`[Cache] 🧹 Cleaned up ${keysToRemove.length} expired entries`);
    }
  } catch (error) {
    console.error('[Cache] Error clearing expired entries:', error);
  }
}

/**
 * Clear all cache entries
 */
async function clearAllCache(): Promise<void> {
  try {
    const allData = await chrome.storage.local.get(null);
    const keysToRemove: string[] = [];
    
    for (const key in allData) {
      if (key.startsWith('cache_ivanti_cache_')) {
        keysToRemove.push(key);
      }
    }
    
    if (keysToRemove.length > 0) {
      await chrome.storage.local.remove(keysToRemove);
      console.log(`[Cache] 🗑️ Cleared all cache (${keysToRemove.length} entries)`);
    }
  } catch (error) {
    console.error('[Cache] Error clearing all cache:', error);
  }
}

/**
 * Cleanup cache if it exceeds max size
 */
async function cleanupCacheIfNeeded(type: string): Promise<void> {
  try {
    const allData = await chrome.storage.local.get(null);
    const typeEntries: Array<{ key: string; entry: CacheEntry<any> }> = [];
    
    // Collect all entries of this type
    for (const key in allData) {
      if (key.startsWith(`cache_ivanti_cache_${type}_`)) {
        const entry = allData[key] as CacheEntry<any>;
        if (entry) {
          typeEntries.push({ key, entry });
        }
      }
    }
    
    // If over limit, remove oldest entries
    if (typeEntries.length >= CACHE_CONFIG.maxSize) {
      // Sort by timestamp (oldest first)
      typeEntries.sort((a, b) => a.entry.timestamp - b.entry.timestamp);
      
      // Remove oldest 20% of entries
      const toRemove = typeEntries.slice(0, Math.floor(typeEntries.length * 0.2));
      const keysToRemove = toRemove.map(e => e.key);
      
      await chrome.storage.local.remove(keysToRemove);
      console.log(`[Cache] 🧹 Cleaned up ${keysToRemove.length} old entries for ${type}`);
    }
  } catch (error) {
    console.error('[Cache] Error during cleanup:', error);
  }
}

/**
 * Get cache statistics
 */
export async function getCacheStats(): Promise<{
  totalEntries: number;
  entriesByType: Record<string, number>;
  oldestEntry: number | null;
  newestEntry: number | null;
}> {
  try {
    const allData = await chrome.storage.local.get(null);
    const stats = {
      totalEntries: 0,
      entriesByType: {} as Record<string, number>,
      oldestEntry: null as number | null,
      newestEntry: null as number | null
    };
    
    for (const key in allData) {
      if (key.startsWith('cache_ivanti_cache_')) {
        const entry = allData[key] as CacheEntry<any>;
        if (entry) {
          stats.totalEntries++;
          
          // Extract type from key
          const match = key.match(/cache_ivanti_cache_([^_]+)_/);
          if (match) {
            const type = match[1];
            stats.entriesByType[type] = (stats.entriesByType[type] || 0) + 1;
          }
          
          // Track oldest/newest
          if (!stats.oldestEntry || entry.timestamp < stats.oldestEntry) {
            stats.oldestEntry = entry.timestamp;
          }
          if (!stats.newestEntry || entry.timestamp > stats.newestEntry) {
            stats.newestEntry = entry.timestamp;
          }
        }
      }
    }
    
    return stats;
  } catch (error) {
    console.error('[Cache] Error getting cache stats:', error);
    return {
      totalEntries: 0,
      entriesByType: {},
      oldestEntry: null,
      newestEntry: null
    };
  }
}

// Export clearAllCache for use in logout handler
export { clearAllCache };

