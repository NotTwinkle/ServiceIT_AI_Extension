/**
 * Ivanti Documentation Service
 * 
 * Provides official Ivanti Neurons for ITSM documentation for the AI assistant.
 * This ensures the AI can reference official documentation when answering questions.
 */

export interface IvantiDocSection {
  title: string;
  content: string;
  category: 'incidents' | 'service-requests' | 'users' | 'workflows' | 'api' | 'general';
  keywords: string[];
}

/**
 * Official Ivanti Neurons for ITSM Documentation
 * Based on Ivanti's official documentation and best practices
 */
export const IVANTI_DOCUMENTATION: IvantiDocSection[] = [
  {
    title: 'Incident Management Overview',
    category: 'incidents',
    keywords: ['incident', 'ticket', 'issue', 'problem', 'break', 'fix'],
    content: `INCIDENT MANAGEMENT IN IVANTI:
- An Incident is a record of an unplanned interruption to an IT service or reduction in the quality of an IT service
- Incidents are created to track and resolve issues that affect users
- Key fields: IncidentNumber (unique identifier), Subject, Symptom, Status, Priority, Category, Service
- Status values: Logged, Active, Resolved, Closed, Waiting for 3rd Party
- Priority: 1 (Critical) to 5 (Low) - lower number = higher priority
- CreatedDateTime: When the incident was first logged
- LastModDateTime: When the incident was last updated
- ProfileLink: The employee who reported the incident
- Owner: The employee or team assigned to work on the incident
- Resolution: Text field describing how the incident was resolved (required for Resolved/Closed status)`
  },
  {
    title: 'Service Request Management',
    category: 'service-requests',
    keywords: ['service request', 'sr', 'request', 'catalog', 'offering'],
    content: `SERVICE REQUEST MANAGEMENT IN IVANTI:
- A Service Request is a request from a user for something which is a normal part of service delivery
- Examples: New equipment, access requests, information requests, software installation
- Key fields: ServiceReqNumber (unique identifier), Subject, Symptom, Status, Service, Urgency
- Status values: Submitted, In Progress, Fulfilled, Closed, Cancelled
- Service: The service catalog item being requested
- Urgency: Low, Medium, High, Critical
- ServiceReqTemplate: The template used to create the service request
- CreatedDateTime: When the service request was submitted
- ProfileLink: The employee who submitted the request`
  },
  {
    title: 'Priority and Urgency System',
    category: 'incidents',
    keywords: ['priority', 'urgency', 'impact', 'critical', 'high', 'low'],
    content: `IVANTI PRIORITY SYSTEM:
- Priority is calculated from Urgency and Impact: Priority = (Urgency × Impact) or manually set
- Priority values: 1 (Critical), 2 (High), 3 (Medium), 4 (Low), 5 (Very Low)
- Urgency: How quickly the issue needs to be resolved (Low, Medium, High, Critical)
- Impact: How many users or services are affected (Low, Medium, High, Critical)
- Lower Priority number = Higher priority (1 is most urgent)
- Priority 1-2: Critical/High - immediate attention required
- Priority 3: Medium - normal business hours
- Priority 4-5: Low - can be scheduled`
  },
  {
    title: 'User and Employee Management',
    category: 'users',
    keywords: ['user', 'employee', 'profile', 'contact', 'person'],
    content: `USER AND EMPLOYEE MANAGEMENT IN IVANTI:
- Employees are users of the Ivanti system who can create tickets, be assigned tickets, or be contacts
- Key fields: RecId (unique identifier), LoginID, DisplayName, PrimaryEmail, Team, Department, Status
- Status: Active, Inactive, Terminated
- ProfileLink: Used to link tickets to employees (RecId format)
- Employees can have multiple roles assigned (Admin, Self Service, Service Desk Analyst, etc.)
- Roles determine what actions an employee can perform in the system
- Teams: Groups of employees who work together (e.g., "Network Support", "Service Desk")`
  },
  {
    title: 'Categories and Services',
    category: 'general',
    keywords: ['category', 'service', 'classification', 'type'],
    content: `CATEGORIES AND SERVICES IN IVANTI:
- Category: Classifies the type of incident or service request (e.g., "IT Issue", "Network Problem", "Software")
- Service: The IT service that is affected or being requested (e.g., "Service Desk", "Email Service", "Network")
- Categories help organize and route tickets to the right teams
- Services represent actual IT services provided to the organization
- Both Categories and Services are required fields when creating incidents
- Subcategory: More specific classification within a category`
  },
  {
    title: 'Status Values and Workflow',
    category: 'workflows',
    keywords: ['status', 'workflow', 'state', 'progress', 'resolved', 'closed'],
    content: `INCIDENT STATUS WORKFLOW:
- Logged: Incident has been created but not yet assigned
- Active: Incident is assigned and being worked on
- Waiting for 3rd Party: Waiting for external vendor or team
- Resolved: Issue has been fixed, waiting for user confirmation
- Closed: Incident is fully resolved and closed
- Status transitions: Logged → Active → Resolved → Closed
- Resolution field is recommended when status is set to Resolved or Closed
- ⚠️ CRITICAL: CauseCode field is REQUIRED when status is set to "Resolved"
- Common CauseCode values: "Fixed", "Resolved", "Completed", "No Problem Found", "User Error", "Training Provided"
- If CauseCode is not provided when resolving, use "Fixed" as a default value
- ClosedDateTime: Automatically set when status changes to Closed`
  },
  {
    title: 'OData API Endpoints',
    category: 'api',
    keywords: ['api', 'odata', 'endpoint', 'rest', 'query'],
    content: `IVANTI ODATA API ENDPOINTS:
- Base URL: /HEAT/api/odata/businessobject/
- Incidents: /incidents - Query incidents with $filter, $select, $orderby, $top, $skip
- Service Requests: /servicereqs - Query service requests
- Employees: /employees - Query employee records
- Categories: /categorys - Query categories (note: lowercase "categorys")
- Services: /ci__services - Query services (note: "ci__services" with double underscore)
- Teams: /standarduserteams - Query teams
- Departments: /departments - Query departments
- Roles: /frs_def_roles - Query role definitions
- OData query syntax: $filter=Status eq 'Active', $select=IncidentNumber,Subject, $orderby=CreatedDateTime desc, $top=100
- Maximum records per query: 100 (use $skip for pagination)`
  },
  {
    title: 'Creating Incidents - Required Fields',
    category: 'incidents',
    keywords: ['create', 'new', 'incident', 'required', 'fields', 'mandatory'],
    content: `REQUIRED FIELDS FOR CREATING INCIDENTS:
- Subject: Brief title describing the issue (REQUIRED)
- Symptom: Detailed description of the problem (REQUIRED)
- Category: Type of issue (REQUIRED) - Must be a VALID category from Ivanti's validation list
- ⚠️ CRITICAL: Category is a validated field - it MUST match exact values from the system's validation list
- Categories are case-sensitive and must match exactly (e.g., "Service Desk" not "service desk")
- Invalid categories will be rejected with error: "is not in the validation list"
- Optional but recommended:
  - Priority: 1-5 (defaults to 5 if not specified)
  - Source: How it was reported (Phone, Email, Chat, Self Service)
  - Service: The affected IT service
  - Subcategory: More specific classification
- ProfileLink: Automatically set to the current user
- CreatedDateTime: Automatically set to current time
- Status: Automatically set to "Logged" for new incidents`
  },
  {
    title: 'Roles and Permissions',
    category: 'users',
    keywords: ['role', 'permission', 'access', 'capability', 'admin', 'self service'],
    content: `IVANTI ROLES AND PERMISSIONS:
- Admin/Administrator: Full system access, can view/edit all tickets, manage users, system settings
- Self Service / Self Service User: Can create tickets and view own tickets only
- Service Desk Analyst: Can view/edit all tickets, assign tickets, close tickets, search users
- Manager/Supervisor: Can view team tickets, approve requests, view reports
- Roles are assigned to employees via frs_def_roleassignments table
- Each role has specific capabilities (canViewAllTickets, canEditTickets, canCreateTickets, etc.)
- Role DisplayName is the user-friendly name (e.g., "Self Service User")
- RoleID is the technical identifier (e.g., "SelfService")`
  },
  {
    title: 'Date and Time Fields',
    category: 'general',
    keywords: ['date', 'time', 'created', 'modified', 'resolved', 'closed'],
    content: `DATE AND TIME FIELDS IN IVANTI:
- All date/time fields are in ISO 8601 format: YYYY-MM-DDTHH:mm:ss+HH:mm (e.g., "2025-12-03T14:35:48+08:00")
- CreatedDateTime: When the record was first created
- LastModDateTime: When the record was last modified
- ClosedDateTime: When the record was closed (for incidents/service requests)
- ResolvedDateTime: When the record was resolved
- Date filtering: Use $filter=CreatedDateTime ge '2025-12-01T00:00:00' for date ranges
- Timezone: Dates are stored in the server's timezone (typically UTC or local timezone)`
  },
  {
    title: 'Searching and Filtering',
    category: 'api',
    keywords: ['search', 'filter', 'query', 'find', 'lookup'],
    content: `SEARCHING AND FILTERING IN IVANTI:
- Use OData $filter syntax for searching
- Examples:
  - $filter=Status eq 'Active' - Find active incidents
  - $filter=ProfileLink_RecID eq 'RECID123' - Find user's tickets
  - $filter=CreatedDateTime ge '2025-12-01' - Find tickets created after date
  - $filter=contains(Subject, 'laptop') - Find tickets with "laptop" in subject
- Combine filters with 'and', 'or', 'not'
- Use $select to limit returned fields: $select=IncidentNumber,Subject,Status
- Use $orderby for sorting: $orderby=CreatedDateTime desc
- Use $top and $skip for pagination: $top=100&$skip=0`
  },
  {
    title: 'Terminology - Tickets vs Incidents vs Service Requests',
    category: 'general',
    keywords: ['ticket', 'incident', 'service request', 'terminology', 'difference'],
    content: `IVANTI TERMINOLOGY:
- "Ticket" is a GENERIC term that includes both Incidents and Service Requests
- Incident: Unplanned interruption or reduction in service quality (break/fix)
- Service Request: Request for something that is a normal part of service delivery
- When users say "ticket", they might mean either incidents or service requests
- Always clarify or show both when user asks for "tickets"
- IncidentNumber: Unique number for incidents (e.g., 10120)
- ServiceReqNumber: Unique number for service requests (e.g., 10053)
- Both use the same workflow concepts (Status, Priority, Owner, etc.)`
  },
  {
    title: 'Password Reset and Account Access - Self-Service Guide',
    category: 'users',
    keywords: ['password', 'reset', 'forgot', 'change', 'lockout', 'account', 'login', 'access'],
    content: `PASSWORD RESET AND ACCOUNT ACCESS IN IVANTI:
SELF-SERVICE PASSWORD RESET:
- Users can reset their own passwords through the Ivanti self-service portal
- Go to the Ivanti login page and click "Forgot Password" or "Reset Password"
- Enter your username or email address associated with your account
- Follow the prompts to receive a password reset link via email
- Use the reset link to create a new password
- Ensure your new password meets the system's password requirements

PASSWORD REQUIREMENTS (TYPICAL):
- Minimum length (usually 8-12 characters)
- Must contain uppercase and lowercase letters
- Must contain at least one number
- May require special characters
- Cannot be the same as previous passwords
- Cannot contain your username or common dictionary words

IF YOU'RE LOCKED OUT:
- Account lockouts usually occur after multiple failed login attempts
- Lockouts are typically temporary (15-30 minutes) and will automatically unlock
- Wait for the lockout period to expire before attempting to log in again
- If you're still locked out after waiting, contact your IT Service Desk

CONTACTING IT SUPPORT FOR PASSWORD HELP:
- If self-service password reset doesn't work, create a Service Request for "Password Reset"
- Include your username (the one you use to log in) and any relevant error messages you've encountered
- IT Service Desk can manually reset your password and unlock your account
- You may need to verify your identity for security purposes (they may call or email you)

SECURITY BEST PRACTICES:
- Never share your password with anyone, including IT support
- Change your password regularly (every 90 days is recommended)
- Use a unique password that you don't use for other accounts
- Enable multi-factor authentication (MFA) if available
- If you suspect your account has been compromised, contact IT immediately`
  },
  {
    title: 'Creating Service Requests for Password Issues',
    category: 'service-requests',
    keywords: ['password', 'service request', 'reset', 'unlock', 'account access'],
    content: `CREATING A SERVICE REQUEST FOR PASSWORD ISSUES:
When to Create a Service Request:
- Self-service password reset is not working
- Your account is locked and won't unlock automatically
- You don't have access to your registered email for password reset
- You need to change your password but don't remember your current one

How to Create the Service Request:
1. Navigate to the Service Request catalog in Ivanti
2. Select "Password Reset" or "Account Access" from the service catalog
3. Fill in the required fields:
   - Subject: "Password Reset Request" or "Account Unlock Request"
   - Symptom: Describe your issue (e.g., "Forgot password, self-service not working")
   - Include your username (the one you use to log in)
   - Include your full name if you know it
   - Include any error messages you've seen
4. Submit the request - IT Service Desk will process it

What Information to Include:
- Your username (the one you use to log in)
- Your full name if possible
- Your email address on file
- Description of the issue (forgot password, account locked, etc.)
- When the issue started
- Any error messages you've encountered
- Whether you've tried the self-service reset option

Processing Time:
- Password reset requests are typically processed within 1-2 business hours
- Urgent requests (during business hours) may be processed faster
- IT will contact you via email or phone to verify your identity before resetting`
  }
];

/**
 * Get relevant documentation sections based on query
 */
export function getRelevantDocumentation(query: string): IvantiDocSection[] {
  const lowerQuery = query.toLowerCase();
  const relevant: IvantiDocSection[] = [];
  
  for (const doc of IVANTI_DOCUMENTATION) {
    // Check if any keyword matches
    const keywordMatch = doc.keywords.some(keyword => 
      lowerQuery.includes(keyword.toLowerCase())
    );
    
    // Check if title matches
    const titleMatch = doc.title.toLowerCase().includes(lowerQuery) ||
                      lowerQuery.includes(doc.title.toLowerCase());
    
    if (keywordMatch || titleMatch) {
      relevant.push(doc);
    }
  }
  
  // If no specific match, return general documentation
  if (relevant.length === 0) {
    return IVANTI_DOCUMENTATION.filter(doc => 
      doc.category === 'general' || doc.category === 'incidents'
    );
  }
  
  return relevant;
}

/**
 * Format documentation for AI context
 */
export function formatDocumentationForContext(docs: IvantiDocSection[]): string {
  if (docs.length === 0) return '';
  
  const sections = docs.map(doc => 
    `[IVANTI DOCUMENTATION: ${doc.title}]\n${doc.content}`
  ).join('\n\n');
  
  return `\n[OFFICIAL IVANTI DOCUMENTATION - REFERENCE THESE WHEN ANSWERING QUESTIONS]:\n${sections}\n`;
}

