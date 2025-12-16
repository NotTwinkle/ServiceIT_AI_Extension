/**
 * Service IT Plus Assistant - Background Service Worker
 * 
 * Handles:
 * - User identity detection (via Ivanti API)
 * - AI message processing (via OpenAI)
 * - Ivanti REST API operations
 * - Message routing between content scripts and services
 */

import { validateConfig } from './config';
import { getCurrentUser, IvantiUser } from './services/userIdentity';
import { processMessage, ChatMessage } from './services/aiService';
import { prefetchCommonData } from './services/dataPrefetchService';
import { fetchRequestOfferings, fetchRequestOfferingFieldset, normalizeRequestOfferingFieldset, createServiceRequest } from './services/ivantiDataService';

// Store conversation history per tab (in memory)
const conversationHistory = new Map<number, ChatMessage[]>();

// GLOBAL user session - shared across ALL tabs for the same domain
// Using chrome.storage.local for persistence across browser restarts (more reliable)
// chrome.storage.session only persists during browser session, not across restarts
let globalUserSession: IvantiUser | null = null;

// GLOBAL session identifier to distinguish login sessions (used by content script for history isolation)
let globalSessionId: string | null = null;

// Track if a logout is already in progress to avoid double cleanup
let logoutInProgress = false;

// Auth probe interval ID (for 401 detection)
let authProbeInterval: number | null = null;

console.log('[Background] Service IT Plus Assistant - Background script loaded');
console.log('[Background] 🔍 Monitoring cookies for logout detection...');
console.log('[Background] 📝 To view service worker logs: chrome://extensions -> Service IT Plus Assistant -> "service worker" link');

// Load global user session on startup (from persistent storage)
// This ensures user session survives browser restarts
chrome.storage.local.get(['currentUser'], (result) => {
  if (result.currentUser) {
    globalUserSession = result.currentUser;
    console.log('[Background] ✅ Restored user session from persistent storage:', globalUserSession?.fullName);
    // Start periodic logout check if we have a restored session
    startPeriodicLogoutCheck();
    startAuthProbe();
  } else {
    // Fallback to session storage for backward compatibility
    chrome.storage.session.get(['currentUser'], (sessionResult) => {
      if (sessionResult.currentUser) {
        globalUserSession = sessionResult.currentUser;
        // Migrate to local storage for persistence
        chrome.storage.local.set({ currentUser: globalUserSession });
        console.log('[Background] ✅ Migrated user session to persistent storage:', globalUserSession?.fullName);
        // Start periodic logout check if we have a restored session
        startPeriodicLogoutCheck();
        startAuthProbe();
      }
    });
  }
});

/**
 * Check if user is logged out by verifying UserSettings cookie exists
 * BEST PRACTICE: Use this as a backup validation, not primary detection
 * Primary detection should be cookie.onChanged listener (event-driven)
 * This function validates logout state when needed (e.g., before API calls)
 */
async function checkUserLoggedOut(): Promise<boolean> {
  try {
    // Try multiple domain formats (cookies can be stored with different domain formats)
    const domains = [
      'serviceitplus.com',
      '.serviceitplus.com', 
      'success.serviceitplus.com',
      '.success.serviceitplus.com'
    ];
    
    for (const domain of domains) {
      try {
        const cookies = await chrome.cookies.getAll({ domain });
        const userSettingsCookie = cookies.find(c => c.name === 'UserSettings');
        
        if (userSettingsCookie) {
          // Found the cookie - user is logged in
          return false;
        }
      } catch (domainError) {
        // Some domains might not be accessible, continue to next
        continue;
      }
    }
    
    // If no cookie found, also verify we don't have an active session
    // This prevents false positives during initial load or prefetch
    if (globalUserSession) {
      // We have an active session in memory - verify it's still valid
      // by checking if we can still access user data from storage
      const result = await chrome.storage.local.get(['currentUser']);
      if (result.currentUser) {
        // Session exists in storage - assume still logged in
        // Cookie might be temporarily unavailable but session is valid
        return false;
      }
    }
    
    // No cookie AND no active session = logged out
    return true;
  } catch (error) {
    console.error('[Background] Error checking logout status:', error);
    // On error, assume still logged in (fail-safe)
    return false;
  }
}

/**
 * Generate a unique session identifier for login sessions
 * Used by content scripts to isolate chat history between logins
 */
function createSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Handle logout cleanup
 */
async function handleLogout() {
  if (logoutInProgress) {
    console.log('[Background] 🚪 Logout already in progress, skipping duplicate call');
    return;
  }
  logoutInProgress = true;
  console.log('[Background] 🚪 ========================================');
  console.log('[Background] 🚪 LOGOUT DETECTED - Starting cleanup');
  console.log('[Background] 🚪 ========================================');
  
  // Stop periodic logout check
  stopPeriodicLogoutCheck();
  stopAuthProbe();
  
  // Clear global session variable
  globalUserSession = null;
  globalSessionId = null;

  // Clear session from storage (local and session)
  await new Promise<void>((resolve) => {
    chrome.storage.session.remove('currentUser', () => {
      console.log('[Background] ✅ Cleared user session from session storage');
      resolve();
    });
  });

  // Remove currentUser, lastSessionId, and conversation histories atomically
  const allData = await new Promise<Record<string, any>>((resolve) => {
    chrome.storage.local.get(null, resolve);
  });
  const keysToRemove: string[] = [];
  Object.keys(allData).forEach((key) => {
    if (key.startsWith('conversationHistory_')) keysToRemove.push(key);
    if (key === 'currentUser' || key === 'lastSessionId') keysToRemove.push(key);
  });

  if (keysToRemove.length > 0) {
    await new Promise<void>((resolve) => {
      chrome.storage.local.remove(keysToRemove, () => {
        console.log('[Background] ✅ Cleared stored user data and histories:', keysToRemove);
        resolve();
      });
    });
  } else {
    console.log('[Background] ✅ No stored user data/histories to clear');
  }
  
  // Clear all conversation histories from memory
  conversationHistory.clear();
  console.log('[Background] ✅ Cleared all conversations from memory');
  
  // Clear ALL stored conversation histories from chrome.storage.local
  chrome.storage.local.get(null, (allData) => {
    const keysToRemove: string[] = [];
    
    Object.keys(allData).forEach(key => {
      // Remove conversation history keys
      if (key.startsWith('conversationHistory_')) {
        keysToRemove.push(key);
      }
      // Remove any other user-specific keys if they exist
      if (key === 'currentUser') {
        keysToRemove.push(key);
      }
    });
    
    if (keysToRemove.length > 0) {
      console.log(`[Background] 🧹 Clearing ${keysToRemove.length} storage keys:`, keysToRemove);
      chrome.storage.local.remove(keysToRemove, () => {
        console.log('[Background] ✅ Cleared all stored user data and histories');
        
        // Verify they're gone
        chrome.storage.local.get(keysToRemove, (verifyData) => {
          const remaining = Object.keys(verifyData);
          if (remaining.length > 0) {
            console.error(`[Background] ❌ ERROR: ${remaining.length} keys still exist:`, remaining);
          } else {
            console.log('[Background] ✅ Verified: All user data cleared');
          }
        });
      });
    } else {
      console.log('[Background] ✅ No stored user data/histories to clear');
    }
  });
  
  // Clear all cached Ivanti data on logout (security best practice)
  import('./services/cacheService').then(({ clearAllCache }) => {
    clearAllCache();
    console.log('[Background] ✅ Cleared all cached data');
  });
  
  // Notify all Ivanti tabs that user logged out
  chrome.tabs.query({ url: 'https://success.serviceitplus.com/*' }, (tabs) => {
    console.log(`[Background] 📤 Sending USER_LOGGED_OUT to ${tabs.length} tabs`);
    tabs.forEach(tab => {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, { 
          type: 'USER_LOGGED_OUT' 
        }).then(() => {
          console.log(`[Background] ✅ Sent USER_LOGGED_OUT to tab ${tab.id}`);
        }).catch((error) => {
          // This is expected if the content script isn't running on the tab (e.g. login page)
          console.log(`[Background] Note: Could not send logout to tab ${tab.id} (content script may not be active):`, error.message);
        });
      }
    });
  });
  
  console.log('[Background] 🚪 ========================================');
  console.log('[Background] 🚪 LOGOUT CLEANUP COMPLETE');
  console.log('[Background] 🚪 ========================================');
  logoutInProgress = false;
}

/**
 * Monitor UserSettings cookie to detect logout AND re-login
 * When user logs out, Ivanti removes this cookie
 * When user logs in, Ivanti adds this cookie back
 */
chrome.cookies.onChanged.addListener((changeInfo) => {
  // Only monitor Ivanti domain
  if (!changeInfo.cookie.domain.includes('serviceitplus.com')) {
    return;
  }
  
  // Log cookie changes (debug mode - can be disabled in production)
  if (changeInfo.removed) {
    console.log(`[Background] 🔍 Cookie removed: ${changeInfo.cookie.name} (domain: ${changeInfo.cookie.domain})`);
  } else {
    console.log(`[Background] 🔍 Cookie added: ${changeInfo.cookie.name} (domain: ${changeInfo.cookie.domain})`);
  }
  
  // Check if UserSettings cookie was removed (LOGOUT)
  if (changeInfo.cookie.name === 'UserSettings' && changeInfo.removed) {
    console.log('[Background] 🚪 LOGOUT DETECTED: UserSettings cookie removed');
    // handleLogout() already does all the cleanup - no need to duplicate code
    handleLogout();
  }
  
  // Check if UserSettings cookie was added (RE-LOGIN after logout)
  if (changeInfo.cookie.name === 'UserSettings' && !changeInfo.removed) {
    // Only treat as re-login if we had a previous logout
    if (!globalUserSession) {
      console.log('[Background] 🔓 ========================================');
      console.log('[Background] 🔓 LOGIN DETECTED: UserSettings cookie added');
      console.log('[Background] 🔓 ========================================');
      
      // Notify all Ivanti tabs that user logged in
      chrome.tabs.query({ url: 'https://success.serviceitplus.com/*' }, (tabs) => {
        console.log(`[Background] 📤 Sending USER_LOGGED_IN to ${tabs.length} tabs`);
        tabs.forEach(tab => {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, { 
              type: 'USER_LOGGED_IN' 
            }).then(() => {
              console.log(`[Background] ✅ Sent USER_LOGGED_IN to tab ${tab.id}`);
            }).catch((error) => {
              console.log(`[Background] Note: Could not send login to tab ${tab.id}:`, error.message);
            });
          }
        });
      });
    }
  }
  
  // Also check for session ID or other auth cookies being removed
  if ((changeInfo.cookie.name.includes('Session') || 
       changeInfo.cookie.name.includes('Auth') ||
       changeInfo.cookie.name.includes('SID')) && 
      changeInfo.removed) {
    console.log('[Background] 🚪 Session cookie removed:', changeInfo.cookie.name);
    
    // Clear session as backup detection method
    if (globalUserSession) {
      console.log('[Background] 🚪 Triggering logout cleanup due to session cookie removal');
      handleLogout();
    }
  }
});

// BEST PRACTICE: Use periodic check as BACKUP only (not primary detection)
// Primary detection: cookie.onChanged listener (event-driven, immediate)
// Backup detection: Periodic validation (catches edge cases where listener might miss)
// 
// Why both?
// 1. cookie.onChanged is immediate and reliable for normal logout
// 2. Periodic check catches: browser crashes, extension reloads, cookie deletion outside extension
// 3. But we make it LESS aggressive to avoid false positives:
//    - Only runs if we have an active session
//    - Longer interval (30 seconds instead of 5)
//    - Validates both cookie AND storage session before triggering logout
let periodicCheckInterval: number | null = null;

function startPeriodicLogoutCheck() {
  // Clear any existing interval
  if (periodicCheckInterval !== null) {
    clearInterval(periodicCheckInterval);
  }
  
  // Only start periodic check if we have an active session
  if (globalUserSession) {
    periodicCheckInterval = setInterval(async () => {
      // Only check if we still have an active session
      if (!globalUserSession) {
        // Session cleared, stop checking
        if (periodicCheckInterval !== null) {
          clearInterval(periodicCheckInterval);
          periodicCheckInterval = null;
        }
        return;
      }
      
      const isLoggedOut = await checkUserLoggedOut();
      if (isLoggedOut) {
        console.log('[Background] 🚪 Periodic backup check detected logout');
        handleLogout();
      }
    }, 30000) as unknown as number; // Check every 30 seconds (less aggressive)
    
    console.log('[Background] ✅ Started periodic logout check (backup, every 30s)');
  }
}

function stopPeriodicLogoutCheck() {
  if (periodicCheckInterval !== null) {
    clearInterval(periodicCheckInterval);
    periodicCheckInterval = null;
    console.log('[Background] ✅ Stopped periodic logout check');
  }
}

function startAuthProbe() {
  if (authProbeInterval) return;
  authProbeInterval = setInterval(async () => {
    if (!globalUserSession) return;
    try {
      const res = await fetch('https://success.serviceitplus.com/HEAT/api/odata/businessobject/employees?$top=1&$select=RecId', {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'application/json' },
      });
      if (res.status === 401 || res.status === 403) {
        console.warn('[Background] 🔒 Auth probe received', res.status, '- treating as logout');
        await handleLogout();
      }
    } catch (err) {
      // Ignore network errors; they can be transient
    }
  }, 15000) as unknown as number;
  console.log('[Background] ✅ Started auth probe (15s interval)');
}

function stopAuthProbe() {
  if (authProbeInterval) {
    clearInterval(authProbeInterval);
    authProbeInterval = null;
    console.log('[Background] ✅ Stopped auth probe');
  }
}

// Start periodic check when user session is established
// This will be called when globalUserSession is set

// Validate configuration on startup
const configValidation = validateConfig();
if (!configValidation.valid) {
  console.error('[Background] ⚠️  Configuration errors:', configValidation.errors);
  console.error('[Background] Please update src/background/config.ts with your API keys');
}

/**
 * Handle messages from content scripts
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // All handlers must return true to indicate async response
  
  if (request.type === 'IDENTIFY_USER') {
    handleIdentifyUser(request, sender, sendResponse);
    return true;
  }
  
  if (request.type === 'SEND_MESSAGE') {
    handleSendMessage(request, sender, sendResponse);
    return true;
  }

  if (request.type === 'CONFIRM_SERVICE_REQUEST') {
    handleConfirmServiceRequest(request, sender, sendResponse);
    return true;
  }

  if (request.type === 'CLEAR_CONVERSATION') {
    handleClearConversation(request, sender, sendResponse);
    return true;
  }
  
  if (request.type === 'PREFETCH_DATA') {
    handlePrefetchData(request, sender, sendResponse);
    return true;
  }
  
  if (request.type === 'GET_CACHED_USER') {
    handleGetCachedUser(request, sender, sendResponse);
    return true;
  }
  
  // Fallback for unknown message types
  sendResponse({ success: false, error: 'Unknown message type' });
  return false;
});

/**
 * Handle: IDENTIFY_USER
 * Identifies the currently logged-in Ivanti user
 */
async function handleIdentifyUser(request: any, sender: any, sendResponse: Function) {
  try {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ success: false, error: 'No tab ID' });
      return;
    }

    console.log('[Background] Identifying user for tab:', tabId);

    // Force refresh if requested OR if fallbackDisplayName doesn't match cached user
    const shouldRefresh = request.forceRefresh || 
      (globalUserSession && request.fallbackDisplayName && 
       globalUserSession.fullName !== request.fallbackDisplayName);
    
    if (shouldRefresh) {
      console.log('[Background] Refreshing user identification (forced or name mismatch)');
      globalUserSession = null;
    }

    // Check global session cache (shared across ALL tabs)
    if (globalUserSession && !shouldRefresh) {
      console.log('[Background] ✅ Returning global cached user:', globalUserSession.fullName);
      sendResponse({ success: true, user: globalUserSession });
      return;
    }

    // Get user (with optional fallback display name from DOM)
    const user = await getCurrentUser(tabId, request.fallbackDisplayName);
    
    if (user) {
      // Generate a new session ID for this identification (used by content script to isolate history)
      const newSessionId = createSessionId();

      // Save to GLOBAL session (shared across all tabs AND persists across browser restarts)
      globalUserSession = user;
      globalSessionId = newSessionId;

      // Use chrome.storage.local for persistence across browser restarts
      chrome.storage.local.set({ currentUser: user }, () => {
        console.log('[Background] ✅ Saved user to persistent storage:', user.fullName);
      });
      // Also save to session storage for backward compatibility
      chrome.storage.session.set({ currentUser: user });
      
      // Start periodic logout check (backup detection)
      startPeriodicLogoutCheck();
      
      console.log('[Background] ✅ User identified:', user.fullName);
      
      // Start auth probe for 401 detection
      startAuthProbe();

      // Notify all Ivanti tabs that a login/session has been established (includes sessionId)
      chrome.tabs.query({ url: 'https://success.serviceitplus.com/*' }, (tabs) => {
        console.log(`[Background] 📤 Broadcasting USER_LOGGED_IN to ${tabs.length} tabs with sessionId ${newSessionId}`);
        tabs.forEach(tab => {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, { 
              type: 'USER_LOGGED_IN',
              sessionId: newSessionId
            }).catch((error) => {
              console.log(`[Background] Note: Could not send USER_LOGGED_IN to tab ${tab.id}:`, error.message);
            });
          }
        });
      });

      sendResponse({ success: true, user: user });
    } else {
      console.log('[Background] ❌ Could not identify user');
      // If we previously had a session, treat this as logout and clean up
      if (globalUserSession) {
        console.log('[Background] ⚠️ Identification failed after having a session. Treating as logout.');
        await handleLogout();
      }
      sendResponse({ 
        success: false, 
        error: 'Could not identify user. Please ensure you are logged in to Ivanti.' 
      });
    }

  } catch (error: any) {
    console.error('[Background] Error identifying user:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * Handle: SEND_MESSAGE
 * Processes a chat message through AI and returns response
 */
async function handleSendMessage(request: any, sender: any, sendResponse: Function) {
  try {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ success: false, error: 'No tab ID' });
      return;
    }

    console.log('[Background] Processing message for tab:', tabId);

    // Get current user from global session OR from request
    let user = globalUserSession;
    
    if (!user && request.currentUser) {
      console.log('[Background] Using user from request:', request.currentUser.fullName);
      user = request.currentUser;
      // Update global session (persists across browser restarts)
      globalUserSession = user;
      // user is guaranteed to be non-null here due to the if condition above
      const newSessionId = createSessionId();
      globalSessionId = newSessionId;
      chrome.storage.local.set({ currentUser: user }, () => {
        if (user) {
          console.log('[Background] ✅ Updated user in persistent storage:', user.fullName);
        }
      });
      
      // Start periodic logout check (backup detection)
      startPeriodicLogoutCheck();
      startAuthProbe();
      chrome.storage.session.set({ currentUser: user });
    }
    
    if (!user) {
      sendResponse({ 
        success: false, 
        error: 'User not identified. Please refresh the page.' 
      });
      return;
    }
    
    console.log('[Background] Processing message for user:', user.fullName, 'Role:', user.roles?.join(', ') || 'Unknown');

    // Get or initialize conversation history
    let history = conversationHistory.get(tabId) || [];
    
    console.log('[Background] Current conversation history length:', history.length);
    console.log('[Background] History preview:', history.slice(-4).map(h => `${h.role}: ${h.content.substring(0, 50)}...`));

    // Check if AI is configured
    if (!configValidation.valid) {
      // Return a helpful error message
      sendResponse({
        success: true,
        message: '⚠️ AI service is not configured. Please add your Gemini API key to the extension configuration.\n\nGet your API key from: https://ai.google.dev/\n\nFor now, I can still help you navigate Ivanti, but I won\'t be able to process natural language commands.',
        actions: []
      });
      return;
    }

    // Process message through AI (this will update history internally)
    // processMessage will add the user message and any system messages to history
    const aiResponse = await processMessage(
      request.message,
      user,
      request.ticketId || null,
      history, // Pass by reference so it can be updated
      request.model // Pass selected model from UI
    );

    // Add AI response to conversation history
    // Note: processMessage already added the user message, so we only add assistant here
    // 2025 BEST PRACTICE: Include timestamp for better context tracking
    history.push({
      role: 'assistant',
      content: aiResponse.message,
      timestamp: Date.now()
    });
    conversationHistory.set(tabId, history);
    
    console.log('[Background] Updated conversation history length:', history.length);

    console.log('[Background] ✅ Message processed');
    sendResponse({
      success: true,
      message: aiResponse.message,
      actions: aiResponse.actions || [],
      thinkingSteps: aiResponse.thinkingSteps || [] // ✅ Pass agent thinking steps to UI
    });

  } catch (error: any) {
    console.error('[Background] ❌ Error processing message:', error);
    console.error('[Background] Error stack:', error.stack);
    console.error('[Background] Error details:', {
      message: error.message,
      name: error.name,
      cause: error.cause
    });
    
    // Return user-friendly error
    let errorMessage = 'Sorry, I encountered an error processing your message.';
    
    // Handle quota exhaustion specifically
    if (error.message?.includes('QUOTA_EXHAUSTED') || error.message?.includes('quota')) {
      errorMessage = `⚠️ API Quota Exceeded\n\nYou've reached your daily API limit (50 requests/day for gemini-2.5-pro on free tier).\n\n💡 Solutions:\n1. Switch to "gemini-2.5-flash" model (higher quota) - use the model selector\n2. Wait until tomorrow (quota resets daily)\n3. Upgrade your Google AI Studio plan\n\n📊 Monitor usage: https://ai.dev/usage?tab=rate-limit`;
    } else if (error.message?.includes('Gemini') || error.message?.includes('API')) {
      errorMessage = '⚠️ AI service error. Please check your Gemini API key configuration.\n\nGet your API key from: https://ai.google.dev/';
    } else if (error.message?.includes('timeout')) {
      errorMessage = '⏱️ Request timeout. The AI service took too long to respond. Please try again with a simpler query.';
    } else {
      errorMessage = `Sorry, I encountered an error: ${error.message || 'Unknown error'}\n\nPlease check the browser console (F12) for more details.`;
    }
    
    // CRITICAL: Always send response to prevent chat from getting stuck
    try {
      sendResponse({ 
        success: true, // Still "success" so UI doesn't break
        message: errorMessage,
        actions: []
      });
    } catch (sendError) {
      console.error('[Background] ❌ CRITICAL: Failed to send error response:', sendError);
      // If sendResponse fails, the chat will be stuck - log this for debugging
    }
  }
}

/**
 * Handle: CONFIRM_SERVICE_REQUEST
 * Creates a Service Request from a selected Request Offering and field values
 */
async function handleConfirmServiceRequest(request: any, sender: any, sendResponse: Function) {
  try {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ success: false, error: 'No tab ID' });
      return;
    }

    let user = globalUserSession;
    if (!user) {
      sendResponse({ success: false, error: 'User not identified. Please refresh the page.' });
      return;
    }

    const { subscriptionId, fieldValues } = request;
    if (!subscriptionId || !fieldValues || typeof fieldValues !== 'object') {
      sendResponse({ success: false, error: 'Missing subscriptionId or fieldValues' });
      return;
    }

    console.log('[Background] CONFIRM_SERVICE_REQUEST for subscriptionId:', subscriptionId);
    console.log('[Background] Field values received:', JSON.stringify(fieldValues, null, 2));
    console.log('[Background] Field values keys:', Object.keys(fieldValues));

    // For now we only validate and echo back; actual SR creation can be wired
    // to a dedicated createServiceRequest helper later if needed.
    const offerings = await fetchRequestOfferings();
    const offering = offerings.find((o: any) =>
      o.SubscriptionId === subscriptionId || o.strSubscriptionId === subscriptionId
    );

    if (!offering) {
      sendResponse({ success: false, error: 'Request Offering not found for subscriptionId' });
      return;
    }

    // ✅ Pass offering object to fetch correct template structure
    const rawFieldset = await fetchRequestOfferingFieldset(subscriptionId, offering);
    if (!rawFieldset) {
      sendResponse({ success: false, error: 'Fieldset not found for Request Offering' });
      return;
    }

    const normalized = normalizeRequestOfferingFieldset(rawFieldset, offering as any);

    // Validate that all required fields are present
    const missingRequired = normalized.fields
      .filter(f => f.required)
      .filter(f => {
        const value = fieldValues[f.name];
        return value === undefined || value === null || value === '' || String(value).trim() === '';
      });

    if (missingRequired.length > 0) {
      const missingFieldsList = missingRequired.map(f => f.label || f.name).join(', ');
      const errorMessage = `Cannot submit: ${missingRequired.length} required field${missingRequired.length > 1 ? 's are' : ' is'} missing: ${missingFieldsList}. Please fill in all required fields before submitting.`;
      
      console.warn('[Background] ⚠️ Validation failed - missing required fields:', missingRequired.map(f => f.label));
      
      sendResponse({
        success: false,
        error: errorMessage,
        missingFields: missingRequired.map(f => ({ 
          name: f.name, 
          label: f.label || f.name,
          type: f.type,
          options: f.options || undefined
        })),
        // Add helpful context for UI
        validationError: true,
        missingFieldsCount: missingRequired.length
      });
      return;
    }

    // Create the service request via Ivanti REST API
    console.log('[Background] Creating service request via Ivanti REST API...');
    
    // Extract field metadata (name, RecId, type, and options) for parameter mapping
    const fieldMetadata = normalized.fields.map(f => ({
      name: f.name,
      recId: f.recId,
      label: f.label,
      type: f.type, // ✅ Include type for combo field handling
      options: f.options // ✅ Include options for RecId lookup
    }));
    
    console.log('[Background] 📋 Field metadata:', fieldMetadata);
    
    const createResult = await createServiceRequest(
      {
        subscriptionId,
        fieldValues,
        fieldMetadata // ✅ Pass field RecIds for Ivanti parameters mapping
      },
      user
    );

    if (!createResult.success) {
      console.error('[Background] ❌ Failed to create service request:', createResult.error);
      sendResponse({
        success: false,
        error: createResult.error || 'Failed to create service request'
      });
      return;
    }

    console.log('[Background] ✅ Service request created successfully:', createResult.requestNumber);

    // Add created service request to conversation history so AI can reference it
    const history = conversationHistory.get(tabId) || [];
    history.push({
      role: 'system',
      content: `[SERVICE REQUEST CREATED - Remember this]: Service Request ${createResult.requestNumber} (RecId: ${createResult.recId || 'Unknown'}) was just created for offering "${normalized.name || 'Unknown Request Offering'}". This service request exists and user can ask about its status.`
    });
    conversationHistory.set(tabId, history);

    sendResponse({
      success: true,
      created: true,
      requestNumber: createResult.requestNumber,
      recId: createResult.recId,
      offeringName: normalized.name || 'Unknown Request Offering'
    });
  } catch (error: any) {
    console.error('[Background] ❌ Error in CONFIRM_SERVICE_REQUEST:', error);
    sendResponse({ success: false, error: error.message || 'Unknown error' });
  }
}

/**
 * Handle: CLEAR_CONVERSATION
 * Clears conversation history for a tab
 */
function handleClearConversation(_request: any, sender: any, sendResponse: Function) {
  const tabId = sender.tab?.id;
  if (tabId) {
    conversationHistory.delete(tabId);
    console.log('[Background] Cleared conversation for tab:', tabId);
  }
  sendResponse({ success: true });
}

/**
 * Handle: PREFETCH_DATA
 * Pre-fetches common Ivanti data to warm up the cache
 */
async function handlePrefetchData(request: any, _sender: any, sendResponse: Function) {
  try {
    const currentUser = request.currentUser || globalUserSession;
    
    if (!currentUser) {
      console.log('[Background] No user for pre-fetch, skipping');
      sendResponse({ success: false, error: 'No user identified' });
      return;
    }
    
    console.log('%c[Background] 🚀 Starting data pre-fetch for user:', 'color: #8b5cf6; font-weight: bold;', currentUser.fullName);
    
    // Run pre-fetch in background (don't wait for it)
    prefetchCommonData(currentUser as IvantiUser).then(() => {
      console.log('%c[Background] ✅ Pre-fetch complete', 'color: #10b981; font-weight: bold;');
    }).catch((error) => {
      console.error('[Background] ❌ Pre-fetch error:', error);
    });
    
    // Return immediately so UI doesn't wait
    sendResponse({ success: true, message: 'Pre-fetch started' });
  } catch (error: any) {
    console.error('[Background] Error starting pre-fetch:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * Handle: GET_CACHED_USER
 * Returns cached user session immediately (for instant UI load)
 */
function handleGetCachedUser(_request: any, _sender: any, sendResponse: Function) {
  if (globalUserSession) {
    console.log('[Background] ✅ Returning cached user:', globalUserSession.fullName);
    sendResponse({ success: true, user: globalUserSession, sessionId: globalSessionId || null });
  } else {
    // Also check chrome.storage.local for cached user
    chrome.storage.local.get(['currentUser', 'lastSessionId'], (result) => {
      if (result.currentUser) {
        globalUserSession = result.currentUser;
        globalSessionId = result.lastSessionId || null;
        console.log('[Background] ✅ Returning cached user from storage:', globalUserSession?.fullName);
        if (globalSessionId) {
          console.log('[Background] ✅ Returning cached session ID:', globalSessionId);
        }
        sendResponse({ success: true, user: globalUserSession, sessionId: globalSessionId || null });
      } else {
        sendResponse({ success: false, error: 'No cached user' });
      }
    });
  }
}

/**
 * Clean up when tabs are closed
 */
chrome.tabs.onRemoved.addListener((tabId) => {
  conversationHistory.delete(tabId);
  console.log('[Background] Cleaned up conversation for tab:', tabId);
  
  // Note: We DON'T clear globalUserSession here because it should persist
  // across all tabs. It will only be cleared when the browser closes or
  // when a different user is detected.
});
