/**
 * BRUTE FORCE USER DATA SCANNER FOR IVANTI NEURONS 2025.3
 * 
 * This script scans EVERY possible location where Ivanti might store user data:
 * - Window object properties
 * - LocalStorage/SessionStorage
 * - Cookies
 * - DOM data attributes
 * - ASP.NET ViewState
 * - Network requests
 * - React/Angular component state
 */

(function() {
  // Brute force scanner - runs silently now (user identification is working)
  // Only log critical findings, not all scan details
  
  const findings = {
    windowObjects: [],
    storage: [],
    cookies: [],
    domData: [],
    networkCalls: [],
    frameworks: []
  };

  // ===== 1. SCAN ALL WINDOW PROPERTIES =====
  const windowKeys = Object.keys(window);
  
  // Look for user-related properties
  const userRelatedKeys = windowKeys.filter(key => {
    const lowerKey = key.toLowerCase();
    return lowerKey.includes('user') || 
           lowerKey.includes('profile') || 
           lowerKey.includes('session') ||
           lowerKey.includes('auth') ||
           lowerKey.includes('login') ||
           lowerKey.includes('employee') ||
           lowerKey.includes('recid');
  });
  
  for (const key of userRelatedKeys) {
    try {
      const value = window[key];
      if (value && typeof value === 'object') {
        findings.windowObjects.push({ key, value });
        
        // Deep inspection
        if (value.RecId || value.recId || value.DisplayName || value.LoginId) {
          // Only log if we find actual user data
        }
      }
    } catch (e) {
      // Skip inaccessible properties
    }
  }

  // ===== 2. SCAN LOCALSTORAGE & SESSIONSTORAGE =====
  // LocalStorage
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    const value = localStorage.getItem(key);
    
    try {
      const parsed = JSON.parse(value);
      if (parsed && (parsed.RecId || parsed.recId || parsed.user || parsed.profile)) {
        findings.storage.push({ location: 'localStorage', key, value: parsed });
      }
    } catch (e) {
      // Not JSON
    }
  }
  
  // SessionStorage
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    const value = sessionStorage.getItem(key);
    
    try {
      const parsed = JSON.parse(value);
      if (parsed && (parsed.RecId || parsed.recId || parsed.user || parsed.profile)) {
        findings.storage.push({ location: 'sessionStorage', key, value: parsed });
      }
    } catch (e) {
      // Not JSON
    }
  }

  // ===== 3. PARSE ALL COOKIES =====
  const cookies = document.cookie.split(';');
  
  for (const cookie of cookies) {
    const [name, ...valueParts] = cookie.split('=');
    const value = valueParts.join('=').trim();
    const trimmedName = name.trim();
    
    if (trimmedName.includes('User') || trimmedName.includes('Session') || trimmedName.includes('Auth')) {
      // Special handling for UserSettings cookie
      if (trimmedName === 'UserSettings') {
        try {
          const params = new URLSearchParams(value);
          const paramsObj = {};
          params.forEach((v, k) => {
            paramsObj[k] = v;
            // Try to decode Base64 values
            try {
              const decoded = atob(v);
              paramsObj[k + '_decoded'] = decoded;
            } catch (e) {}
          });
          findings.cookies.push({ name: trimmedName, params: paramsObj });
        } catch (e) {
          // Failed to parse
        }
      }
      
      // Try to decode if it looks like Base64
      else if (value && value.length > 20) {
        try {
          const decoded = atob(value);
          findings.cookies.push({ name: trimmedName, decoded });
        } catch (e) {
          // Not Base64
        }
      }
    }
  }

  // ===== 4. SCAN DOM FOR DATA ATTRIBUTES =====
  const elementsWithData = document.querySelectorAll('[data-user], [data-recid], [data-profile], [data-employee]');
  
  elementsWithData.forEach(el => {
    const data = {};
    for (const attr of el.attributes) {
      if (attr.name.startsWith('data-')) {
        data[attr.name] = attr.value;
      }
    }
    findings.domData.push(data);
  });

  // ===== 5. CHECK FOR REACT/ANGULAR STATE =====
  // React DevTools
  if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
    findings.frameworks.push('React');
  }
  
  // Angular
  if (window.ng || window.angular) {
    findings.frameworks.push('Angular');
    
    // Try to get Angular scope
    const ngElements = document.querySelectorAll('[ng-app], [data-ng-app]');
    if (ngElements.length > 0) {
      try {
        const scope = angular.element(ngElements[0]).scope();
        if (scope && scope.user) {
          findings.frameworks.push({ type: 'Angular', user: scope.user });
        }
      } catch (e) {}
    }
  }
  
  // Check for common state management
  if (window.__REDUX_DEVTOOLS_EXTENSION__) {
    findings.frameworks.push('Redux');
  }

  // ===== 6. INTERCEPT XHR/FETCH REQUESTS =====
  const originalFetch = window.fetch;
  window.fetch = function(...args) {
    return originalFetch.apply(this, arguments).then(response => {
      // Clone response to read it
      const clone = response.clone();
      clone.json().then(data => {
        if (data && (data.RecId || data.recId || data.user || data.profile)) {
          findings.networkCalls.push({ url: args[0], data });
        }
      }).catch(() => {});
      return response;
    });
  };

  // ===== 7. CHECK ASP.NET VIEWSTATE =====
  const viewState = document.getElementById('__VIEWSTATE');
  if (viewState) {
    findings.domData.push({ type: 'ViewState', value: viewState.value });
  }

  // ===== 8. SCAN FOR INLINE SCRIPT VARIABLES =====
  const scripts = document.querySelectorAll('script:not([src])');
  
  for (const script of scripts) {
    const content = script.textContent;
    // Look for variable assignments
    if (content.includes('RecId') || content.includes('user') || content.includes('profile')) {
      // Found potential user data in script
    }
  }

  // Don't post message - we're not using the findings anymore
  // This prevents DataCloneError from trying to clone Storage objects
  
})();

