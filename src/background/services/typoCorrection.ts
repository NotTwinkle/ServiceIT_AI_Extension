/**
 * Typo Correction Service
 * 
 * Handles typographical errors in user input using fuzzy matching techniques.
 * Based on best practices: Levenshtein distance, domain-specific dictionaries,
 * and context-aware correction to prevent AI overload.
 */

/**
 * Domain-specific dictionary of Ivanti ITSM terms that users might misspell
 * Organized by category for better matching
 * Format: canonical term -> [variants including common typos]
 */
const IVANTI_DICTIONARY: Record<string, string[]> = {
  // Core entities
  ticket: ['ticket', 'tickets', 'tckt', 'tckts', 'tix', 'tickrts', 'tickrt', 'tickt', 'tickts', 'ticktes'],
  incident: ['incident', 'incidents', 'incidnt', 'incidnts', 'incidnet', 'incidnets', 'incidentes'],
  request: ['request', 'requests', 'req', 'reqs', 'reqest', 'reqests', 'requst', 'requsts'],
  
  // User/Employee related
  user: ['user', 'users', 'usr', 'usrs', 'usre', 'usres'],
  employee: ['employee', 'employees', 'empl', 'empls', 'emplyee', 'emplyees', 'employe', 'employes'],
  
  // Status/Priority terms
  priority: ['priority', 'priorities', 'priorty', 'priorties', 'prio', 'prios'],
  urgency: ['urgency', 'urgent', 'urgeny', 'urgncy'],
  impact: ['impact', 'impacts', 'impct', 'impcts'],
  status: ['status', 'stat', 'stats', 'statis', 'staus'],
  
  // Actions
  create: ['create', 'creat', 'crate', 'createe', 'createt'],
  update: ['update', 'updat', 'updte', 'updtae', 'updatet'],
  delete: ['delete', 'delet', 'delte', 'deletet'],
  search: ['search', 'serch', 'serach', 'serche', 'seach'],
  find: ['find', 'fnd', 'finde', 'fidn'],
  show: ['show', 'shw', 'shwo', 'showw'],
  get: ['get', 'gt', 'gett', 'gte'],
  
  // Categories
  category: ['category', 'categories', 'categry', 'categries', 'cat', 'cats', 'catagory', 'catagories'],
  service: ['service', 'services', 'serv', 'servs', 'servic', 'servics'],
  department: ['department', 'departments', 'dept', 'depts', 'departmnt', 'departmnts'],
  team: ['team', 'teams', 'tm', 'tms', 'teem', 'teems'],
};

/**
 * Common typo patterns based on keyboard layout and common mistakes
 */
const COMMON_TYPO_PATTERNS: Record<string, string> = {
  // Transposed characters
  'tickrts': 'tickets',
  'tickrt': 'ticket',
  'incidnt': 'incident',
  'incidnts': 'incidents',
  'tckt': 'ticket',
  'tckts': 'tickets',
  'tix': 'tickets',
  'usr': 'user',
  'usrs': 'users',
  'empl': 'employee',
  'req': 'request',
  'reqs': 'requests',
  'prio': 'priority',
  'cat': 'category',
  'cats': 'categories',
  'serv': 'service',
  'servs': 'services',
  'dept': 'department',
  'depts': 'departments',
  'tm': 'team',
  'tms': 'teams',
  'stat': 'status',
  'stats': 'status',
  'fnd': 'find',
  'serch': 'search',
  'shw': 'show',
  'gt': 'get',
  'creat': 'create',
  'updat': 'update',
  'delet': 'delete',
};

/**
 * Calculate Levenshtein distance between two strings
 * Returns the minimum number of single-character edits needed to transform one string into another
 */
function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  // Base cases
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  // Fill the DP table
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // deletion
        dp[i][j - 1] + 1,      // insertion
        dp[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return dp[m][n];
}

/**
 * Calculate similarity ratio between two strings (0-1)
 * 1.0 = identical, 0.0 = completely different
 */
function similarityRatio(str1: string, str2: string): number {
  const maxLen = Math.max(str1.length, str2.length);
  if (maxLen === 0) return 1.0;
  
  const distance = levenshteinDistance(str1.toLowerCase(), str2.toLowerCase());
  return 1 - (distance / maxLen);
}

/**
 * Find the best match from dictionary for a given word
 * Returns the canonical term if similarity is above threshold, otherwise null
 */
function findBestMatch(
  word: string,
  dictionary: string[],
  threshold: number = 0.75
): string | null {
  const lowerWord = word.toLowerCase();
  
  // First check exact match (case-insensitive)
  const exactMatch = dictionary.find(term => term.toLowerCase() === lowerWord);
  if (exactMatch) return exactMatch;
  
  // Check common typo patterns first (fast lookup)
  if (COMMON_TYPO_PATTERNS[lowerWord]) {
    const corrected = COMMON_TYPO_PATTERNS[lowerWord];
    if (dictionary.some(term => term.toLowerCase() === corrected.toLowerCase())) {
      return corrected;
    }
  }
  
  // Calculate similarity for all dictionary terms
  let bestMatch: string | null = null;
  let bestSimilarity = 0;
  
  for (const term of dictionary) {
    const similarity = similarityRatio(lowerWord, term);
    
    // Prefer exact matches or very close matches
    if (similarity === 1.0) {
      return term;
    }
    
    if (similarity > bestSimilarity && similarity >= threshold) {
      bestSimilarity = similarity;
      bestMatch = term;
    }
  }
  
  return bestMatch;
}

/**
 * Build a flat list of all valid terms from the dictionary
 */
function getAllValidTerms(): string[] {
  const terms = new Set<string>();
  
  // Add all canonical terms
  Object.values(IVANTI_DICTIONARY).forEach(variants => {
    // First variant is typically the canonical form
    if (variants.length > 0) {
      terms.add(variants[0]);
    }
  });
  
  // Add common typo patterns as valid terms to check against
  Object.values(COMMON_TYPO_PATTERNS).forEach(correct => {
    terms.add(correct);
  });
  
  return Array.from(terms);
}

/**
 * Build a comprehensive dictionary for matching (includes all variants)
 */
function buildComprehensiveDictionary(): Map<string, string> {
  const map = new Map<string, string>();
  
  // Map all variants to their canonical form
  Object.entries(IVANTI_DICTIONARY).forEach(([canonical, variants]) => {
    variants.forEach(variant => {
      map.set(variant.toLowerCase(), canonical);
    });
  });
  
  // Add common typo patterns
  Object.entries(COMMON_TYPO_PATTERNS).forEach(([typo, correct]) => {
    map.set(typo.toLowerCase(), correct);
  });
  
  return map;
}

/**
 * Correct typos in user message using fuzzy matching
 * Returns the corrected message and any corrections made
 */
export interface TypoCorrectionResult {
  correctedMessage: string;
  corrections: Array<{ original: string; corrected: string; confidence: number }>;
  wasCorrected: boolean;
}

export function correctTypos(userMessage: string): TypoCorrectionResult {
  const corrections: Array<{ original: string; corrected: string; confidence: number }> = [];
  const dictionary = buildComprehensiveDictionary();
  const validTerms = getAllValidTerms();
  
  // Use word boundary regex to split into words while preserving structure
  const wordRegex = /\b(\w+)\b/g;
  let correctedMessage = userMessage;
  const wordMatches: Array<{ word: string; index: number; length: number }> = [];
  
  // Find all words and their positions
  let match;
  while ((match = wordRegex.exec(userMessage)) !== null) {
    wordMatches.push({
      word: match[1],
      index: match.index,
      length: match[1].length
    });
  }
  
  // Process words in reverse order to avoid index shifting issues when replacing
  const replacements: Array<{ start: number; end: number; replacement: string }> = [];
  
  for (const { word, index, length } of wordMatches) {
    const lowerWord = word.toLowerCase();
    
    // Skip very short words (likely correct or not important)
    if (word.length <= 2) {
      continue;
    }
    
    // Skip numbers
    if (/^\d+$/.test(word)) {
      continue;
    }
    
    // Check common typo patterns first (fast lookup)
    if (COMMON_TYPO_PATTERNS[lowerWord]) {
      const corrected = COMMON_TYPO_PATTERNS[lowerWord];
      if (lowerWord !== corrected.toLowerCase()) {
        corrections.push({
          original: word,
          corrected: corrected,
          confidence: 0.95
        });
        
        // Preserve original capitalization
        const replacement = word[0] === word[0].toUpperCase() 
          ? corrected.charAt(0).toUpperCase() + corrected.slice(1)
          : corrected;
        
        replacements.push({
          start: index,
          end: index + length,
          replacement: replacement
        });
        continue;
      }
    }
    
    // Check exact match in dictionary (fast path)
    if (dictionary.has(lowerWord)) {
      const canonical = dictionary.get(lowerWord)!;
      if (lowerWord !== canonical.toLowerCase()) {
        corrections.push({
          original: word,
          corrected: canonical,
          confidence: 0.9
        });
        
        // Preserve original capitalization
        const replacement = word[0] === word[0].toUpperCase()
          ? canonical.charAt(0).toUpperCase() + canonical.slice(1)
          : canonical;
        
        replacements.push({
          start: index,
          end: index + length,
          replacement: replacement
        });
        continue;
      }
    }
    
    // Fuzzy match against valid terms (only for words 4+ chars to avoid false positives)
    if (word.length >= 4) {
      const bestMatch = findBestMatch(word, validTerms, 0.75); // Higher threshold for fuzzy
      if (bestMatch && bestMatch.toLowerCase() !== lowerWord) {
        const similarity = similarityRatio(lowerWord, bestMatch.toLowerCase());
        // Only correct if similarity is high enough (0.75+)
        if (similarity >= 0.75) {
          corrections.push({
            original: word,
            corrected: bestMatch,
            confidence: similarity
          });
          
          // Preserve original capitalization
          const replacement = word[0] === word[0].toUpperCase()
            ? bestMatch.charAt(0).toUpperCase() + bestMatch.slice(1)
            : bestMatch;
          
          replacements.push({
            start: index,
            end: index + length,
            replacement: replacement
          });
        }
      }
    }
  }
  
  // Apply replacements in reverse order to preserve indices
  replacements.sort((a, b) => b.start - a.start);
  
  for (const { start, end, replacement } of replacements) {
    correctedMessage = correctedMessage.substring(0, start) + replacement + correctedMessage.substring(end);
  }
  
  return {
    correctedMessage,
    corrections,
    wasCorrected: corrections.length > 0
  };
}

/**
 * Quick typo check - returns true if message likely contains typos
 * Used for fast pre-filtering before running full correction
 * This is a lightweight check - full correction is fast enough that we can run it anyway
 */
export function hasLikelyTypos(message: string): boolean {
  // Always run typo correction - it's fast enough and safe (only corrects when confident)
  // This function can be used for logging/analytics, but we'll run correction anyway
  const words = message.toLowerCase().match(/\b\w{4,}\b/g) || [];
  
  if (words.length === 0) return false;
  
  const dictionary = buildComprehensiveDictionary();
  
  // Check if any word matches common typo patterns (fast lookup)
  for (const word of words) {
    if (COMMON_TYPO_PATTERNS[word]) {
      return true;
    }
  }
  
  // Check for words that might be typos (not in dictionary but close to common terms)
  for (const word of words) {
    // Skip if already in dictionary (likely correct)
    if (dictionary.has(word)) {
      continue;
    }
    
    // Quick similarity check against common typos
    for (const [typo] of Object.keys(COMMON_TYPO_PATTERNS)) {
      if (similarityRatio(word, typo) > 0.85) {
        return true;
      }
    }
  }
  
  // Return true more often to ensure correction runs (it's safe - only corrects when confident)
  // This prevents AI overload from unrecognized terms
  return false; // Let the correction function handle it - it's fast
}

