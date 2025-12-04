/**
 * Roles Service
 * 
 * Fetches and manages Ivanti role definitions and permissions
 * Uses the frs_def_roles endpoint to get role information
 */

import { IVANTI_CONFIG } from '../config';

export interface IvantiRole {
  RecId: string;
  Name: string;
  DisplayName?: string;
  Description?: string;
  IsActive?: boolean;
  Permissions?: string[];
  Capabilities?: string[];
  [key: string]: any;
}

export interface RoleCapabilities {
  canViewAllTickets: boolean;
  canEditAllTickets: boolean;
  canDeleteTickets: boolean;
  canCreateTickets: boolean;
  canAssignTickets: boolean;
  canCloseTickets: boolean;
  canViewAllUsers: boolean;
  canEditUsers: boolean;
  canDeleteUsers: boolean;
  canViewReports: boolean;
  canManageCategories: boolean;
  canManageServices: boolean;
  canManageTeams: boolean;
  canManageDepartments: boolean;
  canAccessAdminPanel: boolean;
  canModifySystemSettings: boolean;
  canViewSensitiveData: boolean;
  canExportData: boolean;
  canImportData: boolean;
}

/**
 * Fetch all roles from Ivanti
 */
export async function fetchRoles(): Promise<IvantiRole[]> {
  try {
    console.log('[RolesService] 📥 Fetching roles from Ivanti...');
    
    const url = `${IVANTI_CONFIG.baseUrl}${IVANTI_CONFIG.endpoints.roles}?$top=500`;
    
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include', // Use browser's session cookies
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`[RolesService] ❌ Failed to fetch roles: ${response.status} ${response.statusText}`);
      return [];
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      console.warn('[RolesService] ⚠️ Response is not JSON (content-type:', contentType, ')');
      return [];
    }

    const data = await response.json();
    const roles: IvantiRole[] = data.value || data || [];
    
    console.log(`[RolesService] ✅ Loaded ${roles.length} roles`);
    return roles;
  } catch (error) {
    console.error('[RolesService] ❌ Error fetching roles:', error);
    return [];
  }
}

/**
 * Map role names to capabilities based on Ivanti role definitions
 * This is a heuristic mapping - adjust based on your organization's actual roles
 */
export function mapRolesToCapabilities(roleNames: string[]): RoleCapabilities {
  // Normalize roles:
  // - lower-case
  // - remove spaces so "HR Administrator" => "hradministrator"
  const lowerRoles = roleNames.map(r => r.toLowerCase());
  const normalized = roleNames.map(r => r.toLowerCase().replace(/\s+/g, ''));

  const hasRoleId = (id: string) => normalized.includes(id.toLowerCase().replace(/\s+/g, ''));

  // Default capabilities (most restrictive, similar to a standard self-service user)
  const capabilities: RoleCapabilities = {
    canViewAllTickets: false,
    canEditAllTickets: false,
    canDeleteTickets: false,
    canCreateTickets: true, // most users can create their own tickets
    canAssignTickets: false,
    canCloseTickets: false,
    canViewAllUsers: false,
    canEditUsers: false,
    canDeleteUsers: false,
    canViewReports: false,
    canManageCategories: false,
    canManageServices: false,
    canManageTeams: false,
    canManageDepartments: false,
    canAccessAdminPanel: false,
    canModifySystemSettings: false,
    canViewSensitiveData: false,
    canExportData: false,
    canImportData: false,
  };

  // 1) SYSTEM-LEVEL ADMIN ROLES (very strong, but still no delete/password at AI level)
  //
  // We are intentionally strict here: only specific known admin RoleIDs
  // should grant full capabilities. Generic "administrator" text in business
  // roles (e.g. "HR Administrator") will NOT be treated as full ITSM admin.
  const isSystemAdmin =
    hasRoleId('Admin') ||
    hasRoleId('ivnt_SecurityAdministrator') ||
    hasRoleId('ConfigurationManager');

  if (isSystemAdmin) {
    return {
      canViewAllTickets: true,
      canEditAllTickets: true,
      canDeleteTickets: false, // Still blocked by security restrictions
      canCreateTickets: true,
      canAssignTickets: true,
      canCloseTickets: true,
      canViewAllUsers: true,
      canEditUsers: true,
      canDeleteUsers: false, // Still blocked by security restrictions
      canViewReports: true,
      canManageCategories: true,
      canManageServices: true,
      canManageTeams: true,
      canManageDepartments: true,
      canAccessAdminPanel: true,
      canModifySystemSettings: true,
      canViewSensitiveData: true,
      canExportData: true,
      canImportData: true,
    };
  }

  // 2) SELF-SERVICE STYLE ROLES
  //
  // RoleIDs from your tenant: SelfService, SelfServiceMobile, CallLogSelfService,
  // SelfserviceFM, SelfServiceSecurityOperations, plus any role containing "selfservice".
  const isSelfService =
    hasRoleId('SelfService') ||
    hasRoleId('SelfServiceMobile') ||
    hasRoleId('CallLogSelfService') ||
    hasRoleId('SelfserviceFM') ||
    hasRoleId('SelfServiceSecurityOperations') ||
    lowerRoles.some(r => r.includes('selfservice'));

  if (isSelfService) {
    // Default already matches a safe self-service profile:
    // - canCreateTickets (own)
    // - can view only own tickets
    // Nothing else to elevate.
  }

  // 3) SERVICE DESK / AGENT / ANALYST ROLES
  //
  // RoleIDs: ServiceDeskAnalyst, ServiceDeskAUSpark, CallLogSupportDeskAnalyst,
  // ResponsiveAnalyst, AssetScanner, MobileAssetManager, any role containing
  // "analyst", "agent", "support" etc.
  const isServiceDeskAgent =
    hasRoleId('ServiceDeskAnalyst') ||
    hasRoleId('ServiceDeskAUSpark') ||
    hasRoleId('CallLogSupportDeskAnalyst') ||
    hasRoleId('ResponsiveAnalyst') ||
    hasRoleId('AssetScanner') ||
    hasRoleId('MobileAssetManager') ||
    lowerRoles.some(r =>
      r.includes('agent') ||
      r.includes('analyst') ||
      r.includes('technician') ||
      r.includes('support desk') ||
      r.includes('servicedesk')
    );

  if (isServiceDeskAgent) {
    capabilities.canViewAllTickets = true;
    capabilities.canEditAllTickets = true; // Can edit tickets they own/are assigned
    capabilities.canAssignTickets = true;
    capabilities.canCloseTickets = true;
    capabilities.canViewAllUsers = true;
    capabilities.canViewReports = true;
    capabilities.canExportData = true;
  }

  // 4) BUSINESS / DOMAIN MANAGER ROLES
  //
  // RoleIDs: ProcurementManager, PortfolioManager, FinanceManager, ProjectManager,
  // PayrollManager, HRManager, HRRecruiter, nrn_DemandManager, FacilitiesAdministrator,
  // plus generic "*Manager" roles.
  const isDomainManager =
    hasRoleId('ProcurementManager') ||
    hasRoleId('PortfolioManager') ||
    hasRoleId('FinanceManager') ||
    hasRoleId('ProjectManager') ||
    hasRoleId('PayrollManager') ||
    hasRoleId('HRManager') ||
    hasRoleId('HRRecruiter') ||
    hasRoleId('nrn_DemandManager') ||
    hasRoleId('FacilitiesAdministrator') ||
    lowerRoles.some(r =>
      r.includes(' manager') || // space to avoid matching "management"
      r.endsWith('manager') ||
      r.includes('supervisor') ||
      r.includes('lead') ||
      r.includes('director')
    );

  if (isDomainManager) {
    capabilities.canViewAllTickets = true;
    // Domain managers typically do not heavily edit tickets, but may approve.
    capabilities.canEditAllTickets = true;
    capabilities.canAssignTickets = true;
    capabilities.canCloseTickets = true;
    capabilities.canViewAllUsers = true;
    capabilities.canViewReports = true;
    capabilities.canExportData = true;
    capabilities.canViewSensitiveData = true;
  }

  // 5) READ-ONLY / VIEWER ROLES
  //
  // Not explicit in your sample, but keep a generic catch-all.
  const isReadOnly =
    lowerRoles.some(r =>
      r.includes('read only') ||
      r.includes('readonly') ||
      r.includes('viewer') ||
      r.includes('observer')
    );

  if (isReadOnly) {
    capabilities.canViewAllTickets = true;
    capabilities.canViewAllUsers = true;
    capabilities.canViewReports = true;
    capabilities.canEditAllTickets = false;
    capabilities.canCreateTickets = false;
    capabilities.canAssignTickets = false;
    capabilities.canCloseTickets = false;
  }

  return capabilities;
}

/**
 * Get human-readable description of role capabilities
 */
export function getRoleCapabilitiesDescription(capabilities: RoleCapabilities): string {
  const allowed: string[] = [];
  const restricted: string[] = [];

  if (capabilities.canViewAllTickets) allowed.push('View all tickets');
  if (capabilities.canEditAllTickets) allowed.push('Edit tickets');
  if (capabilities.canCreateTickets) allowed.push('Create tickets');
  if (capabilities.canAssignTickets) allowed.push('Assign tickets');
  if (capabilities.canCloseTickets) allowed.push('Close/resolve tickets');
  if (capabilities.canViewAllUsers) allowed.push('View all users');
  if (capabilities.canViewReports) allowed.push('View reports');
  if (capabilities.canAccessAdminPanel) allowed.push('Access admin panel');
  if (capabilities.canManageCategories) allowed.push('Manage categories');
  if (capabilities.canManageServices) allowed.push('Manage services');
  if (capabilities.canExportData) allowed.push('Export data');

  if (!capabilities.canViewAllTickets) restricted.push('View only own tickets');
  if (!capabilities.canEditAllTickets) restricted.push('Cannot edit tickets');
  if (!capabilities.canAssignTickets) restricted.push('Cannot assign tickets');
  if (!capabilities.canAccessAdminPanel) restricted.push('No admin access');

  return `Allowed: ${allowed.join(', ')}. Restrictions: ${restricted.join(', ')}.`;
}

