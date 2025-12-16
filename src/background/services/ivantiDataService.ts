/**
 * Ivanti Data Service
 * Provides functions for AI to fetch data from Ivanti REST API
 * Now includes intelligent caching for improved performance
 */

import { IVANTI_CONFIG } from '../config';
import { getCachedData, setCachedData } from './cacheService';

/**
 * Shared Ivanti fetch helper with timeout and limited retries.
 * ENTERPRISE PRACTICE: Centralize network resiliency (timeouts, retries, backoff)
 * so all Ivanti calls behave consistently and never hang the extension.
 */
async function ivantiFetch(
  url: string,
  options: RequestInit & { timeoutMs?: number; retries?: number } = {}
): Promise<Response> {
  const { timeoutMs = 8000, retries = 1, ...rest } = options;
  let lastError: any = null;
  let attempt = 0;
  let delay = 500; // start with 0.5s backoff

  while (attempt <= retries) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { ...rest, signal: controller.signal });
      clearTimeout(timeoutId);

      // Retry ONLY on transient server/network style errors
      if (!response.ok && [408, 429, 500, 502, 503, 504].includes(response.status) && attempt < retries) {
        console.warn(
          `[IvantiData] ⚠️ Transient error ${response.status} from Ivanti (attempt ${attempt + 1}/${retries + 1}), retrying in ${delay}ms`
        );
        await new Promise(resolve => setTimeout(resolve, delay));
        attempt++;
        delay = Math.min(delay * 2, 4000); // cap backoff at 4s
        continue;
      }

      return response;
    } catch (error: any) {
      clearTimeout(timeoutId);
      lastError = error;

      // AbortError / network failures → retry if attempts remain
      if (attempt < retries) {
        console.warn(
          '[IvantiData] ⚠️ Network/timeout error calling Ivanti API, retrying...',
          error?.message || error
        );
        await new Promise(resolve => setTimeout(resolve, delay));
        attempt++;
        delay = Math.min(delay * 2, 4000);
        continue;
      }

      break;
    }
  }

  console.error('[IvantiData] ❌ Ivanti fetch failed after retries:', lastError);
  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error('Ivanti fetch failed after retries');
}

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

/**
 * Normalized description of a request offering for AI/UI use
 */
export interface NormalizedRequestOffering {
  recId: string;
  name: string;
  description: string;
  subscriptionId: string;
  topLevelCategory?: string;
  isFormOffering: boolean;
  isPopular: boolean;
}

/**
 * Normalized description of a field in a request offering fieldset
 */
export interface NormalizedOfferingField {
  name: string;
  label: string;
  type: string;
  required: boolean;
  recId?: string; // ✅ RecId for mapping to Ivanti parameters (par-{RecID})
  options?: Array<{ value: string; label: string; recId?: string }>; // ✅ Include recId for combo options
  defaultValue?: any;
}

export interface NormalizedRequestOfferingFieldset {
  subscriptionId: string;
  name?: string;
  description?: string;
  fields: NormalizedOfferingField[];
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

/**
 * Detect short follow-up queries that likely refer to previously fetched data,
 * e.g. "list all of them", "show the rest", "that one", "those tickets", etc.
 * ENTERPRISE PATTERN: Use conversational context before re-parsing natural language.
 */
function isDataFollowUpQuery(query: string): boolean {
  const lower = (query || '').toLowerCase().trim();
  if (!lower) return false;
  // Ignore very long messages – those are usually new intents
  if (lower.length > 160) return false;

  const pronounPhrases = [
    'all of them',
    'list all of them',
    'show all of them',
    'show the rest',
    'list them',
    'show them',
    'those tickets',
    'those incidents',
    'the rest of them',
    'the others',
    'the other ones',
    'that one',
    'this one'
  ];

  if (pronounPhrases.some(p => lower.includes(p))) {
    return true;
  }

  // Generic "list/show" follow‑ups without new domain words often refer to the last result set
  const startsWithListOrShow =
    (lower.startsWith('list') || lower.startsWith('show')) &&
    !lower.includes('ticket') &&
    !lower.includes('incident') &&
    !lower.includes('user') &&
    !lower.includes('employee');

  return startsWithListOrShow;
}

/**
 * Extract the raw Ivanti context payload from a system message block
 * of the form: "[DATA FETCHED FROM IVANTI...]:\n<ivantiContext>"
 */
function extractIvantiContextFromBlock(block: string): string {
  if (!block) return '';
  const headerEnd = block.indexOf(']:');
  if (headerEnd !== -1) {
    return block.substring(headerEnd + 2).trimStart();
  }
  const newline = block.indexOf('\n');
  if (newline !== -1) {
    return block.substring(newline + 1).trimStart();
  }
  return block;
}

/**
 * Reuse the most recent Ivanti data block from conversation history.
 * This allows fast, consistent follow‑ups like "list all of them"
 * without re-calling the API when we already have fresh data.
 */
function getLastIvantiDataContextFromHistory(
  conversationHistory?: ConversationMessage[]
): string | null {
  if (!Array.isArray(conversationHistory) || conversationHistory.length === 0) {
    return null;
  }

  for (let i = conversationHistory.length - 1; i >= 0; i--) {
    const msg = conversationHistory[i];
    if (!msg || typeof msg.content !== 'string') continue;

    // System messages inserted by aiService contain this marker
    if (msg.role === 'system' && msg.content.startsWith('[DATA FETCHED FROM IVANTI')) {
      return extractIvantiContextFromBlock(msg.content);
    }
  }

  return null;
}

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
    
    const response = await ivantiFetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `rest_api_key=${IVANTI_CONFIG.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeoutMs: 8000,
      retries: 2
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
/**
 * INDUSTRY BEST PRACTICE: Get user tickets with pagination and incremental sync
 * - Server-side filtering by RecId (indexed for performance)
 * - Pagination support (limit/skip)
 * - Optional incremental sync with updatedSince
 * - Per-user caching with 10min TTL
 */
export interface PaginatedIncidents {
  incidents: IvantiTicket[];
  totalCount: number;
  hasMore: boolean;
  nextSkip: number;
}

export async function getUserTickets(
  userRecId: string, 
  limit: number = 50,
  skip: number = 0,
  updatedSince?: Date
): Promise<IvantiTicket[]> {
  // Server-side filter: Optimized with index on ProfileLink_RecID
  let filter = `ProfileLink_RecID eq '${userRecId}'`;
  
  // INCREMENTAL SYNC: Only fetch incidents modified after last sync
  if (updatedSince) {
    const isoDate = updatedSince.toISOString();
    filter += ` and LastModDateTime gt DateTime'${isoDate}'`;
    console.log(`[IvantiData] 📅 Incremental sync: fetching incidents updated since ${isoDate}`);
  }
  
  return searchTickets(filter, limit, skip);
}

/**
 * PAGINATED VERSION: Get user tickets with pagination metadata
 * Returns pagination info for "load more" functionality
 */
export async function getUserTicketsPaginated(
  userRecId: string,
  limit: number = 50,
  skip: number = 0
): Promise<PaginatedIncidents> {
  const incidents = await getUserTickets(userRecId, limit + 1, skip); // Fetch 1 extra to check hasMore
  
  const hasMore = incidents.length > limit;
  const actualIncidents = hasMore ? incidents.slice(0, limit) : incidents;
  
  return {
    incidents: actualIncidents,
    totalCount: actualIncidents.length,
    hasMore,
    nextSkip: skip + limit
  };
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
    
    const response = await ivantiFetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `rest_api_key=${IVANTI_CONFIG.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeoutMs: 8000,
      retries: 2
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
    
      const fallbackResponse = await ivantiFetch(fallbackUrl, {
        method: 'GET',
        headers: {
          'Authorization': `rest_api_key=${IVANTI_CONFIG.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeoutMs: 8000,
        retries: 1
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
    
    const response = await ivantiFetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `rest_api_key=${IVANTI_CONFIG.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeoutMs: 8000,
      retries: 2
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
    
    const response = await ivantiFetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `rest_api_key=${IVANTI_CONFIG.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeoutMs: 8000,
      retries: 2
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
    // Include baseUrl in cache params to isolate by Ivanti instance
    const cacheParams = { endpoint: 'requestOfferings', baseUrl: IVANTI_CONFIG.baseUrl };
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
 * Pre-fetch and cache ALL Request Offerings with their fieldsets
 * This builds a complete knowledge base of all offerings so the AI knows everything upfront
 */
export async function prefetchAllRequestOfferingsWithFieldsets(): Promise<void> {
  try {
    console.log('[IvantiData] 🚀 Pre-fetching all Request Offerings with fieldsets...');
    
    // Fetch all offerings
    const offerings = await fetchRequestOfferings();
    if (offerings.length === 0) {
      console.warn('[IvantiData] ⚠️ No Request Offerings to pre-fetch');
      return;
    }
    
    console.log(`[IvantiData] 📦 Pre-fetching fieldsets for ${offerings.length} offerings...`);
    
    // Pre-fetch fieldsets for all offerings (in parallel, but limit concurrency)
    const fieldsetsMap: Record<string, { offering: any; fieldset: IvantiRequestOfferingFieldset | null }> = {};
    const BATCH_SIZE = 5; // Process 5 at a time to avoid overwhelming the API
    
    for (let i = 0; i < offerings.length; i += BATCH_SIZE) {
      const batch = offerings.slice(i, i + BATCH_SIZE);
      const batchPromises = batch.map(async (offering: any) => {
        const subId = offering.strSubscriptionId || offering.SubscriptionId || '';
        if (!subId) return;
        
        try {
          // ✅ Pass offering object to fetch correct template structure
          const fieldset = await fetchRequestOfferingFieldset(subId, offering);
          fieldsetsMap[subId] = {
            offering,
            fieldset
          };
          console.log(`[IvantiData] ✅ Pre-fetched fieldset for: ${offering.strName || offering.Name || 'Unknown'}`);
        } catch (error) {
          console.warn(`[IvantiData] ⚠️ Failed to pre-fetch fieldset for ${subId}:`, error);
          fieldsetsMap[subId] = {
            offering,
            fieldset: null
          };
        }
      });
      
      await Promise.all(batchPromises);
      
      // Small delay between batches to avoid rate limiting
      if (i + BATCH_SIZE < offerings.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    
    // Store complete offering knowledge base in local storage
    const baseUrl = IVANTI_CONFIG.baseUrl;
    const cacheParams = { endpoint: 'requestOfferingsComplete', baseUrl };
    
    // Structure: Map of subscriptionId -> { offering, normalizedFieldset }
    const completeOfferings: Record<string, {
      offering: any;
      normalizedFieldset: NormalizedRequestOfferingFieldset | null;
    }> = {};
    
    for (const [subId, data] of Object.entries(fieldsetsMap)) {
      if (data.fieldset) {
        const normalized = normalizeRequestOfferingFieldset(data.fieldset, data.offering);
        completeOfferings[subId] = {
          offering: data.offering,
          normalizedFieldset: normalized
        };
      } else {
        completeOfferings[subId] = {
          offering: data.offering,
          normalizedFieldset: null
        };
      }
    }
    
    await setCachedData('requestOfferingsComplete', cacheParams, completeOfferings);
    console.log(`[IvantiData] ✅ Pre-fetched and cached ${Object.keys(completeOfferings).length} complete Request Offerings with fieldsets`);
  } catch (error) {
    console.error('[IvantiData] ❌ Error pre-fetching Request Offerings with fieldsets:', error);
  }
}

/**
 * Get complete Request Offering knowledge (offering + fieldset) from cache
 */
export async function getCachedCompleteOffering(subscriptionId: string): Promise<{
  offering: any;
  normalizedFieldset: NormalizedRequestOfferingFieldset | null;
} | null> {
  try {
    const baseUrl = IVANTI_CONFIG.baseUrl;
    const cacheParams = { endpoint: 'requestOfferingsComplete', baseUrl };
    const cached = await getCachedData<Record<string, {
      offering: any;
      normalizedFieldset: NormalizedRequestOfferingFieldset | null;
    }>>('requestOfferingsComplete', cacheParams);
    
    if (cached && cached[subscriptionId]) {
      return cached[subscriptionId];
    }
    
    return null;
  } catch (error) {
    console.error('[IvantiData] Error getting cached complete offering:', error);
    return null;
  }
}

/**
 * Get ALL complete Request Offerings from cache (for AI context)
 */
export async function getAllCachedCompleteOfferings(): Promise<Array<{
  offering: any;
  normalizedFieldset: NormalizedRequestOfferingFieldset | null;
}>> {
  try {
    const baseUrl = IVANTI_CONFIG.baseUrl;
    const cacheParams = { endpoint: 'requestOfferingsComplete', baseUrl };
    const cached = await getCachedData<Record<string, {
      offering: any;
      normalizedFieldset: NormalizedRequestOfferingFieldset | null;
    }>>('requestOfferingsComplete', cacheParams);
    
    if (cached) {
      return Object.values(cached);
    }
    
    return [];
  } catch (error) {
    console.error('[IvantiData] Error getting all cached complete offerings:', error);
    return [];
  }
}

/**
 * Fetch Request Offering Fieldset from Ivanti
 * Requires a subscriptionId (from the request offering)
 */
/**
 * Fetch template using the _All_ endpoint (gets complete template structure)
 * This is the CORRECT way to get the actual template fields, not just parameters
 */
export async function fetchTemplateByRecId(templateRecId: string): Promise<any | null> {
  try {
    console.log(`[IvantiData] 🔍 Fetching template using _All_ endpoint: ${templateRecId}`);
    
    const url = `${IVANTI_CONFIG.baseUrl}/HEAT/api/rest/Template/${templateRecId}/_All_`;
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
          const template = JSON.parse(responseText);
          console.log(`[IvantiData] ✅ Retrieved template via _All_ endpoint for ${templateRecId}`);
          console.log(`[IvantiData] 🔍 Template keys:`, Object.keys(template || {}));
          return template;
        }
      }
    }
    
    console.warn(`[IvantiData] ⚠️ Template not found via _All_ endpoint for ${templateRecId}`);
    return null;
  } catch (error) {
    console.error(`[IvantiData] ❌ Error fetching template via _All_ endpoint:`, error);
    return null;
  }
}

export async function fetchRequestOfferingFieldset(subscriptionId: string, offering?: any): Promise<IvantiRequestOfferingFieldset | null> {
  try {
    console.log(`[IvantiData] Fetching request offering fieldset for: ${subscriptionId}`);
    // Include baseUrl in cache params to isolate by Ivanti instance
    const cacheParams = { subscriptionId, baseUrl: IVANTI_CONFIG.baseUrl };
    const cached = await getCachedData<IvantiRequestOfferingFieldset>('requestOfferingFieldset', cacheParams);
    if (cached) {
      console.log(`[IvantiData] ✅ Using cached fieldset for ${subscriptionId}`);
      return cached;
    }
    
    // ✅ NEW: Try fetching template via _All_ endpoint first (gets actual template structure)
    if (offering) {
      // Check multiple possible locations for Template RecId
      const templateRecId = offering.ServiceReqTemplateDefinitionLink_RecID || 
                           offering.strTemplateRecId || 
                           offering.TemplateRecId ||
                           offering.strServiceReqTemplateDefinitionLink_RecID ||
                           (offering as any).ServiceReqTemplateDefinitionLink_RecID ||
                           (offering as any).TemplateDefinitionLink_RecID ||
                           offering.RecId; // Fallback: sometimes RecId is the template ID
      
      console.log(`[IvantiData] 🔍 Checking for Template RecId in offering:`, {
        ServiceReqTemplateDefinitionLink_RecID: offering.ServiceReqTemplateDefinitionLink_RecID,
        strTemplateRecId: (offering as any).strTemplateRecId,
        TemplateRecId: (offering as any).TemplateRecId,
        RecId: offering.RecId,
        subscriptionId,
        foundTemplateRecId: templateRecId
      });
      
      // Try with templateRecId if different from subscriptionId
      if (templateRecId && templateRecId !== subscriptionId) {
        console.log(`[IvantiData] 🔍 Attempting to fetch template via _All_ endpoint: ${templateRecId}`);
        const template = await fetchTemplateByRecId(templateRecId);
        
        if (template) {
          // Check if template has better field structure
          const templateKeys = Object.keys(template || {});
          console.log(`[IvantiData] 🔍 Template structure keys:`, templateKeys);
          
          // If template has Fields or better structure, use it
          if (template.Fields || template.lstParameters || template.lstParamCategories || template.TemplateDefinition) {
            console.log(`[IvantiData] ✅ Using template from _All_ endpoint (better structure)`);
            await setCachedData('requestOfferingFieldset', cacheParams, template);
            return template;
          }
        }
      }
      
      // ✅ ALSO TRY: Use subscriptionId directly as template RecId (some offerings use subscriptionId as template ID)
      console.log(`[IvantiData] 🔍 Also trying subscriptionId as template RecId: ${subscriptionId}`);
      const templateBySubId = await fetchTemplateByRecId(subscriptionId);
      if (templateBySubId) {
        const templateKeys = Object.keys(templateBySubId || {});
        console.log(`[IvantiData] 🔍 Template (by subscriptionId) structure keys:`, templateKeys);
        
        // Check if this has a different/better structure than PackageData
        if (templateBySubId.Fields || templateBySubId.TemplateDefinition) {
          console.log(`[IvantiData] ✅ Using template from _All_ endpoint (using subscriptionId as RecId)`);
          await setCachedData('requestOfferingFieldset', cacheParams, templateBySubId);
          return templateBySubId;
        }
      }
    }
    
    // Fallback to original endpoint
    console.log(`[IvantiData] 🔄 Falling back to PackageData endpoint`);
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
          
          // ✅ Check if fieldset has Template RecId we can use to fetch actual template
          const templateRecIdFromFieldset = (fieldset as any).ServiceReqTemplateDefinitionLink_RecID ||
                                           (fieldset as any).strTemplateRecId ||
                                           (fieldset as any).TemplateRecId ||
                                           (fieldset as any).RecId;
          
          if (templateRecIdFromFieldset && templateRecIdFromFieldset !== subscriptionId) {
            console.log(`[IvantiData] 🔍 Found Template RecId in fieldset response: ${templateRecIdFromFieldset}`);
            console.log(`[IvantiData] 🔍 Attempting to fetch actual template via _All_ endpoint`);
            
            const actualTemplate = await fetchTemplateByRecId(templateRecIdFromFieldset);
            if (actualTemplate) {
              const templateKeys = Object.keys(actualTemplate || {});
              console.log(`[IvantiData] 🔍 Actual template structure keys:`, templateKeys);
              
              // If template has Fields or TemplateDefinition, it's the real template structure
              if (actualTemplate.Fields || actualTemplate.TemplateDefinition || 
                  (actualTemplate.lstParamCategories && actualTemplate.lstParamCategories.length > 0)) {
                console.log(`[IvantiData] ✅ Using actual template from _All_ endpoint (found via fieldset)`);
                await setCachedData('requestOfferingFieldset', cacheParams, actualTemplate);
                return actualTemplate;
              }
            }
          }
          
          // Use PackageData response (parameters) as fallback
          await setCachedData('requestOfferingFieldset', cacheParams, fieldset);
          console.log(`[IvantiData] ✅ Retrieved fieldset via PackageData endpoint for ${subscriptionId}`);
          console.log(`[IvantiData] ⚠️ NOTE: This contains PARAMETERS (lstParamCategories), not actual template fields`);
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

/**
 * Rank request offerings by how well they match a free-text intent.
 * Uses name/description/category keyword overlap.
 */
export function findBestRequestOfferings(
  intent: string,
  offerings: IvantiRequestOffering[],
  maxResults: number = 5
): NormalizedRequestOffering[] {
  const query = intent.toLowerCase();
  const keywords = query.split(/\s+/).filter(w => w.length > 2);

  const scored = offerings.map(o => {
    const haystackParts: string[] = [];
    if (o.Name || (o as any).strName) haystackParts.push(String(o.Name || (o as any).strName));
    if (o.Description || (o as any).strDescription) haystackParts.push(String(o.Description || (o as any).strDescription));
    if ((o as any).TopLevelCategories) {
      try {
        const tlc = (o as any).TopLevelCategories as any[];
        tlc.forEach(pair => {
          if (Array.isArray(pair) && pair[0]) haystackParts.push(String(pair[0]));
        });
      } catch {
        // ignore
      }
    }

    const haystack = haystackParts.join(' ').toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (!kw) continue;
      if (haystack.includes(kw)) score += 2;
      if (haystack.startsWith(kw) || haystack.includes(` ${kw}`)) score += 1;
    }

    // Small boost for popular offerings
    if ((o as any).IsPopular) score += 1;

    const name = String(o.Name || (o as any).strName || '').trim();
    const description = String(o.Description || (o as any).strDescription || '').trim();
    const topLevelCategory =
      Array.isArray((o as any).TopLevelCategories) && (o as any).TopLevelCategories.length > 0
        ? String((o as any).TopLevelCategories[0][0])
        : undefined;

    const normalized: NormalizedRequestOffering = {
      recId: (o as any).strRecId || o.RecId || '',
      name,
      description,
      subscriptionId: (o as any).strSubscriptionId || (o as any).SubscriptionId || '',
      topLevelCategory,
      isFormOffering: !!(o as any).bIsFormOffering,
      isPopular: !!(o as any).IsPopular
    };

    return { score, offering: normalized };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(s => s.offering);
}

/**
 * Normalize a raw request offering fieldset into a simpler structure for AI/UI.
 */
export function normalizeRequestOfferingFieldset(
  raw: IvantiRequestOfferingFieldset,
  offering?: IvantiRequestOffering
): NormalizedRequestOfferingFieldset {
  // Try multiple locations for fields in the raw fieldset
  let rawFields: any[] = [];

  console.log('[IvantiData] 🔍 Normalizing fieldset. Full raw object keys:', Object.keys(raw || {}));
  console.log('[IvantiData] 🔍 Checking lstParameters:', (raw as any).lstParameters);
  console.log('[IvantiData] 🔍 Checking lstPackages:', (raw as any).lstPackages);
  console.log('[IvantiData] 🔍 Checking lstParamCategories:', (raw as any).lstParamCategories);
  
  // ✅ NEW: Check if this is a template from _All_ endpoint (might have different structure)
  if ((raw as any).TemplateDefinition || (raw as any).Fields || (raw as any).LayoutDefinition) {
    console.log('[IvantiData] 🔍 Detected template structure from _All_ endpoint');
    // Template might have fields directly or in TemplateDefinition
    if ((raw as any).TemplateDefinition?.Fields) {
      rawFields = (raw as any).TemplateDefinition.Fields;
      console.log('[IvantiData] ✅ Found fields in TemplateDefinition.Fields:', rawFields.length);
    } else if ((raw as any).Fields && Array.isArray((raw as any).Fields)) {
      rawFields = (raw as any).Fields;
      console.log('[IvantiData] ✅ Found fields in template Fields:', rawFields.length);
    }
  }
  
  // ✅ PRIMARY: Check ALL lstParamCategories (not just [0]) - forms have multiple sections
  if ((raw as any).lstParamCategories && Array.isArray((raw as any).lstParamCategories) && (raw as any).lstParamCategories.length > 0) {
    console.log(`[IvantiData] 🔍 Found ${(raw as any).lstParamCategories.length} parameter categories`);
    
    // Collect fields from ALL categories (USER INFORMATION, REQUEST DETAILS, etc.)
    const allCategoryFields: any[] = [];
    (raw as any).lstParamCategories.forEach((category: any, index: number) => {
      const categoryName = category.localizedDisplayNames?.en_US || 
                          category.localizedDisplayNames?.['en-US'] ||
                          category.strDisplayName || 
                          category.strName ||
                          `Category ${index}`;
      
      console.log(`[IvantiData] 🔍 Category [${index}]: "${categoryName}"`, {
        displayName: categoryName,
        parametersCount: category.lstParameters?.length || 0,
        fieldNames: category.lstParameters?.slice(0, 5).map((p: any) => p.strName || p.Name).join(', ') || 'none'
      });
      
      if (category?.lstParameters && Array.isArray(category.lstParameters) && category.lstParameters.length > 0) {
        allCategoryFields.push(...category.lstParameters);
        console.log(`[IvantiData] ✅ Found ${category.lstParameters.length} fields in category "${categoryName}"`);
      }
    });
    
    if (allCategoryFields.length > 0) {
      rawFields = allCategoryFields;
      console.log(`[IvantiData] ✅ Collected ${rawFields.length} total fields from ${(raw as any).lstParamCategories.length} categories`);
      console.log(`[IvantiData] 🔍 Field names:`, rawFields.slice(0, 10).map((f: any) => f.strName || f.Name).join(', '));
    }
  }
  
  // Fallback to other locations
  if (rawFields.length === 0 && (raw as any).lstParameters && Array.isArray((raw as any).lstParameters) && (raw as any).lstParameters.length > 0) {
    rawFields = (raw as any).lstParameters;
    console.log('[IvantiData] ✅ Found fields in lstParameters:', rawFields.length);
  } else if (rawFields.length === 0 && (raw as any).lstPackages && Array.isArray((raw as any).lstPackages) && (raw as any).lstPackages.length > 0) {
    const firstPackage = (raw as any).lstPackages[0];
    if (firstPackage?.Fields || firstPackage?.lstParameters || firstPackage?.Parameters) {
      rawFields = firstPackage.Fields || firstPackage.lstParameters || firstPackage.Parameters;
      console.log('[IvantiData] ✅ Found fields in lstPackages[0]:', rawFields.length);
    }
  } else if (rawFields.length === 0 && raw.Fields && Array.isArray(raw.Fields) && raw.Fields.length > 0) {
    rawFields = raw.Fields;
    console.log('[IvantiData] ✅ Found fields in Fields:', rawFields.length);
  }
  
  if (rawFields.length === 0) {
    console.warn('[IvantiData] ⚠️ Could not find any fields in raw fieldset');
  }
  
  // ✅ FILTER: Only show REQUIRED fields and visible READ-ONLY fields (pre-filled, but visible)
  // Hide all optional, hidden, and conditional fields to keep the form simple
  const visibleFields = rawFields.filter((f: any) => {
    // 1. ALWAYS filter out hidden fields
    if (f.bIsHidden === true) {
      console.log(`[IvantiData] 🚫 Filtering out hidden field: ${f.strName || f.Name}`);
      return false;
    }
    
    // 2. ALWAYS filter out fields with false visibility expression
    const visibilityExpr = f.strVisibilityExpression || f.visibilityExpression?.Source || '';
    if (visibilityExpr) {
      const exprLower = visibilityExpr.toLowerCase().trim();
      if (exprLower === '$(false)' || exprLower === 'false' || exprLower.includes('$(false)')) {
        console.log(`[IvantiData] 🚫 Filtering out field with false visibility: ${f.strName || f.Name}`);
        return false;
      }
    }
    
    // 3. ALWAYS filter out layout fields
    const fieldType = (f.strType || f.Type || '').toLowerCase();
    if (fieldType === 'rowaligner' || fieldType === 'spacer' || fieldType === 'separator') {
      console.log(`[IvantiData] 🚫 Filtering out layout field: ${f.strName || f.Name}`);
      return false;
    }
    
    // 4. Check if field is REQUIRED
    let isRequired = false;
    if (f.bIsRequired === true || f.Required === true || f.required === true) {
      isRequired = true;
    } else if (f.requiredExpression || f.strRequiredExpression) {
      const expr = String(f.requiredExpression || f.strRequiredExpression || '').toLowerCase();
      isRequired = expr !== '' && expr !== '$(false)' && expr !== 'false' && expr !== '0';
    }
    
    // 5. Check if field is READ-ONLY but VISIBLE (pre-filled, user can see but not edit)
    const readOnlyExpr = f.strReadOnlyExpression || f.readOnlyExpression?.Source || '';
    let isReadOnlyVisible = false;
    if (readOnlyExpr) {
      const exprLower = readOnlyExpr.toLowerCase().trim();
      // Read-only but visible (pre-filled fields like Login Id, Financial Owner)
      if (exprLower === '$(true)' || exprLower === 'true') {
        isReadOnlyVisible = true;
      }
    }
    
    // 6. ✅ ONLY SHOW: Required fields OR visible read-only fields (pre-filled)
    if (isRequired || isReadOnlyVisible) {
      console.log(`[IvantiData] ✅ Keeping field: ${f.strName || f.Name} (required: ${isRequired}, readOnlyVisible: ${isReadOnlyVisible})`);
      return true;
    }
    
    // 7. Filter out everything else (optional fields)
    console.log(`[IvantiData] 🚫 Filtering out optional field: ${f.strName || f.Name}`);
    return false;
  });
  
  console.log(`[IvantiData] ✅ Filtered ${rawFields.length} fields down to ${visibleFields.length} visible/editable fields`);
  console.log(`[IvantiData] 🔍 Visible field names:`, visibleFields.slice(0, 10).map((f: any) => f.strName || f.Name).join(', '));
  
  const fields: NormalizedOfferingField[] = visibleFields.map(f => {
    // lstParameters have different property names than Fields
    // Map both formats
    const name = f.strName || f.Name || f.name || '';
    
    // ✅ PRIORITIZE localized titles (better labels like "Request Type" vs "requestedFor")
    // Check multiple possible property names and formats
    const localizedTitles = (f as any).localizedTitles || (f as any).localizedLables || (f as any).LocalizedTitles;
    const localizedLabel = localizedTitles?.en_US || 
                          localizedTitles?.['en-US'] ||
                          localizedTitles?.en ||
                          localizedTitles?.en_US?.trim() ||
                          (localizedTitles && typeof localizedTitles === 'object' ? 
                            Object.values(localizedTitles).find((v: any) => v && typeof v === 'string' && v.trim() !== '') as string | undefined : 
                            null);
    
    // ✅ Also check ValidationListDef for display names (combo fields often have labels here)
    const validationListLabel = (f as any).ValidationListDef?.DisplayName || 
                                (f as any).ValidationListDef?.Name;
    
    // ✅ Try to extract label from category or field metadata (Ivanti uses various property names)
    const metadataLabel = (f as any).strLabel || 
                         (f as any).Label ||
                         (f as any).DisplayName || 
                         (f as any).strDisplayName || 
                         (f as any).label ||
                         (f as any).FieldLabel ||
                         (f as any).strFieldLabel;
    
    // ✅ Fallback: Try to humanize the field name (e.g., "requestedFor" -> "Requested For")
    const humanizedName = name && name !== localizedLabel && name !== metadataLabel && name !== validationListLabel
      ? name
          .replace(/_/g, ' ')
          .replace(/([A-Z])/g, ' $1')
          .replace(/^./, (str: string) => str.toUpperCase())
          .trim()
      : null;
    
    // ✅ Final label priority: localizedTitles (exact match to Ivanti UI) > ValidationListDef > metadata > humanized > name
    const label = (localizedLabel && localizedLabel.trim() !== '') ? localizedLabel.trim() :
                  (validationListLabel && validationListLabel.trim() !== '') ? validationListLabel.trim() :
                  (metadataLabel && metadataLabel.trim() !== '') ? metadataLabel.trim() :
                  (humanizedName && humanizedName.trim() !== '') ? humanizedName.trim() :
                  name;
    
    // ✅ Log label extraction for debugging
    if (!localizedLabel && (f as any).localizedTitles) {
      console.log(`[IvantiData] ⚠️ localizedTitles exists but no en_US found:`, {
        name,
        localizedTitles: (f as any).localizedTitles,
        keys: Object.keys((f as any).localizedTitles || {})
      });
    }
    
    const type = f.strType || f.Type || f.type || 'text';
    
    // ✅ CHECK MULTIPLE POSSIBLE LOCATIONS FOR REQUIRED FLAG
    let required = false;
    if (f.bIsRequired === true || f.Required === true || f.required === true) {
      required = true;
    }
    // Some Ivanti instances use requiredExpression or strRequiredExpression
    else if (f.requiredExpression || f.strRequiredExpression) {
      const expr = String(f.requiredExpression || f.strRequiredExpression || '').toLowerCase();
      // If expression is not empty and not "false", consider it required
      required = expr !== '' && expr !== 'false' && expr !== '0';
    }
    
    const defaultValue = f.strDefaultValue || f.DefaultValue || f.defaultValue || undefined;
    const recId = f.RecId || f.recId || f.strRecId || undefined; // ✅ Capture RecId for parameters mapping
    
    // ✅ DEBUG: Log all fields to understand required flag
    console.log('[IvantiData] 🔍 Field:', {
      name,
      label,
      bIsRequired: f.bIsRequired,
      Required: f.Required,
      required: f.required,
      requiredExpression: f.requiredExpression,
      strRequiredExpression: f.strRequiredExpression,
      computed_required: required
    });
    
    // ✅ DEBUG: Log raw field structure for combo fields to find options
    if (type === 'combo' || type === 'dropdown') {
      console.log('[IvantiData] 🔍 RAW COMBO FIELD:', JSON.stringify(f, null, 2).substring(0, 3000));
      console.log('[IvantiData] 🔍 RAW COMBO FIELD KEYS:', Object.keys(f));
    }
    
    // ✅ For combo/dropdown fields, capture option RecIds too
    const options = f.Options || f.options || f.lstOptions || f.lstValidValues || f.ValidationList;
    const normalizedOptions = options ? options.map((opt: any) => ({
      value: opt.Value || opt.value || opt.strValue,
      label: opt.Label || opt.label || opt.strLabel || opt.strDisplayName,
      recId: opt.RecId || opt.recId || opt.strRecId // ✅ Capture option RecId for Ivanti API
    })) : undefined;
    
    const labelSource = localizedLabel ? 'localizedTitles' : 
                       validationListLabel ? 'ValidationListDef' :
                       metadataLabel ? 'metadata' :
                       humanizedName ? 'humanized' : 'name';
    
    console.log('[IvantiData] 🔍 Normalized field:', { 
      name, 
      label, 
      type, 
      required, 
      defaultValue, 
      recId, 
      optionsCount: normalizedOptions?.length,
      labelSource,
      localizedTitlesValue: localizedLabel || 'not found',
      metadataLabelValue: metadataLabel || 'not found'
    });
    if (normalizedOptions && normalizedOptions.length > 0) {
      console.log('[IvantiData] 🔍   Options:', normalizedOptions);
    }

  return {
      name,
      label,
      type,
      required,
      recId, // ✅ Include RecId in normalized field
      options: normalizedOptions,
      defaultValue
    };
  });

  console.log('[IvantiData] ✅ Normalized', fields.length, 'fields');

  return {
    subscriptionId: (raw as any).strSubscriptionRecId || raw.SubscriptionId,
    name: (offering as any)?.strName || (offering as any)?.Name,
    description: (offering as any)?.strDescription || (offering as any)?.Description,
    fields
  };
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
    
    // Category is REQUIRED by Ivanti - ensure it's provided AND valid
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
    
    // ⚠️ CRITICAL: Validate category against Ivanti's validation list
    // Categories are validated fields - they must match exact values in the system
    try {
      const validCategories = await fetchCategories(100);
      const categoryNames = validCategories
        .map(c => c.Name || c.DisplayName || '')
        .filter(name => name.trim() !== '');
      
      // Check if provided category is valid (case-insensitive match)
      const categoryLower = category.toLowerCase().trim();
      const isValidCategory = categoryNames.some(
        validName => validName.toLowerCase().trim() === categoryLower
      );
      
      if (!isValidCategory && categoryNames.length > 0) {
        // Try to find a close match (fuzzy matching)
        // Look for categories containing the user's category words
        const categoryWords = categoryLower.split(/\s+/).filter(w => w.length > 2);
        const closeMatch = categoryNames.find(validName => {
          const validLower = validName.toLowerCase();
          return categoryWords.some(word => validLower.includes(word)) ||
                 validLower.includes(categoryLower) ||
                 categoryLower.includes(validLower);
        });
        
        if (closeMatch) {
          console.warn(`[IvantiData] ⚠️ Category "${category}" not found in validation list. Using close match: "${closeMatch}"`);
          category = closeMatch; // Use exact name from Ivanti (case-sensitive)
        } else {
          // No close match found - return error with valid categories
          const topCategories = categoryNames.slice(0, 10).join(', ');
          console.error(`[IvantiData] ❌ Invalid category "${category}". Valid categories include: ${topCategories}...`);
          return {
            success: false,
            error: `Invalid category "${category}". Category must be a valid value from Ivanti's validation list. Valid categories include: ${topCategories}${categoryNames.length > 10 ? `, and ${categoryNames.length - 10} more` : ''}. Please check the available categories in Ivanti.`
          };
        }
      } else if (!isValidCategory && categoryNames.length === 0) {
        // Can't validate - proceed with warning (might be a connection issue)
        console.warn(`[IvantiData] ⚠️ Could not fetch categories for validation. Proceeding with category: "${category}"`);
      }
      
      // Ensure we use the exact case-sensitive name from Ivanti
      if (isValidCategory) {
        const exactMatch = categoryNames.find(
          validName => validName.toLowerCase().trim() === categoryLower
        );
        if (exactMatch) {
          category = exactMatch; // Use exact case from Ivanti
        }
      }
    } catch (validationError) {
      // If category validation fails, log warning but proceed (might be connection issue)
      console.warn('[IvantiData] ⚠️ Error validating category (proceeding anyway):', validationError);
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
    CauseCode?: string;
    [key: string]: any; // Allow any other fields
  },
  currentUser: any
): Promise<{ success: boolean; incidentNumber?: string; error?: string }> {
  try {
    console.log('[IvantiData] Updating incident:', incidentRecId, updateData);
    
    // ⚠️ CRITICAL: When status is "Resolved", CauseCode is REQUIRED by Ivanti
    if (updateData.Status === 'Resolved' && !updateData.CauseCode) {
      console.warn('[IvantiData] ⚠️ Status is "Resolved" but CauseCode not provided. Using default value "Fixed"');
      // Use a default CauseCode if not provided
      // Common values: "Fixed", "Resolved", "Completed", "No Problem Found", "User Error"
      // Using "Fixed" as a safe default
      updateData.CauseCode = 'Fixed';
    }
    
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
    const lowerQuery = query.toLowerCase();

    // FIRST: If this looks like a short follow-up ("list all of them"),
    // try to reuse the last fetched Ivanti data from conversation history.
    if (isDataFollowUpQuery(query)) {
      const previousContext = getLastIvantiDataContextFromHistory(conversationHistory);
      if (previousContext) {
        console.log('[IvantiData] ♻️ Reusing previous Ivanti data context for follow-up query');
        return previousContext;
      }
    }

    // Detect if this looks like a dynamic data query (tickets, incidents, live objects).
    // For these, we prefer live Ivanti REST data (with caching) over static knowledge base snapshots.
    const isDynamicDataQuery =
      lowerQuery.includes('ticket') ||
      lowerQuery.includes('incident') ||
      lowerQuery.includes('service request') ||
      lowerQuery.includes('servicerequest') ||
      lowerQuery.includes('sr#') ||
      lowerQuery.includes('request offering') ||
      lowerQuery.includes('category') ||
      lowerQuery.includes('team') ||
      lowerQuery.includes('department') ||
      /\b\d{4,}\b/.test(query);

    // FIRST: Try to get data from knowledge base (if available) – but only for
    // documentation-style or relatively static lookups. Dynamic, per-user data
    // (tickets, incidents, etc.) should come from live APIs backed by cache.
    if (!isDynamicDataQuery) {
      try {
        const { getKnowledgeBaseContext, searchKnowledgeBase } = await import('./knowledgeBaseService');
        const kbContext = await getKnowledgeBaseContext(query, currentUser);
        
        // If knowledge base has relevant data, use it
        if (kbContext && !kbContext.includes('not available')) {
          console.log(`%c[IvantiData] 🧠 Using knowledge base data`, 'color: #8b5cf6; font-weight: bold;');
          
          // ALWAYS try to extract a name from the query and search knowledge base
          // This handles queries like "is there named dana?" or "how about bettina"
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
    }
    
    // Parse the query to determine what data to fetch

    // 🚧 ROLE-BASED VISIBILITY GUARD FOR USER/EMPLOYEE SEARCHES
    // If the user lacks canViewAllUsers, block cross-user lookups unless it is clearly "about me".
    const userWantsPeopleSearch =
      lowerQuery.includes('user') ||
      lowerQuery.includes('employee') ||
      lowerQuery.includes('person') ||
      lowerQuery.includes('people') ||
      lowerQuery.includes('who is') ||
      lowerQuery.includes('find ') ||
      lowerQuery.includes('search ');

    const isAboutSelf =
      lowerQuery.includes('my user') ||
      lowerQuery.includes('my account') ||
      lowerQuery.includes('my profile') ||
      lowerQuery.includes('about me') ||
      lowerQuery.includes("who am i") ||
      lowerQuery.includes("what is my") ||
      lowerQuery.includes("show me");

    const canViewAllUsers = !!currentUser?.capabilities?.canViewAllUsers;

    if (userWantsPeopleSearch && !isAboutSelf && !canViewAllUsers) {
      console.warn('[IvantiData] 🚨 Visibility guard: user lacks canViewAllUsers, blocking cross-user lookup');
      return `[PERMISSIONS]: I can only show your own information. Your role does not allow searching other users.`;
    }

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
      // Check if asking for "my tickets/incidents" (both singular and plural)
      // Also check for "all my" as users often say "list all my incidents"
      const isMyTickets = 
        lowerQuery.includes('my ticket') || // Matches "my ticket" and "my tickets"
        lowerQuery.includes('my incident') || // Matches "my incident" and "my incidents"
        (lowerQuery.includes('all') && lowerQuery.includes('my')) || // "all my tickets"
        (lowerQuery.includes('list') && lowerQuery.includes('my')) || // "list my tickets"
        lowerQuery.includes('show my'); // "show my tickets"
      
      if (isMyTickets) {
        // ⚡ INDUSTRY BEST PRACTICE: Server-side filtered, paginated, cached
        // 1. Server filters by RecId (fast with index)
        // 2. Pagination (50/page, expandable)
        // 3. Per-user cache with 10min TTL
        // 4. Incremental sync on cache refresh
        if (currentUser?.recId) {
          console.log('[IvantiData] 🚀 Fetching user tickets (server-filtered by RecId)');
          
          // OPTIMIZED: Direct API call with server-side filtering
          // Cache is handled inside searchTickets with proper TTL
          const limit = 50; // Industry standard: 50-100 per page
          const tickets = await getUserTickets(currentUser.recId, limit);
          
          if (tickets.length > 0) {
            console.log(`[IvantiData] ✅ Fetched ${tickets.length} tickets (server-filtered, cached for 10min)`);
          } else {
            console.log('[IvantiData] ℹ️ No tickets found for user');
          }
          
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

/**
 * Create a Service Request in Ivanti
 * Uses the Ivanti REST API endpoint: /HEAT/api/rest/ServiceRequest/new
 * @param serviceRequestData - Data for the service request including subscriptionId and field values
 * @param currentUser - Current logged-in user (for strUserId and strCustomerLocation)
 * @returns Promise with success status, request number, and RecId
 */
export async function createServiceRequest(
  serviceRequestData: {
    subscriptionId: string;
    fieldValues: Record<string, any>;
    fieldMetadata?: Array<{ 
      name: string; 
      recId?: string; 
      label?: string;
      type?: string; // Field type (combo, text, etc.) for proper parameter formatting
      options?: Array<{ value: string; label: string; recId?: string }>; // Options for combo/dropdown fields
    }>; // Field RecIds for parameter mapping
  },
  currentUser: any
): Promise<{ success: boolean; requestNumber?: string; recId?: string; error?: string }> {
  try {
    console.log('[IvantiData] Creating service request:', serviceRequestData);
    console.log('[IvantiData] Field values received:', JSON.stringify(serviceRequestData.fieldValues, null, 2));
    console.log('[IvantiData] Field values count:', Object.keys(serviceRequestData.fieldValues).length);

    if (!serviceRequestData.subscriptionId) {
      return {
        success: false,
        error: 'Missing subscriptionId'
      };
    }

    if (!currentUser?.recId) {
      return {
        success: false,
        error: 'User not identified'
      };
    }

    // Get user's location from profile (if available)
    let strCustomerLocation = 'Default'; // Fallback default
    try {
      // Try to get location from user profile
      if (currentUser.location) {
        strCustomerLocation = currentUser.location;
      } else if (currentUser.LocationLink) {
        // If we have a location link, we could fetch it, but for now use a default
        strCustomerLocation = 'Default';
      }
    } catch (err) {
      console.warn('[IvantiData] Could not determine customer location, using default');
    }

    // Calculate local offset (timezone offset in minutes from UTC)
    const localOffset = new Date().getTimezoneOffset();

    // Build the service request data payload
    // According to Ivanti REST API documentation:
    // - Standard fields (Subject, Symptom) go in serviceReqData
    // - Custom parameters from request offering go in parameters object with format: par-{RecID}
    
    const serviceReqData: Record<string, any> = {};
    const parameters: Record<string, any> = {};
    
    console.log('[IvantiData] 📋 Field metadata:', serviceRequestData.fieldMetadata);
    
    // ✅ COMPREHENSIVE FIELD MAPPING for all Ivanti field types
    // Based on Ivanti REST API documentation and best practices
    for (const [fieldName, fieldValue] of Object.entries(serviceRequestData.fieldValues)) {
      console.log(`[IvantiData]   Processing field: ${fieldName} (type: ${serviceRequestData.fieldMetadata?.find(f => f.name === fieldName)?.type || 'unknown'}) = ${fieldValue}`);
      
      // Find the field metadata to get RecId and type
      const fieldMeta = serviceRequestData.fieldMetadata?.find(f => f.name === fieldName);
      
      // If field has a RecId, it's a custom parameter - use par-{RecID} format
      if (fieldMeta?.recId) {
        const paramKey = `par-${fieldMeta.recId}`;
        const fieldType = fieldMeta.type?.toLowerCase() || 'text';
        
        // Format the value based on field type (all sent as strings to Ivanti)
        let formattedValue = fieldValue;
        
        switch (fieldType) {
          case 'date':
          case 'datetime':
          case 'time':
            // Date fields: Format as ISO string or keep user format
            if (formattedValue && typeof formattedValue === 'object' && formattedValue instanceof Date) {
              formattedValue = formattedValue.toISOString();
            }
            // If it's already a string, Ivanti will parse it
            console.log(`[IvantiData]   📅 Date field formatted: ${formattedValue}`);
            break;
            
          case 'number':
          case 'decimal':
          case 'currency':
            // Number fields: Convert to string
            formattedValue = String(formattedValue || '0');
            console.log(`[IvantiData]   🔢 Number field formatted: ${formattedValue}`);
            break;
            
          case 'boolean':
          case 'checkbox':
            // Boolean fields: Convert to 'true' or 'false' string
            formattedValue = formattedValue ? 'true' : 'false';
            console.log(`[IvantiData]   ☑️ Boolean field formatted: ${formattedValue}`);
            break;
            
          case 'multiselect':
            // Multi-select: Join array with comma
            if (Array.isArray(formattedValue)) {
              formattedValue = formattedValue.join(',');
            }
            console.log(`[IvantiData]   📋 Multi-select field formatted: ${formattedValue}`);
            break;
            
          case 'combo':
          case 'dropdown':
          case 'picklist':
            // Combo fields: Handle separately below
            console.log(`[IvantiData]   🔽 Combo/dropdown field (requires RecId)`);
            break;
            
          default:
            // Text, textarea, email, url, etc. - use as-is
            formattedValue = String(formattedValue || '');
            console.log(`[IvantiData]   📝 Text field: ${formattedValue}`);
        }
        
        // Add the parameter value
        parameters[paramKey] = formattedValue;
        console.log(`[IvantiData]   ✅ Added to parameters: ${paramKey} = ${formattedValue}`);
        
        // ✅ FOR COMBO/DROPDOWN FIELDS: Also add the RecId of the selected option
        // Ivanti requires both: par-{RecID} = value AND par-{RecID}-recId = optionRecId
        if (fieldType === 'combo' || fieldType === 'dropdown' || fieldType === 'picklist') {
          let optionRecId: string | undefined;
          
          // Try to find the selected option's RecId from field options
          const selectedOption = fieldMeta.options?.find(opt => 
            opt.label === fieldValue || opt.value === fieldValue
          );
          
          if (selectedOption?.recId) {
            optionRecId = selectedOption.recId;
            console.log(`[IvantiData]   ✅ Found option RecId from options list: ${optionRecId}`);
          } else {
            // ✅ SMART FALLBACK: For common user-related fields, use current user's RecId
            const labelLower = (fieldMeta.label || '').toLowerCase();
            const nameLower = fieldName.toLowerCase();
            const isUserField = labelLower.includes('requestor') || 
                               labelLower.includes('requester') || 
                               labelLower.includes('request for') ||
                               labelLower.includes('owner') ||
                               labelLower.includes('assigned to') ||
                               nameLower.includes('requestor') ||
                               nameLower.includes('requester');
            
            // Check if the value matches the current user's name
            const currentUserName = currentUser?.fullName || currentUser?.loginId || '';
            const valueMatchesCurrentUser = fieldValue && currentUserName && 
              (fieldValue.toLowerCase() === currentUserName.toLowerCase() ||
               fieldValue.toLowerCase().includes(currentUserName.toLowerCase()) ||
               currentUserName.toLowerCase().includes(fieldValue.toLowerCase()));
            
            if (isUserField && valueMatchesCurrentUser && currentUser?.recId) {
              optionRecId = currentUser.recId;
              console.log(`[IvantiData]   ✅ Using current user RecId for "${fieldMeta.label}": ${optionRecId}`);
            } else {
              console.warn(`[IvantiData]   ⚠️ Could not find RecId for combo option: ${fieldValue} in field ${fieldName}`);
              console.warn(`[IvantiData]   ⚠️ Field label: "${fieldMeta.label}", Available options:`, fieldMeta.options?.length || 0);
              console.warn(`[IvantiData]   ⚠️ This may cause validation error. Consider fetching validation list dynamically.`);
            }
          }
          
          // Add the option RecId if found
          if (optionRecId) {
            const recIdKey = `${paramKey}-recId`;
            parameters[recIdKey] = optionRecId;
            console.log(`[IvantiData]   ✅ Added option RecId: ${recIdKey} = ${optionRecId}`);
          }
        }
      } else {
        // Otherwise, it's a standard field - add to serviceReqData
        serviceReqData[fieldName] = fieldValue;
        console.log(`[IvantiData]   ✅ Added to serviceReqData: ${fieldName} = ${fieldValue}`);
      }
    }

    // Ensure ProfileLink is set to current user's RecId if not already set
    if (!serviceReqData.ProfileLink && currentUser.recId) {
      serviceReqData.ProfileLink = currentUser.recId;
      console.log('[IvantiData]   Added ProfileLink:', currentUser.recId);
    }

    console.log('[IvantiData] 📊 Final parameters object:', parameters);
    console.log('[IvantiData] 📊 Final serviceReqData object:', serviceReqData);

    // Build the complete payload for Ivanti REST API
    const payload = {
      attachmentsToDelete: [],
      attachmentsToUpload: [],
      parameters: parameters, // Custom parameters with par-{RecID} format
      delayedFulfill: false,
      formName: 'ServiceReq.ResponsiveAnalyst.DefaultLayout', // Default form layout
      saveReqState: false,
      serviceReqData: serviceReqData,
      strCustomerLocation: strCustomerLocation,
      strUserId: currentUser.recId,
      subscriptionId: serviceRequestData.subscriptionId,
      localOffset: localOffset
    };

    const url = `${IVANTI_CONFIG.baseUrl}/HEAT/api/rest/ServiceRequest/new`;

    console.log('[IvantiData] POST URL:', url.replace(IVANTI_CONFIG.apiKey, '***'));
    console.log('[IvantiData] Payload:', JSON.stringify(payload, null, 2));

    const response = await ivantiFetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `rest_api_key=${IVANTI_CONFIG.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      timeoutMs: 15000, // 15 second timeout for service request creation
      retries: 2 // Retry up to 2 times
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[IvantiData] Failed to create service request:', response.status, errorText);
      return {
        success: false,
        error: `Failed to create service request: ${response.status} - ${errorText}`
      };
    }

    const data = await response.json();
    console.log('[IvantiData] ✅ Service request API response:', data);

    // ✅ CHECK IF IVANTI REPORTS SUCCESS
    if (data.IsSuccess === false) {
      const errorMsg = data.ErrorText || data.ErrorMessage || 'Unknown error from Ivanti';
      console.error('[IvantiData] ❌ Ivanti reported failure:', errorMsg);
      console.error('[IvantiData] ❌ Full error response:', data);
      
      // Provide helpful error message based on common issues
      let helpfulError = errorMsg;
      if (errorMsg.includes('validation list') || errorMsg.includes('identifier')) {
        helpfulError = `${errorMsg}\n\n💡 This usually means a dropdown field is missing its RecId. Check the console logs for which field failed.`;
      } else if (errorMsg.includes('required field') || errorMsg.includes('mandatory')) {
        helpfulError = `${errorMsg}\n\n💡 A required field is missing or empty. Please fill all required fields.`;
      }
      
      return {
        success: false,
        error: helpfulError
      };
    }

    // Extract request number and RecId from response
    // Ivanti returns: { IsSuccess: true, ServiceRequests: [{ strRequestNum: "10089", strRequestRecId: "..." }] }
    console.log('[IvantiData] Looking for request number in response...');
    
    let requestNumber = 'Unknown';
    let recId = null;
    
    // Check if response has ServiceRequests array (typical Ivanti response structure)
    if (data.ServiceRequests && Array.isArray(data.ServiceRequests) && data.ServiceRequests.length > 0) {
      const firstRequest = data.ServiceRequests[0];
      requestNumber = firstRequest.strRequestNum || firstRequest.RequestNum || firstRequest.ServiceReqNumber || 'Unknown';
      recId = firstRequest.strRequestRecId || firstRequest.RequestRecId || firstRequest.RecId || null;
      console.log('[IvantiData]   ✅ Found in ServiceRequests[0].strRequestNum:', requestNumber);
      console.log('[IvantiData]   ✅ Found in ServiceRequests[0].strRequestRecId:', recId);
    } else {
      // Fallback: Check top-level fields (older API format)
      console.log('[IvantiData]   Checking top-level fields...');
      
      requestNumber = 
        data.ServiceReqNumber || 
        data.serviceReqNumber || 
        data.RequestNumber || 
        data.requestNumber ||
        data.strServiceReqNumber ||
        data.strRequestNum ||
        data.value?.ServiceReqNumber || 
        data.value?.RequestNumber ||
        data.value?.strServiceReqNumber ||
        data.Number ||
        'Unknown';
      
      recId = 
        data.RecId || 
        data.recId || 
        data.strRecId ||
        data.strRequestRecId ||
        data.value?.RecId || 
        data.value?.recId ||
        data.value?.strRecId ||
        null;
    }

    if (requestNumber === 'Unknown') {
      console.warn('[IvantiData] ⚠️ Could not extract request number from response. Full response:', data);
    }

    console.log('[IvantiData] ✅ Extracted request number:', requestNumber);
    console.log('[IvantiData] ✅ Extracted RecId:', recId);

    return {
      success: true,
      requestNumber: String(requestNumber),
      recId: recId ? String(recId) : undefined
    };

  } catch (error: any) {
    console.error('[IvantiData] Error creating service request:', error);
    return {
      success: false,
      error: error?.message || 'Unknown error creating service request'
    };
  }
}

/**
 * Get RecId for a Service Request by its ServiceReqNumber
 * Useful for looking up service requests after creation
 * @param serviceReqNumber - The ServiceReqNumber to look up
 * @returns RecId if found, null otherwise
 */
export async function getServiceRequestRecId(serviceReqNumber: string): Promise<string | null> {
  try {
    console.log('[IvantiData] Getting RecId for service request number:', serviceReqNumber);

    // Try multiple query formats (ServiceReqNumber might be string or numeric)
    const url = `${IVANTI_CONFIG.baseUrl}${IVANTI_CONFIG.endpoints.serviceRequests}`;
    
    const queryFormats = [
      `ServiceReqNumber eq '${serviceReqNumber}'`, // String format with quotes
      `ServiceReqNumber eq ${serviceReqNumber}`,   // Numeric format without quotes
    ];

    for (const query of queryFormats) {
      try {
        console.log(`[IvantiData] Trying query format: ${query}`);
        const queryUrl = `${url}?$filter=${encodeURIComponent(query)}&$top=1`;
        
        const response = await ivantiFetch(queryUrl, {
          method: 'GET',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          timeoutMs: 8000,
          retries: 1
        });

        if (response.ok) {
          const data = await response.json();
          const items = data.value || data || [];
          
          if (items.length > 0 && items[0].RecId) {
            console.log('[IvantiData] ✅ Found Service Request RecId:', items[0].RecId);
            return items[0].RecId;
          }
        }
      } catch (err) {
        console.warn('[IvantiData] Query format failed:', query, err);
        continue;
      }
    }

    // If still not found, try fetching recent service requests and search
    console.log('[IvantiData] Trying broader search...');
    const recentServiceRequests = await fetchServiceRequests(20);
    const matchingRequest = recentServiceRequests.find(sr =>
      String(sr.ServiceReqNumber) === String(serviceReqNumber) ||
      String(sr.RequestNumber) === String(serviceReqNumber)
    );

    if (matchingRequest && matchingRequest.RecId) {
      console.log('[IvantiData] ✅ Found RecId in recent service requests:', matchingRequest.RecId);
      return matchingRequest.RecId;
    }

    console.warn('[IvantiData] ❌ Service request not found:', serviceReqNumber);
    return null;

  } catch (error) {
    console.error('[IvantiData] Error getting service request RecId:', error);
    return null;
  }
}

/**
 * Fetch a specific service request by RecId
 * @param recId - The RecId of the service request
 * @returns Service request data if found, null otherwise
 */
export async function getServiceRequestByRecId(recId: string): Promise<IvantiServiceRequest | null> {
  try {
    console.log('[IvantiData] Fetching service request by RecId:', recId);
    
    const url = `${IVANTI_CONFIG.baseUrl}${IVANTI_CONFIG.endpoints.serviceRequests}('${recId}')`;
    
    const response = await ivantiFetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      timeoutMs: 8000,
      retries: 1
    });

    if (!response.ok) {
      console.warn('[IvantiData] Service request not found:', recId);
      return null;
    }

    const data = await response.json();
    const serviceRequest = data.value || data;

    // Normalize RequestNumber
    if (serviceRequest) {
      serviceRequest.RequestNumber = serviceRequest.RequestNumber ?? serviceRequest.ServiceReqNumber ?? serviceRequest.ServiceReqNumber?.toString();
    }

    console.log('[IvantiData] ✅ Found service request:', serviceRequest);
    return serviceRequest;

  } catch (error) {
    console.error('[IvantiData] Error fetching service request:', error);
    return null;
  }
}

