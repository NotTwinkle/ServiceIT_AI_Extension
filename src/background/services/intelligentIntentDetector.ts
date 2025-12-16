/**
 * Intelligent Intent Detector
 * 
 * Uses LLM reasoning (Gemini) to detect user intent from natural language,
 * instead of brittle pattern matching.
 * 
 * Based on 2024 best practices:
 * - ReAct framework (Reasoning + Acting)
 * - Chain-of-Thought prompting
 * - Context-aware classification
 * 
 * This allows the AI to understand:
 * - "sounds good" → confirmation
 * - "let's do this" → confirmation
 * - "i want this one" → selection
 * - "the service it" → referring to previous offering
 * - Typos, grammar mistakes, vague language
 */

import { AI_CONFIG } from '../config';

export interface IntentDetectionResult {
  // Primary intents
  isConfirming: boolean;          // User is confirming/agreeing to something
  isDelegating: boolean;          // User wants AI to decide/fill in details
  isSelecting: boolean;           // User is selecting/choosing an option
  isProviding: boolean;           // User is providing requested information
  isAsking: boolean;              // User is asking a question
  
  // Confidence & reasoning
  confidence: number;             // 0-1, how confident the AI is
  reasoning: string;              // Chain-of-thought explanation
  
  // Context understanding
  referencingPrevious: boolean;   // User referring to something mentioned before
  needsClarification: boolean;    // Message is too ambiguous
}

/**
 * Detect user intent using Gemini LLM reasoning
 * 
 * This is the "smart" way - AI interprets meaning from context,
 * not just matching keywords.
 */
export async function detectIntentWithLLM(
  userMessage: string,
  conversationHistory: Array<{ role: string; content: string }>,
  currentContext?: {
    lastAIResponse?: string;
    suggestedOffering?: string;
    waitingForConfirmation?: boolean;
    waitingForSelection?: boolean;
    missingFields?: string[];
  }
): Promise<IntentDetectionResult> {
  
  // Build context summary from recent conversation
  const recentMessages = conversationHistory.slice(-6); // Last 3 exchanges
  const contextSummary = recentMessages.map(m => 
    `${m.role === 'user' ? 'USER' : 'ASSISTANT'}: ${m.content.substring(0, 200)}...`
  ).join('\n');
  
  // Build structured prompt for intent classification
  const prompt = `You are an intent classifier for a conversational AI assistant in an ITSM system.

[CURRENT CONVERSATION CONTEXT]
${contextSummary}

[CURRENT STATE]
${currentContext?.waitingForConfirmation ? '- AI is waiting for user to confirm an action' : ''}
${currentContext?.suggestedOffering ? `- AI suggested offering: "${currentContext.suggestedOffering}"` : ''}
${currentContext?.waitingForSelection ? '- AI is waiting for user to select an option' : ''}
${currentContext?.missingFields?.length ? `- AI asked for: ${currentContext.missingFields.join(', ')}` : ''}

[USER'S LATEST MESSAGE]
"${userMessage}"

[YOUR TASK]
Analyze the user's message and classify their intent. Think step-by-step:

1. What did the AI just ask or suggest?
2. What is the user responding to?
3. What does the user's message MEAN in this context?
4. Is the user confirming, asking, selecting, or providing info?

[EXAMPLES OF CONFIRMATION]
- "yes" / "yeah" / "yup" / "sure"
- "sounds good" / "that works" / "perfect"
- "let's do it" / "go ahead" / "proceed"
- "i confirm" / "confirmed" / "i agree"
- "yes please" / "yes that's right"
- Even just "ok" or "👍" can be confirmation in context

[EXAMPLES OF DELEGATION]
- "you decide" / "up to you" / "whatever works"
- "just do it" / "fill it in for me"
- "i don't care" / "make it for me"

[EXAMPLES OF SELECTION]
- "the first one" / "number 2" / "option A"
- "the service it" (referring to previous mention)
- "pcf please" / "i want the laptop one"

[EXAMPLES OF PROVIDING INFO]
- "my email is..." / "for john doe"
- "laptop, manila office" (answering multiple questions)

Respond ONLY with valid JSON in this exact format:
{
  "isConfirming": true/false,
  "isDelegating": true/false,
  "isSelecting": true/false,
  "isProviding": true/false,
  "isAsking": true/false,
  "confidence": 0.0-1.0,
  "reasoning": "Step-by-step explanation of why you classified this way",
  "referencingPrevious": true/false,
  "needsClarification": true/false
}`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${AI_CONFIG.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [{ text: prompt }]
          }],
          generationConfig: {
            temperature: 0.1, // Low temperature for consistent classification
            maxOutputTokens: 500
          }
        })
      }
    );

    if (!response.ok) {
      // Handle rate limiting (429) gracefully
      if (response.status === 429) {
        console.warn('[Intelligent Intent] ⚠️ Rate limit hit (429), using fallback heuristics');
        throw new Error('RATE_LIMIT');
      }
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // Extract JSON from response (may be wrapped in markdown)
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in LLM response');
    }
    
    const result: IntentDetectionResult = JSON.parse(jsonMatch[0]);
    
    console.log('[Intelligent Intent] 🧠 LLM Classification:', {
      userMessage,
      result: {
        isConfirming: result.isConfirming,
        isDelegating: result.isDelegating,
        isSelecting: result.isSelecting,
        confidence: result.confidence
      },
      reasoning: result.reasoning
    });
    
    return result;
    
  } catch (error: any) {
    const isRateLimit = error.message === 'RATE_LIMIT';
    
    if (isRateLimit) {
      console.warn('[Intelligent Intent] ⚠️ Rate limit hit (429), using enhanced fallback heuristics');
    } else {
      console.error('[Intelligent Intent] ❌ Error detecting intent with LLM:', error);
    }
    
    // Enhanced fallback heuristics (better than basic regex)
    const lowerMessage = userMessage.toLowerCase().trim();
    
    // Check for confirmation patterns (more flexible)
    const confirmationPatterns = [
      /^(yes|yeah|yep|sure|ok|okay|proceed|confirm|confirmed?)\b/i,
      /\b(sounds good|that works|perfect|exactly|absolutely|go ahead|let'?s do it|i agree)\b/i,
      /\b(i confirm|please confirm|confirmed|that'?s right|correct)\b/i,
      /\b(can you do it|do it for me|please)\b/i // "can you do it for me please" = delegation/confirmation
    ];
    const isConfirming = confirmationPatterns.some(p => p.test(lowerMessage));
    
    // Check for delegation patterns
    const delegationPatterns = [
      /\b(up to you|you decide|your choice|whatever works|you choose)\b/i,
      /\b(just do it|fill it in|make it for me|do it for me|auto.?fill)\b/i,
      /\b(i don'?t care|you know|i trust you)\b/i,
      /\b(can you do it|do it for me)\b/i
    ];
    const isDelegating = delegationPatterns.some(p => p.test(lowerMessage));
    
    return {
      isConfirming,
      isDelegating,
      isSelecting: /\b(the|this|that)\b.*\b(one|option|please)\b/i.test(lowerMessage),
      isProviding: lowerMessage.includes(',') || lowerMessage.includes('is') || lowerMessage.includes('for'),
      isAsking: lowerMessage.includes('?') || lowerMessage.startsWith('what') || lowerMessage.startsWith('how') || lowerMessage.startsWith('where'),
      confidence: isRateLimit ? 0.7 : 0.5, // Higher confidence for rate limit (temporary issue)
      reasoning: isRateLimit 
        ? 'Rate limit hit, using enhanced fallback heuristics (temporary)'
        : 'LLM failed, used enhanced fallback heuristics',
      referencingPrevious: /\b(the|this|that|it)\b/i.test(lowerMessage),
      needsClarification: false
    };
  }
}

/**
 * Quick synchronous check for obvious intents
 * (use this for fast path, fallback to LLM for ambiguous cases)
 */
export function quickIntentCheck(userMessage: string): {
  isObviousConfirmation: boolean;
  isObviousDelegation: boolean;
  isAmbiguous: boolean;
} {
  const lowerMessage = userMessage.toLowerCase().trim();
  
  // Very obvious confirmations
  const obviousConfirmations = ['yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'proceed', 'confirm', 'confirmed'];
  const isObviousConfirmation = obviousConfirmations.includes(lowerMessage);
  
  // Very obvious delegations
  const isObviousDelegation = /^(you decide|up to you|just do it|fill it in)$/i.test(lowerMessage);
  
  // Ambiguous if longer message with confirmation words mixed in
  const hasConfirmationWords = /\b(yes|yeah|sure|ok|good|right|sounds|let'?s|i want|i'?ll take)\b/i.test(lowerMessage);
  const isAmbiguous = !isObviousConfirmation && !isObviousDelegation && hasConfirmationWords;
  
  return { isObviousConfirmation, isObviousDelegation, isAmbiguous };
}
