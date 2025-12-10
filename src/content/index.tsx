import React from 'react';
import ReactDOM from 'react-dom/client';
import ChatWidget from '../components/ChatWidget';
import LoadingScreen from '../components/LoadingScreen';
import '../styles.css';

export interface UserInfo {
  recId?: string;
  loginId: string;
  email?: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  team?: string;
  department?: string;
  role?: string;
  roles?: string[];
  teams?: string[];
}

/**
 * Get user info from Background Script (which calls Ivanti API)
 * Falls back to DOM scraping if API fails
 */
const getUserInfo = async (): Promise<UserInfo | null> => {
  console.log("ServiceIT: Requesting user identification from background script...");

  // Strategy 1: Try to get user from injected script (window.HEAT)
  const userFromInjection = await waitForInjectedUser();
  
  if (userFromInjection && userFromInjection.recId) {
    console.log("✅ ServiceIT: Got complete user data from window.HEAT:", userFromInjection);
    return userFromInjection;
  }

  // Strategy 2: Try to get display name from DOM as a fallback hint
  const fallbackDisplayName = await scrapeUserNameFromDOM();
  
  try {
    // Ask background script to identify user (it will try API first)
    // Force refresh on every page load to avoid stale cached data
    const response = await chrome.runtime.sendMessage({
      type: 'IDENTIFY_USER',
      fallbackDisplayName: fallbackDisplayName,
      forceRefresh: true // Don't use cached user data
    });

    if (response && response.success && response.user) {
      console.log("✅ ServiceIT: User identified:", response.user);
      return response.user;
    } else {
      console.warn("ServiceIT: Background script could not identify user:", response.error);
      
      // Last resort: use DOM-scraped name
      if (fallbackDisplayName) {
        console.log("ServiceIT: Using fallback display name:", fallbackDisplayName);
        return {
          loginId: fallbackDisplayName,
          fullName: fallbackDisplayName
        };
      }
      
      return null;
    }

  } catch (error) {
    console.error("ServiceIT: Error communicating with background script:", error);
    
    // Last resort: use DOM-scraped name
    if (fallbackDisplayName) {
      return {
        loginId: fallbackDisplayName,
        fullName: fallbackDisplayName
      };
    }
    
    return null;
  }
};

/**
 * Wait for the injected script to find user data from window.HEAT
 */
const waitForInjectedUser = (): Promise<UserInfo | null> => {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.log("⏱️ ServiceIT: Timeout waiting for injected script (this is normal if window.HEAT doesn't exist)");
      resolve(null);
    }, 10000); // Wait up to 10 seconds (increased from 5)

    const messageHandler = (event: MessageEvent) => {
      if (event.source !== window) return;
      if (event.data.type === 'SERVICEIT_USER_DETECTED') {
        clearTimeout(timeout);
        window.removeEventListener('message', messageHandler);
        console.log("✅ ServiceIT: Received user from injected script:", event.data.user);
        resolve(event.data.user);
      }
    };

    window.addEventListener('message', messageHandler);
  });
};

/**
 * Scrape display name from DOM (used as fallback hint for API lookup)
 * Enhanced version with multiple strategies and better timing
 * PRIORITY: This should find the VISIBLE user in the UI header (orange bar)
 */
const scrapeUserNameFromDOM = async (): Promise<string | null> => {
  console.log("🔍 ServiceIT: Scraping display name from DOM...");
  
  try {
    // Wait a bit for the page to fully load (Ivanti uses lazy loading)
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // FIRST: Look for the user name in the visible header (orange bar)
    // In your screenshot, "Michael Monteza" appears next to "Administrator"
    console.log("🔍 ServiceIT: Looking for user in visible header...");
    
    // Strategy 0: Find ALL text in the top-right corner and log it
    const topRightElements = Array.from(document.querySelectorAll('*')).filter(el => {
      const rect = el.getBoundingClientRect();
      return rect.top >= 0 && rect.top < 100 && rect.left > window.innerWidth * 0.7;
    });
    
    console.log(`🔍 ServiceIT: Found ${topRightElements.length} elements in top-right corner`);
    
    for (const el of topRightElements.slice(0, 20)) {
      const text = el.textContent?.trim();
      if (text && text.length > 0 && text.length < 100) {
        console.log(`  📍 Element text: "${text}"`);
        
        // Check if it matches name pattern AND is visible
        if (isValidName(text)) {
          const rect = el.getBoundingClientRect();
          console.log(`  ✅ FOUND VALID NAME in header: "${text}" at position (${rect.left}, ${rect.top})`);
          return text;
        }
      }
    }
    
    // Strategy 1: Look for the orange header bar with user profile (from your screenshot)
    // The header typically has a user icon and name in the top-right
    const headerSelectors = [
      'header [class*="user"]',
      'header [class*="profile"]',
      '.header-user',
      '.header-profile',
      '[role="banner"] [class*="user"]'
    ];

    for (const selector of headerSelectors) {
      const elements = document.querySelectorAll(selector);
      console.log(`🔍 ServiceIT: Checking selector "${selector}", found ${elements.length} elements`);
      for (const el of elements) {
        const text = el.textContent?.trim();
        console.log(`  - Text: "${text}"`);
        if (text && isValidName(text)) {
          console.log(`✅ ServiceIT: Found user via header selector "${selector}": ${text}`);
          return text;
        }
      }
    }

    // Strategy 2: Look for common Ivanti user menu selectors
    const commonSelectors = [
      '.user-name',
      '.username',
      '.user-display-name',
      '.profile-name',
      '.current-user',
      '[class*="user"][class*="name"]',
      '[id*="user"][id*="name"]',
      '.x-btn-inner', // ExtJS button text (Ivanti uses ExtJS)
      '.x-menu-item-text', // ExtJS menu items
      '[data-user-name]',
      '[data-username]'
    ];

    for (const selector of commonSelectors) {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        const text = el.textContent?.trim();
        if (text && isValidName(text)) {
          console.log(`✅ ServiceIT: Found user via selector "${selector}": ${text}`);
          return text;
        }
      }
    }

    // Strategy 3: Look in the top-right corner (where user menus typically are)
    const candidates = scanTopRightCorner();
    if (candidates.length > 0) {
      console.log("✅ ServiceIT: DOM scraped candidates:", candidates.slice(0, 5));
      return candidates[0].text;
    }

    // Strategy 4: Look for elements with aria-label or title containing "user"
    const ariaElements = document.querySelectorAll('[aria-label*="user" i], [title*="user" i]');
    for (const el of ariaElements) {
      const text = el.textContent?.trim();
      if (text && isValidName(text)) {
        console.log(`✅ ServiceIT: Found user via aria/title: ${text}`);
        return text;
      }
    }

    console.log("❌ ServiceIT: No valid name found in DOM after all strategies");
    return null;

  } catch (e) {
    console.error("❌ ServiceIT: DOM scraping failed", e);
    return null;
  }
};

/**
 * Check if text looks like a valid person's name
 */
const isValidName = (str: string): boolean => {
  const trimmed = str.trim();
  
  // Must be at least 2 words (First Last)
  const words = trimmed.split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  
  // Each word must start with capital letter and be at least 2 chars
  for (const word of words) {
    if (!/^[A-Z][a-z]{1,}$/.test(word)) return false;
  }
  
  // Blacklist common UI terms
  const blacklist = [
    'Quick Links', 'Service IT', 'Log Out', 'Logout', 'Settings', 'Help', 'Support',
    'Home', 'Dashboard', 'Menu', 'Admin', 'Search', 'Filter', 'View', 'Edit',
    'Create', 'New', 'Save', 'Cancel', 'Back', 'Next', 'Previous', 'Close',
    'App Management', 'User And Roles', 'System Tools', 'Automation',
    'Service Request', 'Service Desk', 'Change Calendar', 'Call Log', 'Project Roles',
    'Discovered Assets', 'Site Configuration', 'Analytic Metrics', 'Business Value',
    'Week Number', 'Page Size', 'Modified On', 'Object Workspace', 'All Active',
    'Service Management', 'Ivanti Neurons', 'Bot Results', 'Value Modeling'
  ];
  
  // Check if any blacklist term matches
  if (blacklist.some(bad => trimmed.toLowerCase().includes(bad.toLowerCase()))) {
    return false;
  }
  
  // Must not contain common UI keywords
  if (/Desk|Request|Calendar|Log|Assets|Configuration|Metrics|Number|Size|Workspace|Management|Results|Modeling/i.test(trimmed)) {
    return false;
  }
  
  return true;
};

/**
 * Scan the top-right corner of the page for user names
 */
const scanTopRightCorner = (): Array<{text: string, score: number}> => {
  const allElements = document.querySelectorAll('*');
  const candidates: Array<{text: string, score: number, element: Element}> = [];
  const windowWidth = window.innerWidth;

  for (const el of allElements) {
    const rect = el.getBoundingClientRect();
    
    // Only look in top 200px and right 30% of screen
    if (rect.top < 0 || rect.top > 200) continue;
    if (rect.left < windowWidth * 0.6) continue;

    // Get direct text only (not children)
    const directText = Array.from(el.childNodes)
      .filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => node.textContent?.trim())
      .filter(t => t && t.length > 0)
      .join(' ');

    if (directText && isValidName(directText)) {
      // Score based on position and context
      let score = 0;
      
      // Top-right corner is best
      if (rect.left > windowWidth * 0.8) score += 100;
      if (rect.top < 80) score += 50;
      
      // Prefer smaller elements (user names are usually not huge)
      if (rect.width < 200) score += 30;
      
      // Prefer elements with user-related classes
      const className = el.className?.toString().toLowerCase() || '';
      if (className.includes('user') || className.includes('profile')) score += 50;
      
      // Prefer clickable elements (user menus are usually clickable)
      const tagName = el.tagName.toLowerCase();
      if (tagName === 'a' || tagName === 'button' || tagName === 'span') score += 20;
      
      candidates.push({ text: directText, score, element: el });
    }
  }

  // Sort by score (highest first)
  candidates.sort((a, b) => b.score - a.score);
  
  return candidates;
};

/**
 * Run brute-force scanner to find ALL possible user data locations
 */
const runBruteForceScan = () => {
  // Brute force scanner runs silently now (user identification is working)
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('brute-force-scanner.js');
  script.onload = () => {
    script.remove();
  };
  (document.head || document.documentElement).appendChild(script);
  
  // No longer listening for scan results - scanner runs silently
};

/**
 * Global flag to track if user has logged out
 * This prevents re-showing UI until a new login is detected
 */
let hasLoggedOut = false;

/**
 * Global React root reference
 * INDUSTRY BEST PRACTICE: Store root globally to properly unmount on logout
 */
let globalReactRoot: ReactDOM.Root | null = null;

/**
 * Global session ID to track unique login sessions
 * ENTERPRISE BEST PRACTICE: Use timestamp-based session isolation
 */
let currentSessionId: string | null = null;

/**
 * Listen for logout events from background script
 */
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'USER_LOGGED_OUT') {
    console.log('🚪 ========================================');
    console.log('🚪 ServiceIT: USER_LOGGED_OUT received in content script');
    console.log('🚪 ========================================');
    
    // Mark that user has logged out
    hasLoggedOut = true;
    
    // CRITICAL: Unmount React root BEFORE removing DOM element
    // This ensures complete cleanup of React's internal state and memory
    if (globalReactRoot) {
      try {
        console.log('🧹 ServiceIT: Unmounting React root...');
        globalReactRoot.unmount();
        globalReactRoot = null;
        console.log('✅ ServiceIT: React root unmounted successfully');
      } catch (error) {
        console.error('❌ ServiceIT: Error unmounting React root:', error);
      }
    }
    
    // Remove the DOM container
    const container = document.getElementById('serviceit-assistant-root');
    if (container) {
      container.remove();
      console.log('✅ ServiceIT: Chat widget DOM removed');
    }
    
    // Invalidate current session
    currentSessionId = null;
    console.log('✅ ServiceIT: Session invalidated');
    
    // ENTERPRISE BEST PRACTICE: Complete storage verification
    chrome.storage.local.get(null, (allData) => {
      const keysToRemove = Object.keys(allData).filter(key => 
        key.startsWith('conversationHistory_') || 
        key === 'currentUser' ||
        key === 'lastSessionId'
      );
      
      if (keysToRemove.length > 0) {
        console.log(`🧹 ServiceIT: Found ${keysToRemove.length} items to clear:`, keysToRemove);
        chrome.storage.local.remove(keysToRemove, () => {
          console.log(`✅ ServiceIT: Storage cleared`);
          
          // Verify complete cleanup
          chrome.storage.local.get(null, (verifyData) => {
            const remaining = Object.keys(verifyData).filter(key => 
              key.startsWith('conversationHistory_') || 
              key === 'currentUser' ||
              key === 'lastSessionId'
            );
            
            if (remaining.length > 0) {
              console.error('❌ ServiceIT: ERROR - Storage not fully cleared:', remaining);
            } else {
              console.log('✅ ServiceIT: VERIFIED - Storage completely cleared');
            }
          });
        });
      } else {
        console.log('✅ ServiceIT: No stored items to clear');
      }
    });
    
    console.log('🚪 ========================================');
    console.log('🚪 ServiceIT: Logout complete. Monitoring for re-login...');
    console.log('🚪 ========================================');
  }
  
  // Listen for RE-LOGIN events from background script
  // This is sent when UserSettings cookie is detected after it was previously removed
  if (message.type === 'USER_LOGGED_IN' && hasLoggedOut) {
    console.log('🚪 ========================================');
    console.log('🚪 ServiceIT: USER_LOGGED_IN received - reinitializing...');
    console.log('🚪 ========================================');
    
    // Reset the logout flag
    hasLoggedOut = false;
    
    // Generate new session ID for complete isolation
    // ENTERPRISE BEST PRACTICE: Each login session gets unique ID
    currentSessionId = `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    console.log(`✅ ServiceIT: New session created: ${currentSessionId}`);
    
    // Store session ID to verify against cached data
    chrome.storage.local.set({ lastSessionId: currentSessionId }, () => {
      console.log('✅ ServiceIT: Session ID stored');
    });
    
    // Re-run init() to show loading screen and rebuild UI
    setTimeout(() => {
      console.log('🔄 ServiceIT: Initializing fresh session...');
      init();
    }, 1500); // Slightly longer delay to ensure complete cleanup
  }
});

// Main Init
const init = async () => {
  // ONLY run in the MAIN FRAME (not iframes) to prevent duplication
  if (window !== window.top) {
    console.log("ServiceIT: Skipping iframe, only running in main frame");
    return;
  }

  // Prevent duplicate initialization - check if widget already exists
  // EXCEPTION: Allow re-initialization after logout
  const existingWidget = document.getElementById('serviceit-assistant-root');
  if (existingWidget && !hasLoggedOut) {
    console.log("ServiceIT: Widget already initialized, skipping");
    return;
  } else if (existingWidget || globalReactRoot) {
    // CRITICAL: Clean up any existing React instance before re-init
    console.log("ServiceIT: Cleaning up previous session...");
    
    if (globalReactRoot) {
      try {
        globalReactRoot.unmount();
        globalReactRoot = null;
        console.log("✅ ServiceIT: Unmounted existing React root");
      } catch (error) {
        console.error("❌ ServiceIT: Error unmounting:", error);
      }
    }
    
    if (existingWidget) {
      existingWidget.remove();
      console.log("✅ ServiceIT: Removed stale widget DOM");
    }
  }

  // Check if we're on an Ivanti domain first
  const isIvantiDomain = window.location.hostname.includes('serviceitplus.com') || 
                         window.location.hostname.includes('ivanti.com') ||
                         window.location.hostname.includes('heat');
  
  if (!isIvantiDomain) {
    console.log("ServiceIT: Not on an Ivanti domain. AI Assistant will not load.");
    return;
  }

  // Validate session by making a lightweight API call to Ivanti
  // This is more reliable than just checking cookies (which can persist after logout)
  // Try multiple endpoints in case one fails
  // IMPORTANT: Only block on 401/403 (definitive "not logged in"). All other errors are treated as potentially valid.
  console.log('[ServiceIT] Validating Ivanti session with API call...');
  
  const validationEndpoints = [
    '/HEAT/api/v1/User/current',
    '/HEAT/api/v1/user/current',
    '/HEAT/api/rest/Session/User',
    '/HEAT/api/odata/businessobject/employees?$top=1',
    '/HEAT/api/odata/businessobject/categorys?$top=1',
  ];
  
  let foundAuthError = false;
  
  for (const endpoint of validationEndpoints) {
    try {
      const testUrl = window.location.origin + endpoint;
      const testResponse = await fetch(testUrl, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
        },
      });
      
      console.log(`[ServiceIT] Session validation (${endpoint}):`, testResponse.status);
      
      // ONLY block on 401 or 403 - these definitively mean user is not logged in
      if (testResponse.status === 401 || testResponse.status === 403) {
        console.log("ServiceIT: User is not logged in (401/403). AI Assistant will not load.");
        foundAuthError = true;
        break;
      }
      
      // If we get 200 or 204, session is definitely valid - proceed
      if (testResponse.status === 200 || testResponse.status === 204) {
        console.log(`ServiceIT: ✅ Active session validated via ${endpoint}. Proceeding with AI Assistant initialization.`);
        break; // Found valid endpoint, proceed
      }
      
      // For 400, 404, 500, or any other error - these don't necessarily mean logged out
      // Continue trying other endpoints, but don't block initialization
      console.log(`[ServiceIT] Endpoint ${endpoint} returned ${testResponse.status} (non-auth error), trying next endpoint...`);
    } catch (error: any) {
      // Network errors, CORS errors, etc. - don't block, just try next endpoint
      console.log(`[ServiceIT] Error validating with ${endpoint}:`, error.message);
      continue; // Try next endpoint
    }
  }
  
  // ONLY block if we found a definitive auth error (401/403)
  if (foundAuthError) {
    console.log("ServiceIT: Authentication error detected. AI Assistant will not load.");
    return; // Exit early - don't show any UI
  }
  
  // If we get here, either:
  // 1. We found a valid endpoint (200/204)
  // 2. All endpoints returned non-auth errors (400, 404, 500, etc.) - assume session might still be valid
  // 3. All endpoints failed with network errors - assume session might still be valid
  console.log("ServiceIT: ✅ No authentication errors detected. Proceeding with AI Assistant initialization.");

  // Diagnostic logging
  console.log("========================================");
  console.log("ServiceIT Extension: Initializing in MAIN FRAME");
  console.log("Current URL:", window.location.href);
  console.log("Document Ready State:", document.readyState);
  console.log("========================================");

  // RUN BRUTE FORCE SCAN to find ALL user data locations
  runBruteForceScan();

  // Create the UI container FIRST
  const rootContainer = document.createElement('div');
  rootContainer.id = 'serviceit-assistant-root';
  rootContainer.style.cssText = 'all: initial; position: fixed; z-index: 2147483647;';
  document.body.appendChild(rootContainer);

  // ENTERPRISE BEST PRACTICE: Store root globally for proper cleanup
  const root = ReactDOM.createRoot(rootContainer);
  globalReactRoot = root;
  
  // 2025 BEST PRACTICE: Check for cached user first to avoid loading screen
  console.log("ServiceIT: Checking for cached user session...");
  let currentUser: UserInfo | null = null;
  
  try {
    // Try to get cached user from background script first (instant)
    const cachedUserResponse = await chrome.runtime.sendMessage({
      type: 'GET_CACHED_USER'
    });
    
    if (cachedUserResponse && cachedUserResponse.success && cachedUserResponse.user) {
      console.log("✅ ServiceIT: Using cached user - showing UI immediately:", cachedUserResponse.user.fullName);
      currentUser = cachedUserResponse.user;
      
      // Show UI immediately with cached user (skip loading screen!)
      root.render(
        <React.StrictMode>
          <ChatWidget currentUser={currentUser} />
        </React.StrictMode>
      );
      
      // Refresh user data in background (silent)
      getUserInfo().then((freshUser) => {
        if (freshUser && freshUser.loginId === currentUser?.loginId) {
          console.log("✅ ServiceIT: User data refreshed in background");
          // Optionally update UI if user data changed
          if (JSON.stringify(freshUser) !== JSON.stringify(currentUser)) {
            console.log("ServiceIT: User data changed, updating UI...");
            currentUser = freshUser;
            root.render(
              <React.StrictMode>
                <ChatWidget currentUser={currentUser} />
              </React.StrictMode>
            );
          }
        }
      }).catch((error) => {
        console.warn("ServiceIT: Background user refresh failed (non-critical):", error);
      });
      
      // Start background data prefetch (silent)
      chrome.runtime.sendMessage({
        type: 'PREFETCH_DATA',
        currentUser: currentUser,
        silent: true // Don't show progress
      }).catch(() => {
        // Ignore errors - prefetch is optional
      });
      
      return; // Exit early - UI is already shown!
    }
  } catch (error) {
    console.log("ServiceIT: No cached user found, will show loading screen:", error);
  }

  // No cached user found - show loading screen and fetch fresh data
  console.log("ServiceIT: No cached user - showing loading screen");
  let progressState = { stage: 'init', progress: 0, message: 'Identifying user...' };
  
  const updateProgress = (progress: { stage: string; progress: number; message: string }) => {
    progressState = progress;
    root.render(
      <React.StrictMode>
        <LoadingScreen message="Loading Service IT AI" progress={progressState} />
      </React.StrictMode>
    );
  };
  
  root.render(
    <React.StrictMode>
      <LoadingScreen message="Loading Service IT AI" progress={progressState} />
    </React.StrictMode>
  );
  
  console.log("ServiceIT: Loading screen displayed");

  // Get user info (Background script handles API calls - may take a few seconds)
  updateProgress({ stage: 'user_identification', progress: 10, message: 'Identifying user...' });
  currentUser = await getUserInfo();
  
  if (currentUser) {
    console.log("Service IT Plus: Identified User", currentUser);
    
    // SECURITY CHECK: Ensure user has role before proceeding
    // If no role is detected, this is a critical security issue - block access
    if (!currentUser.role && (!currentUser.roles || currentUser.roles.length === 0)) {
      console.error('🚨 ServiceIT: SECURITY - No role detected for user!');
      console.error('🚨 ServiceIT: User data:', currentUser);
      console.error('🚨 ServiceIT: AI Assistant will be blocked for security.');
      
      // Remove UI and show error message
      rootContainer.remove();
      
      // Show security notice to user
      const securityNotice = document.createElement('div');
      securityNotice.id = 'serviceit-security-notice';
      securityNotice.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: #fee;
        border: 2px solid #c00;
        padding: 20px;
        border-radius: 8px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        z-index: 999999;
        max-width: 400px;
        font-family: system-ui, -apple-system, sans-serif;
      `;
      securityNotice.innerHTML = `
        <h3 style="margin: 0 0 10px 0; color: #c00;">⚠️ AI Assistant Unavailable</h3>
        <p style="margin: 0 0 10px 0;">Your user role could not be verified. For security reasons, the AI Assistant is disabled.</p>
        <p style="margin: 0; font-size: 0.9em; color: #666;">Please contact your administrator if you believe this is an error.</p>
        <button onclick="this.parentElement.remove()" style="margin-top: 15px; padding: 8px 16px; background: #c00; color: white; border: none; border-radius: 4px; cursor: pointer;">Close</button>
      `;
      document.body.appendChild(securityNotice);
      
      // Auto-remove after 10 seconds
      setTimeout(() => {
        securityNotice.remove();
      }, 10000);
      
      return;
    }
    
    console.log('✅ ServiceIT: User role verified:', currentUser.role || currentUser.roles?.[0]);
    
    updateProgress({ stage: 'user_identified', progress: 30, message: 'User identified, pre-fetching data...' });
    
    // Pre-fetch common data while showing loading screen
    try {
      await chrome.runtime.sendMessage({
        type: 'PREFETCH_DATA',
        currentUser: currentUser
      });
      updateProgress({ stage: 'prefetch_complete', progress: 90, message: 'Almost ready...' });
    } catch (error) {
      console.warn("ServiceIT: Pre-fetch failed (non-critical):", error);
      // Continue anyway - pre-fetch is optional
    }
    
    // Small delay to show completion
    await new Promise(resolve => setTimeout(resolve, 300));
    updateProgress({ stage: 'complete', progress: 100, message: 'Ready!' });
    await new Promise(resolve => setTimeout(resolve, 200));

  // Replace loading screen with chat widget
  root.render(
    <React.StrictMode>
      <ChatWidget currentUser={currentUser} />
    </React.StrictMode>
  );
  
  console.log("ServiceIT: Chat widget rendered");
  } else {
    // User identification failed - remove the UI
    console.warn("Service IT Plus: Could not identify user. Removing AI Assistant.");
    rootContainer.remove();
  }
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

export { getUserInfo };

