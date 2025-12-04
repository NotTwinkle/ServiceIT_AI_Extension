/**
 * User Identity Service
 * 
 * Responsible for identifying the currently logged-in Ivanti user.
 * Uses multiple strategies with fallback mechanisms.
 */

import { IVANTI_CONFIG } from '../config';
import { mapRolesToCapabilities, RoleCapabilities } from './rolesService';

export interface IvantiUser {
  recId: string;
  loginId: string;
  fullName: string;
  email?: string;
  team?: string;
  department?: string;
  roles?: string[];
  teams?: string[];
  capabilities?: RoleCapabilities; // Role-based capabilities
}

/**
 * Strategy 1: Get user via Standard REST API endpoints (with API Key)
 */
async function getCurrentUserFromAPI(tabId: number): Promise<IvantiUser | null> {
  try {
    console.log('[UserIdentity] Attempting to get current user from API...');
    console.log('[UserIdentity] Using API Key:', IVANTI_CONFIG.apiKey ? 'Present' : 'Missing');
    
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (baseUrl: string, apiKey: string) => {
        try {
          // Ivanti Neurons 2025.3 uses Authorization header
          const headers: Record<string, string> = {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          };
          
          // CORRECT FORMAT: Authorization: rest_api_key={Reference ID}
          if (apiKey) {
            headers['Authorization'] = `rest_api_key=${apiKey}`;
          }
          
          const opts: RequestInit = { 
            method: 'GET', 
            credentials: 'include' as RequestCredentials, 
            headers 
          };

          // List of endpoints to try (Ivanti Neurons 2025.3 - CORRECTED with /HEAT/ prefix)
          const endpoints = [
            '/HEAT/api/v1/User/current',        // Standard Ivanti API v1 (OFFICIAL)
            '/HEAT/api/v1/user/current',        // Lowercase variant
            '/HEAT/api/rest/Session/User',      // Legacy HEAT
            '/HEAT/api/user/me',                // Alternative
            '/HEAT/api/core/users/current',     // Core API
            '/HEAT/api/v1/session/user'         // Session endpoint
          ];

          for (const ep of endpoints) {
            try {
              const url = `${baseUrl}${ep}`;
              console.log(`[UserIdentity] Trying: ${url} with Authorization header`);
              
              const res = await fetch(url, opts);
              console.log(`[UserIdentity] ${ep} → Status: ${res.status}`);
              
              if (res.ok) {
                const data = await res.json();
                console.log(`[UserIdentity] ✅ SUCCESS! Data:`, data);
                return { success: true, user: data, source: ep };
              } else if (res.status === 401 || res.status === 403) {
                console.log(`[UserIdentity] ${ep} → Authentication failed (${res.status})`);
              }
            } catch (e) { 
              console.log(`[UserIdentity] ${ep} → Error:`, e);
              /* ignore 404/error and continue */ 
            }
          }
          
          return { success: false, error: 'All endpoints failed' };
        } catch (e: any) {
          return { success: false, error: e.message };
        }
      },
      args: [IVANTI_CONFIG.baseUrl, IVANTI_CONFIG.apiKey || '']
    });

    if (result && result[0]?.result?.success) {
      const userData = result[0].result.user;
      console.log(`[UserIdentity] ✅ Found user via ${result[0].result.source}:`, userData);
      return normalizeUser(userData);
    }

    console.log('[UserIdentity] ❌ API strategy failed');
    return null;
  } catch (error) {
    console.error('[UserIdentity] Error calling API:', error);
    return null;
  }
}

/**
 * Strategy 2: Get user via OData Query (The "Self-ID" Trick)
 * Tries to fetch "My" profile using OData which often exposes a filtered view
 */
async function getCurrentUserFromOData(tabId: number): Promise<IvantiUser | null> {
  try {
    console.log('[UserIdentity] Attempting OData self-identification...');
    
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (baseUrl: string) => {
        try {
          // Attempt 1: Fetch Employee matching the current session email (if we can guess it? No.)
          // Attempt 2: Just fetch 1 Employee. In some locked-down systems, you can only see YOURSELF.
          // Or fetch a "Session" business object if it exists.
          
          // Let's try to fetch 10 employees. If we are logged in, we should at least get a list.
          // Then we might match via the "Owner" field if it exists? No.
          
          // Better: Check for "QuickActions" or "Layouts" for "CurrentUser"
          // API: /api/odata/businessobject/Employee?$top=1&$select=RecId,LoginId,DisplayName,PrimaryEmail
          
          const response = await fetch(
            `${baseUrl}/HEAT/api/odata/businessobject/employees?$top=5&$select=RecId,LoginID,DisplayName,PrimaryEmail,Status`,
            {
              method: 'GET',
              credentials: 'include' as RequestCredentials,
              headers: { 'Accept': 'application/json' }
            }
          );

          if (response.ok) {
            const data = await response.json();
            // We got data. But which one is the CURRENT user?
            // Without a "me" endpoint, we can't be 100% sure unless the API returns ONLY the current user due to permissions.
            return { success: true, candidates: data.value || [] };
          }
          return { success: false };
        } catch (e: any) {
          return { success: false, error: e.message };
        }
      },
      args: [IVANTI_CONFIG.baseUrl]
    });

    if (result && result[0]?.result?.success) {
      // We found some employees. This doesn't identify the CURRENT user, but confirms API access.
      // We can't use this to identify the user unless we have a matching criterion (like name from DOM).
      console.log(`[UserIdentity] OData is accessible, found ${result[0].result.candidates.length} employees.`);
    }

    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Strategy 3: Search for user by display name (fallback)
 * Used when API method fails and we only have the display name from DOM
 */
async function findUserByName(displayName: string, tabId: number): Promise<IvantiUser | null> {
  try {
    console.log(`[UserIdentity] Searching for user by name: "${displayName}"`);
    
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (baseUrl: string, name: string, apiKey: string) => {
        try {
          // Build headers with correct Authorization format
          const headers: Record<string, string> = { 'Accept': 'application/json' };
          
          // CORRECT FORMAT: Authorization: rest_api_key={Reference ID}
          if (apiKey) {
            headers['Authorization'] = `rest_api_key=${apiKey}`;
          }
          
          // Search using OData filter on Employee
          const filter = encodeURIComponent(`DisplayName eq '${name}' or FullName eq '${name}'`);
          const url = `${baseUrl}/api/odata/businessobject/Employee?$filter=${filter}&$select=RecId,LoginId,DisplayName,FullName,PrimaryEmail,Status,Team,Department,OrganizationalUnit`;
          
          console.log(`[UserIdentity] OData query: ${url} with Authorization header`);
          
          const response = await fetch(url, {
            method: 'GET',
            credentials: 'include' as RequestCredentials,
            headers
          });

          console.log(`[UserIdentity] OData response status: ${response.status}`);

          if (response.ok) {
            const data = await response.json();
            console.log(`[UserIdentity] OData found ${data.value?.length || 0} users`);
            return { success: true, users: data.value || [] };
          }
          return { success: false, error: `HTTP ${response.status}` };
        } catch (e: any) {
          console.error('[UserIdentity] OData error:', e);
          return { success: false, error: e.message };
        }
      },
      args: [IVANTI_CONFIG.baseUrl, displayName, IVANTI_CONFIG.apiKey || '']
    });

    if (result && result[0]?.result?.success) {
      const users = result[0].result.users;
      if (users.length === 0) {
        console.log('[UserIdentity] No users found matching name');
        return null;
      }

      console.log(`[UserIdentity] Found ${users.length} matching users`);
      
      // Filter for Active users
      const activeUser = users.find((u: any) => u.Status === 'Active') || users[0];
      console.log('[UserIdentity] ✅ Selected user:', activeUser);
      return normalizeUser(activeUser);
    }
    
    console.log('[UserIdentity] ❌ Name search failed');
    return null;
  } catch (error) {
    console.error('[UserIdentity] Error in findUserByName:', error);
    return null;
  }
}

function normalizeUser(raw: any): IvantiUser {
  const roles = raw.Roles || raw.roles || [];
  const user: IvantiUser = {
    recId: raw.RecId || raw.recId || raw.id || raw.UserId,
    loginId: raw.LoginID || raw.LoginId || raw.loginId || raw.username || raw.UserName,
    fullName: raw.DisplayName || raw.FullName || raw.fullName || raw.displayName,
    email: raw.PrimaryEmail || raw.Email || raw.email || raw.mail,
    team: raw.Team || raw.team,
    department: raw.Department || raw.department,
    roles: roles,
    teams: raw.Teams || raw.teams || []
  };
  
  // Map roles to capabilities
  if (roles.length > 0) {
    user.capabilities = mapRolesToCapabilities(roles);
    console.log('[UserIdentity] ✅ Mapped role capabilities:', user.capabilities);
  }
  
  return user;
}

/**
 * Strategy 4: Parse UserSettings Cookie (PLAN B - Most Reliable)
 * Ivanti stores user data in the UserSettings cookie in Base64 format
 * Also extract role from sessionStorage
 */
async function getCurrentUserFromCookie(tabId: number): Promise<IvantiUser | null> {
  try {
    console.log('[UserIdentity] 🍪 Attempting to parse UserSettings cookie and sessionStorage...');
    
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        try {
          let loginId = null;
          let roleFromCookie = null;
          
          // Get all cookies
          const cookies = document.cookie.split(';');
          console.log('[UserIdentity] Found cookies:', cookies.length);
          
          // Find UserSettings cookie
          for (const cookie of cookies) {
            const trimmed = cookie.trim();
            if (trimmed.startsWith('UserSettings=')) {
              const value = trimmed.substring('UserSettings='.length);
              console.log('[UserIdentity] 🎯 Found UserSettings cookie:', value.substring(0, 100) + '...');
              
              // Parse the cookie value
              // Format: User=<base64>&Role=<base64>&ReSA=<base64>&SID=<value>&TC=<value>...
              const params = new URLSearchParams(value);
              
              // Decode User parameter (Base64 encoded)
              const userEncoded = params.get('User');
              if (userEncoded) {
                try {
                  // Decode Base64
                  loginId = atob(userEncoded);
                  console.log('[UserIdentity] ✅ Decoded User data:', loginId);
                } catch (e) {
                  console.error('[UserIdentity] Failed to decode User parameter:', e);
                }
              }
              
              // Decode Role parameter (Base64 encoded)
              const roleEncoded = params.get('Role');
              if (roleEncoded) {
                try {
                  roleFromCookie = atob(roleEncoded);
                  console.log('[UserIdentity] ✅ Decoded Role data:', roleFromCookie);
                } catch (e) {
                  console.error('[UserIdentity] Failed to decode Role parameter:', e);
                }
              }
              
              break;
            }
          }
          
          // Get role from sessionStorage (more reliable in Ivanti Neurons)
          let roleFromStorage = null;
          try {
            const currentTabRole = sessionStorage.getItem('currentTabRole');
            if (currentTabRole) {
              roleFromStorage = currentTabRole;
              console.log('[UserIdentity] ✅ Found role in sessionStorage:', roleFromStorage);
            }
          } catch (e) {
            console.log('[UserIdentity] Could not access sessionStorage');
          }
          
          if (loginId) {
            return {
              success: true,
              loginId: loginId,
              role: roleFromStorage || roleFromCookie,
              source: 'UserSettings cookie + sessionStorage'
            };
          }
          
          return { success: false, error: 'Could not extract user data' };
        } catch (e: any) {
          return { success: false, error: e.message };
        }
      },
      args: []
    });

    if (result && result[0]?.result?.success) {
      const data = result[0].result;
      console.log('[UserIdentity] ✅ Cookie data extracted:', data);
      
      // If we have loginId, use it to search for the full user record
      if (data.loginId) {
        console.log('[UserIdentity] 🔍 Searching for user by loginId:', data.loginId);
        const userFromSearch = await findUserByLoginId(data.loginId, tabId);
        
        // If we found the user via API, add the role from cookie/sessionStorage
        if (userFromSearch) {
          if (data.role) {
            userFromSearch.roles = [data.role];
            console.log('[UserIdentity] ✅ Added role to user:', data.role);
            // Map roles to capabilities
            userFromSearch.capabilities = mapRolesToCapabilities([data.role]);
          }
          return userFromSearch;
        }
        
        // If OData search fails, extract name from email and return basic user info
        // Extract display name from email (e.g., "michael.monteza@..." → "Michael Monteza")
        let displayName = data.loginId;
        if (data.loginId.includes('@')) {
          // Extract the part before @
          const username = data.loginId.split('@')[0];
          // Convert "michael.monteza" → "Michael Monteza"
          displayName = username
            .split('.')
            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ');
        }
        
        console.log('[UserIdentity] ✅ Using cookie data with formatted name:', displayName);
        
        // Return user info (RecId will be populated by brute-force scanner if found)
        return {
          recId: '', // Will be populated by brute-force scanner
          loginId: data.loginId,
          fullName: displayName,
          email: data.loginId,
          roles: data.role ? [data.role] : [],
          source: data.source
        } as IvantiUser;
      }
    }
    
    console.log('[UserIdentity] ❌ Cookie parsing failed');
    return null;
  } catch (error) {
    console.error('[UserIdentity] Error parsing cookie:', error);
    return null;
  }
}

/**
 * Search for user by LoginId (email/username)
 */
async function findUserByLoginId(loginId: string, tabId: number): Promise<IvantiUser | null> {
  try {
    console.log(`[UserIdentity] Searching for user by loginId: "${loginId}"`);
    
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (baseUrl: string, loginId: string, apiKey: string) => {
        try {
          const headers: Record<string, string> = { 'Accept': 'application/json' };
          
          if (apiKey) {
            headers['Authorization'] = `rest_api_key=${apiKey}`;
          }
          
          // Search using OData filter on employees by LoginID (CONFIRMED WORKING)
          const filter = encodeURIComponent(`LoginID eq '${loginId}'`);
          const url = `${baseUrl}/HEAT/api/odata/businessobject/employees?$filter=${filter}&$select=RecId,LoginID,DisplayName,FirstName,LastName,PrimaryEmail,Status,Team,Department,OrganizationalUnit`;
          
          console.log(`[UserIdentity] OData LoginId query: ${url}`);
          
          const response = await fetch(url, {
            method: 'GET',
            credentials: 'include' as RequestCredentials,
            headers
          });

          console.log(`[UserIdentity] OData LoginId response status: ${response.status}`);

          if (response.ok) {
            const data = await response.json();
            console.log(`[UserIdentity] OData found ${data.value?.length || 0} users`);
            return { success: true, users: data.value || [] };
          }
          return { success: false, error: `HTTP ${response.status}` };
        } catch (e: any) {
          console.error('[UserIdentity] OData LoginId error:', e);
          return { success: false, error: e.message };
        }
      },
      args: [IVANTI_CONFIG.baseUrl, loginId, IVANTI_CONFIG.apiKey || '']
    });

    if (result && result[0]?.result?.success) {
      const users = result[0].result.users;
      if (users.length > 0) {
        const activeUser = users.find((u: any) => u.Status === 'Active') || users[0];
        console.log('[UserIdentity] ✅ Found user by LoginId:', activeUser);
        return normalizeUser(activeUser);
      }
    }
    
    return null;
  } catch (error) {
    console.error('[UserIdentity] Error in findUserByLoginId:', error);
    return null;
  }
}

/**
 * Main function: Get the current Ivanti user
 */
export async function getCurrentUser(
  tabId: number,
  fallbackDisplayName?: string
): Promise<IvantiUser | null> {
  console.log('[UserIdentity] Starting user identification...');

  // PLAN B FIRST: Parse UserSettings Cookie (Most Reliable for Ivanti Neurons 2025.3)
  console.log('[UserIdentity] 🍪 PLAN B: Trying cookie parsing first...');
  const userFromCookie = await getCurrentUserFromCookie(tabId);
  if (userFromCookie) {
    console.log('[UserIdentity] ✅ SUCCESS via cookie parsing!');
    return userFromCookie;
  }

  // 1. Try Standard API (likely to fail on Neurons 2025.3)
  console.log('[UserIdentity] Trying API endpoints...');
  const userFromAPI = await getCurrentUserFromAPI(tabId);
  if (userFromAPI) return userFromAPI;

  // 2. Try Name Search (if provided)
  if (fallbackDisplayName) {
    console.log('[UserIdentity] API failed, trying name search...');
    const userFromName = await findUserByName(fallbackDisplayName, tabId);
    if (userFromName) return userFromName;
  }

  // 3. Last Resort: Try OData
  const userFromOData = await getCurrentUserFromOData(tabId);
  if (userFromOData) return userFromOData;
  
  console.error('[UserIdentity] ❌ Failed to identify user via all methods');
  return null;
}
