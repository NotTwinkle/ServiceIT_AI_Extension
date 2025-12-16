/**
 * Service Request Agent
 * 
 * Implements the full agentic pattern for Service Request creation:
 * - Thinks through the problem
 * - Calls tools to gather data
 * - Auto-fills what it can
 * - Asks for only what's missing
 * - Validates everything before submission
 * 
 * This is the reference implementation for all other agents.
 */

import { 
  createAgentContext, 
  createStepManager, 
  AgentResult
  // AgentResponseValidator - Will use later for validation
} from './agentCore';
import { 
  fetchRequestOfferings, 
  fetchRequestOfferingFieldset,
  normalizeRequestOfferingFieldset,
  NormalizedRequestOfferingFieldset,
  NormalizedOfferingField
} from './ivantiDataService';
import { IvantiUser } from './userIdentity';
import { getRelevantDocumentation, formatDocumentationForContext } from './ivantiDocumentation';

interface Message {
  role: string;
  content: string;
  timestamp?: number;
}

interface IvantiAction {
  method: string;
  endpoint: string;
  description: string;
  requiresConfirmation: boolean;
  body: any;
}

// ══════════════════════════════════════════════════════════════════════════════
// SERVICE REQUEST CREATION AGENT
// ══════════════════════════════════════════════════════════════════════════════

export async function runCreateServiceRequestAgent(
  confirmedOfferingName: string,
  conversationHistory: Message[],
  currentUser: IvantiUser,
  isDelegatingToAI: boolean,
  _normalizedMessage: string // Prefixed with _ to indicate intentionally unused
): Promise<AgentResult> {
  
  console.log('[SR Agent] 🤖 Starting Service Request creation agent');
  console.log('[SR Agent] Offering:', confirmedOfferingName);
  console.log('[SR Agent] Delegation mode:', isDelegatingToAI);

  // ══════════════════════════════════════════════════════════════════════════════
  // STEP 1: Initialize agent steps (for UI progress indicator)
  // ══════════════════════════════════════════════════════════════════════════════
  
  const stepManager = createStepManager([
    { id: 'find_offering', label: 'Finding Request Offering in Ivanti' },
    { id: 'fetch_fieldset', label: 'Loading form fields and requirements' },
    { id: 'analyze_fields', label: 'Analyzing required vs optional fields' },
    { id: 'search_documentation', label: 'Searching Ivanti documentation for best practices' },
    { id: 'autofill', label: 'Auto-filling details from your profile' },
    { id: 'check_readiness', label: 'Checking if form is complete' },
    { id: 'prepare_draft', label: 'Preparing confirmation form' }
  ]);

  const contextBuilder = createAgentContext();

  // ══════════════════════════════════════════════════════════════════════════════
  // STEP 2: Find the offering (TOOL CALL)
  // ══════════════════════════════════════════════════════════════════════════════
  
  stepManager.startStep('find_offering');
  
  let offerings: any[];
  try {
    offerings = await fetchRequestOfferings();
    contextBuilder.addFact('totalOfferings', offerings.length);
  } catch (error: any) {
    stepManager.errorStep('find_offering', error.message);
    contextBuilder.addError(`Failed to fetch request offerings: ${error.message}`);
    
    return {
      message: "I encountered an error loading the Request Offerings from Ivanti. Please try again in a moment.",
      actions: [],
      thinkingSteps: stepManager.getSteps()
    };
  }

  const matchedOffering = offerings.find((o: any) => {
    const name = o.strName || o.Name || '';
    return name.toLowerCase() === confirmedOfferingName.toLowerCase();
  });

  if (!matchedOffering) {
    stepManager.errorStep('find_offering', 'Offering not found');
    contextBuilder.addError(`Could not find offering: ${confirmedOfferingName}`);
    
    return {
      message: `I couldn't find the Request Offering "${confirmedOfferingName}" in Ivanti. It may have been removed or renamed. Please check the catalog again.`,
      actions: [],
      thinkingSteps: stepManager.getSteps()
    };
  }

  const subscriptionId = matchedOffering.strSubscriptionId || matchedOffering.SubscriptionId || '';
  stepManager.completeStep('find_offering', `Found: ${confirmedOfferingName}`);
  contextBuilder.addFact('offeringName', confirmedOfferingName);
  contextBuilder.addFact('subscriptionId', subscriptionId);

  // ══════════════════════════════════════════════════════════════════════════════
  // STEP 3: Fetch fieldset (TOOL CALL)
  // ══════════════════════════════════════════════════════════════════════════════
  
  stepManager.startStep('fetch_fieldset');
  
  let normalizedFieldset: NormalizedRequestOfferingFieldset;
  try {
    // ✅ Pass offering object to fetch correct template structure
    const rawFieldset = await fetchRequestOfferingFieldset(subscriptionId, matchedOffering);
    if (!rawFieldset) {
      throw new Error('Fieldset returned null');
    }
    
    normalizedFieldset = normalizeRequestOfferingFieldset(rawFieldset, matchedOffering);
    stepManager.completeStep('fetch_fieldset', `${normalizedFieldset.fields.length} fields loaded`);
    contextBuilder.addFact('totalFields', normalizedFieldset.fields.length);
  } catch (error: any) {
    stepManager.errorStep('fetch_fieldset', error.message);
    contextBuilder.addError(`Failed to load form fields: ${error.message}`);
    
    return {
      message: `I found the "${confirmedOfferingName}" offering, but couldn't load its form fields from Ivanti. Please try again.`,
      actions: [],
      thinkingSteps: stepManager.getSteps()
    };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // STEP 4: Analyze fields (REASONING)
  // ══════════════════════════════════════════════════════════════════════════════
  
  stepManager.startStep('analyze_fields');
  
  const requiredFields = normalizedFieldset.fields.filter(f => f.required);
  const optionalFields = normalizedFieldset.fields.filter(f => !f.required);
  const dropdownFields = normalizedFieldset.fields.filter(f => 
    f.type === 'combo' || f.type === 'dropdown' || f.type === 'picklist'
  );

  contextBuilder.addFact('requiredFieldsCount', requiredFields.length);
  contextBuilder.addFact('optionalFieldsCount', optionalFields.length);
  contextBuilder.addFact('dropdownFieldsCount', dropdownFields.length);
  
  // Build field summaries for context
  const fieldSummaries = normalizedFieldset.fields.map(f => {
    const summary: any = {
      name: f.name,
      label: f.label,
      type: f.type,
      required: f.required
    };
    
    if ((f.type === 'combo' || f.type === 'dropdown') && f.options && f.options.length > 0) {
      summary.options = f.options.slice(0, 10).map(opt => opt.label);
      if (f.options.length > 10) {
        summary.optionsNote = `+${f.options.length - 10} more options`;
      }
    }
    
    return summary;
  });

  contextBuilder.addFact('fields', fieldSummaries);
  stepManager.completeStep('analyze_fields', `${requiredFields.length} required, ${optionalFields.length} optional`);

  // ══════════════════════════════════════════════════════════════════════════════
  // STEP 4.5: Search documentation if needed (TOOL CALL)
  // ══════════════════════════════════════════════════════════════════════════════
  
  // If we have complex fields (many dropdowns, unusual types), search docs for best practices
  if (dropdownFields.length > 3 || normalizedFieldset.fields.length > 10) {
    stepManager.startStep('search_documentation');
    
    try {
      // Search for documentation on handling complex request offerings
      const query = `request offering fieldset structure validation lists dropdown fields ${confirmedOfferingName} service-requests`;
      const allDocs = await getRelevantDocumentation(query);
      // Filter to service-requests category
      const docs = allDocs.filter(doc => doc.category === 'service-requests' || doc.category === 'api');
      
      if (docs.length > 0) {
        const formattedDocs = formatDocumentationForContext(docs);
        contextBuilder.addFact('documentation', formattedDocs);
        stepManager.completeStep('search_documentation', `Found ${docs.length} relevant documentation sections`);
        console.log('[SR Agent] 📚 Searched documentation for complex offering structure');
      } else {
        stepManager.skipStep('search_documentation', 'No additional documentation needed');
      }
    } catch (error: any) {
      stepManager.skipStep('search_documentation', 'Documentation search failed (non-critical)');
      console.warn('[SR Agent] ⚠️ Documentation search failed:', error);
    }
  } else {
    // Skip documentation search for simple offerings
    stepManager.skipStep('search_documentation', 'Simple offering, documentation not needed');
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // STEP 5: Auto-fill (TOOL CALLS + REASONING)
  // ══════════════════════════════════════════════════════════════════════════════
  
  stepManager.startStep('autofill');
  
  // Extract context from conversation for smart auto-fill
  const recentUserMessages = conversationHistory
    .filter(m => m.role === 'user')
    .slice(-5)
    .map(m => m.content)
    .join(' ')
    .toLowerCase();
  
  const userNeedKeywords = recentUserMessages.match(/\b(monitor|laptop|computer|keyboard|mouse|printer|phone|mobile|desk|chair|software|access|account|password|hardware|unlock|reset)\b/gi) || [];
  const userNeedDescription = userNeedKeywords.length > 0 ? userNeedKeywords.join(', ') : 'User requested item';

  let autoFilledCount = 0;
  
  // Auto-fill each field based on heuristics
  normalizedFieldset.fields.forEach(f => {
    if (f.defaultValue) return; // Already has a value from Ivanti
    
    const lname = f.name.toLowerCase();
    const flabel = (f.label || '').toLowerCase();
    
    // User profile fields
    if (lname.includes('email') || flabel.includes('email')) {
      f.defaultValue = currentUser.email || '';
      autoFilledCount++;
    } else if (lname.includes('login') || flabel.includes('login') || lname.includes('loginid')) {
      f.defaultValue = currentUser.loginId || currentUser.email || '';
      autoFilledCount++;
    } else if ((lname.includes('name') && !lname.includes('manager')) || lname.includes('requestor') || lname.includes('requester') || lname.includes('requested by') || flabel.includes('requestor') || flabel.includes('requested by')) {
      f.defaultValue = currentUser.fullName || currentUser.loginId;
      autoFilledCount++;
    } else if (lname.includes('department') || flabel.includes('department')) {
      f.defaultValue = currentUser.department || '';
      autoFilledCount++;
    } else if (lname.includes('location') || lname.includes('site') || flabel.includes('location') || flabel.includes('site')) {
      f.defaultValue = currentUser.location || currentUser.site || '';
      autoFilledCount++;
    }
    // Context-based fields
    else if (lname.includes('subject') || lname.includes('summary') || flabel.includes('subject') || flabel.includes('summary') || lname.includes('title')) {
      if (userNeedKeywords.length > 0 && userNeedKeywords[0]) {
        const keyword = userNeedKeywords[0];
        f.defaultValue = `Request for ${keyword.charAt(0).toUpperCase() + keyword.slice(1)}`;
      } else {
        f.defaultValue = `${confirmedOfferingName} Request`;
      }
      autoFilledCount++;
    } else if (lname.includes('description') || lname.includes('symptom') || lname.includes('detail') || lname.includes('reason') || flabel.includes('description') || flabel.includes('reason')) {
      if (userNeedKeywords.length > 0) {
        f.defaultValue = `Request for ${userNeedDescription} for ${currentUser.fullName || 'user'}'s workspace`;
      } else {
        f.defaultValue = `Service request submitted via AI assistant`;
      }
      autoFilledCount++;
    } else if (lname.includes('category') || flabel.includes('category')) {
      if (userNeedKeywords.some(k => ['monitor', 'laptop', 'computer', 'keyboard', 'mouse', 'printer', 'hardware'].includes(k.toLowerCase()))) {
        f.defaultValue = 'Service IT';
        autoFilledCount++;
      }
    } else if (lname.includes('urgency') || lname.includes('priority') || flabel.includes('urgency') || flabel.includes('priority')) {
      f.defaultValue = isDelegatingToAI ? 'Medium' : '';
      if (isDelegatingToAI) autoFilledCount++;
    }
  });

  stepManager.completeStep('autofill', `${autoFilledCount} fields auto-filled`);
  contextBuilder.addFact('autoFilledCount', autoFilledCount);

  // ══════════════════════════════════════════════════════════════════════════════
  // STEP 6: Check readiness (REASONING)
  // ══════════════════════════════════════════════════════════════════════════════
  
  stepManager.startStep('check_readiness');
  
  const filledRequiredFields = requiredFields.filter(f => 
    f.defaultValue !== undefined && 
    f.defaultValue !== null && 
    f.defaultValue !== '' &&
    String(f.defaultValue).trim() !== ''
  );
  
  const missingRequiredFields = requiredFields.filter(f => 
    !f.defaultValue || String(f.defaultValue).trim() === ''
  );

  const allRequiredFieldsFilled = requiredFields.length === 0 || missingRequiredFields.length === 0;
  const readyForConfirmation = allRequiredFieldsFilled || isDelegatingToAI;

  contextBuilder.addFact('requiredFieldsFilled', filledRequiredFields.length);
  contextBuilder.addFact('requiredFieldsTotal', requiredFields.length);
  contextBuilder.addFact('readyForConfirmation', readyForConfirmation);

  if (missingRequiredFields.length > 0 && !isDelegatingToAI) {
    missingRequiredFields.forEach(f => {
      let fieldInfo = `${f.label || f.name}`;
      
      // Add dropdown options if available
      if ((f.type === 'combo' || f.type === 'dropdown') && f.options && f.options.length > 0) {
        const optionLabels = f.options.slice(0, 5).map(opt => opt.label);
        if (f.options.length <= 5) {
          fieldInfo += ` (options: ${optionLabels.join(', ')})`;
        } else {
          fieldInfo += ` (options: ${optionLabels.join(', ')}, +${f.options.length - 5} more)`;
        }
      }
      
      contextBuilder.addMissingInfo(fieldInfo);
    });
  }

  stepManager.completeStep('check_readiness', 
    readyForConfirmation 
      ? 'All required fields filled' 
      : `${missingRequiredFields.length} required fields missing`
  );

  // ══════════════════════════════════════════════════════════════════════════════
  // STEP 7: Prepare draft action (ACTION)
  // ══════════════════════════════════════════════════════════════════════════════
  
  stepManager.startStep('prepare_draft');

  const ivantiActions: IvantiAction[] = [{
    method: 'POST',
    endpoint: 'ivanti://serviceRequest/draft',
    description: `Draft service request for ${confirmedOfferingName}`,
    requiresConfirmation: true,
    body: {
      subscriptionId,
      offeringName: confirmedOfferingName,
      fieldset: normalizedFieldset,
      normalizedFieldset: normalizedFieldset,
      readyForConfirmation: readyForConfirmation,
      missingRequiredFields: readyForConfirmation ? [] : missingRequiredFields.map(f => ({ 
        name: f.name, 
        label: f.label || f.name 
      }))
    }
  }];

  contextBuilder.addFact('draftCreated', true);
  stepManager.completeStep('prepare_draft', 'Draft action created');

  // ══════════════════════════════════════════════════════════════════════════════
  // STEP 8: Build grounded context for Gemini (REASONING)
  // ══════════════════════════════════════════════════════════════════════════════
  
  const context = contextBuilder.buildContext();
  
  // Build a detailed field guide for the AI
  const fieldGuide: string[] = [];
  
  if (readyForConfirmation) {
    fieldGuide.push('✅ FORM IS READY FOR CONFIRMATION');
    fieldGuide.push('\nAuto-filled fields:');
    normalizedFieldset.fields
      .filter(f => f.defaultValue && String(f.defaultValue).trim() !== '')
      .forEach(f => {
        fieldGuide.push(`  • ${f.label}: ${f.defaultValue}`);
      });
  } else {
    fieldGuide.push('⚠️ FORM NOT READY - Missing required fields:');
    missingRequiredFields.forEach(f => {
      let line = `  • ${f.label} (${f.type})`;
      if ((f.type === 'combo' || f.type === 'dropdown') && f.options && f.options.length > 0) {
        const opts = f.options.slice(0, 5).map(o => o.label);
        line += ` - Options: ${opts.join(', ')}${f.options.length > 5 ? ` (+${f.options.length - 5} more)` : ''}`;
      }
      fieldGuide.push(line);
    });
    
    if (filledRequiredFields.length > 0) {
      fieldGuide.push('\nAlready filled:');
      filledRequiredFields.forEach(f => {
        fieldGuide.push(`  • ${f.label}: ${f.defaultValue}`);
      });
    }
  }

  // Add documentation if it was searched
  let documentationContext = '';
  if (context.facts.documentation) {
    documentationContext = `\n[IVANTI DOCUMENTATION - Reference for Best Practices]\n${context.facts.documentation}\n`;
  }

  // Build the system message with grounded context
  const groundedContext = `${contextBuilder.buildSystemMessage()}${documentationContext}

[FIELD GUIDE]
${fieldGuide.join('\n')}

[AI INSTRUCTIONS]
${readyForConfirmation ? `
✅ ALL REQUIRED FIELDS ARE FILLED. Tell the user:
1. You've prepared the Service Request form for "${confirmedOfferingName}"
2. Show them what you auto-filled (be specific: "I filled in your name, location, and a summary")
3. Mention they can review/edit any field in the form below
4. Tell them to click "Confirm & Submit" when ready

Be warm, clear, and guide them to the next action.
` : `
⚠️ MISSING REQUIRED FIELDS - FORM CANNOT PROCEED YET.

CRITICAL: The user CANNOT submit this form because ${missingRequiredFields.length} required field${missingRequiredFields.length > 1 ? 's are' : ' is'} missing.

You are an ASSISTANT - your job is to GUIDE the user on what to input in each field!

You MUST clearly explain:
1. **WHY the form isn't ready**: "I need a few more details before I can prepare the submission form"
2. **WHAT is missing**: List each missing field with its label
3. **WHAT to input**: For EACH field, tell the user EXACTLY what to provide:
   - For dropdowns: Show the available options clearly
   - For text fields: Give examples of what to enter
   - For email fields: Tell them to enter their email
   - For name fields: Tell them whose name to enter
4. **HOW to provide it**: Give a clear example format showing how to answer all fields at once

IMPORTANT:
- The form WILL appear below, but the submit button will be disabled until fields are filled
- BE SPECIFIC - don't just say "enter Requested For", say "Requested For - choose from: John Doe, Jane Smith, etc."
- For dropdown fields, ALWAYS show the main options (from FIELD GUIDE above)
- For text fields, give examples: "Location - enter: Manila Office, Cebu Office, or Remote"
- Ask for ALL missing fields in ONE message so the user can answer everything at once

Example EXCELLENT response:
"I've started preparing the ${confirmedOfferingName} form! I can see the form below, but I need a few more details to enable the submit button:

**Please provide the following:**

${missingRequiredFields.map((f, i) => {
  let guidance = `${i + 1}. **${f.label}**`;
  
  if ((f.type === 'combo' || f.type === 'dropdown') && f.options && f.options.length > 0) {
    const opts = f.options.slice(0, 8).map(o => o.label);
    if (f.options.length <= 8) {
      guidance += `\n   → Select from: ${opts.join(', ')}`;
    } else {
      guidance += `\n   → Select from: ${opts.join(', ')}, or ${f.options.length - 8} more options (see dropdown in form)`;
    }
  } else if (f.type === 'text' || f.type === 'textarea') {
    const labelLower = f.label.toLowerCase();
    if (labelLower.includes('email')) {
      guidance += `\n   → Enter an email address (e.g., "john.doe@company.com")`;
    } else if (labelLower.includes('name') && !labelLower.includes('manager')) {
      guidance += `\n   → Enter the person's full name (e.g., "John Doe")`;
    } else if (labelLower.includes('manager')) {
      guidance += `\n   → Enter the manager's name (e.g., "Jane Smith")`;
    } else if (labelLower.includes('location')) {
      guidance += `\n   → Enter the location (e.g., "Manila Office", "Cebu Office", "Remote")`;
    } else if (labelLower.includes('login') || labelLower.includes('loginid')) {
      guidance += `\n   → Enter the login ID or username`;
    } else {
      guidance += `\n   → Enter the ${f.label.toLowerCase()}`;
    }
  } else if (f.type === 'date') {
    guidance += `\n   → Enter a date (e.g., "2025-12-15" or "December 15, 2025")`;
  } else {
    guidance += `\n   → Please provide: ${f.label.toLowerCase()}`;
  }
  
  return guidance;
}).join('\n\n')}

**You can provide all of these in one message**, for example:
"Requested For: John Doe, Manager: Jane Smith, Location: Manila Office, Financial Owner: Default"

Once you provide these, I'll update the form and enable the submit button!"

${filledRequiredFields.length > 0 ? `\n\n**Already filled for you:** ${filledRequiredFields.map(f => `${f.label}: ${f.defaultValue}`).join(', ')}` : ''}
`}

[ADAPTING TO DIFFERENT OFFERINGS]
This offering ("${confirmedOfferingName}") has ${normalizedFieldset.fields.length} fields with ${requiredFields.length} required.
${documentationContext ? 'Documentation has been searched to understand best practices for this type of offering.' : ''}
${dropdownFields.length > 0 ? `This offering has ${dropdownFields.length} dropdown/combo fields - make sure to show users the available options.` : ''}

CRITICAL ANTI-HALLUCINATION RULES:
- NEVER invent emails, RecIds, or numbers not in [GROUNDED FACTS]
- NEVER say you "submitted" or "created" the SR - only "prepared the form"
- ONLY mention fields listed in [FIELD GUIDE] above
- For dropdown fields, ONLY mention options listed in the facts
- If you're unsure about field behavior, reference the documentation above

CRITICAL FIELD DISPLAY RULES - KEEP IT SIMPLE:
- ONLY show REQUIRED fields that need user input
- ONLY show visible READ-ONLY fields (pre-filled, like Login Id, Financial Owner) - these are already filled but visible
- DO NOT mention optional fields - they clutter the form and confuse users
- DO NOT mention hidden fields - they're not visible to users
- DO NOT mention conditional fields (like address fields that only show when "Deliver to Office" is No)
- DO NOT mention fields that are filled later by the system (like Asset Tag, Serial Number in "Asset Fulfillment Activity")
- Keep the form SIMPLE - only what's absolutely needed to submit

The form should show ONLY:
1. Required fields that need user input
2. Visible read-only fields (pre-filled, but shown for context like Login Id, Financial Owner)

Everything else should be hidden to avoid overwhelming the user.`;

  // ══════════════════════════════════════════════════════════════════════════════
  // RETURN: Send grounded context + steps back to main agent controller
  // ══════════════════════════════════════════════════════════════════════════════

  return {
    message: '', // Will be filled by Gemini in main controller
    actions: ivantiActions,
    thinkingSteps: stepManager.getSteps(),
    context: {
      ...context,
      steps: stepManager.getSteps(),
      groundedSystemMessage: groundedContext
    } as any
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// HELPER: Extract user-provided values from a natural language response
// ══════════════════════════════════════════════════════════════════════════════

export function parseUserFieldValues(
  userMessage: string, 
  missingFields: NormalizedOfferingField[]
): Record<string, string> {
  const parsed: Record<string, string> = {};
  
  // This is a simple pattern matcher - in production you'd use Gemini to parse
  // For now, just extract obvious patterns
  
  const messageLower = userMessage.toLowerCase();
  
  missingFields.forEach(field => {
    const labelLower = field.label.toLowerCase();
    
    // Pattern: "for John Doe" → Requested For
    if (labelLower.includes('requested for') || labelLower.includes('for who')) {
      const match = userMessage.match(/for\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i);
      if (match) {
        parsed[field.name] = match[1];
      }
    }
    
    // Pattern: "laptop" / "desktop" → Computer Type
    if (labelLower.includes('type') || labelLower.includes('computer')) {
      const types = ['laptop', 'desktop', 'tablet', 'thin client', 'server'];
      const found = types.find(t => messageLower.includes(t));
      if (found) {
        parsed[field.name] = found.charAt(0).toUpperCase() + found.slice(1);
      }
    }
    
    // Pattern: "Manila office" / "Cebu" → Location
    if (labelLower.includes('location') || labelLower.includes('office') || labelLower.includes('site')) {
      const locations = ['manila', 'cebu', 'remote', 'davao', 'iloilo'];
      const found = locations.find(loc => messageLower.includes(loc));
      if (found) {
        parsed[field.name] = found.charAt(0).toUpperCase() + found.slice(1) + (messageLower.includes('office') ? ' Office' : '');
      }
    }
  });
  
  return parsed;
}
