/**
 * Conversation Management Service
 * 
 * Handles long, messy, or complex conversations to prevent AI overload.
 * Implements best practices:
 * - Conversation summarization
 * - Sliding window context management
 * - Topic-based segmentation
 * - Automatic cleanup of redundant messages
 * - Fallback mechanisms for incoherent conversations
 */

import { ChatMessage } from './aiService';

/**
 * Configuration for conversation management
 */
const CONVERSATION_CONFIG = {
  // Maximum number of recent messages to keep (sliding window)
  MAX_RECENT_MESSAGES: 20,
  
  // Threshold to trigger summarization
  SUMMARIZE_AFTER: 30,
  
  // Maximum total messages before aggressive cleanup
  MAX_TOTAL_MESSAGES: 50,
  
  // Maximum tokens per message (estimated: 1 token ≈ 4 characters)
  MAX_MESSAGE_TOKENS: 500,
  
  // Maximum conversation context tokens (Gemini 2.5 Flash: ~1M tokens, but we keep it reasonable)
  MAX_CONTEXT_TOKENS: 32000, // Conservative limit
  
  // Minimum confidence for keeping a message (0-1)
  MIN_MESSAGE_QUALITY: 0.3,
};

/**
 * Estimate token count for a message
 * Rough approximation: 1 token ≈ 4 characters for English text
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Estimate total tokens in conversation history
 */
function estimateConversationTokens(messages: ChatMessage[]): number {
  return messages.reduce((total, msg) => {
    return total + estimateTokens(msg.content || '');
  }, 0);
}

/**
 * Check if a message is redundant or low-quality
 */
function isLowQualityMessage(msg: ChatMessage, recentMessages: ChatMessage[]): boolean {
  // Skip system messages
  if (msg.role === 'system') return false;
  
  // Check for very short messages (likely not useful)
  if (msg.content && msg.content.trim().length < 5) return true;
  
  // Check for duplicate content
  if (recentMessages.some(m => 
    m.role === msg.role && 
    m.content === msg.content && 
    m !== msg
  )) {
    return true;
  }
  
  // Check for error messages that are redundant
  if (msg.content && (
    msg.content.includes('Error: Error:') || // Double errors
    msg.content.match(/I'm sorry.*I'm sorry/i) // Repeated apologies
  )) {
    return true;
  }
  
  return false;
}

/**
 * Clean redundant or low-quality messages from conversation
 */
export function cleanConversation(messages: ChatMessage[]): ChatMessage[] {
  const cleaned: ChatMessage[] = [];
  const seen = new Set<string>();
  
  for (const msg of messages) {
    // Always keep system messages
    if (msg.role === 'system') {
      cleaned.push(msg);
      continue;
    }
    
    // Skip low-quality messages
    if (isLowQualityMessage(msg, cleaned)) {
      continue;
    }
    
    // Skip exact duplicates
    const contentHash = `${msg.role}:${msg.content?.substring(0, 100)}`;
    if (seen.has(contentHash)) {
      continue;
    }
    seen.add(contentHash);
    
    // Truncate extremely long messages
    if (msg.content && estimateTokens(msg.content) > CONVERSATION_CONFIG.MAX_MESSAGE_TOKENS) {
      const truncated = msg.content.substring(0, CONVERSATION_CONFIG.MAX_MESSAGE_TOKENS * 4);
      cleaned.push({
        ...msg,
        content: truncated + '... [truncated]'
      });
      continue;
    }
    
    cleaned.push(msg);
  }
  
  return cleaned;
}

/**
 * Create an intelligent summary of conversation history
 * Uses key information extraction instead of full summarization
 */
export function createConversationSummary(messages: ChatMessage[]): string {
  const userQueries: Array<{ query: string; timestamp: number }> = [];
  const aiActions: Array<{ action: string; timestamp: number }> = [];
  const topics = new Set<string>();
  const mentionedIncidents = new Set<string>();
  const mentionedUsers = new Set<string>();
  
  for (const msg of messages) {
    const content = msg.content?.toLowerCase() || '';
    const timestamp = msg.timestamp || Date.now();
    
    if (msg.role === 'user') {
      // Extract incident numbers
      const incidentMatches = msg.content?.match(/#?(\d{5,})/g) || [];
      incidentMatches.forEach(inc => mentionedIncidents.add(inc.replace('#', '')));
      
      // Extract user names (simple pattern)
      const nameMatches = msg.content?.match(/\b([A-Z][a-z]+ [A-Z][a-z]+)\b/g) || [];
      nameMatches.forEach(name => mentionedUsers.add(name));
      
      // Categorize query types
      if (content.includes('ticket') || content.includes('incident')) {
        topics.add('incidents');
      }
      if (content.includes('user') || content.includes('employee')) {
        topics.add('users');
      }
      if (content.includes('create')) {
        topics.add('creation');
      }
      if (content.includes('update') || content.includes('edit')) {
        topics.add('updates');
      }
      if (content.includes('search') || content.includes('find')) {
        topics.add('search');
      }
      
      // Store significant user queries
      if (msg.content && msg.content.length > 10 && msg.content.length < 200) {
        userQueries.push({
          query: msg.content.substring(0, 100),
          timestamp
        });
      }
    } else if (msg.role === 'assistant') {
      // Track AI actions
      if (content.includes('created') || content.includes('created incident')) {
        aiActions.push({ action: 'Created incident(s)', timestamp });
      }
      if (content.includes('updated') || content.includes('modified')) {
        aiActions.push({ action: 'Updated record(s)', timestamp });
      }
      if (content.includes('found') && content.includes('incident')) {
        aiActions.push({ action: 'Retrieved incident data', timestamp });
      }
    }
  }
  
  // Build structured summary
  const summaryParts: string[] = [];
  
  // Topics discussed
  if (topics.size > 0) {
    summaryParts.push(`Topics discussed: ${Array.from(topics).join(', ')}`);
  }
  
  // Incident numbers mentioned
  if (mentionedIncidents.size > 0) {
    const incidents = Array.from(mentionedIncidents).slice(0, 5);
    summaryParts.push(`Incidents mentioned: ${incidents.join(', ')}${mentionedIncidents.size > 5 ? '...' : ''}`);
  }
  
  // Users mentioned
  if (mentionedUsers.size > 0) {
    const users = Array.from(mentionedUsers).slice(0, 3);
    summaryParts.push(`Users mentioned: ${users.join(', ')}${mentionedUsers.size > 3 ? '...' : ''}`);
  }
  
  // Recent user queries
  if (userQueries.length > 0) {
    const recentQueries = userQueries.slice(-3);
    summaryParts.push(`Recent queries: ${recentQueries.map(q => `"${q.query}"`).join('; ')}`);
  }
  
  // AI actions taken
  if (aiActions.length > 0) {
    const recentActions = aiActions.slice(-3);
    summaryParts.push(`Actions taken: ${recentActions.map(a => a.action).join('; ')}`);
  }
  
  // Conversation length
  summaryParts.push(`Total exchanges: ${Math.floor(messages.length / 2)}`);
  
  return summaryParts.join('. ') + '.';
}

/**
 * Apply sliding window to conversation history
 * Keeps most recent messages and summarizes older ones
 */
export function applySlidingWindow(
  messages: ChatMessage[],
  currentMessage: string
): ChatMessage[] {
  // First, clean the conversation
  let cleaned = cleanConversation(messages);
  
  // Check token count
  const totalTokens = estimateConversationTokens(cleaned) + estimateTokens(currentMessage);
  
  // If within limits, return as-is
  if (cleaned.length <= CONVERSATION_CONFIG.SUMMARIZE_AFTER && 
      totalTokens <= CONVERSATION_CONFIG.MAX_CONTEXT_TOKENS) {
    return cleaned;
  }
  
  console.log('[ConversationManager] Applying sliding window. Current:', cleaned.length, 'messages,', totalTokens, 'tokens');
  
  // Separate system messages (always keep)
  const systemMessages = cleaned.filter(msg => msg.role === 'system');
  const userAssistantMessages = cleaned.filter(msg => msg.role !== 'system');
  
  // Keep recent messages
  const recentMessages = userAssistantMessages.slice(-CONVERSATION_CONFIG.MAX_RECENT_MESSAGES);
  const oldMessages = userAssistantMessages.slice(0, -CONVERSATION_CONFIG.MAX_RECENT_MESSAGES);
  
  // Create summary of old messages
  let result: ChatMessage[] = [...systemMessages];
  
  if (oldMessages.length > 0) {
    const summary = createConversationSummary(oldMessages);
    const summaryMessage: ChatMessage = {
      role: 'system',
      content: `[CONVERSATION SUMMARY - Earlier context]:\n${summary}\n\nThis summary represents ${oldMessages.length} previous messages that have been condensed to preserve context while managing conversation length.`,
      timestamp: Date.now(),
      summary: 'true'
    };
    result.push(summaryMessage);
  }
  
  // Add recent messages
  result.push(...recentMessages);
  
  console.log('[ConversationManager] After sliding window:', result.length, 'messages');
  
  return result;
}

/**
 * Detect if conversation has become incoherent or too messy
 * Returns true if conversation should be reset or heavily cleaned
 */
export function isConversationMessy(messages: ChatMessage[]): {
  isMessy: boolean;
  reasons: string[];
  suggestion: 'continue' | 'summarize' | 'reset';
} {
  const reasons: string[] = [];
  let isMessy = false;
  
  // Check message count
  if (messages.length > CONVERSATION_CONFIG.MAX_TOTAL_MESSAGES) {
    reasons.push(`Too many messages (${messages.length} > ${CONVERSATION_CONFIG.MAX_TOTAL_MESSAGES})`);
    isMessy = true;
  }
  
  // Check token count
  const tokens = estimateConversationTokens(messages);
  if (tokens > CONVERSATION_CONFIG.MAX_CONTEXT_TOKENS) {
    reasons.push(`Token limit exceeded (${tokens} > ${CONVERSATION_CONFIG.MAX_CONTEXT_TOKENS})`);
    isMessy = true;
  }
  
  // Check for excessive error messages
  const errorMessages = messages.filter(msg => 
    msg.content?.toLowerCase().includes('error') || 
    msg.content?.toLowerCase().includes('sorry, i encountered')
  ).length;
  
  if (errorMessages > 5) {
    reasons.push(`Too many error messages (${errorMessages})`);
    isMessy = true;
  }
  
  // Check for repetitive content
  const recentContents = messages.slice(-10).map(m => m.content?.substring(0, 50)).filter(Boolean);
  const uniqueContents = new Set(recentContents);
  if (recentContents.length > 5 && uniqueContents.size / recentContents.length < 0.5) {
    reasons.push('Repetitive messages detected');
    isMessy = true;
  }
  
  // Determine suggestion
  let suggestion: 'continue' | 'summarize' | 'reset' = 'continue';
  
  if (isMessy) {
    if (messages.length > CONVERSATION_CONFIG.MAX_TOTAL_MESSAGES * 1.5) {
      suggestion = 'reset';
    } else if (tokens > CONVERSATION_CONFIG.MAX_CONTEXT_TOKENS * 1.5) {
      suggestion = 'reset';
    } else {
      suggestion = 'summarize';
    }
  }
  
  return { isMessy, reasons, suggestion };
}

/**
 * Create a reset message for starting fresh conversation
 */
export function createResetMessage(_currentMessage: string, previousContext?: string): ChatMessage {
  const resetContent = previousContext
    ? `[CONVERSATION RESET]: The previous conversation was reset due to length/complexity. Starting fresh. Previous context summary: ${previousContext.substring(0, 200)}...`
    : `[CONVERSATION RESET]: Starting a fresh conversation.`;
  
  return {
    role: 'system',
    content: resetContent,
    timestamp: Date.now()
  };
}

/**
 * Intelligent conversation management - main entry point
 * Applies all cleanup, summarization, and management strategies
 */
export function manageConversation(
  messages: ChatMessage[],
  currentMessage: string
): {
  managedMessages: ChatMessage[];
  wasReset: boolean;
  wasSummarized: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];
  let wasReset = false;
  let wasSummarized = false;
  
  // Check if conversation is too messy
  const messyCheck = isConversationMessy(messages);
  
  if (messyCheck.isMessy) {
    console.warn('[ConversationManager] Conversation detected as messy:', messyCheck.reasons);
    warnings.push(...messyCheck.reasons);
    
    if (messyCheck.suggestion === 'reset') {
      // Create summary before reset
      const summary = createConversationSummary(messages);
      const resetMessage = createResetMessage(currentMessage, summary);
      
      // Keep only essential system messages and reset message
      const essentialSystem = messages.filter(msg => 
        msg.role === 'system' && 
        (msg.content?.includes('[DATA FETCHED') || 
         msg.content?.includes('USER PERMISSIONS') ||
         msg.content?.includes('CONVERSATION STATE'))
      );
      
      return {
        managedMessages: [...essentialSystem, resetMessage],
        wasReset: true,
        wasSummarized: false,
        warnings
      };
    }
  }
  
  // Apply sliding window (summarization)
  let managed = applySlidingWindow(messages, currentMessage);
  
  // Check if summarization happened
  wasSummarized = managed.some(msg => msg.summary === 'true');
  
  // Final cleanup
  managed = cleanConversation(managed);
  
  return {
    managedMessages: managed,
    wasReset,
    wasSummarized,
    warnings
  };
}

/**
 * Extract key information from conversation for quick reference
 */
export function extractConversationKeyInfo(messages: ChatMessage[]): {
  currentTopic?: string;
  mentionedIncidents: string[];
  mentionedUsers: string[];
  recentActions: string[];
} {
  const mentionedIncidents = new Set<string>();
  const mentionedUsers = new Set<string>();
  const recentActions: string[] = [];
  
  // Look at last 10 messages
  const recentMessages = messages.slice(-10);
  
  for (const msg of recentMessages) {
    // Extract incident numbers
    const incidentMatches = msg.content?.match(/#?(\d{5,})/g) || [];
    incidentMatches.forEach(inc => mentionedIncidents.add(inc.replace('#', '')));
    
    // Extract user names
    const nameMatches = msg.content?.match(/\b([A-Z][a-z]+ [A-Z][a-z]+)\b/g) || [];
    nameMatches.forEach(name => mentionedUsers.add(name));
    
    // Track actions
    if (msg.role === 'assistant') {
      if (msg.content?.includes('created')) recentActions.push('created');
      if (msg.content?.includes('updated')) recentActions.push('updated');
      if (msg.content?.includes('found')) recentActions.push('searched');
    }
  }
  
  // Determine current topic from recent messages
  const lastUserMessage = recentMessages.reverse().find(m => m.role === 'user');
  let currentTopic: string | undefined;
  
  if (lastUserMessage?.content) {
    const content = lastUserMessage.content.toLowerCase();
    if (content.includes('ticket') || content.includes('incident')) {
      currentTopic = 'incidents';
    } else if (content.includes('user') || content.includes('employee')) {
      currentTopic = 'users';
    } else if (content.includes('create')) {
      currentTopic = 'creation';
    } else if (content.includes('update')) {
      currentTopic = 'updates';
    }
  }
  
  return {
    currentTopic,
    mentionedIncidents: Array.from(mentionedIncidents),
    mentionedUsers: Array.from(mentionedUsers),
    recentActions: Array.from(new Set(recentActions))
  };
}

