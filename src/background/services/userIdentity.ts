/**
 * User Identity Service
 * 
 * Responsible for identifying the currently logged-in Ivanti user.
 * Uses multiple strategies with fallback mechanisms.
 */

import { IVANTI_CONFIG } from '../config';
import { mapRolesToCapabilities, RoleCapabilities, fetchRoles } from './rolesService';

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
 * Map RoleID to DisplayName using the roles from knowledge base
 * This ensures we always show user-friendly DisplayNames instead of technical RoleIDs
 */
async function mapRoleIdToDisplayName(roleIdOrDisplayName: string): Promise<string> {
  try {
    // Try to load roles from knowledge base (cached)
    const { loadKnowledgeBase } = await import('./knowledgeBaseService');
    const kb = await loadKnowledgeBase();
    
    if (kb && kb.roles && kb.roles.length > 0) {
      // First, check if it's already a DisplayName (exact match)
      const exactMatch = kb.roles.find(r => 
        r.DisplayName === roleIdOrDisplayName || 
        (r as any).Name === roleIdOrDisplayName
      );
      if (exactMatch) {
        return exactMatch.DisplayName || (exactMatch as any).Name || roleIdOrDisplayName;
      }
      
      // Then, check if it's a RoleID (match by RoleID field)
      const roleIdMatch = kb.roles.find(r => 
        (r as any).RoleID === roleIdOrDisplayName ||
        (r as any).RoleId === roleIdOrDisplayName ||
        (r as any).roleId === roleIdOrDisplayName
      );
      if (roleIdMatch) {
        return roleIdMatch.DisplayName || (roleIdMatch as any).Name || roleIdOrDisplayName;
      }
      
      // Also check DesktopName (sometimes used as identifier)
      const desktopMatch = kb.roles.find(r => 
        (r as any).DesktopName === roleIdOrDisplayName
      );
      if (desktopMatch) {
        return desktopMatch.DisplayName || (desktopMatch as any).Name || roleIdOrDisplayName;
      }
    }
    
    // Fallback: Try fetching roles directly if not in KB
    const roles = await fetchRoles();
    if (roles && roles.length > 0) {
      const match = roles.find(r => 
        r.DisplayName === roleIdOrDisplayName ||
        (r as any).RoleID === roleIdOrDisplayName ||
        (r as any).DesktopName === roleIdOrDisplayName
      );
      if (match) {
        return match.DisplayName || (match as any).Name || roleIdOrDisplayName;
      }
    }
    
    // If no match found, return as-is (might already be DisplayName)
    return roleIdOrDisplayName;
  } catch (error) {
    console.warn('[UserIdentity] Could not map role to DisplayName:', error);
    return roleIdOrDisplayName;
  }
}

/**
 * Normalize an array of roles to DisplayNames
 */
async function normalizeRolesToDisplayNames(roles: string[]): Promise<string[]> {
  if (!roles || roles.length === 0) return [];
  
  const normalized = await Promise.all(roles.map(role => mapRoleIdToDisplayName(role)));
  return [...new Set(normalized.filter(Boolean))];
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
      return await normalizeUser(userData);
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
      return await normalizeUser(activeUser);
    }
    
    console.log('[UserIdentity] ❌ Name search failed');
    return null;
  } catch (error) {
    console.error('[UserIdentity] Error in findUserByName:', error);
    return null;
  }
}

async function normalizeUser(raw: any): Promise<IvantiUser> {
  // Extract roles - handle both array and object formats
  let roles: string[] = [];
  
  if (Array.isArray(raw.Roles)) {
    // If Roles is an array of objects, extract DisplayName or Name
    roles = raw.Roles.map((r: any) => 
      typeof r === 'string' ? r : (r.DisplayName || r.Name || r.Role || '')
    ).filter(Boolean);
  } else if (raw.Roles) {
    // Single role object
    roles = [raw.Roles.DisplayName || raw.Roles.Name || raw.Roles.Role || ''].filter(Boolean);
  } else if (raw.roles) {
    // Lowercase variant
    roles = Array.isArray(raw.roles) ? raw.roles : [raw.roles];
  } else if (raw.Role) {
    // Single role string
    roles = [raw.Role];
  }
  
  // Remove duplicates and normalize
  roles = [...new Set(roles.map(r => r.trim()).filter(Boolean))];
  
  // Normalize roles to DisplayNames (map RoleID to DisplayName)
  const normalizedRoles = await normalizeRolesToDisplayNames(roles);
  
  const user: IvantiUser = {
    recId: raw.RecId || raw.recId || raw.id || raw.UserId,
    loginId: raw.LoginID || raw.LoginId || raw.loginId || raw.username || raw.UserName,
    fullName: raw.DisplayName || raw.FullName || raw.fullName || raw.displayName,
    email: raw.PrimaryEmail || raw.Email || raw.email || raw.mail,
    team: raw.Team || raw.team,
    department: raw.Department || raw.department,
    roles: normalizedRoles.length > 0 ? normalizedRoles : roles, // Use DisplayNames if available
    teams: raw.Teams || raw.teams || []
  };
  
  // Map roles to capabilities (handles multiple roles - uses most permissive)
  // Use original roles for capability mapping (RoleID might be needed for matching)
  if (roles.length > 0) {
    user.capabilities = mapRolesToCapabilities(roles);
    console.log('[UserIdentity] ✅ User roles (DisplayNames):', user.roles);
    console.log('[UserIdentity] ✅ Mapped role capabilities:', user.capabilities);
  } else {
    console.warn('[UserIdentity] ⚠️ No roles found for user');
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
          // Try multiple sessionStorage keys
          let roleFromStorage = null;
          let roleFromUI = null;
          try {
            // Check for role from UI scraping (most reliable - shows what user sees)
            roleFromUI = sessionStorage.getItem('currentActiveRoleFromUI');
            // Check for currentActiveRole (set by inject.js from window.Session.CurrentRole)
            roleFromStorage = sessionStorage.getItem('currentActiveRole') || 
                             sessionStorage.getItem('currentTabRole') ||
                             sessionStorage.getItem('userRole');
            
            console.log('[UserIdentity] 🔍 Role detection from storage:');
            console.log('[UserIdentity]   - Role from UI:', roleFromUI);
            console.log('[UserIdentity]   - Role from session:', roleFromStorage);
            console.log('[UserIdentity]   - Role from cookie:', roleFromCookie);
            
            // CRITICAL FIX: Priority order should be:
            // 1. UI-scraped role (what user actually sees in UI)
            // 2. Cookie role (from UserSettings - actual active role)
            // 3. SessionStorage role (might be stale/wrong)
            
            let finalRole = null;
            let source = '';
            
            if (roleFromUI) {
              finalRole = roleFromUI;
              source = 'UI scrape';
              console.log('[UserIdentity] ✅ Using role from UI scraping (most reliable):', finalRole);
            } else if (roleFromCookie) {
              finalRole = roleFromCookie;
              source = 'cookie';
              console.log('[UserIdentity] ✅ Using role from cookie (active role):', finalRole);
            } else if (roleFromStorage) {
              finalRole = roleFromStorage;
              source = 'sessionStorage';
              console.log('[UserIdentity] ⚠️ Using role from sessionStorage (fallback, might be wrong):', finalRole);
            } else {
              console.warn('[UserIdentity] ⚠️ No role found in any storage');
            }
            
            if (loginId) {
              console.log('[UserIdentity] 📋 Final role selected:', finalRole);
              
              return {
                success: true,
                loginId: loginId,
                role: finalRole,
                source: source
              };
            }
          } catch (e) {
            console.log('[UserIdentity] Could not access sessionStorage');
          }
          
          if (loginId) {
            // Fallback if try-catch failed
            const finalRole = roleFromUI || roleFromCookie || roleFromStorage;
            console.log('[UserIdentity] 📋 Final role selected (fallback):', finalRole);
            
            return {
              success: true,
              loginId: loginId,
              role: finalRole,
              source: roleFromUI ? 'UI scrape' : (roleFromCookie ? 'cookie' : 'sessionStorage')
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
      
      // Normalize the cookie role to DisplayName (cookie roles are usually RoleIDs like "SelfService")
      let normalizedCookieRole: string | null = null;
      if (data.role) {
        normalizedCookieRole = await mapRoleIdToDisplayName(data.role);
        console.log('[UserIdentity] ✅ Normalized cookie role from RoleID to DisplayName:');
        console.log('[UserIdentity]   - Original (RoleID from cookie):', data.role);
        console.log('[UserIdentity]   - Normalized (DisplayName):', normalizedCookieRole);
      }
      
      // If we have loginId, use it to search for the full user record
      if (data.loginId) {
        console.log('[UserIdentity] 🔍 Searching for user by loginId:', data.loginId);
        const userFromSearch = await findUserByLoginId(data.loginId, tabId);
        
        // If we found the user via API, we need to get their ACTUAL assigned role
        if (userFromSearch) {
          console.log('[UserIdentity] 🔍 Cookie role (original RoleID):', data.role);
          console.log('[UserIdentity] 🔍 Cookie role (normalized DisplayName):', normalizedCookieRole);
          console.log('[UserIdentity] 🔍 OData roles (might be incomplete):', userFromSearch.roles);
          
          // CRITICAL: Fetch the ACTUAL assigned roles from the database
          // This is the MOST RELIABLE method - queries frs_def_roleassignments table
          let actualRoles: string[] = [];
          
          console.log('[UserIdentity] 🎯 Fetching ACTUAL assigned roles from database...');
          actualRoles = await fetchUserRoles(userFromSearch.recId, tabId);
          
          if (actualRoles && actualRoles.length > 0) {
            console.log('[UserIdentity] ✅ Got ACTUAL assigned roles from database:', actualRoles);
            
            // Normalize roles to DisplayNames (they should already be DisplayNames from fetchUserRoles, but ensure it)
            const normalizedRoles = await normalizeRolesToDisplayNames(actualRoles);
            console.log('[UserIdentity] ✅ Normalized roles to DisplayNames:', normalizedRoles);
            
            // Use the first role (or if multiple, pick based on priority)
            const activeRole = normalizedRoles[0] || actualRoles[0];
            console.log('[UserIdentity] ✅ Using role:', activeRole);
            
            // Set the role and map capabilities (use original for capability mapping, DisplayName for display)
            userFromSearch.roles = normalizedRoles.length > 0 ? normalizedRoles : [activeRole];
            userFromSearch.capabilities = mapRolesToCapabilities(actualRoles); // Use original for mapping
            console.log('[UserIdentity] ✅ Capabilities:', userFromSearch.capabilities);
            
            return userFromSearch;
          }
          
          // FALLBACK: Try UI-scraped role or session role
          console.warn('[UserIdentity] ⚠️ Could not fetch roles from database, trying fallback...');
          let fallbackRole: string | null = null;
          let fallbackRoleOriginal: string | null = null; // Keep original for capability mapping
          
          // Try UI scraped role (from sessionStorage)
          const roleFromUI = (await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
              try {
                return sessionStorage.getItem('currentActiveRoleFromUI');
              } catch { return null; }
            }
          }))[0]?.result;
          
          if (roleFromUI) {
            fallbackRoleOriginal = roleFromUI;
            console.log('[UserIdentity] ✅ Using UI-scraped role (fallback):', fallbackRoleOriginal);
          } else if (normalizedCookieRole) {
            // Use the already-normalized cookie role (DisplayName)
            fallbackRole = normalizedCookieRole;
            fallbackRoleOriginal = data.role; // Keep original RoleID for capability mapping
            console.log('[UserIdentity] ✅ Using normalized cookie role (fallback):', fallbackRole);
          } else if (data.role) {
            fallbackRoleOriginal = data.role;
            console.log('[UserIdentity] ✅ Using session/cookie role (fallback, will normalize):', fallbackRoleOriginal);
          }
          
          // CRITICAL: If no role found, this is a security issue
          if (!fallbackRoleOriginal && !fallbackRole) {
            console.error('[UserIdentity] 🚨 CRITICAL: No role found for user!');
            console.error('[UserIdentity] User data:', userFromSearch);
            // Return null to trigger security block
            return null;
          }
          
          // Normalize fallback role to DisplayName if not already normalized
          // (cookie roles are already normalized above, but UI-scraped roles might need normalization)
          if (!fallbackRole && fallbackRoleOriginal) {
            fallbackRole = await mapRoleIdToDisplayName(fallbackRoleOriginal);
            console.log('[UserIdentity] ✅ Normalized fallback role from RoleID to DisplayName:');
            console.log('[UserIdentity]   - Original (RoleID):', fallbackRoleOriginal);
            console.log('[UserIdentity]   - Normalized (DisplayName):', fallbackRole);
          } else if (fallbackRole) {
            console.log('[UserIdentity] ✅ Using already-normalized role (DisplayName):', fallbackRole);
          }
          
          // Ensure we have a valid role before proceeding
          if (!fallbackRole || !fallbackRoleOriginal) {
            console.error('[UserIdentity] 🚨 CRITICAL: No valid role found after normalization!');
            console.error('[UserIdentity] User data:', userFromSearch);
            return null;
          }
          
          // Set the fallback role and map capabilities
          userFromSearch.roles = [fallbackRole];
          userFromSearch.capabilities = mapRolesToCapabilities([fallbackRoleOriginal]); // Use original RoleID for mapping
          console.log('[UserIdentity] ⚠️ Final role (fallback):', fallbackRole);
          console.log('[UserIdentity] ✅ Capabilities:', userFromSearch.capabilities);
          
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
          // Try to expand roles if the relationship exists
          const filter = encodeURIComponent(`LoginID eq '${loginId}'`);
          // First try with role expansion
          let url = `${baseUrl}/HEAT/api/odata/businessobject/employees?$filter=${filter}&$select=RecId,LoginID,DisplayName,FirstName,LastName,PrimaryEmail,Status,Team,Department,OrganizationalUnit&$expand=Roles`;
          
          console.log(`[UserIdentity] OData LoginId query (with expand): ${url}`);
          
          const response = await fetch(url, {
            method: 'GET',
            credentials: 'include' as RequestCredentials,
            headers
          });

          console.log(`[UserIdentity] OData LoginId response status: ${response.status}`);

          if (response.ok) {
            const data = await response.json();
            console.log(`[UserIdentity] OData found ${data.value?.length || 0} users`);
            const users = data.value || [];
            
            // Check if roles were included in the response
            const rolesIncluded = users.length > 0 && (users[0].Roles || users[0].roles);
            
            return { success: true, users: users, rolesIncluded: !!rolesIncluded };
          }
          
          // If expand failed, try without expand and fetch roles separately
          console.log(`[UserIdentity] Expand failed, trying without expand...`);
          const urlNoExpand = `${baseUrl}/HEAT/api/odata/businessobject/employees?$filter=${filter}&$select=RecId,LoginID,DisplayName,FirstName,LastName,PrimaryEmail,Status,Team,Department,OrganizationalUnit`;
          const response2 = await fetch(urlNoExpand, {
            method: 'GET',
            credentials: 'include' as RequestCredentials,
            headers
          });
          
          if (response2.ok) {
            const data2 = await response2.json();
            console.log(`[UserIdentity] OData found ${data2.value?.length || 0} users (no expand)`);
            return { success: true, users: data2.value || [], rolesIncluded: false };
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
        
        // If roles weren't included in the response, fetch them separately
        let userWithRoles = activeUser;
        const rolesIncluded = (result[0].result as any).rolesIncluded;
        if (!rolesIncluded || !activeUser.Roles || (Array.isArray(activeUser.Roles) && activeUser.Roles.length === 0)) {
          console.log('[UserIdentity] 🔍 Roles not included, fetching separately...');
          const roles = await fetchUserRoles(activeUser.RecId, tabId);
          if (roles && roles.length > 0) {
            userWithRoles = { ...activeUser, Roles: roles };
            console.log('[UserIdentity] ✅ Fetched roles:', roles);
          }
        }
        
        return await normalizeUser(userWithRoles);
      }
    }
    
    return null;
  } catch (error) {
    console.error('[UserIdentity] Error in findUserByLoginId:', error);
    return null;
  }
}

/**
 * Fetch user's actual assigned roles from Ivanti
 * This queries the role assignments table to get the TRUE assigned roles
 * CRITICAL: This is the MOST RELIABLE way to get roles (not from session/cookie)
 */
async function fetchUserRoles(employeeRecId: string, tabId: number): Promise<string[]> {
  try {
    console.log(`[UserIdentity] 🔍 Fetching ACTUAL assigned roles for employee: ${employeeRecId}`);
    
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (baseUrl: string, recId: string) => {
        try {
          const headers: Record<string, string> = { 
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          };
          
          // CRITICAL: Query the role assignments table directly
          // Try multiple approaches based on Ivanti OData best practices
          const approaches = [
            // Approach 1: Use $expand to get role details directly (most efficient)
            `${baseUrl}/HEAT/api/odata/businessobject/frs_def_roleassignments?$filter=EmployeeLink eq '${recId}'&$expand=RoleLink&$select=RoleLink`,
            // Approach 2: Try with different field names
            `${baseUrl}/HEAT/api/odata/businessobject/frs_def_roleassignments?$filter=Employee_RecID eq '${recId}'&$expand=RoleLink`,
            // Approach 3: Try without expand, get RoleLink and fetch separately
            `${baseUrl}/HEAT/api/odata/businessobject/frs_def_roleassignments?$filter=EmployeeLink eq '${recId}'&$select=RoleLink`,
          ];
          
          let roleLinks: string[] = [];
          
          for (const url of approaches) {
            try {
              console.log(`[UserIdentity] 🎯 Trying role assignments query: ${url}`);
              const response = await fetch(url, {
                method: 'GET',
                credentials: 'include',
                headers
              });
              
              if (response.ok) {
                const data = await response.json();
                console.log(`[UserIdentity] ✅ Role query response:`, data);
                
                // Handle different response formats
                let rolesArray = [];
                
                // Format 1: Direct roles array from employees('recId')/Roles
                if (Array.isArray(data.value)) {
                  rolesArray = data.value;
                } else if (data.value) {
                  rolesArray = [data.value];
                } else if (data.Roles) {
                  rolesArray = Array.isArray(data.Roles) ? data.Roles : [data.Roles];
                } else if (Array.isArray(data)) {
                  rolesArray = data;
                }
                
                // Extract role information
                for (const role of rolesArray) {
                  if (role) {
                    // If it's an object with RecId, extract it
                    if (typeof role === 'object') {
                      if (role.RecId) {
                        roleLinks.push(role.RecId);
                        // If we already have DisplayName, use it
                        if (role.DisplayName) {
                          console.log(`[UserIdentity] 📋 Found role with DisplayName: ${role.DisplayName}`);
                        }
                      } else if (role.RoleLink) {
                        // Handle RoleLink field
                        if (typeof role.RoleLink === 'object' && role.RoleLink.RecId) {
                          roleLinks.push(role.RoleLink.RecId);
                          if (role.RoleLink.DisplayName) {
                            console.log(`[UserIdentity] 📋 Found expanded role: ${role.RoleLink.DisplayName}`);
                          }
                        } else if (typeof role.RoleLink === 'string') {
                          roleLinks.push(role.RoleLink);
                        }
                      }
                    } else if (typeof role === 'string') {
                      roleLinks.push(role);
                    }
                  }
                }
                
                if (roleLinks.length > 0) {
                  console.log(`[UserIdentity] ✅ Found ${roleLinks.length} role assignments:`, roleLinks);
                  break; // Success, exit loop
                } else if (rolesArray.length > 0) {
                  console.log(`[UserIdentity] ⚠️ Found roles array but couldn't extract RecIds:`, rolesArray);
                }
              } else {
                const errorText = await response.text();
                console.log(`[UserIdentity] Approach failed (${response.status}): ${errorText.substring(0, 200)}`);
              }
            } catch (e: any) {
              console.log(`[UserIdentity] Approach error:`, e.message);
              continue;
            }
          }
          
          if (roleLinks.length > 0) {
            // Fetch role definitions to get DisplayNames
            // Try without $top first (some Ivanti versions don't support it)
            const rolesUrls = [
              `${baseUrl}/HEAT/api/odata/businessobject/frs_def_roles?$select=RecId,RoleID,DisplayName`,
              `${baseUrl}/HEAT/api/odata/businessobject/frs_def_roles?$top=100&$select=RecId,RoleID,DisplayName`,
            ];
            
            let rolesData: any = null;
            for (const rolesUrl of rolesUrls) {
              try {
                console.log(`[UserIdentity] 🎯 Fetching role definitions: ${rolesUrl}`);
                const rolesResponse = await fetch(rolesUrl, {
                  method: 'GET',
                  credentials: 'include',
                  headers
                });
                
                if (rolesResponse.ok) {
                  rolesData = await rolesResponse.json();
                  console.log(`[UserIdentity] ✅ Loaded ${rolesData.value?.length || 0} role definitions`);
                  break;
                } else {
                  console.log(`[UserIdentity] Roles query failed (${rolesResponse.status}), trying alternative...`);
                }
              } catch (e) {
                console.log(`[UserIdentity] Roles query error:`, e);
                continue;
              }
            }
            
            if (rolesData && rolesData.value) {
              // Map role RecIds to DisplayNames
              const roleNames: string[] = [];
              for (const roleLink of roleLinks) {
                const roleDefinition = rolesData.value.find((r: any) => r.RecId === roleLink);
                if (roleDefinition) {
                  // Use DisplayName (e.g., "Self Service User" not "SelfService")
                  roleNames.push(roleDefinition.DisplayName || roleDefinition.RoleID);
                  console.log(`[UserIdentity] 📋 Mapped role: ${roleLink} -> ${roleDefinition.DisplayName}`);
                } else {
                  console.warn(`[UserIdentity] ⚠️ Could not find role definition for: ${roleLink}`);
                }
              }
              
              if (roleNames.length > 0) {
                console.log(`[UserIdentity] ✅ Employee's ACTUAL assigned roles:`, roleNames);
                return { success: true, roles: roleNames };
              }
            } else {
              console.warn(`[UserIdentity] ⚠️ Could not fetch role definitions`);
            }
          } else {
            console.warn(`[UserIdentity] ⚠️ No role assignments found for employee`);
          }
          
          return { success: false, error: 'Could not fetch role assignments' };
        } catch (e: any) {
          console.error('[UserIdentity] Error in role fetch:', e);
          return { success: false, error: e.message };
        }
      },
      args: [IVANTI_CONFIG.baseUrl, employeeRecId]
    });
    
    if (result && result[0]?.result?.success) {
      return result[0].result.roles || [];
    }
    
    console.log('[UserIdentity] ⚠️ Could not fetch roles from database');
    return [];
  } catch (error) {
    console.error('[UserIdentity] Error fetching roles:', error);
    return [];
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
