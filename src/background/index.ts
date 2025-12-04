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

// Store conversation history per tab (in memory)
const conversationHistory = new Map<number, ChatMessage[]>();

// GLOBAL user session - shared across ALL tabs for the same domain
// Using chrome.storage.local for persistence across browser restarts (more reliable)
// chrome.storage.session only persists during browser session, not across restarts
let globalUserSession: IvantiUser | null = null;

console.log('[Background] Service IT Plus Assistant - Background script loaded');

// Load global user session on startup (from persistent storage)
// This ensures user session survives browser restarts
chrome.storage.local.get(['currentUser'], (result) => {
  if (result.currentUser) {
    globalUserSession = result.currentUser;
    console.log('[Background] ✅ Restored user session from persistent storage:', globalUserSession?.fullName);
  } else {
    // Fallback to session storage for backward compatibility
    chrome.storage.session.get(['currentUser'], (sessionResult) => {
      if (sessionResult.currentUser) {
        globalUserSession = sessionResult.currentUser;
        // Migrate to local storage for persistence
        chrome.storage.local.set({ currentUser: globalUserSession });
        console.log('[Background] ✅ Migrated user session to persistent storage:', globalUserSession?.fullName);
      }
    });
  }
});

/**
 * Monitor UserSettings cookie to detect logout
 * When user logs out, Ivanti removes this cookie
 */
chrome.cookies.onChanged.addListener((changeInfo) => {
  // Only monitor Ivanti domain
  if (!changeInfo.cookie.domain.includes('serviceitplus.com')) {
    return;
  }
  
  // Check if UserSettings cookie was removed
  if (changeInfo.cookie.name === 'UserSettings' && changeInfo.removed) {
    console.log('[Background] 🚪 LOGOUT DETECTED: UserSettings cookie removed');
    
    // Clear global session from both storage types
    globalUserSession = null;
    chrome.storage.session.remove('currentUser', () => {
      console.log('[Background] ✅ Cleared user session from session storage');
    });
    chrome.storage.local.remove('currentUser', () => {
      console.log('[Background] ✅ Cleared user session from persistent storage');
    });
    
    // Clear all conversation histories
    conversationHistory.clear();
    console.log('[Background] ✅ Cleared all conversations');
    
    // Clear all cached Ivanti data on logout (security best practice)
    import('./services/cacheService').then(({ clearAllCache }) => {
      clearAllCache();
      console.log('[Background] ✅ Cleared all cached data');
    });
    
    // Notify all Ivanti tabs that user logged out
    chrome.tabs.query({ url: 'https://success.serviceitplus.com/*' }, (tabs) => {
      tabs.forEach(tab => {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, { 
            type: 'USER_LOGGED_OUT' 
          }).catch(() => {
            // Tab might not have content script loaded yet
          });
        }
      });
    });
  }
  
  // Also check for session ID or other auth cookies being removed
  if ((changeInfo.cookie.name.includes('Session') || 
       changeInfo.cookie.name.includes('Auth') ||
       changeInfo.cookie.name.includes('SID')) && 
      changeInfo.removed) {
    console.log('[Background] 🚪 Session cookie removed:', changeInfo.cookie.name);
    
    // Clear session as backup detection method
    if (globalUserSession) {
      console.log('[Background] Clearing user session due to session cookie removal');
      globalUserSession = null;
      chrome.storage.session.remove('currentUser');
      chrome.storage.local.remove('currentUser');
      conversationHistory.clear();
    }
  }
});

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

  if (request.type === 'CLEAR_CONVERSATION') {
    handleClearConversation(request, sender, sendResponse);
    return true;
  }
  
  if (request.type === 'PREFETCH_DATA') {
    handlePrefetchData(request, sender, sendResponse);
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
      // Save to GLOBAL session (shared across all tabs AND persists across browser restarts)
      globalUserSession = user;
      // Use chrome.storage.local for persistence across browser restarts
      chrome.storage.local.set({ currentUser: user }, () => {
        console.log('[Background] ✅ Saved user to persistent storage:', user.fullName);
      });
      // Also save to session storage for backward compatibility
      chrome.storage.session.set({ currentUser: user });
      
      console.log('[Background] ✅ User identified:', user.fullName);
      sendResponse({ success: true, user: user });
    } else {
      console.log('[Background] ❌ Could not identify user');
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
      chrome.storage.local.set({ currentUser: user }, () => {
        if (user) {
          console.log('[Background] ✅ Updated user in persistent storage:', user.fullName);
        }
      });
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
      history // Pass by reference so it can be updated
    );

    // Add AI response to conversation history
    // Note: processMessage already added the user message, so we only add assistant here
    history.push({
      role: 'assistant',
      content: aiResponse.message
    });
    conversationHistory.set(tabId, history);
    
    console.log('[Background] Updated conversation history length:', history.length);

    console.log('[Background] ✅ Message processed');
    sendResponse({
      success: true,
      message: aiResponse.message,
      actions: aiResponse.actions || []
    });

  } catch (error: any) {
    console.error('[Background] Error processing message:', error);
    
    // Return user-friendly error
    let errorMessage = 'Sorry, I encountered an error processing your message.';
    if (error.message?.includes('Gemini') || error.message?.includes('API')) {
      errorMessage = '⚠️ AI service error. Please check your Gemini API key configuration.\n\nGet your API key from: https://ai.google.dev/';
    }
    
    sendResponse({ 
      success: true, // Still "success" so UI doesn't break
      message: errorMessage,
      actions: []
    });
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
 * Clean up when tabs are closed
 */
chrome.tabs.onRemoved.addListener((tabId) => {
  conversationHistory.delete(tabId);
  console.log('[Background] Cleaned up conversation for tab:', tabId);
  
  // Note: We DON'T clear globalUserSession here because it should persist
  // across all tabs. It will only be cleared when the browser closes or
  // when a different user is detected.
});
