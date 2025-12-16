/**
 * Adaptive Memory Service
 * 
 * Implements enterprise-grade adaptive learning and long-term memory for the AI assistant.
 * Based on 2024-2025 best practices:
 * - RAG (Retrieval-Augmented Generation) for instance-specific knowledge
 * - Long-term memory persistence across sessions
 * - Multi-dimensional memory retrieval (semantic, entity, temporal)
 * - Adaptive learning from user corrections
 * 
 * References:
 * - Mem0: Dynamic memory extraction and consolidation (26% improvement)
 * - IMDMR: Multi-dimensional memory retrieval (3.8x improvement)
 * - HippoRAG 2: Associative memory for long-term context
 */


export interface InstanceFact {
  id: string;
  fact: string; // e.g., "This is a service desk, not Cherwell Service Management"
  category: 'correction' | 'preference' | 'context' | 'workflow' | 'terminology';
  source: 'user_correction' | 'conversation' | 'system';
  confidence: number; // 0-1, how confident we are in this fact
  createdAt: number;
  lastUsed: number;
  usageCount: number;
  baseUrl: string; // Isolated per Ivanti instance
}

export interface ConversationMemory {
  sessionId: string;
  userId: string;
  baseUrl: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
  }>;
  summary?: string;
  keyTopics: string[];
  createdAt: number;
  lastUpdated: number;
}

const STORAGE_KEYS = {
  INSTANCE_FACTS: 'ivanti_instance_facts',
  CONVERSATION_MEMORIES: 'ivanti_conversation_memories',
  USER_PREFERENCES: 'ivanti_user_preferences',
};

/**
 * Extract facts from user corrections
 * Example: "wait its not cherwell service management its a service desk"
 * → Fact: "This is a service desk, not Cherwell Service Management"
 */
export function extractFactFromCorrection(
  userMessage: string,
  previousContext: string,
  baseUrl: string
): InstanceFact | null {
  // Detect correction patterns
  const correctionPatterns = [
    /(?:wait|actually|no|not|correction|that's wrong|incorrect).*?(?:its?|it's|this is|that is|we are|we're)\s+(?:not|a|an|the)\s+([^,\.]+)/i,
    /(?:its?|it's|this is|that is)\s+(?:not|a|an|the)\s+([^,\.]+)/i,
    /(?:we|this|that)\s+(?:are|is)\s+(?:a|an|the)\s+([^,\.]+)/i,
  ];
  
  for (const pattern of correctionPatterns) {
    const match = userMessage.match(pattern);
    if (match && match[1]) {
      const correctedValue = match[1].trim();
      
      // Try to extract what was wrong from previous context
      let wrongValue = '';
      if (previousContext) {
        const wrongMatch = previousContext.match(/(?:cherwell|service management|offering|request)/i);
        if (wrongMatch) {
          wrongValue = wrongMatch[0];
        }
      }
      
      const factText = wrongValue
        ? `This is ${correctedValue}, not ${wrongValue}`
        : `This is ${correctedValue}`;
      
      return {
        id: `fact_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        fact: factText,
        category: 'correction',
        source: 'user_correction',
        confidence: 0.9, // High confidence for explicit corrections
        createdAt: Date.now(),
        lastUsed: Date.now(),
        usageCount: 1,
        baseUrl,
      };
    }
  }
  
  return null;
}

/**
 * Store instance-specific fact
 */
export async function storeInstanceFact(fact: InstanceFact): Promise<void> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.INSTANCE_FACTS);
    const facts: InstanceFact[] = result[STORAGE_KEYS.INSTANCE_FACTS] || [];
    
    // Check for duplicates (same fact for same baseUrl)
    const existingIndex = facts.findIndex(
      f => f.baseUrl === fact.baseUrl && 
           f.fact.toLowerCase() === fact.fact.toLowerCase()
    );
    
    if (existingIndex >= 0) {
      // Update existing fact (increase confidence, usage count)
      facts[existingIndex] = {
        ...facts[existingIndex],
        confidence: Math.min(1.0, facts[existingIndex].confidence + 0.1),
        lastUsed: Date.now(),
        usageCount: facts[existingIndex].usageCount + 1,
      };
    } else {
      facts.push(fact);
    }
    
    await chrome.storage.local.set({ [STORAGE_KEYS.INSTANCE_FACTS]: facts });
    console.log('[AdaptiveMemory] ✅ Stored instance fact:', fact.fact);
  } catch (error) {
    console.error('[AdaptiveMemory] Error storing fact:', error);
  }
}

/**
 * Retrieve relevant instance facts for a query
 * Uses semantic matching (keyword-based for now, can be enhanced with embeddings)
 */
export async function retrieveRelevantFacts(
  query: string,
  baseUrl: string,
  maxResults: number = 5
): Promise<InstanceFact[]> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.INSTANCE_FACTS);
    const allFacts: InstanceFact[] = result[STORAGE_KEYS.INSTANCE_FACTS] || [];
    
    // Filter by baseUrl (instance isolation)
    const instanceFacts = allFacts.filter(f => f.baseUrl === baseUrl);
    
    if (instanceFacts.length === 0) return [];
    
    // Simple keyword-based relevance scoring
    const lowerQuery = query.toLowerCase();
    const queryWords = lowerQuery.split(/\s+/).filter(w => w.length > 2);
    
    const scoredFacts = instanceFacts.map(fact => {
      const lowerFact = fact.fact.toLowerCase();
      let score = 0;
      
      // Exact phrase match (highest score)
      if (lowerFact.includes(lowerQuery)) {
        score += 10;
      }
      
      // Word overlap
      const factWords = lowerFact.split(/\s+/);
      const matchingWords = queryWords.filter(qw => factWords.some(fw => fw.includes(qw) || qw.includes(fw)));
      score += matchingWords.length * 2;
      
      // Boost by confidence and recency
      score += fact.confidence * 3;
      const daysSinceUsed = (Date.now() - fact.lastUsed) / (1000 * 60 * 60 * 24);
      score += Math.max(0, 5 - daysSinceUsed); // Recent facts get boost
      
      // Boost by usage count (frequently used facts are more relevant)
      score += Math.log(fact.usageCount + 1) * 0.5;
      
      return { fact, score };
    });
    
    // Sort by score and return top results
    return scoredFacts
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
      .map(item => item.fact);
  } catch (error) {
    console.error('[AdaptiveMemory] Error retrieving facts:', error);
    return [];
  }
}

/**
 * Store conversation memory for long-term persistence
 */
export async function storeConversationMemory(
  sessionId: string,
  userId: string,
  baseUrl: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }>,
  summary?: string,
  keyTopics: string[] = []
): Promise<void> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.CONVERSATION_MEMORIES);
    const memories: ConversationMemory[] = result[STORAGE_KEYS.CONVERSATION_MEMORIES] || [];
    
    // Find existing memory for this session
    const existingIndex = memories.findIndex(m => m.sessionId === sessionId);
    
    const memory: ConversationMemory = {
      sessionId,
      userId,
      baseUrl,
      messages: messages.slice(-50), // Keep last 50 messages
      summary,
      keyTopics,
      createdAt: existingIndex >= 0 ? memories[existingIndex].createdAt : Date.now(),
      lastUpdated: Date.now(),
    };
    
    if (existingIndex >= 0) {
      memories[existingIndex] = memory;
    } else {
      memories.push(memory);
      // Keep only last 100 conversations per instance
      const instanceMemories = memories.filter(m => m.baseUrl === baseUrl);
      if (instanceMemories.length > 100) {
        const toRemove = instanceMemories
          .sort((a, b) => a.lastUpdated - b.lastUpdated)
          .slice(0, instanceMemories.length - 100);
        toRemove.forEach(m => {
          const index = memories.findIndex(me => me.sessionId === m.sessionId);
          if (index >= 0) memories.splice(index, 1);
        });
      }
    }
    
    await chrome.storage.local.set({ [STORAGE_KEYS.CONVERSATION_MEMORIES]: memories });
    console.log('[AdaptiveMemory] ✅ Stored conversation memory for session:', sessionId);
  } catch (error) {
    console.error('[AdaptiveMemory] Error storing conversation memory:', error);
  }
}

/**
 * Retrieve relevant conversation memories
 */
export async function retrieveRelevantMemories(
  query: string,
  baseUrl: string,
  userId: string,
  maxResults: number = 3
): Promise<ConversationMemory[]> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.CONVERSATION_MEMORIES);
    const allMemories: ConversationMemory[] = result[STORAGE_KEYS.CONVERSATION_MEMORIES] || [];
    
    // Filter by baseUrl and userId
    const relevantMemories = allMemories.filter(
      m => m.baseUrl === baseUrl && m.userId === userId
    );
    
    if (relevantMemories.length === 0) return [];
    
    // Simple relevance scoring
    const lowerQuery = query.toLowerCase();
    const scored = relevantMemories.map(memory => {
      let score = 0;
      
      // Check summary
      if (memory.summary && memory.summary.toLowerCase().includes(lowerQuery)) {
        score += 5;
      }
      
      // Check key topics
      const matchingTopics = memory.keyTopics.filter(t => 
        lowerQuery.includes(t.toLowerCase()) || t.toLowerCase().includes(lowerQuery)
      );
      score += matchingTopics.length * 2;
      
      // Check recent messages
      const recentMessages = memory.messages.slice(-5);
      const matchingMessages = recentMessages.filter(m => 
        m.content.toLowerCase().includes(lowerQuery)
      );
      score += matchingMessages.length;
      
      // Boost by recency
      const daysSinceUpdate = (Date.now() - memory.lastUpdated) / (1000 * 60 * 60 * 24);
      score += Math.max(0, 10 - daysSinceUpdate);
      
      return { memory, score };
    });
    
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
      .map(item => item.memory);
  } catch (error) {
    console.error('[AdaptiveMemory] Error retrieving memories:', error);
    return [];
  }
}

/**
 * Mark fact as used (updates lastUsed and usageCount)
 */
export async function markFactAsUsed(factId: string): Promise<void> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.INSTANCE_FACTS);
    const facts: InstanceFact[] = result[STORAGE_KEYS.INSTANCE_FACTS] || [];
    
    const fact = facts.find(f => f.id === factId);
    if (fact) {
      fact.lastUsed = Date.now();
      fact.usageCount += 1;
      await chrome.storage.local.set({ [STORAGE_KEYS.INSTANCE_FACTS]: facts });
    }
  } catch (error) {
    console.error('[AdaptiveMemory] Error marking fact as used:', error);
  }
}

/**
 * Clean up old facts (older than 90 days, low confidence, never used)
 */
export async function cleanupOldFacts(baseUrl: string): Promise<void> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.INSTANCE_FACTS);
    const facts: InstanceFact[] = result[STORAGE_KEYS.INSTANCE_FACTS] || [];
    
    const now = Date.now();
    const ninetyDaysAgo = now - (90 * 24 * 60 * 60 * 1000);
    
    const cleaned = facts.filter(f => {
      if (f.baseUrl !== baseUrl) return true; // Keep facts from other instances
      
      // Remove if: old AND (low confidence OR never used)
      if (f.createdAt < ninetyDaysAgo) {
        if (f.confidence < 0.3 || f.usageCount === 0) {
          return false;
        }
      }
      
      return true;
    });
    
    if (cleaned.length < facts.length) {
      await chrome.storage.local.set({ [STORAGE_KEYS.INSTANCE_FACTS]: cleaned });
      console.log(`[AdaptiveMemory] 🗑️ Cleaned up ${facts.length - cleaned.length} old facts`);
    }
  } catch (error) {
    console.error('[AdaptiveMemory] Error cleaning up facts:', error);
  }
}
