/**
 * Knowledge Base Service
 * 
 * Creates a comprehensive local knowledge base of Ivanti data
 * that the AI can use as its "brain" - storing all employees, incidents, categories, etc.
 * 
 * This data is fetched during initialization and stored in chrome.storage.local
 * The AI can reference this data without making API calls.
 */

import { IvantiUser } from './userIdentity';
import { 
  searchTickets, 
  fetchCategories, 
  getUserTickets,
  fetchServices,
  fetchTeams,
  fetchDepartments,
  fetchServiceRequests,
  IvantiEmployee,
  IvantiTicket,
  IvantiCategory,
  IvantiService,
  IvantiTeam,
  IvantiDepartment,
  IvantiServiceRequest
} from './ivantiDataService';
import { fetchRoles, IvantiRole } from './rolesService';
import { IVANTI_CONFIG } from '../config';

export interface KnowledgeBase {
  employees: IvantiEmployee[];
  incidents: IvantiTicket[];
  serviceRequests: IvantiServiceRequest[];
  categories: IvantiCategory[];
  services: IvantiService[];
  teams: IvantiTeam[];
  departments: IvantiDepartment[];
  roles: IvantiRole[];
  userTickets: IvantiTicket[];
  lastUpdated: number;
  version: number;
}

const KB_VERSION = 4; // Incremented to include roles
const KB_STORAGE_KEY = 'ivanti_knowledge_base';

/**
 * Load knowledge base from storage
 */
export async function loadKnowledgeBase(): Promise<KnowledgeBase | null> {
  try {
    const result = await chrome.storage.local.get([KB_STORAGE_KEY]);
    const kb = result[KB_STORAGE_KEY] as KnowledgeBase | undefined;
    
    if (kb && kb.version === KB_VERSION) {
      const age = Date.now() - kb.lastUpdated;
      const maxAge = 30 * 60 * 1000; // 30 minutes
      
      if (age < maxAge) {
        console.log(`%c[KnowledgeBase] ✅ Loaded from storage (age: ${Math.round(age / 1000)}s)`, 'color: #10b981; font-weight: bold;');
        return kb;
      } else {
        console.log(`%c[KnowledgeBase] ⏰ Knowledge base expired (age: ${Math.round(age / 1000)}s)`, 'color: #f59e0b; font-weight: bold;');
      }
    }
    
    return null;
  } catch (error) {
    console.error('[KnowledgeBase] Error loading:', error);
    return null;
  }
}

/**
 * Build comprehensive knowledge base from Ivanti
 */
export async function buildKnowledgeBase(
  currentUser: IvantiUser | null,
  onProgress?: (stage: string, progress: number, message: string) => void
): Promise<KnowledgeBase> {
  console.log('%c[KnowledgeBase] 🧠 Building comprehensive knowledge base...', 'color: #8b5cf6; font-weight: bold; font-size: 14px;');
  
  const kb: KnowledgeBase = {
    employees: [],
    incidents: [],
    serviceRequests: [],
    categories: [],
    services: [],
    teams: [],
    departments: [],
    roles: [],
    userTickets: [],
    lastUpdated: Date.now(),
    version: KB_VERSION
  };
  
  const totalSteps = 9; // Updated to include roles
  let currentStep = 0;
  
  try {
    // Step 1: Fetch ALL employees (this is the "brain" for user searches)
    if (onProgress) {
      onProgress('employees', Math.round((currentStep / totalSteps) * 100), 'Loading all employees...');
    }
    
    try {
      console.log('%c[KnowledgeBase] 📥 Fetching all employees...', 'color: #3b82f6; font-weight: bold;');
      
      // Clear ALL cache entries first to free up maximum space for knowledge base
      try {
        const { clearAllCache } = await import('./cacheService');
        await clearAllCache();
        console.log('[KnowledgeBase] Cleared all cache to maximize storage for knowledge base');
      } catch (error) {
        console.warn('[KnowledgeBase] Could not clear cache:', error);
      }
      
      // Fetch employees using pagination approach to get diverse results
      const employeeBatches: IvantiEmployee[] = [];
      const seenRecIds = new Set<string>();
      
      // Strategy 1: Try to fetch without filter using pagination
      try {
        console.log('[KnowledgeBase] Attempting to fetch employees with pagination...');
        // Try fetching in batches using $skip
        for (let skip = 0; skip < 1000; skip += 100) {
          try {
            const url = `${IVANTI_CONFIG.baseUrl}${IVANTI_CONFIG.endpoints.userByName}?$top=100&$skip=${skip}`;
            const response = await fetch(url, {
              method: 'GET',
              credentials: 'include', // Use browser's session cookies
              headers: {
                'Content-Type': 'application/json',
              },
            });
            
            if (response.ok) {
              const data = await response.json();
              const batch: IvantiEmployee[] = data.value || [];
              
              if (batch.length === 0) break; // No more employees
              
              let added = 0;
              batch.forEach(emp => {
                if (emp.RecId && !seenRecIds.has(emp.RecId)) {
                  employeeBatches.push(emp);
                  seenRecIds.add(emp.RecId);
                  added++;
                }
              });
              
              console.log(`[KnowledgeBase] Fetched batch ${skip}-${skip + 100}: ${batch.length} returned, ${added} new (total: ${employeeBatches.length})`);
              
              if (batch.length < 100) break; // Last batch
              if (employeeBatches.length >= 500) {
                console.log('[KnowledgeBase] Reached 500 employees via pagination');
                break;
              }
            } else {
              console.warn(`[KnowledgeBase] Pagination not supported (${response.status}), trying pattern approach...`);
              break;
            }
          } catch (error) {
            console.warn(`[KnowledgeBase] Error fetching batch at skip ${skip}:`, error);
            break;
          }
        }
      } catch (error) {
        console.warn('[KnowledgeBase] Pagination approach failed, trying pattern-based search...');
      }
      
      // Strategy 2: If pagination didn't work or we need more, use diverse search patterns with pagination
      if (employeeBatches.length < 200) {
        console.log('[KnowledgeBase] Using diverse pattern-based search with pagination to get more employees...');
        // Use diverse patterns that are less likely to overlap
        const diversePatterns = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z'];
        
        for (const pattern of diversePatterns) {
          // Try pagination for each pattern to get different batches
          for (let skip = 0; skip < 500; skip += 50) {
            try {
              // Build filter for pattern search
              const filter = `contains(tolower(DisplayName),'${pattern}') or contains(tolower(LoginID),'${pattern}') or contains(tolower(PrimaryEmail),'${pattern}')`;
              const encodedFilter = encodeURIComponent(filter);
              const url = `${IVANTI_CONFIG.baseUrl}${IVANTI_CONFIG.endpoints.userByName}?$filter=${encodedFilter}&$top=50&$skip=${skip}`;
              
              const response = await fetch(url, {
                method: 'GET',
                credentials: 'include', // Use browser's session cookies
                headers: {
                  'Content-Type': 'application/json',
                },
              });
              
              if (response.ok) {
                const data = await response.json();
                const batch: IvantiEmployee[] = data.value || [];
                
                if (batch.length === 0) break; // No more for this pattern
                
                let added = 0;
                batch.forEach(emp => {
                  if (emp.RecId && !seenRecIds.has(emp.RecId)) {
                    employeeBatches.push(emp);
                    seenRecIds.add(emp.RecId);
                    added++;
                  }
                });
                
                if (added > 0) {
                  console.log(`[KnowledgeBase] Pattern "${pattern}" skip ${skip}: ${batch.length} returned, ${added} new (total: ${employeeBatches.length})`);
                }
                
                // Stop if we have enough employees
                if (employeeBatches.length >= 500) {
                  console.log('[KnowledgeBase] Reached 500 employees, stopping');
                  break;
                }
                
                if (batch.length < 50) break; // Last batch for this pattern
              } else {
                break; // Pattern search failed, try next pattern
              }
            } catch (error) {
              // Continue to next skip or pattern
              break;
            }
          }
          
          // Stop outer loop if we have enough
          if (employeeBatches.length >= 500) {
            break;
          }
        }
      }
      
      // Optimize employee data - keep only essential fields to reduce storage size
      kb.employees = employeeBatches.map(emp => ({
        RecId: emp.RecId,
        LoginID: emp.LoginID,
        DisplayName: emp.DisplayName,
        PrimaryEmail: emp.PrimaryEmail,
        Team: emp.Team,
        Department: emp.Department,
        Status: emp.Status,
        Title: emp.Title,
      }));
      console.log(`%c[KnowledgeBase] ✅ Loaded ${kb.employees.length} unique employees (optimized for storage)`, 'color: #10b981; font-weight: bold;');
    } catch (error) {
      console.error('[KnowledgeBase] ❌ Error fetching employees:', error);
    }
    
    currentStep++;
    
    // Step 2: Fetch recent incidents (last 100)
    if (onProgress) {
      onProgress('incidents', Math.round((currentStep / totalSteps) * 100), 'Loading recent incidents...');
    }
    
    try {
      console.log('%c[KnowledgeBase] 📥 Fetching recent incidents...', 'color: #3b82f6; font-weight: bold;');
      // ENTERPRISE PATTERN: Aggressive prefetch for incidents (within 10MB budget)
      // Note: Ivanti caps $top at 100 per request
      let rawIncidents: IvantiTicket[] = [];
      const batchSize = 100;   // API limit per request
      const maxBatches = 10;   // Up to 1,000 incidents max (fits comfortably under 10MB)
      
      for (let batch = 0; batch < maxBatches; batch++) {
        const skip = batch * batchSize;
        console.log(`[KnowledgeBase] Fetching incidents batch ${batch + 1}/${maxBatches} (skip: ${skip}, top: ${batchSize})...`);
        const batchIncidents = await searchTickets('Status ne null', batchSize, skip);
        
        if (batchIncidents.length === 0) {
          console.log(`[KnowledgeBase] No more incidents to fetch (batch ${batch + 1} returned 0 results)`);
          break;
        }
        
        rawIncidents.push(...batchIncidents);
        
        // If we got less than batchSize, we've reached the end
        if (batchIncidents.length < batchSize) {
          console.log(`[KnowledgeBase] Reached end of incidents (batch ${batch + 1} returned ${batchIncidents.length} results)`);
          break;
        }
      }
      
      console.log(`[KnowledgeBase] ✅ Fetched ${rawIncidents.length} total incidents across all batches`);
      // Store richer incident data now that storage is less constrained
      kb.incidents = rawIncidents.map(inc => {
        let humanCreated = '';
        let humanLastMod = '';
        try {
          if (inc.CreatedDateTime) {
            const d = new Date(inc.CreatedDateTime);
            humanCreated = d.toLocaleString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            });
          }
          if (inc.LastModDateTime) {
            const d2 = new Date(inc.LastModDateTime);
            humanLastMod = d2.toLocaleString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            });
          }
        } catch (e) {
          console.warn('[KnowledgeBase] ⚠️ Failed to format incident dates', e);
        }

        return {
          RecId: inc.RecId,
          IncidentNumber: inc.IncidentNumber,
          Subject: inc.Subject,
          Status: inc.Status,
          Priority: inc.Priority,
          Category: inc.Category,
          Subcategory: inc.Subcategory,
          Service: inc.Service,
          CreatedDateTime: inc.CreatedDateTime,
          LastModDateTime: inc.LastModDateTime,
          Owner: inc.Owner,
          OwnerTeam: inc.OwnerTeam,
          ProfileFullName: inc.ProfileFullName,
          Symptom: inc.Symptom,
          Description: inc.Description,
          Resolution: inc.Resolution,
          Impact: inc.Impact,
          Urgency: inc.Urgency,
          Source: inc.Source,
          HumanCreatedDateTime: humanCreated,
          HumanLastModDateTime: humanLastMod,
        };
      });
      console.log(`%c[KnowledgeBase] ✅ Loaded ${kb.incidents.length} incidents (rich fields)`, 'color: #10b981; font-weight: bold;');
    } catch (error) {
      console.error('[KnowledgeBase] ❌ Error fetching incidents:', error);
    }
    
    currentStep++;
    
    // Step 3: Fetch ALL categories
    if (onProgress) {
      onProgress('categories', Math.round((currentStep / totalSteps) * 100), 'Loading categories...');
    }
    
    try {
      console.log('%c[KnowledgeBase] 📥 Fetching categories...', 'color: #3b82f6; font-weight: bold;');
      kb.categories = await fetchCategories(100); // Get up to 100 categories
      if (kb.categories.length > 0) {
        console.log(`%c[KnowledgeBase] ✅ Loaded ${kb.categories.length} categories`, 'color: #10b981; font-weight: bold;');
      } else {
        console.warn('[KnowledgeBase] ⚠️ No categories loaded (session may not be established - this is normal after logout/login)');
      }
    } catch (error) {
      console.warn('[KnowledgeBase] ⚠️ Error fetching categories (non-critical):', error);
    }
    
    currentStep++;
    
    // Step 4: Fetch Services
    if (onProgress) {
      onProgress('services', Math.round((currentStep / totalSteps) * 100), 'Loading services...');
    }
    
    try {
      console.log('%c[KnowledgeBase] 📥 Fetching services...', 'color: #3b82f6; font-weight: bold;');
      kb.services = await fetchServices(50);
      console.log(`%c[KnowledgeBase] ✅ Loaded ${kb.services.length} services`, 'color: #10b981; font-weight: bold;');
    } catch (error) {
      console.error('[KnowledgeBase] ❌ Error fetching services:', error);
    }
    
    currentStep++;
    
    // Step 5: Fetch Teams
    if (onProgress) {
      onProgress('teams', Math.round((currentStep / totalSteps) * 100), 'Loading teams...');
    }
    
    try {
      console.log('%c[KnowledgeBase] 📥 Fetching teams...', 'color: #3b82f6; font-weight: bold;');
      kb.teams = await fetchTeams(50);
      console.log(`%c[KnowledgeBase] ✅ Loaded ${kb.teams.length} teams`, 'color: #10b981; font-weight: bold;');
    } catch (error) {
      console.error('[KnowledgeBase] ❌ Error fetching teams:', error);
    }
    
    currentStep++;
    
    // Step 6: Fetch Departments
    if (onProgress) {
      onProgress('departments', Math.round((currentStep / totalSteps) * 100), 'Loading departments...');
    }
    
    try {
      console.log('%c[KnowledgeBase] 📥 Fetching departments...', 'color: #3b82f6; font-weight: bold;');
      kb.departments = await fetchDepartments(50);
      console.log(`%c[KnowledgeBase] ✅ Loaded ${kb.departments.length} departments`, 'color: #10b981; font-weight: bold;');
    } catch (error) {
      console.error('[KnowledgeBase] ❌ Error fetching departments:', error);
    }
    
    currentStep++;
    
    // Step 7: Fetch Service Requests
    if (onProgress) {
      onProgress('service_requests', Math.round((currentStep / totalSteps) * 100), 'Loading service requests...');
    }

    try {
      console.log('%c[KnowledgeBase] 📥 Fetching service requests...', 'color: #3b82f6; font-weight: bold;');
      const rawServiceReqs = await fetchServiceRequests(100);
      
      if (rawServiceReqs.length === 0) {
        console.warn('[KnowledgeBase] ⚠️ No service requests loaded (session may not be established - this is normal after logout/login)');
      }
      
      // Normalize and add human-readable created date
      kb.serviceRequests = rawServiceReqs.map((sr: any) => {
        let humanCreated = '';
        try {
          if (sr.CreatedDateTime) {
            const d = new Date(sr.CreatedDateTime);
            humanCreated = d.toLocaleString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            });
          }
        } catch (e) {
          console.warn('[KnowledgeBase] ⚠️ Failed to format service request created date', e);
        }

        return {
          ...sr,
          HumanCreatedDateTime: humanCreated,
        };
      });
      console.log(`%c[KnowledgeBase] ✅ Loaded ${kb.serviceRequests.length} service requests`, 'color: #10b981; font-weight: bold;');
    } catch (error) {
      console.warn('[KnowledgeBase] ⚠️ Error fetching service requests (non-critical):', error);
    }

    currentStep++;
    
    // Step 8: Fetch roles
    if (onProgress) {
      onProgress('roles', Math.round((currentStep / totalSteps) * 100), 'Loading roles...');
    }
    
    try {
      console.log('%c[KnowledgeBase] 📥 Fetching roles...', 'color: #3b82f6; font-weight: bold;');
      kb.roles = await fetchRoles();
      console.log(`%c[KnowledgeBase] ✅ Loaded ${kb.roles.length} roles`, 'color: #10b981; font-weight: bold;');
    } catch (error) {
      console.error('[KnowledgeBase] ❌ Error fetching roles:', error);
    }
    
    currentStep++;
    
    // Step 9: Fetch current user's tickets
    if (currentUser?.recId) {
      if (onProgress) {
        onProgress('user_tickets', Math.round((currentStep / totalSteps) * 100), 'Loading your tickets...');
      }
      
      try {
        console.log('%c[KnowledgeBase] 📥 Fetching user tickets...', 'color: #3b82f6; font-weight: bold;');
        kb.userTickets = await getUserTickets(currentUser.recId, 50);
        console.log(`%c[KnowledgeBase] ✅ Loaded ${kb.userTickets.length} user tickets`, 'color: #10b981; font-weight: bold;');
      } catch (error) {
        console.error('[KnowledgeBase] ❌ Error fetching user tickets:', error);
      }
    }
    
    currentStep++;
    
    // Save to storage (clear old cache first if needed)
    try {
      // Clear old knowledge base if it exists
      await chrome.storage.local.remove([KB_STORAGE_KEY]);
      
      // Save new knowledge base
      await chrome.storage.local.set({ [KB_STORAGE_KEY]: kb });
      console.log(`%c[KnowledgeBase] 💾 Saved knowledge base to storage`, 'color: #3b82f6; font-weight: bold;');
    } catch (error: any) {
      if (error?.message?.includes('quota') || error?.message?.includes('QUOTA')) {
        console.warn('[KnowledgeBase] ⚠️ Storage quota exceeded, clearing old cache...');
        // Try to clear old cache entries
        try {
          const { clearAllCache } = await import('./cacheService');
          // Clear all cache to free up maximum space
          await clearAllCache();
          // Retry saving
          await chrome.storage.local.set({ [KB_STORAGE_KEY]: kb });
          console.log(`%c[KnowledgeBase] 💾 Saved knowledge base after cache cleanup`, 'color: #3b82f6; font-weight: bold;');
        } catch (retryError) {
          console.error('[KnowledgeBase] ❌ Failed to save after cleanup:', retryError);
          throw retryError;
        }
      } else {
        throw error;
      }
    }
    console.log(`%c[KnowledgeBase] 📊 Summary:`, 'color: #6366f1; font-weight: bold;', {
      employees: kb.employees.length,
      incidents: kb.incidents.length,
      categories: kb.categories.length,
      services: kb.services.length,
      teams: kb.teams.length,
      departments: kb.departments.length,
      roles: kb.roles.length,
      userTickets: kb.userTickets.length,
      totalSize: `${(JSON.stringify(kb).length / 1024).toFixed(2)} KB`
    });
    
    if (onProgress) {
      onProgress('complete', 100, 'Knowledge base ready!');
    }
    
    return kb;
  } catch (error) {
    console.error('[KnowledgeBase] Error building knowledge base:', error);
    throw error;
  }
}

/**
 * Get knowledge base data for AI context
 * Returns formatted string that AI can use
 */
export async function getKnowledgeBaseContext(query: string, currentUser?: IvantiUser | null, conversationHistory?: any[]): Promise<string> {
  const kb = await loadKnowledgeBase();
  
  if (!kb) {
    return '[KNOWLEDGE BASE]: Knowledge base not available. Will fetch data on-demand.';
  }
  
  const lowerQuery = query.toLowerCase();
  const context: string[] = [];
  
  // Add Ivanti official documentation (CRITICAL: AI must reference this)
  try {
    const { getRelevantDocumentation, formatDocumentationForContext } = await import('./ivantiDocumentation');
    const relevantDocs = getRelevantDocumentation(query);
    const docContext = formatDocumentationForContext(relevantDocs);
    if (docContext) {
      context.push(docContext);
      context.push(`\n[CRITICAL INSTRUCTION]: The documentation above is OFFICIAL IVANTI DOCUMENTATION. When answering questions, ALWAYS reference this documentation first. If the user asks about how something works in Ivanti, use the documentation above. Only use the knowledge base data below for specific records (incidents, employees, etc.) from this organization.`);
    }
  } catch (error) {
    console.warn('[KnowledgeBase] Could not load Ivanti documentation:', error);
  }
  
  // Add current user info if available
  if (currentUser) {
    context.push(`CURRENT USER: ${currentUser.fullName} (${currentUser.loginId}), Team: ${currentUser.team || 'Unknown'}, Role: ${currentUser.roles?.join(', ') || 'Standard User'}`);
  }
  
  // Check conversation history for context clues (e.g., if they just asked about services)
  let recentContext = '';
  if (conversationHistory && conversationHistory.length > 0) {
    const recentMessages = conversationHistory.slice(-4).map(m => m.content || m.parts?.[0]?.text || '').join(' ').toLowerCase();
    recentContext = recentMessages;
  }
  
  const combinedContext = (lowerQuery + ' ' + recentContext).toLowerCase();
  
  // Always include summary of what's available
  context.push(`\n[KNOWLEDGE BASE SUMMARY]:`);
  context.push(`- ${kb.employees.length} employees`);
  context.push(`- ${kb.incidents.length} incidents`);
  context.push(`- ${kb.serviceRequests.length} service requests`);
  context.push(`- ${kb.categories.length} categories`);
  context.push(`- ${kb.services.length} services`);
  context.push(`- ${kb.teams.length} teams`);
  context.push(`- ${kb.departments.length} departments`);
  context.push(`- ${kb.roles.length} roles`);
  
  // SECURITY: Only include employee data if user has permission to view all users
  const canViewEmployees = currentUser?.capabilities?.canViewAllUsers ?? false;
  
  // If query is about users/employees OR recent conversation mentioned users
  if ((lowerQuery.includes('user') || lowerQuery.includes('employee') || lowerQuery.includes('find') || 
      combinedContext.includes('user') || combinedContext.includes('employee') || combinedContext.includes('find'))) {
    
    if (!canViewEmployees) {
      // Self Service users cannot search employees
      context.push(`\n[EMPLOYEES]: Access restricted. You can only view your own profile information.`);
    } else {
      context.push(`\n[EMPLOYEES IN SYSTEM - ${kb.employees.length} total]:`);
      if (kb.employees.length > 0) {
        // Try to extract name from query for targeted search
        const nameMatch = query.match(/(?:find|search|know|get|show|who is|about)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/i);
        const searchName = nameMatch ? nameMatch[1].toLowerCase().trim() : null;
        
        let employeesToShow = kb.employees;
        let showingFiltered = false;
        
        // If searching for a specific name, prioritize matching employees
        if (searchName) {
          const matches = kb.employees.filter(e => 
            e.DisplayName?.toLowerCase().includes(searchName) ||
            e.LoginID?.toLowerCase().includes(searchName) ||
            e.PrimaryEmail?.toLowerCase().includes(searchName)
          );
          
          if (matches.length > 0) {
            employeesToShow = [...matches, ...kb.employees.filter(e => !matches.includes(e))];
            showingFiltered = true;
            context.push(`[FOUND ${matches.length} MATCHING EMPLOYEE(S) FOR "${searchName}"]:`);
          }
        }
        
        // Show up to 150 employees (much higher limit to ensure all common names are included)
        const sample = employeesToShow.slice(0, 150);
        context.push(sample.map((e, i) => 
          `${i + 1}. ${e.DisplayName} (${e.PrimaryEmail || e.LoginID}) - ${e.Team || 'No team'} - ${e.Status}`
        ).join('\n'));
        if (kb.employees.length > 150) {
          context.push(`... and ${kb.employees.length - 150} more employees in the system.`);
        }
        
        if (searchName && showingFiltered) {
          context.push(`\n[NOTE]: Top results are employees matching "${searchName}".`);
        }
      }
    }
  }
  
  // SECURITY: Check if user can view all tickets
  const canViewAllTickets = currentUser?.capabilities?.canViewAllTickets ?? false;
  
  // Determine if user wants ALL tickets (incidents + service requests) or specific types
  const wantsAllTickets = (lowerQuery.includes('ticket') || combinedContext.includes('ticket')) &&
                          !lowerQuery.includes('incident') &&
                          !lowerQuery.includes('service request') &&
                          !lowerQuery.includes('sr ') &&
                          !lowerQuery.includes('sr#');
  
  // If user wants ALL tickets (generic "tickets"), show combined view
  if (wantsAllTickets) {
    if (!canViewAllTickets) {
      // Self Service users can only see their own tickets
      context.push(`\n[TICKETS]: You can only view your own tickets. Use "my tickets" to see tickets you created.`);
    } else {
      context.push(`\n[ALL TICKETS IN SYSTEM]:`);
      context.push(`Note: In Ivanti, "tickets" includes both Incidents and Service Requests.`);
      context.push(`- ${kb.incidents.length} Incidents`);
      context.push(`- ${kb.serviceRequests.length} Service Requests`);
      context.push(`- Total: ${kb.incidents.length + kb.serviceRequests.length} tickets\n`);
      
      // Combine and sort by CreatedDateTime
      const allTickets: any[] = [
        ...kb.incidents.map(inc => ({
          type: 'Incident',
          number: inc.IncidentNumber,
          subject: inc.Subject,
          status: inc.Status,
          priority: inc.Priority,
          reporter: inc.ProfileFullName,
          created: inc.CreatedDateTime,
          humanCreated: inc.HumanCreatedDateTime,
        })),
        ...kb.serviceRequests.map((sr: any) => ({
          type: 'Service Request',
          number: sr.RequestNumber || sr.ServiceReqNumber,
          subject: sr.Subject,
          status: sr.Status,
          priority: sr.Urgency || 'N/A',
          reporter: sr.ProfileFullName,
          created: sr.CreatedDateTime,
          humanCreated: sr.HumanCreatedDateTime,
        }))
      ];
      
      // Sort by created date (most recent first)
      allTickets.sort((a, b) => {
        const dateA = a.created ? new Date(a.created).getTime() : 0;
        const dateB = b.created ? new Date(b.created).getTime() : 0;
        return dateB - dateA; // descending
      });
      
      if (allTickets.length > 0) {
        context.push(`[RECENT TICKETS (Combined Incidents & Service Requests) - ${allTickets.length} total]:`);
        const sample = allTickets.slice(0, 20);
        context.push(sample.map((t, i) => 
          `${i + 1}. ${t.type} #${t.number}: "${t.subject}" - ${t.status} - Priority/Urgency: ${t.priority} - Reporter: ${t.reporter || 'Unknown'} - Created: ${t.humanCreated || t.created || 'Unknown'}`
        ).join('\n'));
        if (allTickets.length > 20) {
          context.push(`... and ${allTickets.length - 20} more tickets in the system.`);
        }
      }
    }
  }
  
  // If query is about incidents/tickets (but NOT generic "tickets" which we already handled above)
  if ((lowerQuery.includes('incident') || 
      (lowerQuery.includes('ticket') && !wantsAllTickets) ||
      combinedContext.includes('incident') || 
      (combinedContext.includes('ticket') && !wantsAllTickets)) && !wantsAllTickets) {
    // Try to detect a specific date in the query (e.g., "december 1", "2025-12-01")
    let dateFilter: string | null = null;
    const monthNames = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    // Support both "december 1" and "december 1st"
    const monthRegex = new RegExp(`\\b(${monthNames.join('|')})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i');
    const match = query.match(monthRegex);
    if (match) {
      const monthIndex = monthNames.findIndex(m => m === match[1].toLowerCase());
      const day = parseInt(match[2], 10);
      const year = new Date().getFullYear(); // assume current year
      if (monthIndex >= 0 && day >= 1 && day <= 31) {
        const isoDate = new Date(year, monthIndex, day).toISOString().slice(0, 10); // YYYY-MM-DD
        dateFilter = isoDate;
      }
    } else {
      // Fallback 1: direct ISO date in query (YYYY-MM-DD)
      const isoMatch = query.match(/\b(\d{4}-\d{2}-\d{2})\b/);
      if (isoMatch) {
        dateFilter = isoMatch[1];
      } else {
        // Fallback 2: US-style date like 12/01/2025 or 12-01-2025 (optionally with time)
        const usMatch = query.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/);
        if (usMatch) {
          const month = parseInt(usMatch[1], 10) - 1; // JS months 0-11
          const day = parseInt(usMatch[2], 10);
          const year = parseInt(usMatch[3], 10);
          if (month >= 0 && month < 12 && day >= 1 && day <= 31) {
            const isoDate = new Date(year, month, day).toISOString().slice(0, 10);
            dateFilter = isoDate;
          }
        }
      }
    }

    if (dateFilter) {
      // SECURITY: Only show all incidents if user has permission
      if (canViewAllTickets) {
        // Filter incidents by CreatedDateTime date prefix
        const byDate = kb.incidents.filter(t => 
          t.CreatedDateTime && String(t.CreatedDateTime).startsWith(dateFilter!)
        );
        context.push(`\n[INCIDENTS CREATED ON ${dateFilter} - ${byDate.length} incident(s)]:`);
        if (byDate.length > 0) {
          context.push(byDate.slice(0, 25).map((t, i) =>
            `${i + 1}. Incident #${t.IncidentNumber}: "${t.Subject}" - ${t.Status} - Priority ${t.Priority} - Reporter: ${t.ProfileFullName || 'Unknown'} - Created: ${t.HumanCreatedDateTime || t.CreatedDateTime || 'Unknown'}`
          ).join('\n'));
        } else {
          context.push(`No incidents were found with CreatedDateTime on ${dateFilter}.`);
        }
      } else {
        // Self Service users can only see their own tickets
        const userTicketsOnDate = kb.userTickets.filter(t => 
          t.CreatedDateTime && String(t.CreatedDateTime).startsWith(dateFilter!)
        );
        if (userTicketsOnDate.length > 0) {
          context.push(`\n[YOUR INCIDENTS CREATED ON ${dateFilter} - ${userTicketsOnDate.length} incident(s)]:`);
          context.push(userTicketsOnDate.slice(0, 25).map((t, i) =>
            `${i + 1}. Incident #${t.IncidentNumber}: "${t.Subject}" - ${t.Status} - Priority ${t.Priority} - Created: ${t.HumanCreatedDateTime || t.CreatedDateTime || 'Unknown'}`
          ).join('\n'));
        } else {
          context.push(`\n[INCIDENTS ON ${dateFilter}]: You don't have any tickets created on this date.`);
        }
      }
      } else {
        // If the user mentioned a month without a specific day (e.g., "in december"),
        // filter by month and optionally year.
        let monthOnlyIndex = -1;
        for (let i = 0; i < monthNames.length; i++) {
          if (lowerQuery.includes(monthNames[i])) {
            monthOnlyIndex = i;
            break;
          }
        }

        if (monthOnlyIndex >= 0) {
          // Try to detect a year in the query, otherwise assume current year
          let year = new Date().getFullYear();
          const yearMatch = query.match(/\b(20\d{2})\b/);
          if (yearMatch) {
            year = parseInt(yearMatch[1], 10);
          }

          const incidentsInMonth = kb.incidents.filter(t => {
            if (!t.CreatedDateTime) return false;
            const d = new Date(t.CreatedDateTime);
            return d.getMonth() === monthOnlyIndex && d.getFullYear() === year;
          });

          const monthLabel = monthNames[monthOnlyIndex][0].toUpperCase() + monthNames[monthOnlyIndex].slice(1);
          
          // SECURITY: Only show all incidents if user has permission
          if (canViewAllTickets) {
            context.push(`\n[INCIDENTS CREATED IN ${monthLabel} ${year} - ${incidentsInMonth.length} incident(s)]:`);
            if (incidentsInMonth.length > 0) {
              context.push(incidentsInMonth.slice(0, 50).map((t, i) =>
                `${i + 1}. Incident #${t.IncidentNumber}: "${t.Subject}" - ${t.Status} - Priority ${t.Priority} - Reporter: ${t.ProfileFullName || 'Unknown'} - Created: ${t.HumanCreatedDateTime || t.CreatedDateTime || 'Unknown'}`
              ).join('\n'));
              if (incidentsInMonth.length > 50) {
                context.push(`... and ${incidentsInMonth.length - 50} more incidents in that month.`);
              }
            } else {
              context.push(`No incidents were found with CreatedDateTime in ${monthLabel} ${year}.`);
            }
          } else {
            // Self Service users can only see their own tickets
            const userTicketsInMonth = kb.userTickets.filter(t => {
              if (!t.CreatedDateTime) return false;
              const d = new Date(t.CreatedDateTime);
              return d.getMonth() === monthOnlyIndex && d.getFullYear() === year;
            });
            
            if (userTicketsInMonth.length > 0) {
              context.push(`\n[YOUR INCIDENTS CREATED IN ${monthLabel} ${year} - ${userTicketsInMonth.length} incident(s)]:`);
              context.push(userTicketsInMonth.slice(0, 50).map((t, i) =>
                `${i + 1}. Incident #${t.IncidentNumber}: "${t.Subject}" - ${t.Status} - Priority ${t.Priority} - Created: ${t.HumanCreatedDateTime || t.CreatedDateTime || 'Unknown'}`
              ).join('\n'));
            } else {
              context.push(`\n[INCIDENTS IN ${monthLabel} ${year}]: You don't have any tickets created in this month.`);
            }
          }
        } else {
          // Default: show recent incidents (always include created date so the AI can't claim dates are missing)
          // SECURITY: Only show all incidents if user has permission
          if (canViewAllTickets) {
            context.push(`\n[RECENT INCIDENTS IN SYSTEM - ${kb.incidents.length} total]:`);
            if (kb.incidents.length > 0) {
              const sample = kb.incidents.slice(0, 10);
              context.push(sample.map((t, i) => 
                `${i + 1}. Incident #${t.IncidentNumber}: "${t.Subject}" - ${t.Status} - Priority ${t.Priority} - ${t.ProfileFullName || 'Unknown'} - Created: ${t.HumanCreatedDateTime || t.CreatedDateTime || 'Unknown'}`
              ).join('\n'));
              if (kb.incidents.length > 10) {
                context.push(`... and ${kb.incidents.length - 10} more incidents in the system.`);
              }
            }
          } else {
            context.push(`\n[INCIDENTS]: You can only view your own tickets. Use "my tickets" to see tickets you created.`);
          }
        }
      }
    
    // Add user's own tickets if available
    if (kb.userTickets.length > 0 && currentUser) {
      context.push(`\n[YOUR TICKETS - ${kb.userTickets.length} total]:`);
      context.push(kb.userTickets.slice(0, 10).map((t, i) => 
        `${i + 1}. Incident #${t.IncidentNumber}: "${t.Subject}" - ${t.Status} - Priority ${t.Priority}`
      ).join('\n'));
    }
  }

  // If query is about service requests (SR tickets)
  if (lowerQuery.includes('service request') || lowerQuery.includes('service requests') ||
      combinedContext.includes('service request') || combinedContext.includes('service requests') ||
      /\bsr\s*#?\d+/i.test(query)) {
    // Try to detect a specific date in the query (e.g., "december 1", "2025-12-01")
    let srDateFilter: string | null = null;
    const monthNamesSR = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    // Support both "december 1" and "december 1st"
    const monthRegexSR = new RegExp(`\\b(${monthNamesSR.join('|')})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i');
    const matchSR = query.match(monthRegexSR);
    if (matchSR) {
      const monthIndex = monthNamesSR.findIndex(m => m === matchSR[1].toLowerCase());
      const day = parseInt(matchSR[2], 10);
      const year = new Date().getFullYear(); // assume current year
      if (monthIndex >= 0 && day >= 1 && day <= 31) {
        const isoDate = new Date(year, monthIndex, day).toISOString().slice(0, 10); // YYYY-MM-DD
        srDateFilter = isoDate;
      }
    } else {
      const isoMatchSR = query.match(/\b(\d{4}-\d{2}-\d{2})\b/);
      if (isoMatchSR) {
        srDateFilter = isoMatchSR[1];
      } else {
        const usMatchSR = query.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/);
        if (usMatchSR) {
          const month = parseInt(usMatchSR[1], 10) - 1;
          const day = parseInt(usMatchSR[2], 10);
          const year = parseInt(usMatchSR[3], 10);
          if (month >= 0 && month < 12 && day >= 1 && day <= 31) {
            const isoDate = new Date(year, month, day).toISOString().slice(0, 10);
            srDateFilter = isoDate;
          }
        }
      }
    }

    context.push(`\n[SERVICE REQUESTS IN SYSTEM - ${kb.serviceRequests.length} total]:`);
    if (kb.serviceRequests.length > 0) {
      let list = kb.serviceRequests;

      if (srDateFilter) {
        // Filter by CreatedDateTime prefix
        list = kb.serviceRequests.filter((sr: any) =>
          sr.CreatedDateTime && String(sr.CreatedDateTime).startsWith(srDateFilter!)
        );
        context.push(`[FILTERED BY CreatedDateTime = ${srDateFilter}] (${list.length} SR(s) found)`);
      } else {
        // Month-only filter similar to incidents when user mentions a month name
        let monthOnlyIndexSR = -1;
        for (let i = 0; i < monthNamesSR.length; i++) {
          if (lowerQuery.includes(monthNamesSR[i])) {
            monthOnlyIndexSR = i;
            break;
          }
        }
        if (monthOnlyIndexSR >= 0) {
          let year = new Date().getFullYear();
          const yearMatchSR2 = query.match(/\b(20\d{2})\b/);
          if (yearMatchSR2) {
            year = parseInt(yearMatchSR2[1], 10);
          }
          list = kb.serviceRequests.filter((sr: any) => {
            if (!sr.CreatedDateTime) return false;
            const d = new Date(sr.CreatedDateTime);
            return d.getMonth() === monthOnlyIndexSR && d.getFullYear() === year;
          });
          const monthLabelSR = monthNamesSR[monthOnlyIndexSR][0].toUpperCase() + monthNamesSR[monthOnlyIndexSR].slice(1);
          context.push(`[FILTERED BY month = ${monthLabelSR} ${year}] (${list.length} SR(s) found)`);
        }
      }

      const sample = list.slice(0, 20);
      context.push(sample.map((sr: any, i: number) => {
        const number = sr.RequestNumber || sr.ServiceReqNumber || sr.DisplayName || sr.RecId;
        const subject = sr.Subject || sr.DisplayName || 'No subject';
        const status = sr.Status || 'Unknown status';
        const service = sr.Service || 'Unknown service';
        const created = sr.HumanCreatedDateTime || sr.CreatedDateTime || 'Unknown created date';
        return `${i + 1}. SR ${number}: "${subject}" - ${status} - Service: ${service} - Created: ${created}`;
      }).join('\n'));
      if (list.length > 20) {
        context.push(`... and ${list.length - 20} more service requests in the system.`);
      } else if (!srDateFilter && kb.serviceRequests.length > 20) {
        context.push(`... and ${kb.serviceRequests.length - 20} more service requests in the system.`);
      }
    }
  }
  
  // If query is about categories
  if (lowerQuery.includes('category') || combinedContext.includes('category')) {
    context.push(`\n[AVAILABLE CATEGORIES - ${kb.categories.length} total]:`);
    if (kb.categories.length > 0) {
      context.push(kb.categories.slice(0, 25).map((c, i) => 
        `${i + 1}. ${c.DisplayName || c.Name}${c.Service ? ` (${c.Service})` : ''}`
      ).join('\n'));
    }
  }
  
  // If query is about services OR recent conversation mentioned services (IMPORTANT: Include details!)
  // IMPORTANT: Avoid triggering this when user explicitly says "service request(s)"
  const mentionsServiceRequest = lowerQuery.includes('service request') || combinedContext.includes('service request');
  if ((lowerQuery.includes('service') || combinedContext.includes('service')) && !mentionsServiceRequest || 
      lowerQuery.includes('one with') || lowerQuery.includes('detail') || lowerQuery.includes('give me')) {
    context.push(`\n[AVAILABLE SERVICES - ${kb.services.length} total]:`);
    if (kb.services.length > 0) {
      // Show ALL services with full details when asked for details
      const showAll = lowerQuery.includes('detail') || lowerQuery.includes('one with') || lowerQuery.includes('give me');
      const servicesToShow = showAll ? kb.services : kb.services.slice(0, 25);
      context.push(servicesToShow.map((s, i) => {
        const details: string[] = [];
        details.push(`${i + 1}. ${s.DisplayName || s.Name}`);
        if (s.Description) details.push(`   Description: ${s.Description}`);
        if (s.ServiceOwner) details.push(`   Owner: ${s.ServiceOwner}`);
        if (s.ServiceOwnerTeam) details.push(`   Owner Team: ${s.ServiceOwnerTeam}`);
        if (s.IsActive !== undefined) details.push(`   Status: ${s.IsActive ? 'Active' : 'Inactive'}`);
        return details.join('\n');
      }).join('\n\n'));
      if (!showAll && kb.services.length > 25) {
        context.push(`... and ${kb.services.length - 25} more services in the system.`);
      }
    }
  }
  
  // If query is about teams
  if (lowerQuery.includes('team') || combinedContext.includes('team')) {
    context.push(`\n[AVAILABLE TEAMS - ${kb.teams.length} total]:`);
    if (kb.teams.length > 0) {
      context.push(kb.teams.slice(0, 25).map((t, i) => 
        `${i + 1}. ${t.DisplayName || t.Name}${t.Department ? ` (${t.Department})` : ''}`
      ).join('\n'));
    }
  }
  
  // If query is about departments
  if (lowerQuery.includes('department') || combinedContext.includes('department')) {
    context.push(`\n[AVAILABLE DEPARTMENTS - ${kb.departments.length} total]:`);
    if (kb.departments.length > 0) {
      context.push(kb.departments.slice(0, 25).map((d, i) => 
        `${i + 1}. ${d.DisplayName || d.Name}`
      ).join('\n'));
    }
  }
  
  context.push(`\n[KNOWLEDGE BASE INFO]: This data was last updated ${Math.round((Date.now() - kb.lastUpdated) / 1000)} seconds ago.`);
  // SECURITY: Add role-based restrictions to AI instructions
  if (currentUser?.capabilities) {
    const caps = currentUser.capabilities;
    context.push(`\n[SECURITY RESTRICTIONS - STRICTLY ENFORCE]:`);
    
    if (!caps.canViewAllUsers) {
      context.push(`- User CANNOT search for or view other employees/users. Only show their own profile if asked.`);
    }
    
    if (!caps.canViewAllTickets) {
      context.push(`- User CANNOT view all tickets. Only show their own tickets (from [YOUR TICKETS] section above).`);
      context.push(`- If user asks for "all tickets" or "all incidents", redirect them to use "my tickets" instead.`);
    }
    
    if (!caps.canEditAllTickets && !caps.canCloseTickets) {
      context.push(`- User CANNOT edit, update, assign, or close tickets. They can only CREATE new tickets.`);
    }
    
    context.push(`- User CAN create new tickets (this is allowed for all users).`);
  }
  
  context.push(`\n[CRITICAL INSTRUCTION]: Use ONLY the data provided in this knowledge base context. Respect the security restrictions above. When users ask about services, categories, teams, or departments, you MUST use the data from this knowledge base. Do NOT say "I don't have that information" if it's in the knowledge base above.`);
  context.push(`If a user asks for "one with detail" or "give me one", provide the FULL details from the knowledge base, including Name, Description, Owner, Status, etc.`);
  
  return context.join('\n');
}

/**
 * Search knowledge base for specific data
 */
export async function searchKnowledgeBase(
  type: 'employees' | 'incidents' | 'categories' | 'services' | 'teams' | 'departments',
  searchTerm?: string
): Promise<any[]> {
  const kb = await loadKnowledgeBase();
  
  if (!kb) {
    return [];
  }
  
  switch (type) {
    case 'employees':
      if (!searchTerm) return kb.employees;
      const lowerSearch = searchTerm.toLowerCase().trim();
      
      // Split search term into words for better matching
      const searchWords = lowerSearch.split(/\s+/);
      
      return kb.employees.filter(emp => {
        const displayName = (emp.DisplayName || '').toLowerCase();
        const email = (emp.PrimaryEmail || emp.LoginID || '').toLowerCase();
        
        // Check if all search words appear in display name or email
        const matchesDisplayName = searchWords.every(word => displayName.includes(word));
        const matchesEmail = searchWords.every(word => email.includes(word));
        
        // Also check if display name or email contains the full search term
        const containsFullTerm = displayName.includes(lowerSearch) || email.includes(lowerSearch);
        
        return matchesDisplayName || matchesEmail || containsFullTerm;
      });
    
    case 'incidents':
      if (!searchTerm) return kb.incidents;
      const lowerIncident = searchTerm.toLowerCase();
      return kb.incidents.filter(inc => 
        inc.Subject?.toLowerCase().includes(lowerIncident) ||
        String(inc.IncidentNumber).includes(searchTerm) ||
        inc.ProfileFullName?.toLowerCase().includes(lowerIncident)
      );
    
    case 'categories':
      return kb.categories;
    
    case 'services':
      if (!searchTerm) return kb.services;
      const lowerService = searchTerm.toLowerCase();
      return kb.services.filter(svc => 
        (svc.DisplayName || svc.Name)?.toLowerCase().includes(lowerService)
      );
    
    case 'teams':
      if (!searchTerm) return kb.teams;
      const lowerTeam = searchTerm.toLowerCase();
      return kb.teams.filter(team => 
        (team.DisplayName || team.Name)?.toLowerCase().includes(lowerTeam)
      );
    
    case 'departments':
      if (!searchTerm) return kb.departments;
      const lowerDept = searchTerm.toLowerCase();
      return kb.departments.filter(dept => 
        (dept.DisplayName || dept.Name)?.toLowerCase().includes(lowerDept)
      );
    
    default:
      return [];
  }
}

/**
 * Update knowledge base (refresh data)
 */
export async function updateKnowledgeBase(
  currentUser: IvantiUser | null,
  onProgress?: (stage: string, progress: number, message: string) => void
): Promise<KnowledgeBase> {
  console.log('%c[KnowledgeBase] 🔄 Updating knowledge base...', 'color: #8b5cf6; font-weight: bold;');
  return buildKnowledgeBase(currentUser, onProgress);
}

