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
 * Listen for logout events from background script
 */
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'USER_LOGGED_OUT') {
    console.log('🚪 ServiceIT: User logged out, clearing UI...');
    
    // Remove the chat widget if it exists
    const container = document.getElementById('serviceit-assistant-root');
    if (container) {
      container.remove();
      console.log('ServiceIT: Chat widget removed due to logout');
    }
    
    // Optionally show a logout message
    console.log('ServiceIT: User session ended. Reload page to restart assistant.');
  }
});

// Main Init
const init = async () => {
  // ONLY run in the MAIN FRAME (not iframes) to prevent duplication
  if (window !== window.top) {
    console.log("ServiceIT: Skipping iframe, only running in main frame");
    return;
  }

  if (document.getElementById('serviceit-assistant-root')) return;

  // Check if user is logged into Ivanti by looking for session cookies
  const cookies = document.cookie;
  const hasUserSettings = cookies.includes('UserSettings=');
  const hasSessionId = cookies.includes('ASP.NET_SessionId=') || cookies.includes('HEAT_SessionId=');
  const isIvantiDomain = window.location.hostname.includes('serviceitplus.com') || 
                         window.location.hostname.includes('ivanti.com') ||
                         window.location.hostname.includes('heat');
  
  console.log('[ServiceIT] Session check:', {
    hasUserSettings,
    hasSessionId,
    isIvantiDomain,
    hostname: window.location.hostname
  });
  
  // If no active session, don't load AI Assistant
  if (!hasUserSettings || !isIvantiDomain) {
    console.log("ServiceIT: No active Ivanti session detected. AI Assistant will not load.");
    return; // Exit early - don't show any UI
  }

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

  // Render loading screen immediately
  const root = ReactDOM.createRoot(rootContainer);
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

  let currentUser: UserInfo | null = null;

  // Get user info (Background script handles API calls - may take a few seconds)
  updateProgress({ stage: 'user_identification', progress: 10, message: 'Identifying user...' });
  currentUser = await getUserInfo();
  
  if (currentUser) {
    console.log("Service IT Plus: Identified User", currentUser);
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

