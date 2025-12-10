/**
 * Ivanti Data Service
 * Provides functions for AI to fetch data from Ivanti REST API
 * Now includes intelligent caching for improved performance
 */

import { IVANTI_CONFIG } from '../config';
import { getCachedData, setCachedData } from './cacheService';

export interface IvantiTicket {
  RecId: string;
  IncidentNumber: number | string;
  Subject: string;
  Status: string;
  Priority: string;
  Category: string;
  Service: string;
  CreatedDateTime: string;
  LastModDateTime: string;
  Owner: string;
  ProfileFullName: string;
  Symptom?: string; // This is the actual description field in Ivanti
  Description?: string; // Alias for Symptom
  Resolution?: string;
  Impact?: string;
  Urgency?: string;
  Subcategory?: string;
  Source?: string;
  OwnerTeam?: string;
  Email?: string;
  Phone?: string;
  [key: string]: any; // Allow any other fields from API
}

export interface IvantiEmployee {
  RecId: string;
  LoginID: string;
  DisplayName: string;
  PrimaryEmail: string;
  Team: string;
  Department: string;
  Status: string;
  Title: string;
}

// Simple helper to check if two name parts are "close enough" (handles small typos like Nunez vs Nunes)
function namesAreClose(a: string, b: string): boolean {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  if (la === lb) return true;
  const minLen = Math.min(la.length, lb.length);
  if (minLen === 0) return false;
  let common = 0;
  while (common < minLen && la[common] === lb[common]) {
    common++;
  }
  // Consider them close if all but at most one character (usually at the end) match
  return common >= minLen - 1;
}

export interface IvantiCategory {
  RecId: string;
  Name: string;
  DisplayName?: string;
  Description?: string;
  ParentCategory?: string;
  ParentCategoryRecId?: string;
  Service?: string;
  ServiceRecId?: string;
  IsActive?: boolean;
}

export interface IvantiService {
  RecId: string;
  Name: string;
  DisplayName?: string;
  Description?: string;
  IsActive?: boolean;
  ServiceOwner?: string;
  ServiceOwnerTeam?: string;
}

export interface IvantiServiceRequest {
  RecId: string;
  RequestNumber?: string | number; // normalized number we use in context
  ServiceReqNumber?: string | number; // raw field from API
  DisplayName?: string;
  Subject?: string;
  Status?: string;
  Category?: string;
  Service?: string;
  CreatedDateTime?: string;
  LastModDateTime?: string;
  ProfileFullName?: string;
  Requester?: string;
  [key: string]: any;
}

export interface IvantiTeam {
  RecId: string;
  Name: string;
  DisplayName?: string;
  Description?: string;
  Department?: string;
  Manager?: string;
  IsActive?: boolean;
}

export interface IvantiDepartment {
  RecId: string;
  Name: string;
  DisplayName?: string;
  Description?: string;
  Manager?: string;
  IsActive?: boolean;
}

export interface IvantiRequestOffering {
  SubscriptionId: string;
  Name: string;
  DisplayName?: string;
  Description?: string;
  Category?: string;
  Service?: string;
  IsActive?: boolean;
  Icon?: string;
  [key: string]: any;
}

export interface IvantiRequestOfferingFieldset {
  SubscriptionId: string;
  Fields: Array<{
    Name: string;
    DisplayName: string;
    Type: string;
    Required: boolean;
    DefaultValue?: any;
    Options?: Array<{ Value: string; Label: string }>;
  }>;
  [key: string]: any;
}

export interface IvantiSubcategory {
  RecId: string;
  Name: string;
  DisplayName?: string;
  Category?: string;
  CategoryRecId?: string;
  IsActive?: boolean;
}

type ConversationMessage = {
  role?: string;
  content?: string;
};

function hasUserSearchContext(query: string, history?: ConversationMessage[]): boolean {
  const lower = query.toLowerCase();
  if (lower.includes('user') ||
      lower.includes('employee') ||
      lower.includes('tickets of') ||
      lower.includes('incidents of')) {
    return true;
  }

  if (!Array.isArray(history)) {
    return false;
  }

  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (!msg || typeof msg.content !== 'string') {
      continue;
    }
    if (msg.role === 'system') {
      continue;
    }

    const lowerContent = msg.content.toLowerCase();

    if (msg.role === 'assistant') {
      if ((lowerContent.includes("couldn't find") && lowerContent.includes('user')) ||
          (lowerContent.includes('could not find') && lowerContent.includes('user')) ||
          (lowerContent.includes('searching') && lowerContent.includes('user')) ||
          (lowerContent.includes('provide') && lowerContent.includes('name')) ||
          (lowerContent.includes('being more specific') && lowerContent.includes('user'))) {
        return true;
      }
      break;
    }

    if (msg.role === 'user') {
      if (lowerContent.includes('find user') ||
          lowerContent.includes('find an employee') ||
          lowerContent.includes('search for') ||
          lowerContent.includes('look for a user') ||
          (lowerContent.includes('find') && lowerContent.includes('user'))) {
        return true;
      }
      break;
    }
  }

  return false;
}

function extractNameFromLooseQuery(query: string, history?: ConversationMessage[]): string | null {
  if (!hasUserSearchContext(query, history)) {
    return null;
  }

  const trimmed = query.trim();
  if (!trimmed) {
    return null;
  }

  const cleaned = trimmed
    .replace(/["'’“”,.?!]/g, ' ')
    .replace(/\b(find|search|user|employee|named|name|ticket|tickets|incident|incidents|look|for|show|all|the|please|can|you|help|with|about|tell|me|need|to|and|of|in|on|any|someone|person)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    return null;
  }

  const words = cleaned.split(' ').filter(Boolean);
  if (words.length < 2 || words.length > 4) {
    return null;
  }

  const isNameLike = words.every(word => /^[a-zA-Z][a-zA-Z'.-]*$/.test(word));
  if (!isNameLike) {
    return null;
  }

  return words
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Fetch ticket details by RecId (direct GET)
 */
export async function getTicketDetails(ticketId: string): Promise<IvantiTicket | null> {
  try {
    console.log(`[IvantiData] Fetching ticket details by RecId: ${ticketId}`);
    
    // Try format 1: OData entity key format
    let url = `${IVANTI_CONFIG.baseUrl}${IVANTI_CONFIG.endpoints.incidents}('${ticketId}')`;
    console.log(`[IvantiData] Trying URL format 1: ${url.replace(IVANTI_CONFIG.apiKey, '***')}`);
    
    let response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `rest_api_key=${IVANTI_CONFIG.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    // Try format 2: Filter by RecId
    if (!response.ok) {
      console.log(`[IvantiData] Format 1 failed (${response.status}), trying format 2: Filter by RecId`);
      url = `${IVANTI_CONFIG.baseUrl}${IVANTI_CONFIG.endpoints.incidents}?$filter=RecId eq '${ticketId}'&$top=1`;
      response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `rest_api_key=${IVANTI_CONFIG.apiKey}`,
          'Content-Type': 'application/json',
        },
      });
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[IvantiData] ❌ Failed to fetch ticket: ${response.status}`, errorText);
      return null;
    }

    const data = await response.json();
    
    // Handle different response formats
    if (data.value && Array.isArray(data.value)) {
      console.log(`[IvantiData] ✅ Ticket fetched (array format):`, data.value[0]);
      return data.value[0] || null;
    } else if (data.RecId) {
      console.log(`[IvantiData] ✅ Ticket fetched (object format):`, data);
      return data;
    } else {
      console.warn(`[IvantiData] ⚠️ Unexpected response format:`, data);
      return null;
    }
  } catch (error) {
    console.error('[IvantiData] ❌ Error fetching ticket:', error);
    return null;
  }
}

/**
 * Fetch service requests (ServiceReq business object)
 */
export async function fetchServiceRequests(top: number = 50): Promise<IvantiServiceRequest[]> {
  try {
    console.log(`[IvantiData] Fetching top ${top} service requests`);
    const cacheParams = { top };
    const cached = await getCachedData<IvantiServiceRequest[]>('serviceRequests', cacheParams);
    if (cached) {
      console.log(`[IvantiData] ✅ Using cached service requests (${cached.length} service requests)`);
      return cached;
    }

    const url = `${IVANTI_CONFIG.baseUrl}${IVANTI_CONFIG.endpoints.serviceRequests}?$top=${top}`;
    console.log('[IvantiData] ServiceRequests URL:', url);

    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      
      // Handle 401 (Unauthorized) gracefully - session expired or invalid
      if (response.status === 401) {
        console.warn(`[IvantiData] ⚠️ Session expired or invalid (401) - skipping service requests fetch. This is normal after logout/login.`);
        return [];
      }
      
      console.error(`[IvantiData] ❌ Failed to fetch service requests: ${response.status}`, errorText);
      return [];
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      console.warn('[IvantiData] ⚠️ ServiceRequests response is not JSON (content-type:', contentType, ')');
      return [];
    }

    const data = await response.json();
    const rawItems: any[] = data.value || data || [];
    
    // Normalize to ensure RequestNumber is always populated from ServiceReqNumber when present
    const items: IvantiServiceRequest[] = rawItems.map((sr) => ({
      ...sr,
      RequestNumber: sr.RequestNumber ?? sr.ServiceReqNumber ?? sr.ServiceReqNumber?.toString(),
    }));
    
    console.log(`[IvantiData] ✅ Loaded ${items.length} raw service requests`);

    // Cache the data (best-effort)
    try {
      await setCachedData('serviceRequests', cacheParams, items, 2 * 60); // 2 minutes TTL
    } catch (cacheError) {
      console.warn('[IvantiData] ⚠️ Failed to cache service requests:', cacheError);
    }

    return items;
  } catch (error) {
    console.error('[IvantiData] ❌ Error fetching service requests:', error);
    return [];
  }
}

/**
 * Search tickets by criteria
 * Matches Postman query format - gets ALL fields (no $select)
 * Now includes caching for improved performance and supports pagination
 */
export async function searchTickets(filter: string, top: number = 10, skip: number = 0): Promise<IvantiTicket[]> {
  try {
    console.log(`[IvantiData] Searching tickets with filter: ${filter}, top: ${top}, skip: ${skip}`);
    
    // Check cache first
    const cacheParams = { filter, top, skip };
    console.log(`[IvantiData] 🔍 Checking cache for incidents:`, cacheParams);
    const cached = await getCachedData<IvantiTicket[]>('incidents', cacheParams);
    if (cached) {
      console.log(`[IvantiData] ✅ Using cached data (${cached.length} tickets)`);
      return cached;
    }
    console.log(`[IvantiData] 📡 Cache miss, fetching from API...`);
    
    const encodedFilter = encodeURIComponent(filter);
    // NO $select - get ALL fields like Postman does
    // Add $skip for pagination support
    const url = `${IVANTI_CONFIG.baseUrl}${IVANTI_CONFIG.endpoints.incidents}?$filter=${encodedFilter}&$top=${top}&$skip=${skip}&$orderby=CreatedDateTime desc`;
    
    console.log(`[IvantiData] Full URL: ${url.replace(IVANTI_CONFIG.apiKey, '***')}`);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `rest_api_key=${IVANTI_CONFIG.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[IvantiData] ❌ API Error ${response.status}:`, errorText);
      console.error(`[IvantiData] Failed URL: ${url.replace(IVANTI_CONFIG.apiKey, '***')}`);
      return [];
    }

    const data = await response.json();
    console.log(`[IvantiData] ✅ API Response received, found ${data.value?.length || 0} tickets`);
    
    if (!data.value) {
      console.warn(`[IvantiData] ⚠️ Response doesn't have 'value' property:`, Object.keys(data));
      // Try alternative response formats
      if (Array.isArray(data)) {
        return data;
      }
      if (data.results) {
        return data.results;
      }
      return [];
    }
    
    // Map Symptom to Description for backward compatibility
    const tickets = data.value.map((ticket: any) => {
      if (ticket.Symptom && !ticket.Description) {
        ticket.Description = ticket.Symptom;
      }
      return ticket;
    });
    
    // Cache the results
    await setCachedData('incidents', cacheParams, tickets);
    
    return tickets;
  } catch (error) {
    console.error('[IvantiData] ❌ Error searching tickets:', error);
    return [];
  }
}

/**
 * Get user's tickets
 */
export async function getUserTickets(userRecId: string, top: number = 10): Promise<IvantiTicket[]> {
  const filter = `ProfileLink_RecID eq '${userRecId}'`;
  return searchTickets(filter, top);
}

/**
 * Get employee details by RecId
 */
export async function getEmployeeDetails(employeeRecId: string): Promise<IvantiEmployee | null> {
  try {
    console.log(`[IvantiData] Fetching employee details for: ${employeeRecId}`);
    
    const url = `${IVANTI_CONFIG.baseUrl}${IVANTI_CONFIG.endpoints.userByName}('${employeeRecId}')`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `rest_api_key=${IVANTI_CONFIG.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`[IvantiData] Failed to fetch employee: ${response.status}`);
      return null;
    }

    const data = await response.json();
    console.log(`[IvantiData] ✅ Employee fetched:`, data);
    return data;
  } catch (error) {
    console.error('[IvantiData] Error fetching employee:', error);
    return null;
  }
}

/**
 * Search employees by name or email
 * Now includes caching for improved performance
 */
export async function searchEmployees(searchTerm: string, top: number = 10): Promise<IvantiEmployee[]> {
  try {
    console.log(`[IvantiData] Searching employees (tokenized): ${searchTerm}`);

    const raw = searchTerm.trim();
    // Allow empty search term to fetch all employees (if API supports it)
    if (!raw && top <= 10) {
      // For small top values, require a search term
      return [];
    }
    
    // Check cache first
    const cacheParams = { searchTerm: raw.toLowerCase(), top };
    console.log(`[IvantiData] 🔍 Checking cache for employees:`, cacheParams);
    const cached = await getCachedData<IvantiEmployee[]>('employees', cacheParams);
    if (cached) {
      console.log(`[IvantiData] ✅ Using cached data (${cached.length} employees)`);
      return cached;
    }
    console.log(`[IvantiData] 📡 Cache miss, fetching from API...`);

    // Escape single quotes for OData
    const safe = raw.replace(/'/g, "''");
    const tokens = safe.split(/\s+/).filter(Boolean);

    // Build a stricter filter that requires all tokens to appear in DisplayName (like the UI search),
    // plus a looser clause for LoginID/PrimaryEmail.
    // Example: contains(DisplayName,'lance') and contains(DisplayName,'nune')
    const displayNameClauses = tokens.map(t => `contains(DisplayName,'${t}')`);
    const displayNameFilter = displayNameClauses.join(' and ');

    const loginEmailFilter =
      `contains(LoginID,'${safe}') or contains(PrimaryEmail,'${safe}')`;

    // Prefer matches where DisplayName starts with the first token (e.g., first name)
    const firstToken = tokens[0];
    const startsWithFilter = firstToken
      ? `startswith(DisplayName,'${firstToken}')`
      : '';

    // Final filter combines:
    // - strong matches on DisplayName (all tokens)
    // - plus LoginID/PrimaryEmail contains search
    // - plus optional startswith boost for first token
    const parts: string[] = [];
    if (displayNameFilter) parts.push(`(${displayNameFilter})`);
    if (startsWithFilter) parts.push(startsWithFilter);
    parts.push(`(${loginEmailFilter})`);

    const filter = parts.join(' or ');

    const encodedFilter = encodeURIComponent(filter);
    const url = `${IVANTI_CONFIG.baseUrl}${IVANTI_CONFIG.endpoints.userByName}?$filter=${encodedFilter}&$top=${top}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `rest_api_key=${IVANTI_CONFIG.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`[IvantiData] Failed to search employees: ${response.status}`);
      return [];
    }

    let data = await response.json();
    let employees: IvantiEmployee[] = data.value || [];
    console.log(`[IvantiData] ✅ Filtered employee search returned ${employees.length} record(s)`);

    // If filtered search returned nothing, fall back to a broader, client-side fuzzy search.
    if (employees.length === 0) {
      console.log('[IvantiData] Filtered search returned 0 results, performing broad fallback search for fuzzy matching');
      const fallbackUrl = `${IVANTI_CONFIG.baseUrl}${IVANTI_CONFIG.endpoints.userByName}?$top=${Math.max(top, 25)}`;

      const fallbackResponse = await fetch(fallbackUrl, {
        method: 'GET',
        headers: {
          'Authorization': `rest_api_key=${IVANTI_CONFIG.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!fallbackResponse.ok) {
        console.error(`[IvantiData] Failed fallback employee search: ${fallbackResponse.status}`);
        return [];
      }

      data = await fallbackResponse.json();
      const allEmployees: IvantiEmployee[] = data.value || [];
      console.log(`[IvantiData] Fallback employee search retrieved ${allEmployees.length} records, applying client-side filter`);

      const lowerRaw = raw.toLowerCase();
      const tokensLower = lowerRaw.split(/\s+/).filter(Boolean);

      employees = allEmployees.filter(e => {
        const dn = (e.DisplayName || '').toLowerCase();
        const login = (e.LoginID || '').toLowerCase();
        const email = (e.PrimaryEmail || '').toLowerCase();

        // Direct contains on any field
        if (dn.includes(lowerRaw) || login.includes(lowerRaw) || email.includes(lowerRaw)) {
          return true;
        }

        // All tokens must appear somewhere in DisplayName
        if (tokensLower.length > 0) {
          const allTokensInName = tokensLower.every(t => dn.includes(t));
          if (allTokensInName) return true;
        }

        // Fuzzy: if any token is "close" to any part of the display name
        const dnParts = dn.split(/\s+/);
        for (const t of tokensLower) {
          for (const p of dnParts) {
            if (namesAreClose(t, p)) {
              return true;
            }
          }
        }

        return false;
      }).slice(0, top);

      console.log(`[IvantiData] Fallback filtered employees down to ${employees.length} candidate(s)`);
    }

    // Cache the results
    await setCachedData('employees', cacheParams, employees);

    return employees;
  } catch (error) {
    console.error('[IvantiData] Error searching employees:', error);
    return [];
  }
}

/**
 * Search a single employee by exact email (PrimaryEmail or LoginID)
 */
export async function searchEmployeeByEmail(email: string): Promise<IvantiEmployee | null> {
  try {
    console.log(`[IvantiData] Searching employee by email: ${email}`);

    // Escape single quotes for OData
    const safeEmail = email.replace(/'/g, "''");
    const filter = `PrimaryEmail eq '${safeEmail}' or LoginID eq '${safeEmail}'`;
    const encodedFilter = encodeURIComponent(filter);
    const url = `${IVANTI_CONFIG.baseUrl}${IVANTI_CONFIG.endpoints.userByName}?$filter=${encodedFilter}&$top=5`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `rest_api_key=${IVANTI_CONFIG.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[IvantiData] Failed to search employee by email: ${response.status} - ${errorText}`);
      return null;
    }

    const data = await response.json();
    const employees: IvantiEmployee[] = data.value || [];
    console.log(`[IvantiData] ✅ Email search found ${employees.length} employees`);

    if (employees.length === 0) return null;

    // Prefer exact PrimaryEmail match, then LoginID
    const exactPrimary = employees.find(e => e.PrimaryEmail?.toLowerCase() === email.toLowerCase());
    if (exactPrimary) return exactPrimary;

    const exactLogin = employees.find(e => e.LoginID?.toLowerCase() === email.toLowerCase());
    if (exactLogin) return exactLogin;

    // Fallback to first result
    return employees[0];
  } catch (error) {
    console.error('[IvantiData] Error searching employee by email:', error);
    return null;
  }
}

/**
 * Search a single employee by exact display name
 */
export async function searchEmployeeByExactName(fullName: string): Promise<IvantiEmployee | null> {
  try {
    console.log(`[IvantiData] Searching employee by exact name: ${fullName}`);

    const safeName = fullName.replace(/'/g, "''");
    const filter = `DisplayName eq '${safeName}'`;
    const encodedFilter = encodeURIComponent(filter);
    const url = `${IVANTI_CONFIG.baseUrl}${IVANTI_CONFIG.endpoints.userByName}?$filter=${encodedFilter}&$top=5`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `rest_api_key=${IVANTI_CONFIG.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[IvantiData] Failed to search employee by exact name: ${response.status} - ${errorText}`);
      return null;
    }

    const data = await response.json();
    const employees: IvantiEmployee[] = data.value || [];
    console.log(`[IvantiData] ✅ Exact name search found ${employees.length} employees`);

    if (employees.length === 0) return null;

    // Prefer exact DisplayName match (case insensitive)
    const exact = employees.find(e => e.DisplayName?.toLowerCase() === fullName.toLowerCase());
    return exact || employees[0];
  } catch (error) {
    console.error('[IvantiData] Error searching employee by exact name:', error);
    return null;
  }
}

/**
 * Fetch available incident categories
 */
/**
 * Fetch Services from Ivanti
 * Tries multiple endpoint variations since Ivanti instances may use different names
 */
export async function fetchServices(top: number = 50): Promise<IvantiService[]> {
  try {
    console.log(`[IvantiData] Fetching top ${top} services`);
    const cacheParams = { top };
    const cached = await getCachedData<IvantiService[]>('services', cacheParams);
    if (cached) {
      console.log(`[IvantiData] ✅ Using cached services (${cached.length} services)`);
      return cached;
    }
    
    // Use the confirmed working endpoint: ci__services
    const url = `${IVANTI_CONFIG.baseUrl}${IVANTI_CONFIG.endpoints.services}?$top=${top}`;
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include', // Use browser's session cookies
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    if (response.ok) {
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const responseText = await response.text();
        if (responseText && responseText.trim() !== '') {
          const data = JSON.parse(responseText);
          const services = data.value || [];
          if (services.length > 0) {
            await setCachedData('services', cacheParams, services);
            console.log(`[IvantiData] ✅ Retrieved ${services.length} services`);
            return services;
          }
        }
      }
    }
    
    console.warn(`[IvantiData] ⚠️ Services endpoint returned no data`);
    return [];
  } catch (error) {
    console.error('[IvantiData] Error fetching services:', error);
    return [];
  }
}

/**
 * Fetch Teams from Ivanti
 * Uses the confirmed working endpoint: standarduserteams
 */
export async function fetchTeams(top: number = 50): Promise<IvantiTeam[]> {
  try {
    console.log(`[IvantiData] Fetching top ${top} teams`);
    const cacheParams = { top };
    const cached = await getCachedData<IvantiTeam[]>('teams', cacheParams);
    if (cached) {
      console.log(`[IvantiData] ✅ Using cached teams (${cached.length} teams)`);
      return cached;
    }
    
    // Use the confirmed working endpoint
    const url = `${IVANTI_CONFIG.baseUrl}${IVANTI_CONFIG.endpoints.teams}?$top=${top}`;
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include', // Use browser's session cookies
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    if (response.ok) {
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const responseText = await response.text();
        if (responseText && responseText.trim() !== '') {
          const data = JSON.parse(responseText);
          const teams = data.value || [];
          if (teams.length > 0) {
            await setCachedData('teams', cacheParams, teams);
            console.log(`[IvantiData] ✅ Retrieved ${teams.length} teams`);
            return teams;
          }
        }
      }
    }
    
    console.warn(`[IvantiData] ⚠️ Teams endpoint returned no data`);
    return [];
  } catch (error) {
    console.error('[IvantiData] Error fetching teams:', error);
    return [];
  }
}

/**
 * Fetch Departments from Ivanti
 * Uses the confirmed working endpoint: departments (lowercase)
 */
export async function fetchDepartments(top: number = 50): Promise<IvantiDepartment[]> {
  try {
    console.log(`[IvantiData] Fetching top ${top} departments`);
    const cacheParams = { top };
    const cached = await getCachedData<IvantiDepartment[]>('departments', cacheParams);
    if (cached) {
      console.log(`[IvantiData] ✅ Using cached departments (${cached.length} departments)`);
      return cached;
    }
    
    // Use the confirmed working endpoint
    const url = `${IVANTI_CONFIG.baseUrl}${IVANTI_CONFIG.endpoints.departments}?$top=${top}`;
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include', // Use browser's session cookies
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    if (response.ok) {
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const responseText = await response.text();
        if (responseText && responseText.trim() !== '') {
          const data = JSON.parse(responseText);
          const departments = data.value || [];
          if (departments.length > 0) {
            await setCachedData('departments', cacheParams, departments);
            console.log(`[IvantiData] ✅ Retrieved ${departments.length} departments`);
            return departments;
          }
        }
      }
    }
    
    console.warn(`[IvantiData] ⚠️ Departments endpoint returned no data`);
    return [];
  } catch (error) {
    console.error('[IvantiData] Error fetching departments:', error);
    return [];
  }
}

/**
 * Fetch Request Offerings from Ivanti
 * Uses the confirmed working REST endpoint
 */
export async function fetchRequestOfferings(): Promise<IvantiRequestOffering[]> {
  try {
    console.log(`[IvantiData] Fetching request offerings`);
    const cacheParams = { endpoint: 'requestOfferings' };
    const cached = await getCachedData<IvantiRequestOffering[]>('requestOfferings', cacheParams);
    if (cached) {
      console.log(`[IvantiData] ✅ Using cached request offerings (${cached.length} offerings)`);
      return cached;
    }
    
    // Use the confirmed working endpoint
    const url = `${IVANTI_CONFIG.baseUrl}${IVANTI_CONFIG.endpoints.requestOfferings}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `rest_api_key=${IVANTI_CONFIG.apiKey}`,
        'Content-Type': 'application/json',
      },
    });
    
    if (response.ok) {
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const responseText = await response.text();
        if (responseText && responseText.trim() !== '') {
          const data = JSON.parse(responseText);
          // The response structure may vary, adapt as needed
          const offerings = Array.isArray(data) ? data : (data.value || data.Templates || []);
          if (offerings.length > 0) {
            await setCachedData('requestOfferings', cacheParams, offerings);
            console.log(`[IvantiData] ✅ Retrieved ${offerings.length} request offerings`);
            return offerings;
          }
        }
      }
    }
    
    console.warn(`[IvantiData] ⚠️ Request offerings endpoint returned no data`);
    return [];
  } catch (error) {
    console.error('[IvantiData] Error fetching request offerings:', error);
    return [];
  }
}

/**
 * Fetch Request Offering Fieldset from Ivanti
 * Requires a subscriptionId (from the request offering)
 */
export async function fetchRequestOfferingFieldset(subscriptionId: string): Promise<IvantiRequestOfferingFieldset | null> {
  try {
    console.log(`[IvantiData] Fetching request offering fieldset for: ${subscriptionId}`);
    const cacheParams = { subscriptionId };
    const cached = await getCachedData<IvantiRequestOfferingFieldset>('requestOfferingFieldset', cacheParams);
    if (cached) {
      console.log(`[IvantiData] ✅ Using cached fieldset for ${subscriptionId}`);
      return cached;
    }
    
    // Use the confirmed working endpoint with subscriptionId
    const url = `${IVANTI_CONFIG.baseUrl}${IVANTI_CONFIG.endpoints.requestOfferingFieldset}/${subscriptionId}/strCustomerLocation`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `rest_api_key=${IVANTI_CONFIG.apiKey}`,
        'Content-Type': 'application/json',
      },
    });
    
    if (response.ok) {
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const responseText = await response.text();
        if (responseText && responseText.trim() !== '') {
          const fieldset = JSON.parse(responseText);
          await setCachedData('requestOfferingFieldset', cacheParams, fieldset);
          console.log(`[IvantiData] ✅ Retrieved fieldset for ${subscriptionId}`);
          return fieldset;
        }
      }
    }
    
    console.warn(`[IvantiData] ⚠️ Request offering fieldset not found for ${subscriptionId}`);
    return null;
  } catch (error) {
    console.error(`[IvantiData] Error fetching request offering fieldset for ${subscriptionId}:`, error);
    return null;
  }
}

export async function fetchCategories(top: number = 25): Promise<IvantiCategory[]> {
  try {
    console.log(`[IvantiData] Fetching top ${top} categories`);
    
    const url = `${IVANTI_CONFIG.baseUrl}${IVANTI_CONFIG.endpoints.categories}?$top=${top}`;
    
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include', // Use browser's session cookies
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unable to read error response');
      
      // Handle 401 (Unauthorized) gracefully - session expired or invalid
      if (response.status === 401) {
        console.warn(`[IvantiData] ⚠️ Session expired or invalid (401) - skipping categories fetch. This is normal after logout/login.`);
        return [];
      }
      
      console.error(`[IvantiData] ❌ Failed to fetch categories: ${response.status} - ${errorText}`);
      return [];
    }

    // Check if response has content before parsing
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      console.warn(`[IvantiData] ⚠️ Categories response is not JSON (content-type: ${contentType})`);
      return [];
    }

    // Get response text first to check if it's empty
    const responseText = await response.text();
    if (!responseText || responseText.trim() === '') {
      console.warn(`[IvantiData] ⚠️ Categories response is empty`);
      return [];
    }

    // Try to parse JSON
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      console.error(`[IvantiData] ❌ Failed to parse categories JSON:`, parseError);
      console.error(`[IvantiData] Response text (first 200 chars):`, responseText.substring(0, 200));
      return [];
    }

    const categories = data.value || [];

    console.log(`[IvantiData] ✅ Retrieved ${categories.length} categories`);
    return categories;
  } catch (error) {
    console.error('[IvantiData] Error fetching categories:', error);
    return [];
  }
}

/**
 * Get a default category from recent incidents
 * This helps when Category is required but user hasn't specified one
 */
async function getDefaultCategory(): Promise<string | null> {
  try {
    // Get a recent incident to extract a common category
    const recentTickets = await searchTickets('Status ne null', 1);
    if (recentTickets.length > 0 && recentTickets[0].Category) {
      console.log('[IvantiData] Found default category from recent incident:', recentTickets[0].Category);
      return recentTickets[0].Category;
    }
    return null;
  } catch (error) {
    console.error('[IvantiData] Error getting default category:', error);
    return null;
  }
}

/**
 * Create a new incident in Ivanti
 * @param incidentData - Incident data (Subject, Symptom, Category REQUIRED, etc.)
 * @param currentUser - Current logged-in user
 */
export async function createIncident(incidentData: {
  Subject: string;
  Symptom: string;
  Category: string; // REQUIRED - Ivanti requires this field
  Subcategory?: string;
  Service?: string;
  Priority?: string;
  Impact?: string;
  Urgency?: string;
  Source?: string;
  Status?: string;
  ProfileLink?: string; // User's RecId
}, currentUser: any): Promise<{ success: boolean; incidentNumber?: string; recId?: string; error?: string }> {
  try {
    console.log('[IvantiData] Creating incident:', incidentData);
    
    // Ensure ProfileLink is set to current user's RecId
    if (!incidentData.ProfileLink && currentUser?.recId) {
      incidentData.ProfileLink = currentUser.recId;
    }
    
    // Category is REQUIRED by Ivanti - ensure it's provided
    let category = incidentData.Category;
    if (!category || category.trim() === '') {
      console.warn('[IvantiData] Category not provided, attempting to get default...');
      const defaultCategory = await getDefaultCategory();
      if (defaultCategory) {
        category = defaultCategory;
        console.log('[IvantiData] Using default category:', category);
      } else {
        // Use a common default category if we can't find one
        category = 'Service Desk'; // Common default, but may need to be adjusted per instance
        console.warn('[IvantiData] Using fallback category:', category);
      }
    }
    
    // Build payload with REQUIRED fields
    // Ivanti REQUIRES: Subject, Symptom, ProfileLink, Category
    const payload: any = {
      Subject: incidentData.Subject,
      Symptom: incidentData.Symptom,
      ProfileLink: incidentData.ProfileLink || currentUser?.recId,
      Category: category, // REQUIRED FIELD
    };
    
    // Add Status only if explicitly provided (Ivanti may have defaults)
    // New incidents typically start as "Logged"
    if (incidentData.Status) {
      payload.Status = incidentData.Status;
    }
    
    // Add Priority only if provided (use string format)
    if (incidentData.Priority) {
      payload.Priority = String(incidentData.Priority);
    }
    
    // Source field is validated - only include if valid value provided
    // Valid Source values based on Ivanti: "Phone", "Email", "Chat", "Self Service"
    // If not provided or invalid, omit it (Ivanti will use default based on context)
    const validSources = ['Phone', 'Email', 'Chat', 'Self Service'];
    if (incidentData.Source && validSources.includes(incidentData.Source)) {
      payload.Source = incidentData.Source;
    }
    // Don't set default Source - let Ivanti determine based on API context
    
    // Service field may also be validated - only include if provided
    if (incidentData.Service) {
      payload.Service = incidentData.Service;
    }
    
    // Subcategory is optional but can be added if provided
    if (incidentData.Subcategory) {
      payload.Subcategory = incidentData.Subcategory;
    }
    
    // Impact and Urgency are typically validated fields
    // Only add if provided
    if (incidentData.Impact) {
      payload.Impact = incidentData.Impact;
    }
    if (incidentData.Urgency) {
      payload.Urgency = incidentData.Urgency;
    }
    
    const url = `${IVANTI_CONFIG.baseUrl}${IVANTI_CONFIG.endpoints.incidents}`;
    
    console.log('[IvantiData] POST URL:', url.replace(IVANTI_CONFIG.apiKey, '***'));
    console.log('[IvantiData] Payload:', JSON.stringify(payload, null, 2));
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `rest_api_key=${IVANTI_CONFIG.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[IvantiData] Failed to create incident:', response.status, errorText);
      return {
        success: false,
        error: `Failed to create incident: ${response.status} - ${errorText}`
      };
    }
    
    const data = await response.json();
    console.log('[IvantiData] ✅ Incident created:', data);
    
    // Extract incident number and RecId from response
    const incidentNumber = data.IncidentNumber || data.value?.IncidentNumber || 'Unknown';
    const recId = data.RecId || data.value?.RecId || null;
    
    return {
      success: true,
      incidentNumber: String(incidentNumber),
      recId: recId ? String(recId) : undefined
    };
    
  } catch (error) {
    console.error('[IvantiData] Error creating incident:', error);
    return {
      success: false,
      error: (error as Error).message || 'Unknown error creating incident'
    };
  }
}

/**
 * Update an existing incident in Ivanti
 * @param incidentRecId - The RecId of the incident to update
 * @param updateData - Fields to update (Subject, Symptom, Status, Priority, etc.)
 * @param currentUser - Current logged-in user
 */
export async function updateIncident(
  incidentRecId: string,
  updateData: {
    Subject?: string;
    Symptom?: string;
    Status?: string;
    Priority?: string;
    Category?: string;
    Subcategory?: string;
    Impact?: string;
    Urgency?: string;
    Owner?: string;
    OwnerTeam?: string;
    Resolution?: string;
    [key: string]: any; // Allow any other fields
  },
  currentUser: any
): Promise<{ success: boolean; incidentNumber?: string; error?: string }> {
  try {
    console.log('[IvantiData] Updating incident:', incidentRecId, updateData);
    
    // Add LastModBy to track who made the change
    const payload: any = {
      ...updateData,
      LastModBy: currentUser?.loginId || currentUser?.email || 'AI Assistant'
    };
    
    // OData format: /incidents(RecId)
    const url = `${IVANTI_CONFIG.baseUrl}${IVANTI_CONFIG.endpoints.incidents}('${incidentRecId}')`;
    
    console.log('[IvantiData] PATCH URL:', url.replace(IVANTI_CONFIG.apiKey, '***'));
    console.log('[IvantiData] Payload:', JSON.stringify(payload, null, 2));
    
    const response = await fetch(url, {
      method: 'PATCH', // Use PATCH for partial updates
      headers: {
        'Authorization': `rest_api_key=${IVANTI_CONFIG.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[IvantiData] Failed to update incident:', response.status, errorText);
      return {
        success: false,
        error: `Failed to update incident: ${response.status} - ${errorText}`
      };
    }
    
    // Some APIs return empty body on success, try to get updated data
    let incidentNumber = 'Unknown';
    try {
      const data = await response.json();
      incidentNumber = data.IncidentNumber || data.value?.IncidentNumber || 'Unknown';
    } catch {
      // If no JSON response, fetch the incident to get the number
      const updatedIncident = await getTicketDetails(incidentRecId);
      if (updatedIncident) {
        incidentNumber = String(updatedIncident.IncidentNumber);
      }
    }
    
    console.log('[IvantiData] ✅ Incident updated:', incidentNumber);
    
    return {
      success: true,
      incidentNumber: String(incidentNumber)
    };
    
  } catch (error) {
    console.error('[IvantiData] Error updating incident:', error);
    return {
      success: false,
      error: (error as Error).message || 'Unknown error updating incident'
    };
  }
}

/**
 * Delete an incident in Ivanti
 * @param incidentRecId - The RecId of the incident to delete
 * @param _currentUser - Current logged-in user (for permission checking, reserved for future use)
 */
export async function deleteIncident(
  incidentRecId: string,
  _currentUser: any
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log('[IvantiData] Deleting incident:', incidentRecId);
    
    // OData format: /incidents(RecId)
    const url = `${IVANTI_CONFIG.baseUrl}${IVANTI_CONFIG.endpoints.incidents}('${incidentRecId}')`;
    
    console.log('[IvantiData] DELETE URL:', url.replace(IVANTI_CONFIG.apiKey, '***'));
    
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': `rest_api_key=${IVANTI_CONFIG.apiKey}`,
        'Content-Type': 'application/json',
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[IvantiData] Failed to delete incident:', response.status, errorText);
      return {
        success: false,
        error: `Failed to delete incident: ${response.status} - ${errorText}`
      };
    }
    
    console.log('[IvantiData] ✅ Incident deleted successfully');
    
    return {
      success: true
    };
    
  } catch (error) {
    console.error('[IvantiData] Error deleting incident:', error);
    return {
      success: false,
      error: (error as Error).message || 'Unknown error deleting incident'
    };
  }
}

/**
 * Get incident RecId from incident number
 * Helper function to convert incident number to RecId for update/delete operations
 * Tries multiple query formats to handle different data types
 */
export async function getIncidentRecId(incidentNumber: string): Promise<string | null> {
  try {
    console.log('[IvantiData] Getting RecId for incident number:', incidentNumber);
    
    // Try multiple query formats (IncidentNumber might be string or numeric)
    const queryFormats = [
      `IncidentNumber eq '${incidentNumber}'`, // String format with quotes
      `IncidentNumber eq ${incidentNumber}`,   // Numeric format without quotes
      `IncidentNumber eq ${parseInt(incidentNumber)}`, // Explicit numeric conversion
    ];
    
    for (const query of queryFormats) {
      console.log(`[IvantiData] Trying query format: ${query}`);
      const tickets = await searchTickets(query, 1);
      
      if (tickets.length > 0 && tickets[0].RecId) {
        console.log('[IvantiData] ✅ Found RecId:', tickets[0].RecId);
        return tickets[0].RecId;
      }
    }
    
    // If still not found, try without filter (get recent and search)
    console.log('[IvantiData] Trying broader search...');
    const recentTickets = await searchTickets('Status ne null', 20);
    const matchingTicket = recentTickets.find(t => 
      String(t.IncidentNumber) === String(incidentNumber)
    );
    
    if (matchingTicket && matchingTicket.RecId) {
      console.log('[IvantiData] ✅ Found RecId in recent tickets:', matchingTicket.RecId);
      return matchingTicket.RecId;
    }
    
    console.warn('[IvantiData] ❌ Incident not found:', incidentNumber);
    return null;
    
  } catch (error) {
    console.error('[IvantiData] Error getting RecId:', error);
    return null;
  }
}

/**
 * AI Tool: Fetch Ivanti data based on user query
 * This function is called by the AI when it needs to fetch data from Ivanti
 * 
 * @param query - User's query
 * @param currentUser - Current logged-in user
 * @param conversationHistory - Full conversation history to check for previously fetched data (optional, for future use)
 */
export async function fetchIvantiData(
  query: string,
  currentUser?: any,
  conversationHistory?: ConversationMessage[]
): Promise<string> {
  console.log(`[IvantiData] AI requested data for query: "${query}"`);
  
  try {
    // FIRST: Try to get data from knowledge base (if available)
    try {
      const { getKnowledgeBaseContext, searchKnowledgeBase } = await import('./knowledgeBaseService');
      const kbContext = await getKnowledgeBaseContext(query, currentUser);
      
      // If knowledge base has relevant data, use it
      if (kbContext && !kbContext.includes('not available')) {
        console.log(`%c[IvantiData] 🧠 Using knowledge base data`, 'color: #8b5cf6; font-weight: bold;');
        
        // ALWAYS try to extract a name from the query and search knowledge base
        // This handles queries like "is there named dana?" or "how about bettina"
        const lowerQuery = query.toLowerCase();
        
        // Try to extract name using multiple patterns
        let searchName: string | null = null;
        
        // Pattern 1: "named X" or "name X"
        const namedMatch = query.match(/\b(named|name|called)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/i);
        if (namedMatch && namedMatch[2]) {
          searchName = namedMatch[2];
        }
        
        // Pattern 2: "how about X" or "what about X"
        if (!searchName) {
          const aboutMatch = query.match(/\b(how|what)\s+about\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/i);
          if (aboutMatch && aboutMatch[2]) {
            searchName = aboutMatch[2];
          }
        }
        
        // Pattern 3: "is there X" or "is X"
        if (!searchName) {
          const isMatch = query.match(/\b(is\s+there|is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/i);
          if (isMatch && isMatch[2]) {
            searchName = isMatch[2];
          }
        }
        
        // Pattern 4: Just a capitalized name (2-4 words)
        if (!searchName) {
          const nameMatch = query.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/);
          if (nameMatch && nameMatch[1]) {
            const words = nameMatch[1].split(/\s+/);
            // Only treat as name if it's 1-3 words and looks like a name
            if (words.length >= 1 && words.length <= 3 && words.every(w => /^[A-Z][a-z]+$/.test(w))) {
              searchName = nameMatch[1];
            }
          }
        }
        
        // If we found a name, search the knowledge base
        if (searchName) {
          console.log(`%c[IvantiData] 🔍 Searching knowledge base for: "${searchName}"`, 'color: #3b82f6; font-weight: bold;');
          const kbResults = await searchKnowledgeBase('employees', searchName);
          
          if (kbResults.length > 0) {
            console.log(`%c[IvantiData] ✅ Found ${kbResults.length} employees in knowledge base`, 'color: #10b981; font-weight: bold;');
            return `[DATA FROM KNOWLEDGE BASE - SEARCH RESULTS FOR "${searchName}"]:
${kbResults.map((e, i) => 
  `${i + 1}. ${e.DisplayName} (${e.PrimaryEmail || e.LoginID}) - Team: ${e.Team || 'No team'} - Department: ${e.Department || 'N/A'} - Status: ${e.Status} - RecId: ${e.RecId}`
).join('\n')}

INSTRUCTIONS: Use this knowledge base data to answer. This is real data from Ivanti that was pre-loaded. Tell the user you found this person in the system.`;
          } else {
            console.log(`%c[IvantiData] ❌ No employees found in knowledge base for: "${searchName}"`, 'color: #ef4444; font-weight: bold;');
            // Load KB to get employee count
            const { loadKnowledgeBase } = await import('./knowledgeBaseService');
            const kb = await loadKnowledgeBase();
            const employeeCount = kb?.employees.length || 0;
            // Still return KB context but note that the specific name wasn't found
            return `${kbContext}

[SEARCH RESULT]: I searched the knowledge base for "${searchName}" but didn't find any employees with that name. The knowledge base contains ${employeeCount} employees.`;
          }
        }
        
        // If query explicitly mentions user/employee/find, show employee list
        if (lowerQuery.includes('user') || lowerQuery.includes('employee') || lowerQuery.includes('find')) {
          // Return knowledge base context which includes employee list
          return kbContext;
        }
        
        // Return knowledge base context for general queries
        return kbContext;
      }
    } catch (error) {
      console.warn('[IvantiData] Knowledge base not available, falling back to API:', error);
    }
    
    // Parse the query to determine what data to fetch
    const lowerQuery = query.toLowerCase();

    // Suggest categories if user is asking about them
    const asksForCategories =
      lowerQuery.includes('category') &&
      (lowerQuery.includes('list') ||
       lowerQuery.includes('show') ||
       lowerQuery.includes('what') ||
       lowerQuery.includes('available') ||
       lowerQuery.includes('options') ||
       lowerQuery.includes('suggest') ||
       lowerQuery.includes('recommend') ||
       lowerQuery.includes("don't know") ||
       lowerQuery.includes('not sure') ||
       lowerQuery.includes('which category'));
    
    if (asksForCategories) {
      const categories = await fetchCategories(25);
      
      if (categories.length === 0) {
        return `[CATEGORY LOOKUP]: I couldn't retrieve the list of categories right now. Please try again in a moment or manually select a category in Ivanti.`;
      }

      const formatted = categories.map((cat, index) => {
        const name = cat.DisplayName || cat.Name;
        const service = cat.Service ? `Service: ${cat.Service}` : '';
        const description = cat.Description ? `Description: ${cat.Description}` : '';
        return `${index + 1}. ${name}${service ? ` (${service})` : ''}${description ? ` - ${description}` : ''}`;
      }).join('\n');

      return `[CATEGORY LOOKUP]: Here are some categories you can choose from:\n${formatted}\n\nINSTRUCTIONS: Present these category options in a conversational way. Explain that the user can pick the one that best matches their issue. Encourage them to choose the category that aligns with their problem area (e.g., Service Desk, Connectivity, Ivanti Neurons).`;
    }
    
    // Check if asking about tickets
    if (lowerQuery.includes('ticket') || lowerQuery.includes('incident')) {
      if (lowerQuery.includes('my tickets') || lowerQuery.includes('my incidents')) {
        // Fetch user's tickets
        if (currentUser?.recId) {
          const tickets = await getUserTickets(currentUser.recId, 20);
          if (tickets.length > 0) {
            const openTickets = tickets.filter(t => t.Status !== 'Closed' && t.Status !== 'Resolved');
            const highPriority = tickets.filter(t => parseInt(t.Priority) <= 2);
            
            // Helper to strip HTML
            const stripHtml = (html: string | null | undefined): string => {
              if (!html) return '';
              return html.replace(/<[^>]*>/g, '')
                .replace(/&nbsp;/g, ' ')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .trim()
                .replace(/\s+/g, ' ');
            };
            
            return `YOUR INCIDENTS (${currentUser.fullName}):
TOTAL: ${tickets.length} incidents
OPEN: ${openTickets.length} still active
HIGH PRIORITY: ${highPriority.length} urgent items

INCIDENT LIST:
${tickets.map((t, index) => {
  const created = new Date(t.CreatedDateTime);
  const daysAgo = Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24));
  const description = stripHtml(t.Symptom || t.Description || '');
  const descPreview = description.length > 100 ? description.substring(0, 100) + '...' : description;
  
  return `${index + 1}. Incident #${t.IncidentNumber} - "${t.Subject}"
   - Status: ${t.Status}
   - Priority: ${t.Priority}
   - Category: ${t.Category || 'Not categorized'}
   - Opened: ${created.toLocaleDateString()} (${daysAgo} days ago)
   ${descPreview ? `- Description: ${descPreview}` : ''}`;
}).join('\n\n')}

INSTRUCTIONS: Present this conversationally using plain text paragraphs. Do NOT use markdown (no asterisks, bold, bullet points). Include description details when explaining incidents. Highlight any urgent items. Explain status in plain terms. Write naturally.`;
          } else {
            return `RESULT: No incidents found for ${currentUser.fullName}.

INSTRUCTIONS: Say something friendly like "You don't have any tickets right now. Everything's looking good!"`;
          }
        } else {
          return 'ERROR: Unable to identify current user. Please refresh the page.';
        }
      }
      
      // Check if asking about a specific ticket number (extract ANY number from query)
      const ticketMatch = query.match(/\b(\d{4,})\b/); // Match any 4+ digit number
      if (ticketMatch) {
        const ticketNumber = ticketMatch[1];
        console.log(`[IvantiData] 🔍 Searching for incident number: ${ticketNumber}`);
        
        // Try multiple query formats
        let tickets: IvantiTicket[] = [];
        
        // Format 1: Exact match with quotes
        console.log(`[IvantiData] Trying format 1: IncidentNumber eq '${ticketNumber}'`);
        tickets = await searchTickets(`IncidentNumber eq '${ticketNumber}'`, 1);
        
        // Format 2: Without quotes (in case it's numeric)
        if (tickets.length === 0) {
          console.log(`[IvantiData] Trying format 2: IncidentNumber eq ${ticketNumber}`);
          tickets = await searchTickets(`IncidentNumber eq ${ticketNumber}`, 1);
        }
        
        // Format 3: Contains (in case number has prefix)
        if (tickets.length === 0) {
          console.log(`[IvantiData] Trying format 3: contains(IncidentNumber,'${ticketNumber}')`);
          tickets = await searchTickets(`contains(IncidentNumber,'${ticketNumber}')`, 1);
        }
        
        // Format 4: Try with INC prefix
        if (tickets.length === 0) {
          console.log(`[IvantiData] Trying format 4: IncidentNumber eq 'INC${ticketNumber}'`);
          tickets = await searchTickets(`IncidentNumber eq 'INC${ticketNumber}'`, 1);
        }
        
        if (tickets.length > 0) {
          const ticket = tickets[0];
          console.log(`[IvantiData] ✅ Found incident:`, ticket);
          
          const created = ticket.CreatedDateTime ? new Date(ticket.CreatedDateTime) : null;
          const modified = ticket.LastModDateTime ? new Date(ticket.LastModDateTime) : null;
          const daysOpen = created ? Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24)) : null;
          
          // Strip HTML from Symptom/Description
          const stripHtml = (html: string | null | undefined): string => {
            if (!html) return 'No description provided';
            // Remove HTML tags
            const text = html.replace(/<[^>]*>/g, '');
            // Decode HTML entities
            const decoded = text
              .replace(/&nbsp;/g, ' ')
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'");
            // Clean up whitespace
            return decoded.trim().replace(/\s+/g, ' ') || 'No description provided';
          };
          
          const description = stripHtml(ticket.Symptom || ticket.Description);
          
          return `INCIDENT #${ticket.IncidentNumber} FOUND:

Title: "${ticket.Subject}"
Current Status: ${ticket.Status}
Priority Level: ${ticket.Priority}
Category: ${ticket.Category || 'Not categorized'}
Subcategory: ${ticket.Subcategory || 'Not specified'}
Service: ${ticket.Service || 'Not specified'}
Impact: ${ticket.Impact || 'Not specified'}
Urgency: ${ticket.Urgency || 'Not specified'}
Source: ${ticket.Source || 'Not specified'}
Assigned To: ${ticket.Owner || 'Unassigned'}
Assigned Team: ${ticket.OwnerTeam || 'Not assigned'}
Reported By: ${ticket.ProfileFullName || 'Unknown'}
Email: ${ticket.Email || 'Not provided'}

Timeline:
${created ? `- Opened: ${created.toLocaleDateString()} at ${created.toLocaleTimeString()}${daysOpen !== null ? ` (${daysOpen} days ago)` : ''}` : '- Opened: Date not available'}
${modified ? `- Last Updated: ${modified.toLocaleDateString()} at ${modified.toLocaleTimeString()}` : '- Last Updated: Date not available'}

Description/Details:
${description}

Resolution:
${ticket.Resolution || 'Not yet resolved'}

INSTRUCTIONS: Explain this incident in a conversational, friendly way using plain text paragraphs. Do NOT use markdown formatting (no asterisks, bold, bullet points). Write naturally like you're explaining to a colleague. Include the description/details in your explanation. If it's been open for a long time, mention that. If it's high priority, emphasize that.`;
        } else {
          console.log(`[IvantiData] ❌ Could not find incident #${ticketNumber} with any query format`);
          return `RESULT: Incident #${ticketNumber} was not found in the system after trying multiple search methods.

POSSIBLE REASONS:
1. The incident number might be incorrect or mistyped
2. The incident might have been deleted or archived
3. You might not have permission to view it
4. It might be in a different system or environment

INSTRUCTIONS: Politely explain that this incident doesn't exist. Be empathetic - maybe they mistyped the number. Suggest they:
- Double-check the incident number (maybe it's 10101 or 10111?)
- Try searching by keywords from the description
- Search by the reporter's name
- Ask their team lead for the correct number
- Check if they're looking in the right system

Be helpful and understanding, not technical. Offer to help search in a different way.`;
        }
      }
      
      // Check if asking about high priority, urgency, or impact incidents
      if (lowerQuery.includes('high priority') || lowerQuery.includes('urgent') || 
          lowerQuery.includes('critical') || lowerQuery.includes('priority 1') || 
          lowerQuery.includes('priority 2')) {
        console.log(`[IvantiData] Searching for high priority incidents`);
        const filter = `Priority le 2`; // Priority <= 2 (Critical or High)
        const tickets = await searchTickets(filter, 20);
        if (tickets.length > 0) {
          const stripHtml = (html: string | null | undefined): string => {
            if (!html) return '';
            return html.replace(/<[^>]*>/g, '')
              .replace(/&nbsp;/g, ' ')
              .replace(/&amp;/g, '&')
              .trim()
              .replace(/\s+/g, ' ');
          };
          
          return `HIGH PRIORITY INCIDENTS (Priority 1 or 2):
TOTAL: ${tickets.length} high priority incidents found

INCIDENT LIST:
${tickets.map((t, index) => {
  const created = new Date(t.CreatedDateTime);
  const daysAgo = Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24));
  const description = stripHtml(t.Symptom || t.Description || '');
  const descPreview = description.length > 100 ? description.substring(0, 100) + '...' : description;
  
  return `${index + 1}. Incident #${t.IncidentNumber} - "${t.Subject}"
   - Status: ${t.Status}
   - Priority: ${t.Priority} (${t.Priority === '1' ? 'Critical' : 'High'})
   - Urgency: ${t.Urgency || 'Not specified'}
   - Impact: ${t.Impact || 'Not specified'}
   - Assigned To: ${t.Owner || 'Unassigned'}
   - Reported By: ${t.ProfileFullName || 'Unknown'}
   - Opened: ${created.toLocaleDateString()} (${daysAgo} days ago)
   ${descPreview ? `- Description: ${descPreview}` : ''}`;
}).join('\n\n')}

INSTRUCTIONS: Present these high priority incidents in a natural, conversational way. Emphasize that these need immediate attention. Do NOT use markdown. Write like you're explaining to a colleague.`;
        } else {
          return `RESULT: No high priority incidents found (Priority 1 or 2).

INSTRUCTIONS: Explain that there are no critical or high priority incidents right now, which is good news.`;
        }
      }
      
      // Check if asking about high urgency incidents
      if (lowerQuery.includes('high urgency') || lowerQuery.includes('urgency high')) {
        console.log(`[IvantiData] Searching for high urgency incidents`);
        const filter = `Urgency eq 'High'`;
        const tickets = await searchTickets(filter, 20);
        if (tickets.length > 0) {
          const stripHtml = (html: string | null | undefined): string => {
            if (!html) return '';
            return html.replace(/<[^>]*>/g, '')
              .replace(/&nbsp;/g, ' ')
              .replace(/&amp;/g, '&')
              .trim()
              .replace(/\s+/g, ' ');
          };
          
          return `HIGH URGENCY INCIDENTS:
TOTAL: ${tickets.length} incidents with high urgency

INCIDENT LIST:
${tickets.map((t, index) => {
  const created = new Date(t.CreatedDateTime);
  const daysAgo = Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24));
  const description = stripHtml(t.Symptom || t.Description || '');
  const descPreview = description.length > 100 ? description.substring(0, 100) + '...' : description;
  
  return `${index + 1}. Incident #${t.IncidentNumber} - "${t.Subject}"
   - Status: ${t.Status}
   - Priority: ${t.Priority}
   - Urgency: High
   - Impact: ${t.Impact || 'Not specified'}
   - Assigned To: ${t.Owner || 'Unassigned'}
   - Opened: ${created.toLocaleDateString()} (${daysAgo} days ago)
   ${descPreview ? `- Description: ${descPreview}` : ''}`;
}).join('\n\n')}

INSTRUCTIONS: Present these high urgency incidents naturally. Explain that high urgency means they need to be resolved quickly. Do NOT use markdown.`;
        } else {
          return `RESULT: No incidents with high urgency found.

INSTRUCTIONS: Explain that there are no high urgency incidents right now.`;
        }
      }
      
      // Check if asking about high impact incidents
      if (lowerQuery.includes('high impact') || lowerQuery.includes('impact high') ||
          (lowerQuery.includes('capacity') && lowerQuery.includes('high'))) {
        console.log(`[IvantiData] Searching for high impact incidents (user may have said 'capacity')`);
        const filter = `Impact eq 'High'`;
        const tickets = await searchTickets(filter, 20);
        if (tickets.length > 0) {
          const stripHtml = (html: string | null | undefined): string => {
            if (!html) return '';
            return html.replace(/<[^>]*>/g, '')
              .replace(/&nbsp;/g, ' ')
              .replace(/&amp;/g, '&')
              .trim()
              .replace(/\s+/g, ' ');
          };
          
          return `HIGH IMPACT INCIDENTS (affecting many users):
TOTAL: ${tickets.length} incidents with high impact

INCIDENT LIST:
${tickets.map((t, index) => {
  const created = new Date(t.CreatedDateTime);
  const daysAgo = Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24));
  const description = stripHtml(t.Symptom || t.Description || '');
  const descPreview = description.length > 100 ? description.substring(0, 100) + '...' : description;
  
  return `${index + 1}. Incident #${t.IncidentNumber} - "${t.Subject}"
   - Status: ${t.Status}
   - Priority: ${t.Priority}
   - Impact: High (affecting many users)
   - Urgency: ${t.Urgency || 'Not specified'}
   - Assigned To: ${t.Owner || 'Unassigned'}
   - Opened: ${created.toLocaleDateString()} (${daysAgo} days ago)
   ${descPreview ? `- Description: ${descPreview}` : ''}`;
}).join('\n\n')}

INSTRUCTIONS: Present these high impact incidents naturally. Explain that high impact means many users are affected. If user said 'capacity', clarify that in Ivanti we use 'Impact' (not capacity) to measure how many users are affected. Do NOT use markdown.`;
        } else {
          return `RESULT: No incidents with high impact found.

INSTRUCTIONS: Explain that there are no high impact incidents right now. If user said 'capacity', clarify that in Ivanti we use 'Impact' to measure how many users are affected, and there are currently no high impact incidents.`;
        }
      }
    }
    
    // Check if asking about users/employees or their tickets
    if (lowerQuery.includes('user') || lowerQuery.includes('employee') || 
        lowerQuery.includes('incidents of') || lowerQuery.includes('tickets of') ||
        lowerQuery.includes('all the incidents') || lowerQuery.includes('show incidents')) {
      
      // 1) Check if an email address is provided (most precise)
      const emailMatch = query.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      if (emailMatch) {
        const email = emailMatch[0];
        console.log(`[IvantiData] Searching for user by email: "${email}"`);

        const employeeByEmail = await searchEmployeeByEmail(email);
        if (!employeeByEmail) {
          return `[SEARCH RESULT]: NO USER FOUND
Email searched: "${email}"
Result: 0 employees found in Ivanti

CRITICAL INSTRUCTIONS TO AI:
- DO NOT make up any RecIds, emails, or user details
- DO NOT say "I found" or present any user information
- Tell the user: "I couldn't find any user with email '${email}' in the Ivanti system"
- Suggest they check the email address for typos or try searching by name
- NEVER invent data that doesn't exist`;
        }

        // If asking about incidents/tickets, fetch them for this user
        if (lowerQuery.includes('incident') || lowerQuery.includes('ticket')) {
          console.log(`[IvantiData] Fetching ALL tickets for: ${employeeByEmail.DisplayName} (email search)`);

          const tickets = await getUserTickets(employeeByEmail.RecId, 50);
          if (tickets.length > 0) {
            const stripHtml = (html: string | null | undefined): string => {
              if (!html) return '';
              return html.replace(/<[^>]*>/g, '')
                .replace(/&nbsp;/g, ' ')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .trim()
                .replace(/\s+/g, ' ');
            };

            return `USER: ${employeeByEmail.DisplayName} (${employeeByEmail.PrimaryEmail})
TOTAL INCIDENTS: ${tickets.length}

INCIDENT LIST:
${tickets.map((t, index) => {
  const created = new Date(t.CreatedDateTime);
  const modified = new Date(t.LastModDateTime);
  const daysAgo = Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24));
  const description = stripHtml(t.Symptom || t.Description || '');
  const descPreview = description.length > 150 ? description.substring(0, 150) + '...' : description;
  
  return `${index + 1}. Incident #${t.IncidentNumber} - "${t.Subject}"
   - Current Status: ${t.Status}
   - Priority Level: ${t.Priority}
   - Category: ${t.Category || 'Not categorized'}
   - Assigned To: ${t.Owner || 'Not yet assigned'}
   - Assigned Team: ${t.OwnerTeam || 'Not assigned'}
   - Opened: ${created.toLocaleDateString()} (${daysAgo} days ago)
   - Last Update: ${modified.toLocaleDateString()}
   ${descPreview ? `- Description: ${descPreview}` : '- Description: No description provided'}`;
}).join('\n\n')}

INSTRUCTIONS: Present this information in a natural, conversational way using plain text paragraphs. Do NOT use markdown formatting. Explain who this user is, how many incidents they have, and highlight any important ones (recent, high priority, etc.).`;
          } else {
            return `USER: ${employeeByEmail.DisplayName} (${employeeByEmail.PrimaryEmail})
RESULT: This user does not have any incidents in the system.

INSTRUCTIONS: Explain this naturally, like "They don't have any tickets right now" or "There are no incidents associated with this user."`;
          }
        }

        // If only user details are requested (no incident keywords)
        return `Found user candidate: ${employeeByEmail.DisplayName} (${employeeByEmail.PrimaryEmail})
Team: ${employeeByEmail.Team || 'No team'} | Department: ${employeeByEmail.Department || 'N/A'}
Status: ${employeeByEmail.Status} | RecId: ${employeeByEmail.RecId}

INSTRUCTIONS: Present this as a likely match and ALWAYS ask the user to confirm if this is the correct person before using this user for any further actions (like viewing or modifying incidents). Do NOT assume this is the right person until the user clearly confirms.`;
      }
      
      // 2) No email – extract a name from various patterns
      let extractedName: string | null = null;
      let nameMatch = query.match(/(?:user|employee)\s+(?:named\s+)?["']?([a-z\s]+)["']?/i);
      if (nameMatch) {
        extractedName = nameMatch[1].trim();
      }
      if (!extractedName) {
        nameMatch = query.match(/(?:incidents|tickets)\s+(?:of|for)\s+["']?([a-z\s]+)["']?/i);
        if (nameMatch) {
          extractedName = nameMatch[1].trim();
      }
      }
      if (!extractedName) {
        // Try to extract just a name (e.g., "Timothy Campos") with capital letters
        nameMatch = query.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/);
      if (nameMatch) {
          extractedName = nameMatch[1].trim();
        }
      }
      if (!extractedName) {
        extractedName = extractNameFromLooseQuery(query, conversationHistory);
      }
      
      if (extractedName) {
        const name = extractedName;
        const lowerName = name.toLowerCase();
        console.log(`[IvantiData] Searching for user by name: "${name}"`);
        
        // First, try exact DisplayName match if full name looks like "First Last"
        let employee: IvantiEmployee | null = null;
        if (name.split(/\s+/).length >= 2) {
          employee = await searchEmployeeByExactName(name);
        }

        // If exact name search didn't find anything, fall back to broader search
        const employeesRaw = employee ? [employee] : await searchEmployees(name, 10);

        // Post-filter results to avoid completely unrelated suggestions:
        // - DisplayName must contain the search string (case-insensitive), or
        // - For multi-part names, at least first OR last token must appear
        let employees = employeesRaw;
        if (!employee && employeesRaw.length > 0) {
          const parts = lowerName.split(/\s+/).filter(Boolean);
          employees = employeesRaw.filter(e => {
            const dn = (e.DisplayName || '').toLowerCase();
            if (!dn) return false;
            if (dn.includes(lowerName)) return true;
            if (parts.length >= 2) {
              const first = parts[0];
              const last = parts[parts.length - 1];
              return dn.includes(first) || dn.includes(last);
            }
            // Single-token name: require that token to appear in DisplayName
            return dn.includes(parts[0]);
          });
        }

        if (employees.length > 0) {
          // Try to find a "did you mean" candidate if we don't already have an exact match
          let chosenEmployee: IvantiEmployee | null = employee;

          if (!chosenEmployee) {
            const parts = lowerName.split(/\s+/);
            if (parts.length >= 2) {
              const qFirst = parts[0];
              const qLast = parts[parts.length - 1];

              for (const e of employees) {
                const dn = (e.DisplayName || '').toLowerCase();
                const dnParts = dn.split(/\s+/);
                if (dnParts.length >= 2) {
                  const eFirst = dnParts[0];
                  const eLast = dnParts[dnParts.length - 1];
                  if (namesAreClose(eFirst, qFirst) && namesAreClose(eLast, qLast)) {
                    chosenEmployee = e;
                    break;
                  }
                }
              }
            }
          }

          // If still no chosen employee and there are multiple, return a suggestion list
          if (!chosenEmployee && employees.length > 1) {
            console.log('[IvantiData] No exact match; returning suggestions list.');
            return `I couldn't find an exact match for "${name}" in Ivanti, but here are some people with similar names:

${employees.map((e, index) => 
  `${index + 1}. ${e.DisplayName} (${e.PrimaryEmail})
   Team: ${e.Team || 'No team'} | Department: ${e.Department || 'N/A'}
   Status: ${e.Status}`).join('\n\n')}

INSTRUCTIONS: Explain that these are suggestions and ask the user which one they meant by number or by name.`;
          }

          // If we found a close match and no exact one, phrase it as a "did you mean" suggestion
          if (!employee && chosenEmployee) {
            console.log('[IvantiData] Using close-match suggestion for user:', chosenEmployee.DisplayName);
            if (lowerQuery.includes('incident') || lowerQuery.includes('ticket')) {
              console.log(`[IvantiData] Fetching ALL tickets for suggested user: ${chosenEmployee.DisplayName}`);

              const tickets = await getUserTickets(chosenEmployee.RecId, 50);
              if (tickets.length > 0) {
                const stripHtml = (html: string | null | undefined): string => {
                  if (!html) return '';
                  return html.replace(/<[^>]*>/g, '')
                    .replace(/&nbsp;/g, ' ')
                    .replace(/&amp;/g, '&')
                    .trim()
                    .replace(/\s+/g, ' ');
                };

                return `I couldn't find an exact match for "${name}", but I did find a very similar user: ${chosenEmployee.DisplayName}.

Here are this user's incidents:

${tickets.map((t, index) => {
  const created = new Date(t.CreatedDateTime);
  const modified = new Date(t.LastModDateTime);
  const daysAgo = Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24));
  const description = stripHtml(t.Symptom || t.Description || '');
  const descPreview = description.length > 150 ? description.substring(0, 150) + '...' : description;
  
  return `${index + 1}. Incident #${t.IncidentNumber} - "${t.Subject}"
   - Current Status: ${t.Status}
   - Priority Level: ${t.Priority}
   - Category: ${t.Category || 'Not categorized'}
   - Assigned To: ${t.Owner || 'Not yet assigned'}
   - Assigned Team: ${t.OwnerTeam || 'Not assigned'}
   - Opened: ${created.toLocaleDateString()} (${daysAgo} days ago)
   - Last Update: ${modified.toLocaleDateString()}
   ${descPreview ? `- Description: ${descPreview}` : '- Description: No description provided'}`;
}).join('\n\n')}

INSTRUCTIONS: Present this as a "Did you mean" suggestion. Make it clear that this is the closest match to the name they provided, and ask them to confirm if this is the right person.`;
              } else {
                return `I couldn't find an exact match for "${name}", but I did find a very similar user: ${chosenEmployee.DisplayName}. This user does not currently have any incidents in the system.

INSTRUCTIONS: Present this as a "Did you mean" suggestion and ask the user to confirm if this is the correct person.`;
              }
            }

            // No incidents requested, just user details with "did you mean" phrasing
            return `I couldn't find an exact match for "${name}", but I did find a very similar user: ${chosenEmployee.DisplayName}.

Email: ${chosenEmployee.PrimaryEmail}
Team: ${chosenEmployee.Team || 'No team'} | Department: ${chosenEmployee.Department || 'N/A'}
Status: ${chosenEmployee.Status} | RecId: ${chosenEmployee.RecId}

INSTRUCTIONS: Present this as a suggestion with "Did you mean...?" and ask the user to confirm.`;
          }

          // Use the chosen employee (either exact or first result)
          const finalEmployee: IvantiEmployee = chosenEmployee || employees[0];
          console.log(`[IvantiData] Using user: ${finalEmployee.DisplayName} (RecId: ${finalEmployee.RecId})`);
          
          // If asking about incidents/tickets, fetch them
          if (lowerQuery.includes('incident') || lowerQuery.includes('ticket')) {
            console.log(`[IvantiData] Fetching ALL tickets for: ${finalEmployee.DisplayName}`);
            
            // Fetch more tickets (up to 50) to show comprehensive list
            const tickets = await getUserTickets(finalEmployee.RecId, 50);
            if (tickets.length > 0) {
              // Helper to strip HTML
              const stripHtml = (html: string | null | undefined): string => {
                if (!html) return '';
                return html.replace(/<[^>]*>/g, '')
                  .replace(/&nbsp;/g, ' ')
                  .replace(/&amp;/g, '&')
                  .replace(/&lt;/g, '<')
                  .replace(/&gt;/g, '>')
                  .replace(/&quot;/g, '"')
                  .replace(/&#39;/g, "'")
                  .trim()
                  .replace(/\s+/g, ' ');
              };
              
              // Format data for AI to present naturally
              return `USER: ${finalEmployee.DisplayName} (${finalEmployee.PrimaryEmail})
TOTAL INCIDENTS: ${tickets.length}

INCIDENT LIST:
${tickets.map((t, index) => {
  const created = new Date(t.CreatedDateTime);
  const modified = new Date(t.LastModDateTime);
  const daysAgo = Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24));
  const description = stripHtml(t.Symptom || t.Description || '');
  const descPreview = description.length > 150 ? description.substring(0, 150) + '...' : description;
  
  return `${index + 1}. Incident #${t.IncidentNumber} - "${t.Subject}"
   - Current Status: ${t.Status}
   - Priority Level: ${t.Priority}
   - Category: ${t.Category || 'Not categorized'}
   - Assigned To: ${t.Owner || 'Not yet assigned'}
   - Assigned Team: ${t.OwnerTeam || 'Not assigned'}
   - Opened: ${created.toLocaleDateString()} (${daysAgo} days ago)
   - Last Update: ${modified.toLocaleDateString()}
   ${descPreview ? `- Description: ${descPreview}` : '- Description: No description provided'}`;
}).join('\n\n')}

INSTRUCTIONS: Present this information in a natural, conversational way using plain text paragraphs. Do NOT use markdown formatting. Don't show raw data. Include description details when explaining incidents. Summarize key insights like how many are open, which are high priority, etc. Write like you're talking to a colleague.`;
            } else {
              return `USER: ${finalEmployee.DisplayName} (${finalEmployee.PrimaryEmail})
RESULT: This user has no incidents in the system.

INSTRUCTIONS: Explain this naturally, like "They don't have any tickets right now" or "There are no incidents associated with this user."`;
            }
          } else {
            // Just return user info
            return `Found user candidate: ${finalEmployee.DisplayName} (${finalEmployee.PrimaryEmail})
Team: ${finalEmployee.Team || 'No team'} | Department: ${finalEmployee.Department || 'N/A'}
Status: ${finalEmployee.Status} | RecId: ${finalEmployee.RecId}

INSTRUCTIONS: Present this as a likely match and ALWAYS ask the user to confirm if this is the correct person before using this user for any further actions (like viewing or modifying incidents). Do NOT assume this is the right person until the user clearly confirms.`;
          }
        } else {
          // NO EMPLOYEES FOUND - Be very explicit
          return `[SEARCH RESULT]: NO USER FOUND
Name searched: "${name}"
Result: 0 employees found in Ivanti

CRITICAL INSTRUCTIONS TO AI:
- DO NOT make up any RecIds, emails, or user details
- DO NOT say "I found" or present any user information
- Tell the user: "I couldn't find any user named '${name}' in the Ivanti system"
- Suggest they check the spelling or try a different search term
- NEVER invent data that doesn't exist`;
        }
      }
    }
    
    // If we get here, try a general search for any numbers in the query
    const anyNumber = query.match(/\b(\d{4,})\b/);
    if (anyNumber) {
      console.log(`[IvantiData] Attempting fallback search for number: ${anyNumber[1]}`);
      const filter = `IncidentNumber eq '${anyNumber[1]}'`;
      const tickets = await searchTickets(filter, 1);
      if (tickets.length > 0) {
        const ticket = tickets[0];
        return `INCIDENT #${ticket.IncidentNumber} FOUND:
Title: "${ticket.Subject}"
Status: ${ticket.Status}
Priority: ${ticket.Priority}

INSTRUCTIONS: Present this naturally.`;
      }
    }
    
    return `I'd be happy to help you find information in Ivanti! Here's what I can do:

SEARCH OPTIONS:
- "Show my tickets" - See all your incidents
- "Show incident 10104" - Look up a specific incident by number
- "Find user John Doe" - Search for a user
- "Show all incidents of [name]" - See someone's tickets

INSTRUCTIONS: Be friendly and encouraging. Offer to help them search in a different way.`;
           
  } catch (error) {
    console.error('[IvantiData] Error in fetchIvantiData:', error);
    return 'Sorry, I encountered an error while fetching data from Ivanti. Please try again.';
  }
}

