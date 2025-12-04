/**
 * Data Pre-fetching Service
 * 
 * Pre-fetches common Ivanti data during extension initialization
 * to improve AI response quality and reduce latency.
 * 
 * This runs in the background while the loading screen is shown.
 */

import { IvantiUser } from './userIdentity';
import { getUserTickets, fetchCategories, searchTickets } from './ivantiDataService';
import { buildKnowledgeBase } from './knowledgeBaseService';

export interface PrefetchProgress {
  stage: string;
  progress: number; // 0-100
  message: string;
}

export type PrefetchCallback = (progress: PrefetchProgress) => void;

/**
 * Pre-fetch common data that the AI might need
 * This runs during the loading screen to warm up the cache
 */
export async function prefetchCommonData(
  currentUser: IvantiUser | null,
  onProgress?: PrefetchCallback
): Promise<void> {
  try {
    console.log('%c[Prefetch] 🚀 Starting comprehensive data pre-fetching (building knowledge base)...', 'color: #8b5cf6; font-weight: bold; font-size: 14px;');
    
    if (!currentUser) {
      console.log('[Prefetch] No user identified, skipping pre-fetch');
      return;
    }

    // Build comprehensive knowledge base (this is the AI's "brain")
    try {
      await buildKnowledgeBase(currentUser, (stage, progress, message) => {
        if (onProgress) {
          onProgress({
            stage,
            progress,
            message
          });
        }
      });
      console.log('%c[Prefetch] ✅ Knowledge base built successfully!', 'color: #10b981; font-weight: bold; font-size: 14px;');
    } catch (error) {
      console.error('[Prefetch] Error building knowledge base:', error);
      // Fall back to basic pre-fetching
      console.log('[Prefetch] Falling back to basic pre-fetching...');
      
      const totalSteps = 3;
      let currentStep = 0;

      // Step 1: Fetch user's own tickets
      if (onProgress) {
        onProgress({
          stage: 'user_tickets',
          progress: Math.round((currentStep / totalSteps) * 100),
          message: 'Loading your tickets...'
        });
      }
      
      if (currentUser.recId) {
        try {
          const tickets = await getUserTickets(currentUser.recId, 20);
          console.log(`%c[Prefetch] ✅ User tickets cached (${tickets.length} tickets)`, 'color: #10b981; font-weight: bold;');
        } catch (error) {
          console.error('[Prefetch] ❌ Error fetching user tickets:', error);
        }
      }
      
      currentStep++;

      // Step 2: Fetch categories
      if (onProgress) {
        onProgress({
          stage: 'categories',
          progress: Math.round((currentStep / totalSteps) * 100),
          message: 'Loading categories...'
        });
      }
      
      try {
        const categories = await fetchCategories(25);
        console.log(`%c[Prefetch] ✅ Categories cached (${categories.length} categories)`, 'color: #10b981; font-weight: bold;');
      } catch (error) {
        console.error('[Prefetch] ❌ Error fetching categories:', error);
      }
      
      currentStep++;

      // Step 3: Fetch recent incidents
      if (onProgress) {
        onProgress({
          stage: 'recent_incidents',
          progress: Math.round((currentStep / totalSteps) * 100),
          message: 'Loading recent incidents...'
        });
      }
      
      try {
        const incidents = await searchTickets('Priority le 2', 10);
        console.log(`%c[Prefetch] ✅ Recent incidents cached (${incidents.length} incidents)`, 'color: #10b981; font-weight: bold;');
      } catch (error) {
        console.error('[Prefetch] ❌ Error fetching recent incidents:', error);
      }
      
      currentStep++;

      if (onProgress) {
        onProgress({
          stage: 'complete',
          progress: 100,
          message: 'Ready!'
        });
      }
    }
    
    console.log('%c[Prefetch] ✅ Data pre-fetching complete!', 'color: #10b981; font-weight: bold; font-size: 14px;');
    
    // Log knowledge base stats
    try {
      const { loadKnowledgeBase } = await import('./knowledgeBaseService');
      const kb = await loadKnowledgeBase();
      if (kb) {
        console.log('%c[Knowledge Base Stats]', 'color: #6366f1; font-weight: bold;', {
          employees: kb.employees.length,
          incidents: kb.incidents.length,
          categories: kb.categories.length,
          userTickets: kb.userTickets.length,
          lastUpdated: new Date(kb.lastUpdated).toLocaleTimeString(),
          totalSize: `${(JSON.stringify(kb).length / 1024).toFixed(2)} KB`
        });
      }
    } catch (error) {
      // Ignore if knowledge base not available
    }
    
    // Also log cache stats
    try {
      const { getCacheStats } = await import('./cacheService');
      const stats = await getCacheStats();
      console.log('%c[Cache Stats]', 'color: #6366f1; font-weight: bold;', {
        totalEntries: stats.totalEntries,
        byType: stats.entriesByType,
        oldest: stats.oldestEntry ? new Date(stats.oldestEntry).toLocaleTimeString() : 'N/A',
        newest: stats.newestEntry ? new Date(stats.newestEntry).toLocaleTimeString() : 'N/A'
      });
    } catch (error) {
      // Ignore if cache stats not available
    }
  } catch (error) {
    console.error('[Prefetch] Error during pre-fetching:', error);
    if (onProgress) {
      onProgress({
        stage: 'error',
        progress: 100,
        message: 'Pre-fetching completed with some errors'
      });
    }
  }
}

/**
 * Pre-fetch data for a specific user query (e.g., when user asks about someone)
 * This is called on-demand when the AI detects it needs specific data
 */
export async function prefetchForQuery(
  query: string,
  _currentUser: IvantiUser | null
): Promise<void> {
  try {
    const lowerQuery = query.toLowerCase();
    
    // If query mentions a user name, pre-fetch that user's data
    if (lowerQuery.includes('user') || lowerQuery.includes('employee')) {
      // Extract name from query (simple pattern matching)
      const nameMatch = query.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/);
      if (nameMatch && nameMatch[1]) {
        const name = nameMatch[1];
        console.log(`[Prefetch] Pre-fetching data for user: ${name}`);
        // The actual fetching will happen in fetchIvantiData, but we can trigger cache warming here
      }
    }
    
    // If query mentions incidents, pre-fetch recent incidents
    if (lowerQuery.includes('incident') || lowerQuery.includes('ticket')) {
      console.log('[Prefetch] Pre-fetching recent incidents...');
      await searchTickets('Status ne null', 20);
    }
  } catch (error) {
    console.error('[Prefetch] Error in query-specific pre-fetch:', error);
  }
}

