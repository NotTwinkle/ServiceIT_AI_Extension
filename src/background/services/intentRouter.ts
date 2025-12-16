/**
 * Intent Router
 * 
 * Detects user intent from message and routes to appropriate agent.
 * This is the ENTRY POINT for all AI processing.
 */

export enum UserIntent {
  // Service Request intents
  CREATE_SERVICE_REQUEST = 'CREATE_SERVICE_REQUEST',
  CHECK_SR_STATUS = 'CHECK_SR_STATUS',
  
  // Incident intents
  LOOKUP_INCIDENT = 'LOOKUP_INCIDENT',
  UPDATE_INCIDENT = 'UPDATE_INCIDENT',
  CHECK_INCIDENT_STATUS = 'CHECK_INCIDENT_STATUS',
  
  // Knowledge Base intents
  KNOWLEDGE_BASE_SEARCH = 'KNOWLEDGE_BASE_SEARCH',
  HOW_TO_QUESTION = 'HOW_TO_QUESTION',
  
  // User/Employee intents
  SEARCH_USER = 'SEARCH_USER',
  CHECK_USER_INFO = 'CHECK_USER_INFO',
  
  // General conversation
  GREETING = 'GREETING',
  HELP = 'HELP',
  GENERAL_QUESTION = 'GENERAL_QUESTION',
  
  // Unknown
  UNKNOWN = 'UNKNOWN'
}

export interface IntentDetectionResult {
  intent: UserIntent;
  confidence: number; // 0-1
  entities?: {
    incidentNumber?: string;
    srNumber?: string;
    offeringName?: string;
    userName?: string;
    keywords?: string[];
  };
  requiresTools?: string[]; // Which tools/APIs this intent needs
}

/**
 * Detect user intent from message
 * Uses pattern matching + keyword detection (could be upgraded to ML later)
 */
export function detectIntent(
  userMessage: string,
  _conversationHistory: any[], // Prefixed with _ to indicate intentionally unused (reserved for future use)
  currentSRState?: any
): IntentDetectionResult {
  
  const lowerMessage = userMessage.toLowerCase().trim();
  
  // ══════════════════════════════════════════════════════════════════════════════
  // GREETING
  // ══════════════════════════════════════════════════════════════════════════════
  
  const greetingPatterns = [
    /^(hi|hello|hey|good morning|good afternoon|good evening)$/i,
    /^(hi|hello|hey) there$/i,
    /^what'?s up$/i
  ];
  
  if (greetingPatterns.some(p => p.test(lowerMessage))) {
    return {
      intent: UserIntent.GREETING,
      confidence: 0.95
    };
  }
  
  // ══════════════════════════════════════════════════════════════════════════════
  // HELP
  // ══════════════════════════════════════════════════════════════════════════════
  
  if (lowerMessage === 'help' || lowerMessage === 'what can you do' || 
      lowerMessage === 'how can you help' || lowerMessage === 'capabilities') {
    return {
      intent: UserIntent.HELP,
      confidence: 1.0
    };
  }
  
  // ══════════════════════════════════════════════════════════════════════════════
  // SERVICE REQUEST CREATION
  // ══════════════════════════════════════════════════════════════════════════════
  
  const srCreationKeywords = [
    'create sr', 'new sr', 'service request', 'request for', 
    'i need', 'i want', 'can i get', 'laptop', 'computer', 
    'hardware', 'software', 'access', 'account', 'unlock', 'reset password'
  ];
  
  const hasSRCreationKeyword = srCreationKeywords.some(k => lowerMessage.includes(k));
  
  // Check if in SR creation flow (catalog shown)
  const inSRFlow = currentSRState?.state === 'CATALOG_SHOWN' || 
                   currentSRState?.state === 'OFFERING_SUGGESTED';
  
  if (hasSRCreationKeyword || inSRFlow) {
    return {
      intent: UserIntent.CREATE_SERVICE_REQUEST,
      confidence: 0.9,
      requiresTools: ['fetchRequestOfferings', 'fetchFieldset']
    };
  }
  
  // ══════════════════════════════════════════════════════════════════════════════
  // INCIDENT LOOKUP (specific incident number)
  // ══════════════════════════════════════════════════════════════════════════════
  
  const incidentNumberMatch = userMessage.match(/\b(?:incident|ticket|inc)?\s*#?\s*(\d{4,6})\b/i);
  
  if (incidentNumberMatch) {
    return {
      intent: UserIntent.LOOKUP_INCIDENT,
      confidence: 0.95,
      entities: {
        incidentNumber: incidentNumberMatch[1]
      },
      requiresTools: ['fetchIncidentByNumber']
    };
  }
  
  // ══════════════════════════════════════════════════════════════════════════════
  // INCIDENT STATUS CHECK (general)
  // ══════════════════════════════════════════════════════════════════════════════
  
  const incidentStatusKeywords = [
    'my incident', 'my ticket', 'incident status', 'ticket status',
    'check incident', 'check ticket', 'my open incident', 'my open ticket'
  ];
  
  if (incidentStatusKeywords.some(k => lowerMessage.includes(k))) {
    return {
      intent: UserIntent.CHECK_INCIDENT_STATUS,
      confidence: 0.85,
      requiresTools: ['fetchIncidents']
    };
  }
  
  // ══════════════════════════════════════════════════════════════════════════════
  // SERVICE REQUEST STATUS
  // ══════════════════════════════════════════════════════════════════════════════
  
  const srStatusKeywords = [
    'sr status', 'service request status', 'my service request',
    'check sr', 'track sr'
  ];
  
  const srNumberMatch = userMessage.match(/\b(?:sr|service request)?\s*#?\s*(\d{4,6})\b/i);
  
  if (srStatusKeywords.some(k => lowerMessage.includes(k)) || srNumberMatch) {
    return {
      intent: UserIntent.CHECK_SR_STATUS,
      confidence: 0.85,
      entities: srNumberMatch ? {
        srNumber: srNumberMatch[1]
      } : undefined,
      requiresTools: ['fetchServiceRequests']
    };
  }
  
  // ══════════════════════════════════════════════════════════════════════════════
  // KNOWLEDGE BASE / HOW-TO
  // ══════════════════════════════════════════════════════════════════════════════
  
  const howToPatterns = [
    /^how (?:do i|to|can i)/i,
    /^what (?:is|are|does)/i,
    /^where (?:is|can i|do i)/i,
    /^when (?:should|can|do)/i,
    /^why (?:is|does|can)/i
  ];
  
  if (howToPatterns.some(p => p.test(lowerMessage))) {
    return {
      intent: UserIntent.HOW_TO_QUESTION,
      confidence: 0.8,
      requiresTools: ['searchKnowledgeBase', 'fetchDocumentation']
    };
  }
  
  // ══════════════════════════════════════════════════════════════════════════════
  // USER SEARCH
  // ══════════════════════════════════════════════════════════════════════════════
  
  const userSearchKeywords = [
    'find user', 'search user', 'who is', 'user named', 'employee named',
    'contact for', 'email for', 'find employee'
  ];
  
  if (userSearchKeywords.some(k => lowerMessage.includes(k))) {
    return {
      intent: UserIntent.SEARCH_USER,
      confidence: 0.8,
      requiresTools: ['searchEmployees']
    };
  }
  
  // ══════════════════════════════════════════════════════════════════════════════
  // GENERAL QUESTION (catch-all)
  // ══════════════════════════════════════════════════════════════════════════════
  
  return {
    intent: UserIntent.GENERAL_QUESTION,
    confidence: 0.5,
    requiresTools: ['searchKnowledgeBase']
  };
}

/**
 * Get a human-readable description of an intent
 */
export function getIntentDescription(intent: UserIntent): string {
  const descriptions: Record<UserIntent, string> = {
    [UserIntent.CREATE_SERVICE_REQUEST]: 'Creating a Service Request',
    [UserIntent.CHECK_SR_STATUS]: 'Checking Service Request status',
    [UserIntent.LOOKUP_INCIDENT]: 'Looking up incident details',
    [UserIntent.UPDATE_INCIDENT]: 'Updating incident information',
    [UserIntent.CHECK_INCIDENT_STATUS]: 'Checking incident status',
    [UserIntent.KNOWLEDGE_BASE_SEARCH]: 'Searching knowledge base',
    [UserIntent.HOW_TO_QUESTION]: 'Answering how-to question',
    [UserIntent.SEARCH_USER]: 'Searching for user',
    [UserIntent.CHECK_USER_INFO]: 'Getting user information',
    [UserIntent.GREETING]: 'Greeting user',
    [UserIntent.HELP]: 'Showing capabilities',
    [UserIntent.GENERAL_QUESTION]: 'Answering general question',
    [UserIntent.UNKNOWN]: 'Processing request'
  };
  
  return descriptions[intent] || 'Processing request';
}
