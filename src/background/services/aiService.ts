/**
 * AI Service
 * 
 * Handles all AI-related operations using Google Gemini API
 * Processes user messages and generates intelligent responses
 */

import { AI_CONFIG } from '../config';
import { IvantiUser } from './userIdentity';
import { fetchIvantiData, createIncident, updateIncident, deleteIncident, getIncidentRecId } from './ivantiDataService';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIResponse {
  message: string;
  actions?: IvantiAction[];
}

export interface IvantiAction {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  endpoint: string;
  body?: any;
  description: string;
  requiresConfirmation?: boolean;
}

/**
 * Detect if the AI is hallucinating data (making up RecIds, emails, etc.)
 * Returns an array of warning messages if hallucinations are detected
 */
function detectHallucinations(aiResponse: string, actualData: string): string[] {
  const warnings: string[] = [];
  
  // Check for RecIds in AI response (32-character hex strings)
  const recIdPattern = /RecId[:\s]+([A-F0-9]{32})/gi;
  const aiRecIds = [...aiResponse.matchAll(recIdPattern)].map(match => match[1]);
  
  for (const recId of aiRecIds) {
    if (!actualData.includes(recId)) {
      warnings.push(`AI made up RecId: ${recId} (not found in fetched data)`);
    }
  }
  
  // Check for email addresses in AI response
  const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
  const aiEmails = [...aiResponse.matchAll(emailPattern)].map(match => match[0]);
  
  for (const email of aiEmails) {
    if (!actualData.includes(email)) {
      warnings.push(`AI made up email: ${email} (not found in fetched data)`);
    }
  }
  
  // Check for incident numbers in AI response
  const incidentPattern = /Incident[#\s]+(\d{4,})/gi;
  const aiIncidents = [...aiResponse.matchAll(incidentPattern)].map(match => match[1]);
  
  for (const incidentNum of aiIncidents) {
    if (!actualData.includes(incidentNum)) {
      warnings.push(`AI made up incident number: ${incidentNum} (not found in fetched data)`);
    }
  }
  
  // Check for "I found" statements when no data was actually found
  if (aiResponse.match(/I found|Found user|Found employee/i)) {
    if (actualData.includes('RESULT: No') || actualData.includes('couldn\'t find') || actualData.includes('not found')) {
      warnings.push('AI said "I found" but the data says nothing was found');
    }
  }
  
  return warnings;
}

/**
 * Extract a human-readable incidents snippet from the Ivanti context block.
 * This is used as a fallback when the model claims it has no data or no dates,
 * but the context clearly contains incidents.
 */
function extractIncidentsSnippet(ivantiContext: string): string {
  if (!ivantiContext) return '';

  const markers = [
    '\n[INCIDENTS CREATED ON',
    '\n[INCIDENTS CREATED IN',
    '\n[RECENT INCIDENTS IN SYSTEM'
  ];

  let start = -1;
  for (const marker of markers) {
    start = ivantiContext.indexOf(marker);
    if (start !== -1) break;
  }
  if (start === -1) return '';

  // Find the start of the next section (another line that begins with '[')
  const rest = ivantiContext.substring(start + 1); // skip leading newline
  const nextSectionIndex = rest.indexOf('\n[');
  const end = nextSectionIndex === -1 ? ivantiContext.length : start + 1 + nextSectionIndex;

  const snippet = ivantiContext.substring(start + 1, end).trim();
  return snippet;
}

/**
 * Determine if a short free-text message is likely a follow-up providing a name
 * after previously asking to search for a user/employee.
 */
function isLikelyNameFollowUp(userMessage: string, history: ChatMessage[]): boolean {
  const trimmed = userMessage.trim();
  if (!trimmed) {
    return false;
  }

  const words = trimmed.split(/\s+/);
  if (words.length < 2 || words.length > 4) {
    return false;
  }

  const nameLike = words.every(word => /^[a-zA-Z][a-zA-Z'.-]*$/.test(word));
  if (!nameLike) {
    return false;
  }

  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (!msg || msg.role === 'system') {
      continue;
    }

    if (msg.role === 'assistant') {
      if (/couldn['’]t find.*user/i.test(msg.content) ||
          /could not find.*user/i.test(msg.content) ||
          /searching for/i.test(msg.content) ||
          /try searching/i.test(msg.content) ||
          /Being more specific/i.test(msg.content) ||
          /provide (the )?name/i.test(msg.content)) {
        return true;
      }
      break;
    }

    if (msg.role === 'user') {
      const lower = msg.content.toLowerCase();
      if (lower.includes('find user') ||
          lower.includes('find an employee') ||
          lower.includes('search for') ||
          lower.includes('look for a user') ||
          (lower.includes('find') && lower.includes('user'))) {
        return true;
      }
      break;
    }
  }

  return false;
}

/**
 * Process a user message and generate an AI response using Gemini
 */
export async function processMessage(
  userMessage: string,
  currentUser: IvantiUser,
  ticketId: string | null,
  conversationHistory: ChatMessage[]
): Promise<AIResponse> {
  try {
    console.log('[AI Service] Processing message with Gemini:', userMessage);

    // Lightweight "understanding" layer: normalize very common vague patterns
    const interpretationNotes: string[] = [];
    let normalizedMessage = userMessage;

    // Normalize some extremely common vague phrasings into clearer intent
    if (/what incidents in december 1/i.test(userMessage) || /incidents.*december 1/i.test(userMessage)) {
      interpretationNotes.push('User is asking for all incidents created on December 1 of the current year, any status.');
    }
    if (/tickets i made last month/i.test(userMessage)) {
      interpretationNotes.push('User is asking for tickets they created in the previous calendar month.');
    }
    if (/my ticket for yesterday/i.test(userMessage)) {
      interpretationNotes.push('User is asking for their own tickets created yesterday (relative to today).');
    }

    // Normalize obvious date formats into ISO inside an internal note; do NOT change user text
    const dateMatch = userMessage.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/);
    if (dateMatch) {
      const month = parseInt(dateMatch[1], 10) - 1;
      const day = parseInt(dateMatch[2], 10);
      const year = parseInt(dateMatch[3], 10);
      if (month >= 0 && month < 12 && day >= 1 && day <= 31) {
        const isoDate = new Date(year, month, day).toISOString().slice(0, 10);
        interpretationNotes.push(`User mentioned a date that can be interpreted as ${isoDate} (YYYY-MM-DD).`);
      }
    }

    // SECURITY: Early check for forbidden operations - block before any processing
    const lowerMessage = normalizedMessage.toLowerCase();
    
    // Block password-related operations - ABSOLUTELY FORBIDDEN
    if (lowerMessage.includes('password') || lowerMessage.includes('change password') || 
        lowerMessage.includes('reset password') || lowerMessage.includes('set password') ||
        lowerMessage.includes('update password') || lowerMessage.includes('new password') ||
        lowerMessage.includes('forgot password') || lowerMessage.includes('show password') ||
        lowerMessage.includes('tell password') || lowerMessage.includes('reveal password') ||
        lowerMessage.includes('what is my password') || lowerMessage.includes('what\'s my password')) {
      console.warn('[AI Service] 🚨 SECURITY: User attempted password operation - BLOCKED');
      return {
        message: 'I cannot help with password changes or reveal passwords. This is a security restriction. Please contact your system administrator or use the official password reset process in your system.',
        actions: []
      };
    }
    
    // Block deletion operations - ABSOLUTELY FORBIDDEN
    if (lowerMessage.includes('delete') || lowerMessage.includes('remove') || 
        lowerMessage.includes('erase') || lowerMessage.includes('drop')) {
      // Check if it's about deleting data/records (not just removing from a list)
      if (lowerMessage.includes('incident') || lowerMessage.includes('ticket') || 
          lowerMessage.includes('record') || lowerMessage.includes('data') ||
          lowerMessage.includes('user') || lowerMessage.includes('account')) {
        console.warn('[AI Service] 🚨 SECURITY: User attempted deletion operation - BLOCKED');
        return {
          message: 'I cannot delete any incidents, tickets, records, or user accounts. This is a security restriction to prevent accidental data loss. If you need something removed, please contact your system administrator.',
          actions: []
        };
      }
    }

    // Check if user is asking for Ivanti data
    
    // Special handling for "me", "myself", "my" queries - these refer to current user
    const isSelfQuery = /\b(me|myself|my|i am|who am i|find me|show me|tell me about me)\b/i.test(normalizedMessage);
    
    let needsIvantiData = 
      isSelfQuery || // "find me", "who am i", etc.
      lowerMessage.includes('show') ||
      lowerMessage.includes('get') ||
      lowerMessage.includes('fetch') ||
      lowerMessage.includes('find') ||
      lowerMessage.includes('search') ||
      lowerMessage.includes('list') ||
      lowerMessage.includes('all') ||
      lowerMessage.includes('my tickets') ||
      lowerMessage.includes('ticket #') ||
      lowerMessage.includes('incident') ||
      lowerMessage.includes('user') ||
      lowerMessage.includes('employee') ||
      lowerMessage.includes('of') || // For "incidents of Timothy"
      lowerMessage.includes('priority') ||
      lowerMessage.includes('urgency') ||
      lowerMessage.includes('impact') ||
      lowerMessage.includes('category') ||
      lowerMessage.includes('capacity') || // User might mean Impact
      lowerMessage.includes('urgent') ||
      lowerMessage.includes('critical') ||
      /\b(\d{4,})\b/.test(normalizedMessage) || // Contains incident number
      /\b[A-Z][a-z]+\b/.test(normalizedMessage); // Contains a capitalized name

    if (!needsIvantiData && isLikelyNameFollowUp(normalizedMessage, conversationHistory)) {
      needsIvantiData = true;
    }

    // Limit conversation history to prevent token overflow
    // Keep last 20 messages (10 user + 10 assistant) plus any system messages
    const MAX_HISTORY_MESSAGES = 20;
    if (conversationHistory.length > MAX_HISTORY_MESSAGES) {
      // Keep system messages and recent messages
      const systemMessages = conversationHistory.filter(msg => msg.role === 'system');
      const recentMessages = conversationHistory.filter(msg => msg.role !== 'system').slice(-MAX_HISTORY_MESSAGES);
      conversationHistory.length = 0;
      conversationHistory.push(...systemMessages, ...recentMessages);
      console.log('[AI Service] Trimmed conversation history to', conversationHistory.length, 'messages');
    }

    // Fetch Ivanti data FIRST if needed, and add it to history BEFORE processing
    let ivantiContext = '';
    let actualDataFetched = false;
    if (needsIvantiData) {
      console.log('[AI Service] User query requires Ivanti data, fetching...');
      ivantiContext = await fetchIvantiData(normalizedMessage, currentUser, conversationHistory);
      console.log('[AI Service] Ivanti data fetched:', ivantiContext.substring(0, 200));
      
      // Check if we actually got real data (not just error messages)
      actualDataFetched = !!ivantiContext && 
        !ivantiContext.includes('I\'d be happy to help') && 
        !ivantiContext.includes('Sorry, I encountered an error') &&
        !ivantiContext.includes('NO USER FOUND') &&
        !ivantiContext.includes('NO DATA FOUND');

      if (actualDataFetched) {
        for (let i = conversationHistory.length - 1; i >= 0; i--) {
          const msg = conversationHistory[i];
          if (msg.role === 'system' && msg.content?.startsWith('[WARNING]: No data was found in Ivanti.')) {
            conversationHistory.splice(i, 1);
          }
        }
      }
      
      // Add fetched data + interpretation notes to conversation history IMMEDIATELY
      // so it's available for this request. Interpretation notes help the model
      // understand vague, non-technical questions.
      let dataBlock = `[DATA FETCHED FROM IVANTI - You MUST use ONLY this data, DO NOT make up anything]:\n${ivantiContext}`;
      if (interpretationNotes.length > 0) {
        dataBlock = `[INTERPRETATION NOTES FOR NON-TECHNICAL USER QUESTION]:\n- ${interpretationNotes.join('\n- ')}\n\n` + dataBlock;
      }
      conversationHistory.push({
        role: 'system',
        content: dataBlock
      });
      
      // Add explicit warning if no data was found
      if (!actualDataFetched) {
        conversationHistory.push({
          role: 'system',
          content: `[WARNING]: No data was found in Ivanti. DO NOT make up any RecIds, emails, or other details. Tell the user the search didn't return results.`
        });
      } else {
        conversationHistory.push({
          role: 'system',
          content: `[RESPONSE RULE]: You already have the Ivanti results above. Respond with those details now using plain text paragraphs. Do NOT say that you are still searching.`
        });
      }
    }

    // Get knowledge base context with current query and conversation history
    let kbContext = '';
    try {
      const { getKnowledgeBaseContext } = await import('./knowledgeBaseService');
      kbContext = await getKnowledgeBaseContext(userMessage, currentUser, conversationHistory);
    } catch (error) {
      console.warn('[AI Service] Could not load knowledge base context:', error);
    }

    // Build system instruction (static, doesn't change per message)
    const systemInstruction = await buildSystemPrompt(currentUser, ticketId, kbContext);

    // Convert conversation history to Gemini format
    // IMPORTANT: Include ALL messages in order (user, assistant, system)
    // Gemini can handle system messages in the contents array
    const contents = conversationHistory
      .map(msg => {
        // Map roles correctly for Gemini API
        if (msg.role === 'assistant') {
          return {
            role: 'model',
            parts: [{ text: msg.content }]
          };
        } else if (msg.role === 'system') {
          // System messages can be included as user messages with context markers
          // OR we can include them as part of the system instruction
          // For now, include as user message with clear marker
          return {
            role: 'user',
            parts: [{ text: msg.content }]
          };
        } else {
          return {
            role: 'user',
            parts: [{ text: msg.content }]
          };
        }
      });

    // Add current user message to contents (for this API call)
    contents.push({
      role: 'user',
      parts: [{ text: userMessage }]
    });
    
    // Add current user message to conversation history (for next time)
    // This ensures the history is complete for the next message
    conversationHistory.push({
      role: 'user',
      content: userMessage
    });
    
    console.log('[AI Service] Conversation history length:', conversationHistory.length);
    console.log('[AI Service] Contents array length:', contents.length);
    console.log('[AI Service] Last few messages:', conversationHistory.slice(-3).map(m => `${m.role}: ${m.content.substring(0, 50)}...`));

    // Build Gemini API request
    // Note: systemInstruction should be at the root level, not nested
    // Best practice: use LOWER temperature for grounded / data-backed queries to reduce hallucinations
    const effectiveTemperature =
      needsIvantiData ? Math.min(AI_CONFIG.temperature, 0.3) : AI_CONFIG.temperature;

    const requestBody: any = {
      contents: contents,
      generationConfig: {
        temperature: effectiveTemperature,
        maxOutputTokens: AI_CONFIG.maxOutputTokens,
        topP: 0.9,
        topK: needsIvantiData ? 20 : 40, // slightly narrower sampling when grounded
      }
    };

    // Add system instruction (some models support it at root level)
    if (systemInstruction) {
      requestBody.systemInstruction = {
        parts: [{ text: systemInstruction }]
      };
    }

    // Call Gemini API
    const apiUrl = `${AI_CONFIG.apiUrl}/models/${AI_CONFIG.model}:generateContent?key=${AI_CONFIG.apiKey}`;
    
    console.log('[AI Service] Calling Gemini API:', apiUrl.replace(AI_CONFIG.apiKey, '***'));
    console.log('[AI Service] Request body:', JSON.stringify(requestBody, null, 2).substring(0, 500));

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { error: { message: errorText || response.statusText } };
      }
      console.error('[AI Service] Gemini API error:', errorData);
      console.error('[AI Service] Status:', response.status);
      console.error('[AI Service] Full error:', errorText);
      
      const errorMessage = errorData.error?.message || errorData.message || response.statusText;
      throw new Error(`Gemini API error (${response.status}): ${errorMessage}`);
    }

    const data = await response.json();
    
    // Log full response for debugging
    console.log('[AI Service] Gemini API response:', JSON.stringify(data, null, 2).substring(0, 1000));
    
    // Extract response text from Gemini format
    let aiMessage = data.candidates?.[0]?.content?.parts?.[0]?.text || 
                    'Sorry, I could not generate a response.';

    // Check for blocked content or errors in response
    if (data.candidates?.[0]?.finishReason === 'SAFETY') {
      console.warn('[AI Service] Response blocked by safety filters');
      return {
        message: 'I apologize, but I cannot provide a response to that request due to safety guidelines. Please try rephrasing your question.',
        actions: []
      };
    }

    if (data.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
      console.warn('[AI Service] Response truncated due to token limit');
    }

    console.log('[AI Service] ✅ Generated response from Gemini');

    // ⚠️ HALLUCINATION DETECTION - Validate AI response against fetched data
    if (needsIvantiData && actualDataFetched) {
      const hallucinationWarnings = detectHallucinations(aiMessage, ivantiContext);
      if (hallucinationWarnings.length > 0) {
        console.error('[AI Service] 🚨 HALLUCINATION DETECTED:', hallucinationWarnings);
        // Log for debugging but don't block the response
        // In production, you might want to regenerate or modify the response
      }

      // RESPONSE-LAYER GUARD: if the model incorrectly claims there is no data
      // or no dates available for incidents while the context clearly has them,
      // fall back to a deterministic summary built directly from ivantiContext.
      const lowerAi = aiMessage.toLowerCase();
      const saysNoIncidents =
        /no data available for that specific date/.test(lowerAi) ||
        /i don't have any data for incidents/i.test(lowerAi) ||
        /i don't have information about incidents created/i.test(lowerAi) ||
        /doesn't include their creation dates/i.test(lowerAi) ||
        /do not include their creation dates/i.test(lowerAi) ||
        /no incidents recorded/i.test(lowerAi);

      if (saysNoIncidents && ivantiContext.includes('[INCIDENTS')) {
        const snippet = extractIncidentsSnippet(ivantiContext);
        if (snippet) {
          console.log('[AI Service] Overriding vague/no-data incident answer with deterministic incident list from context.');
          aiMessage =
            'Here are the incidents I can see from the current Ivanti data based on your question:\n\n' +
            snippet +
            '\n\nIf you need a different month or year, tell me the exact date or range.';
        }
      }
    }

    // Check if AI output contains CREATE_INCIDENT marker
    // Format: CREATE_INCIDENT: {"Subject": "...", "Symptom": "...", ...}
    const createIncidentMatch = aiMessage.match(/CREATE_INCIDENT:\s*(\{[\s\S]*?\})/);
    
    if (createIncidentMatch) {
      // Check role-based capabilities
      if (!currentUser.capabilities?.canCreateTickets) {
        console.warn('[AI Service] 🚨 SECURITY: User attempted to create ticket without permission - BLOCKED');
        return {
          message: 'You don\'t have permission to create tickets. Your role does not allow ticket creation. Please contact your administrator if you need this capability.',
          actions: []
        };
      }
      
      try {
        console.log('[AI Service] Found CREATE_INCIDENT marker, parsing...');
        const incidentDataJson = createIncidentMatch[1];
        const incidentData = JSON.parse(incidentDataJson);
        
        console.log('[AI Service] Parsed incident data:', incidentData);
        
        // Validate required fields
        if (!incidentData.Subject || !incidentData.Symptom) {
          console.error('[AI Service] Missing required fields (Subject or Symptom)');
          return {
            message: 'I need both a subject and description to create the incident. Please provide both and try again.',
            actions: []
          };
        }
        
        // Category is REQUIRED by Ivanti - ensure it's provided or use default
        if (!incidentData.Category || incidentData.Category.trim() === '') {
          console.warn('[AI Service] Category not provided, will attempt to use default');
          // The createIncident function will handle getting a default category
          incidentData.Category = ''; // Empty string triggers default lookup in createIncident
        }
        
        // Create the incident
        const createResult = await createIncident(incidentData, currentUser);
        
        if (createResult.success && createResult.incidentNumber) {
          console.log('[AI Service] ✅ Incident created successfully:', createResult.incidentNumber);
          
          // Get RecId from response or fetch it
          let incidentRecId: string | null = createResult.recId || null;
          if (!incidentRecId) {
            try {
              // Small delay to ensure incident is searchable
              await new Promise(resolve => setTimeout(resolve, 300));
              incidentRecId = await getIncidentRecId(String(createResult.incidentNumber));
            } catch (error) {
              console.warn('[AI Service] Could not fetch RecId immediately:', error);
            }
          }
          
          // Add created incident to conversation history as system message so AI remembers it
          // This ensures the AI can reference it in follow-up questions
          const incidentInfo = incidentRecId 
            ? `Incident ${createResult.incidentNumber} (RecId: ${incidentRecId})`
            : `Incident ${createResult.incidentNumber}`;
          
          conversationHistory.push({
            role: 'system',
            content: `[INCIDENT CREATED - Remember this]: ${incidentInfo} was just created with Subject: "${incidentData.Subject}" and Description: "${incidentData.Symptom}". This incident exists and can be updated or deleted. When user asks about this incident, you KNOW it exists.`
          });
          
          // Remove the CREATE_INCIDENT marker from the message and replace with success message
          const cleanMessage = aiMessage
            .replace(/CREATE_INCIDENT:\s*\{[\s\S]*?\}/, '')
            .trim();
          
          return {
            message: `${cleanMessage}\n\n✅ Incident ${createResult.incidentNumber} has been successfully created! You can now view it in Ivanti by searching for incident number ${createResult.incidentNumber}.`,
            actions: []
          };
        } else {
          console.error('[AI Service] Failed to create incident:', createResult.error);
          
          // Remove the CREATE_INCIDENT marker and add error message
          const cleanMessage = aiMessage
            .replace(/CREATE_INCIDENT:\s*\{[\s\S]*?\}/, '')
            .trim();
          
          return {
            message: `${cleanMessage}\n\n❌ I encountered an error creating the incident: ${createResult.error}. Please try again or create the incident manually in Ivanti.`,
            actions: []
          };
        }
        } catch (error) {
          console.error('[AI Service] Error parsing CREATE_INCIDENT JSON:', error);
          // If JSON parsing fails, just return the original message
        }
    }

    // Check if AI output contains UPDATE_INCIDENT marker
    // Format: UPDATE_INCIDENT: {"IncidentNumber": "10104", "Subject": "...", "Status": "...", ...}
    const updateIncidentMatch = aiMessage.match(/UPDATE_INCIDENT:\s*(\{[\s\S]*?\})/);
    
    if (updateIncidentMatch) {
      try {
        console.log('[AI Service] Found UPDATE_INCIDENT marker, parsing...');
        const updateDataJson = updateIncidentMatch[1];
        const updateData = JSON.parse(updateDataJson);
        
        console.log('[AI Service] Parsed update data:', updateData);
        
        // Extract incident number or RecId
        const incidentNumber = updateData.IncidentNumber;
        const incidentRecId = updateData.RecId;
        
        if (!incidentNumber && !incidentRecId) {
          console.error('[AI Service] Missing incident identifier');
          return {
            message: 'I need an incident number to update. Please specify which incident you want to update.',
            actions: []
          };
        }
        
        // Get RecId if we only have incident number
        let recId = incidentRecId;
        if (!recId && incidentNumber) {
          // First, check conversation history for recently created incidents
          const createdIncidentMatch = conversationHistory
            .filter(msg => msg.role === 'system')
            .find(msg => msg.content.includes(`Incident ${incidentNumber}`) && msg.content.includes('was just created'));
          
          if (createdIncidentMatch) {
            console.log('[AI Service] Found incident in conversation history:', incidentNumber);
            // Try to extract RecId from history message
            const recIdMatch = createdIncidentMatch.content.match(/RecId:\s*([A-F0-9]+)/i);
            if (recIdMatch) {
              recId = recIdMatch[1];
              console.log('[AI Service] Using RecId from conversation history:', recId);
            }
          }
          
          // If no RecId from history, try to get RecId from API
          if (!recId) {
            recId = await getIncidentRecId(String(incidentNumber));
          }
          
          if (!recId) {
            // Check if this incident was just created in this conversation
            const justCreated = conversationHistory.some(msg => 
              msg.content.includes(`Incident ${incidentNumber} has been successfully created`) ||
              msg.content.includes(`Incident ${incidentNumber} was just created`)
            );
            
            if (justCreated) {
              // Incident was just created - might need a moment to be searchable
              console.log('[AI Service] Incident was just created, retrying after delay...');
              await new Promise(resolve => setTimeout(resolve, 1000)); // Longer delay for new incidents
              recId = await getIncidentRecId(String(incidentNumber));
            }
            
            if (!recId) {
              return {
                message: `I couldn't find incident ${incidentNumber}. This might be because:\n- The incident number is incorrect\n- The incident was just created and needs a moment to be searchable\n- You don't have permission to view this incident\n\nPlease check the incident number and try again, or wait a moment if you just created it.`,
                actions: []
              };
            }
          }
        }
        
        // Check role-based capabilities for editing
        if (!currentUser.capabilities?.canEditAllTickets) {
          // Check if user owns this ticket (fallback check)
          // Note: This is a simplified check - in production, verify ownership via API
          console.warn('[AI Service] 🚨 SECURITY: User attempted to edit ticket without permission - BLOCKED');
          return {
            message: 'You don\'t have permission to edit tickets. Your role does not allow ticket editing. Please contact your administrator if you need this capability.',
            actions: []
          };
        }
        
        // Remove IncidentNumber and RecId from update data (not updatable fields)
        const { IncidentNumber: _, RecId: __, ...fieldsToUpdate } = updateData;
        
        // Update the incident
        const updateResult = await updateIncident(recId!, fieldsToUpdate, currentUser);
        
        if (updateResult.success) {
          console.log('[AI Service] ✅ Incident updated successfully:', updateResult.incidentNumber);
          
          // Remove the UPDATE_INCIDENT marker from the message
          const cleanMessage = aiMessage
            .replace(/UPDATE_INCIDENT:\s*\{[\s\S]*?\}/, '')
            .trim();
          
          return {
            message: `${cleanMessage}\n\n✅ Incident ${updateResult.incidentNumber || incidentNumber} has been successfully updated!`,
            actions: []
          };
        } else {
          console.error('[AI Service] Failed to update incident:', updateResult.error);
          const cleanMessage = aiMessage
            .replace(/UPDATE_INCIDENT:\s*\{[\s\S]*?\}/, '')
            .trim();
          
          return {
            message: `${cleanMessage}\n\n❌ I encountered an error updating the incident: ${updateResult.error}. Please try again.`,
            actions: []
          };
        }
      } catch (error) {
        console.error('[AI Service] Error parsing UPDATE_INCIDENT JSON:', error);
        // If JSON parsing fails, just return the original message
      }
    }

    // SECURITY: Block all deletion operations - ABSOLUTELY FORBIDDEN
    const deleteIncidentMatch = aiMessage.match(/DELETE_INCIDENT:\s*(\{[\s\S]*?\})/);
    
    if (deleteIncidentMatch) {
      console.warn('[AI Service] 🚨 SECURITY: AI attempted to delete an incident - BLOCKED');
      return {
        message: 'I cannot delete any incidents or records. This is a security restriction to prevent accidental data loss. If you need an incident removed, please contact your system administrator.',
        actions: []
      };
    }
    
    // Legacy deletion handler (should never be reached due to early block, but kept for safety)
    if (false && deleteIncidentMatch) {
      try {
        console.log('[AI Service] Found DELETE_INCIDENT marker, parsing...');
        const deleteDataJson = deleteIncidentMatch[1];
        const deleteData = JSON.parse(deleteDataJson);
        
        console.log('[AI Service] Parsed delete data:', deleteData);
        
        // Extract incident number or RecId
        const incidentNumber = deleteData.IncidentNumber;
        const incidentRecId = deleteData.RecId;
        
        if (!incidentNumber && !incidentRecId) {
          console.error('[AI Service] Missing incident identifier');
          return {
            message: 'I need an incident number to delete. Please specify which incident you want to delete.',
            actions: []
          };
        }
        
        // Get RecId if we only have incident number
        let recId = incidentRecId;
        if (!recId && incidentNumber) {
          recId = await getIncidentRecId(String(incidentNumber));
          if (!recId) {
            return {
              message: `I couldn't find incident ${incidentNumber}. Please check the incident number and try again.`,
              actions: []
            };
          }
        }
        
        // Delete the incident
        const deleteResult = await deleteIncident(recId!, currentUser);
        
        if (deleteResult.success) {
          console.log('[AI Service] ✅ Incident deleted successfully');
          
          // Remove the DELETE_INCIDENT marker from the message
          const cleanMessage = aiMessage
            .replace(/DELETE_INCIDENT:\s*\{[\s\S]*?\}/, '')
            .trim();
          
          return {
            message: `${cleanMessage}\n\n✅ Incident ${incidentNumber || 'has been'} successfully deleted!`,
            actions: []
          };
        } else {
          console.error('[AI Service] Failed to delete incident:', deleteResult.error);
          const cleanMessage = aiMessage
            .replace(/DELETE_INCIDENT:\s*\{[\s\S]*?\}/, '')
            .trim();
          
          return {
            message: `${cleanMessage}\n\n❌ I encountered an error deleting the incident: ${deleteResult.error}. Please try again.`,
            actions: []
          };
        }
      } catch (error) {
        console.error('[AI Service] Error parsing DELETE_INCIDENT JSON:', error);
        // If JSON parsing fails, just return the original message
      }
    }

    // TODO: Parse AI response for any action commands
    // For now, just return the (possibly post-processed) message
    return {
      message: aiMessage,
      actions: []
    };

  } catch (error) {
    console.error('[AI Service] Error processing message:', error);
    throw error;
  }
}

/**
 * Build the system prompt with current user context and role-based permissions
 * This is static and doesn't change per message - it's the base instructions
 */
async function buildSystemPrompt(currentUser: IvantiUser, ticketId: string | null, kbContext: string = ''): Promise<string> {
  // Get role-based capabilities
  const roles = currentUser.roles || [];
  const capabilities = currentUser.capabilities;
  
  // Compute current date/time once per prompt so the model always knows "today"
  const now = new Date();
  const currentDateHuman = now.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const currentDateIso = now.toISOString();
  
  // Format knowledge base context if provided
  let formattedKbContext = '';
  if (kbContext && !kbContext.includes('not available')) {
    formattedKbContext = `\n\nKNOWLEDGE BASE (Pre-loaded Ivanti Data):\n${kbContext}\n\nIMPORTANT: You have access to a comprehensive knowledge base of Ivanti data that was pre-loaded. Use this data to answer questions about employees, incidents, services, categories, teams, and departments. When users ask about any of these, check the knowledge base first. This is real data from Ivanti that is stored locally for fast access. If a user asks for "one with detail" or "give me one", provide the FULL details from the knowledge base.`;
  }
  
  // Build capabilities description dynamically
  let capabilitiesDescription = '✅ STANDARD USER - Limited access\n';
  if (capabilities) {
    const allowed: string[] = [];
    const restricted: string[] = [];
    
    if (capabilities.canViewAllTickets) allowed.push('View all tickets');
    else restricted.push('View only own tickets');
    
    if (capabilities.canEditAllTickets) allowed.push('Edit tickets');
    else restricted.push('Cannot edit tickets');
    
    if (capabilities.canCreateTickets) allowed.push('Create tickets');
    else restricted.push('Cannot create tickets');
    
    if (capabilities.canAssignTickets) allowed.push('Assign tickets');
    else restricted.push('Cannot assign tickets');
    
    if (capabilities.canCloseTickets) allowed.push('Close/resolve tickets');
    else restricted.push('Cannot close tickets');
    
    if (capabilities.canViewAllUsers) allowed.push('View all users');
    else restricted.push('View only own profile');
    
    if (capabilities.canViewReports) allowed.push('View reports');
    
    if (capabilities.canAccessAdminPanel) allowed.push('Access admin panel');
    
    if (capabilities.canManageCategories) allowed.push('Manage categories');
    if (capabilities.canManageServices) allowed.push('Manage services');
    if (capabilities.canManageTeams) allowed.push('Manage teams');
    if (capabilities.canManageDepartments) allowed.push('Manage departments');
    
    if (capabilities.canExportData) allowed.push('Export data');
    if (capabilities.canViewSensitiveData) allowed.push('View sensitive data');
    
    if (capabilities.canModifySystemSettings) allowed.push('Modify system settings');
    
    capabilitiesDescription = `✅ ROLE-BASED CAPABILITIES:\n`;
    if (allowed.length > 0) {
      capabilitiesDescription += `Allowed Actions:\n${allowed.map(a => `- ${a}`).join('\n')}\n`;
    }
    if (restricted.length > 0) {
      capabilitiesDescription += `Restrictions:\n${restricted.map(r => `- ${r}`).join('\n')}\n`;
    }
  } else {
    // Fallback to role-based detection if capabilities not available
    const isAdmin = roles.some(r => r?.toLowerCase().includes('admin'));
    const isManager = roles.some(r => r?.toLowerCase().includes('manager') || r?.toLowerCase().includes('supervisor'));
    const isAgent = roles.some(r => r?.toLowerCase().includes('agent') || r?.toLowerCase().includes('analyst'));
    
    if (isAdmin) {
      capabilitiesDescription = `✅ ADMINISTRATOR - Full system access
- Can view all tickets and users
- Can modify system settings
- Can assign tickets to anyone
- Can close/resolve any ticket
- Can access sensitive data`;
    } else if (isManager) {
      capabilitiesDescription = `✅ MANAGER/SUPERVISOR
- Can view team tickets
- Can assign tickets within team
- Can approve requests
- Cannot modify user passwords or system settings`;
    } else if (isAgent) {
      capabilitiesDescription = `✅ AGENT/ANALYST
- Can view and update assigned tickets
- Can create new tickets
- Can search for users and tickets
- Cannot modify other users' tickets without assignment
- Cannot access user passwords or security settings`;
    } else {
      capabilitiesDescription = `✅ STANDARD USER
- Can view own tickets
- Can create new tickets
- Can update own profile (except password)
- Cannot access other users' data
- Cannot modify system settings`;
    }
  }
  
  let prompt = `${AI_CONFIG.systemPrompt}${formattedKbContext}

CURRENT USER CONTEXT:
- User: ${currentUser.fullName} (${currentUser.loginId})
- User RecId: ${currentUser.recId}
- Roles: ${roles.join(', ') || 'Standard User'}
- Teams: ${currentUser.teams?.join(', ') || currentUser.team || 'Unknown'}
- Department: ${currentUser.department || 'Unknown'}
${ticketId ? `- Current Ticket: ${ticketId}` : '- No ticket context'}
- Current local date/time (from browser): ${currentDateHuman} (ISO: ${currentDateIso})

USER PERMISSIONS & CAPABILITIES:
${capabilitiesDescription}

CRITICAL SECURITY RESTRICTIONS - NEVER ALLOW THESE ACTIONS:
🚫 ABSOLUTELY FORBIDDEN - Password Operations:
   - NEVER change, reset, or modify ANY user's password (including your own)
   - NEVER reveal, show, or tell ANY user's password
   - NEVER generate or suggest passwords
   - NEVER provide password hints or recovery information
   - If asked about passwords, respond: "I cannot help with password changes or reveal passwords. Please contact your system administrator or use the official password reset process."
   - These restrictions apply to ALL users, including administrators

🚫 ABSOLUTELY FORBIDDEN - Deletion Operations:
   - NEVER delete ANY incidents, tickets, or records
   - NEVER delete user accounts
   - NEVER delete any data from the Ivanti system
   - If asked to delete something, respond: "I cannot delete any records or data. If you need something removed, please contact your system administrator."
   - These restrictions apply to ALL users, including administrators

🚫 RESTRICTED ACTIONS (require explicit permission):
   - User account deletion (Admin only, but AI should still refuse)
   - System configuration changes (Admin only)
   - Role/permission modifications (Admin only)
   - Accessing other users' tickets (unless assigned or Manager/Admin)

CONVERSATION MEMORY:
- You have access to the full conversation history
- When users ask follow-up questions (e.g., "that incident", "the one you just showed"), check previous messages
- Reference earlier information when answering follow-up questions
- Use phrases like "From the list I just showed you...", "As I mentioned earlier...", or "Regarding the [item] we discussed..."
- If data was fetched from Ivanti in a previous message, you can reference it without re-fetching

NON-TECHNICAL USERS AND VAGUE QUESTIONS:
- Assume the user is NOT technical and may ask vague or "dumb" questions.
- First, silently interpret what they probably mean using the interpretation notes and the examples in the data.
- Then respond in simple, clear language.
- When the question is ambiguous, make a reasonable, safe guess AND ask a short clarifying question instead of refusing.
- Never require the user to know field names, date formats, or technical terms. You must translate their natural language into the correct Ivanti fields yourself.
- When users ask about dates like \"today\", \"yesterday\", or \"last month\", use the current local date/time shown above to interpret what they mean, and if helpful, tell them explicitly what date you are using (for example: \"Today is Thursday, December 4, 2025\").

IMPORTANT RULES:
1. ALWAYS respect the user's role-based capabilities listed above
2. If a user requests an action they don't have permission for, check the capabilities list and politely explain: "You don't have permission to perform that action. Your role allows: [list allowed actions from capabilities]. Please contact your administrator if you need additional permissions."
3. When searching for other users' data, check if the current user has "canViewAllUsers" capability - if not, only show their own data
4. When editing tickets, check if the user has "canEditAllTickets" capability - if not, only allow editing their own tickets
5. When assigning tickets, check if the user has "canAssignTickets" capability - if not, refuse the action
6. When closing tickets, check if the user has "canCloseTickets" capability - if not, refuse the action
7. SECURITY FIRST: For password or deletion operations, ALWAYS refuse - these are ABSOLUTELY FORBIDDEN for ALL users, including administrators
8. NEVER execute password changes, password reveals, or deletions - these are hard-coded restrictions
9. Be helpful but security-conscious - when in doubt, refuse the action
10. When presenting Ivanti data, format it nicely for readability, and explain what it means in plain language first.
11. If a user asks to change a password, delete something, or reveal a password, immediately refuse and explain why
12. Role-based restrictions are enforced at the API level - if you attempt an action the user doesn't have permission for, it will fail
13. If the knowledge base or Ivanti data above clearly contains relevant incidents, tickets, or service requests for the requested date or person, you MUST use that data. Do not say "I don't have that information" when it is present above.

RESPONSE FORMAT:
- Provide clear, helpful responses in natural language using plain text paragraphs
- NEVER use markdown formatting (no *, **, #, -, bullet points, bold, etc.)
- Write conversationally like you're talking to a colleague
- Use line breaks for readability, but write in flowing paragraphs
- If an action is needed, explain what you would do and ask for confirmation
- For read-only queries (ticket status, information lookup), respond directly with the data in plain text
- For write operations (update, close, assign), explain the action first and verify permissions
- Present information naturally without formatting symbols
- If user lacks permissions, suggest who they should contact (their manager or admin)${kbContext}`;

  return prompt;
}

/**
 * Generate a summary of ticket information using Gemini
 */
export async function summarizeTicket(
  _ticketId: string,
  ticketData: any,
  currentUser: IvantiUser
): Promise<string> {
  try {
    const systemInstruction = `You are an AI assistant helping ${currentUser.fullName} understand their Ivanti ticket.
Provide a clear, concise summary of the ticket information in a friendly tone.`;

    const requestBody: any = {
      contents: [{
        role: 'user',
        parts: [{ text: `Please summarize this ticket:\n\n${JSON.stringify(ticketData, null, 2)}` }]
      }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 500
      }
    };

    // Add system instruction if supported
    if (systemInstruction) {
      requestBody.systemInstruction = {
        parts: [{ text: systemInstruction }]
      };
    }

    const apiUrl = `${AI_CONFIG.apiUrl}/models/${AI_CONFIG.model}:generateContent?key=${AI_CONFIG.apiKey}`;

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (response.ok) {
      const data = await response.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || 'Could not generate summary.';
    }

    return 'Could not generate ticket summary.';

  } catch (error) {
    console.error('[AI Service] Error summarizing ticket:', error);
    return 'Error generating summary.';
  }
}
