/**
 * Change Detection Service for Ivanti Data
 * 
 * Implements polling-based change detection using LastModified timestamps.
 * Monitors Ivanti data for changes and notifies the extension.
 * 
 * 2025 BEST PRACTICE: Use polling with LastModified field for change detection
 * since Ivanti Service Manager doesn't support webhooks/real-time push.
 */

import { IvantiUser } from './userIdentity';
import { searchTickets, getUserTickets } from './ivantiDataService';

export interface ChangeEvent {
  type: 'incident_updated' | 'incident_created' | 'ticket_updated' | 'ticket_created';
  id: string;
  incidentNumber?: string;
  timestamp: Date;
  changes?: string[];
}

export type ChangeCallback = (changes: ChangeEvent[]) => void;

interface MonitoredTicket {
  recId: string;
  incidentNumber: string;
  lastModified: string;
  lastChecked: number;
}

// Store monitored tickets per user
const monitoredTickets = new Map<string, MonitoredTicket[]>();

// Polling intervals (in milliseconds)
const POLLING_INTERVALS = {
  activeTickets: 30 * 1000,      // Check active tickets every 30 seconds
  userTickets: 60 * 1000,        // Check user's tickets every 60 seconds
  recentTickets: 2 * 60 * 1000,  // Check recent tickets every 2 minutes
};

// Change callbacks
const changeCallbacks: ChangeCallback[] = [];

/**
 * Register a callback for change events
 */
export function onChanges(callback: ChangeCallback): () => void {
  changeCallbacks.push(callback);
  
  // Return unsubscribe function
  return () => {
    const index = changeCallbacks.indexOf(callback);
    if (index > -1) {
      changeCallbacks.splice(index, 1);
    }
  };
}

/**
 * Notify all registered callbacks of changes
 */
function notifyChanges(changes: ChangeEvent[]): void {
  if (changes.length === 0) return;
  
  console.log(`[ChangeDetection] 🔔 Detected ${changes.length} change(s)`);
  changeCallbacks.forEach(callback => {
    try {
      callback(changes);
    } catch (error) {
      console.error('[ChangeDetection] Error in change callback:', error);
    }
  });
}

/**
 * Check for changes in monitored tickets
 */
async function checkTicketChanges(
  userId: string
): Promise<ChangeEvent[]> {
  const changes: ChangeEvent[] = [];
  const monitored = monitoredTickets.get(userId) || [];
  
  if (monitored.length === 0) return changes;
  
  try {
    // Fetch current state of monitored tickets
    const ticketNumbers = monitored.map(t => t.incidentNumber);
    const currentTickets = await Promise.all(
      ticketNumbers.map(async (num) => {
        try {
          const tickets = await searchTickets(`IncidentNumber eq '${num}'`, 1);
          return tickets[0] || null;
        } catch (error) {
          console.error(`[ChangeDetection] Error fetching ticket ${num}:`, error);
          return null;
        }
      })
    );
    
    // Compare LastModified timestamps
    for (let i = 0; i < monitored.length; i++) {
      const monitoredTicket = monitored[i];
      const currentTicket = currentTickets[i];
      
      if (!currentTicket) continue;
      
      const currentLastModified = String(currentTicket.LastModDateTime || currentTicket.CreatedDateTime || '');
      const monitoredLastModified = monitoredTicket.lastModified;
      
      if (currentLastModified && currentLastModified !== monitoredLastModified) {
        // Change detected!
        const changeType = String(currentTicket.LastModDateTime || '') !== monitoredLastModified
          ? 'incident_updated'
          : 'incident_created';
        
        changes.push({
          type: changeType,
          id: String(currentTicket.RecId || monitoredTicket.recId),
          incidentNumber: monitoredTicket.incidentNumber,
          timestamp: new Date(),
        });
        
        // Update monitored ticket
        monitoredTicket.lastModified = currentLastModified;
        monitoredTicket.lastChecked = Date.now();
      }
    }
    
    // Update monitored tickets
    monitoredTickets.set(userId, monitored);
    
  } catch (error) {
    console.error('[ChangeDetection] Error checking ticket changes:', error);
  }
  
  return changes;
}

/**
 * Monitor user's tickets for changes
 */
async function monitorUserTickets(
  userId: string,
  currentUser: IvantiUser
): Promise<ChangeEvent[]> {
  const changes: ChangeEvent[] = [];
  
  if (!currentUser.recId) return changes;
  
  try {
    // Fetch user's recent tickets
    const userTickets = await getUserTickets(currentUser.recId, 20);
    
    // Get or initialize monitored tickets
    let monitored = monitoredTickets.get(userId) || [];
    
    // Check for new tickets or changes
    for (const ticket of userTickets) {
      const lastModified = String(ticket.LastModDateTime || ticket.CreatedDateTime || '');
      if (!lastModified || lastModified === 'undefined' || lastModified === 'null') continue;
      
      const existing = monitored.find(
        m => m.incidentNumber === ticket.IncidentNumber
      );
      
      if (!existing) {
        // New ticket detected
        monitored.push({
          recId: String(ticket.RecId || ''),
          incidentNumber: String(ticket.IncidentNumber || ''),
          lastModified: lastModified,
          lastChecked: Date.now(),
        });
        
        changes.push({
          type: 'ticket_created',
          id: String(ticket.RecId || ''),
          incidentNumber: String(ticket.IncidentNumber || ''),
          timestamp: new Date(),
        });
      } else if (existing.lastModified !== lastModified) {
        // Ticket updated
        existing.lastModified = lastModified;
        existing.lastChecked = Date.now();
        
        changes.push({
          type: 'ticket_updated',
          id: String(ticket.RecId || ''),
          incidentNumber: String(ticket.IncidentNumber || ''),
          timestamp: new Date(),
        });
      } else {
        // Update last checked time
        existing.lastChecked = Date.now();
      }
    }
    
    // Remove tickets that are no longer in user's list (older than 7 days)
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    monitored = monitored.filter(m => m.lastChecked > sevenDaysAgo);
    
    monitoredTickets.set(userId, monitored);
    
  } catch (error) {
    console.error('[ChangeDetection] Error monitoring user tickets:', error);
  }
  
  return changes;
}

/**
 * Start monitoring changes for a user
 */
export function startMonitoring(userId: string, currentUser: IvantiUser): () => void {
  console.log(`[ChangeDetection] 🚀 Starting change monitoring for user: ${userId}`);
  
  let isActive = true;
  
  // Initial check
  setTimeout(async () => {
    if (!isActive) return;
    
    try {
      const ticketChanges = await checkTicketChanges(userId);
      const userTicketChanges = await monitorUserTickets(userId, currentUser);
      const allChanges = [...ticketChanges, ...userTicketChanges];
      
      if (allChanges.length > 0) {
        notifyChanges(allChanges);
      }
    } catch (error) {
      console.error('[ChangeDetection] Error in initial check:', error);
    }
  }, 5000); // Initial check after 5 seconds
  
  // Poll for changes
  const pollUserTickets = setInterval(async () => {
    if (!isActive) {
      clearInterval(pollUserTickets);
      return;
    }
    
    try {
      const changes = await monitorUserTickets(userId, currentUser);
      if (changes.length > 0) {
        notifyChanges(changes);
      }
    } catch (error) {
      console.error('[ChangeDetection] Error polling user tickets:', error);
    }
  }, POLLING_INTERVALS.userTickets);
  
  // Poll for monitored tickets
  const pollMonitoredTickets = setInterval(async () => {
    if (!isActive) {
      clearInterval(pollMonitoredTickets);
      return;
    }
    
    try {
      const changes = await checkTicketChanges(userId);
      if (changes.length > 0) {
        notifyChanges(changes);
      }
    } catch (error) {
      console.error('[ChangeDetection] Error polling monitored tickets:', error);
    }
  }, POLLING_INTERVALS.activeTickets);
  
  // Return stop function
  return () => {
    isActive = false;
    clearInterval(pollUserTickets);
    clearInterval(pollMonitoredTickets);
    console.log(`[ChangeDetection] 🛑 Stopped change monitoring for user: ${userId}`);
  };
}

/**
 * Add a ticket to monitoring list
 */
export function monitorTicket(
  userId: string,
  recId: string,
  incidentNumber: string,
  lastModified: string
): void {
  let monitored = monitoredTickets.get(userId) || [];
  
  // Check if already monitored
  if (monitored.some(m => m.incidentNumber === incidentNumber)) {
    return;
  }
  
  monitored.push({
    recId,
    incidentNumber,
    lastModified,
    lastChecked: Date.now(),
  });
  
  monitoredTickets.set(userId, monitored);
  console.log(`[ChangeDetection] 👁️  Now monitoring ticket: ${incidentNumber}`);
}

/**
 * Stop monitoring for a user (on logout)
 */
export function stopMonitoring(userId: string): void {
  monitoredTickets.delete(userId);
  console.log(`[ChangeDetection] 🛑 Stopped monitoring for user: ${userId}`);
}

/**
 * Get monitoring status
 */
export function getMonitoringStatus(userId: string): {
  monitoredTickets: number;
  lastChecked: Date | null;
} {
  const monitored = monitoredTickets.get(userId) || [];
  const lastChecked = monitored.length > 0
    ? new Date(Math.max(...monitored.map(m => m.lastChecked)))
    : null;
  
  return {
    monitoredTickets: monitored.length,
    lastChecked,
  };
}

