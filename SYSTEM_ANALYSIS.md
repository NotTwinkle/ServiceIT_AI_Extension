# Service IT Plus AI Assistant - Complete System Analysis

## 🎯 System Purpose & Goals

### Primary Goal
**Provide an AI-powered conversational interface for Ivanti Service Manager** that enables users to interact with their ITSM system using natural language, eliminating the need to navigate complex forms and menus.

### Why This System Exists
1. **User Experience Enhancement**: Traditional ITSM systems like Ivanti have complex interfaces with many forms, fields, and navigation paths. This extension makes it accessible through natural conversation.
2. **Productivity Improvement**: Users can create tickets, search incidents, and get information without learning Ivanti's specific UI patterns.
3. **Context Awareness**: The system automatically detects what ticket the user is viewing, who they are, and their permissions - providing personalized assistance.
4. **Intelligent Automation**: Uses AI to understand user intent, auto-fill forms, and guide users through complex workflows.

---

## 🏗️ System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Chrome Browser                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────┐         ┌──────────────────┐         │
│  │   Content Script │◄───────►│ Background       │         │
│  │   (React UI)     │ Messages│ Service Worker   │         │
│  │                  │         │                  │         │
│  │  - ChatWidget    │         │  - AI Service    │         │
│  │  - Theme Editor  │         │  - Data Services │         │
│  │  - UI Components │         │  - Agent System  │         │
│  └──────────────────┘         └──────────────────┘         │
│         │                              │                    │
│         │                              │                    │
│         ▼                              ▼                    │
│  ┌──────────────────────────────────────────────────────┐ │
│  │      Ivanti Service Manager                          │ │
│  │      (success.serviceitplus.com)                     │ │
│  │                                                       │ │
│  │  - OData API (incidents, users, categories)         │ │
│  │  - REST API (service requests, templates)           │ │
│  │  - User Session (cookies for authentication)         │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                              │
│         │                              │                    │
│         ▼                              ▼                    │
│  ┌──────────────────────────────────────────────────────┐ │
│  │      AI Providers                                     │ │
│  │                                                       │ │
│  │  - Google Gemini (primary)                            │ │
│  │  - Ollama (local alternative)                         │ │
│  │  - xAI Grok (alternative)                             │ │
│  └──────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Component Layers

#### 1. **Content Script Layer** (`src/content/`)
**Purpose**: Injects React UI into Ivanti pages and handles user interactions.

**Key Files**:
- `index.tsx`: Entry point that detects Ivanti pages and injects the chat widget
- `inject.js`: DOM injection logic that creates the React root
- `brute-force-scanner.js`: Fallback user name detection from DOM

**Responsibilities**:
- Detect when user is on an Ivanti page
- Inject the chat widget UI
- Extract page context (ticket RecId from URL)
- Communicate with background script via `chrome.runtime.sendMessage`
- Handle UI events and render responses

**How It Works**:
1. Content script loads when Ivanti page loads
2. Checks if chat widget already exists (prevents duplicates)
3. Creates a React root and renders `ChatWidget` component
4. Listens for messages from background script
5. Sends user messages to background for processing

---

#### 2. **Background Service Worker** (`src/background/`)
**Purpose**: Core orchestration layer that coordinates all services and handles API communication.

**Key Files**:
- `index.ts`: Main message router and session manager
- `config.ts`: Configuration for Ivanti and AI providers

**Responsibilities**:
- Route messages between content script and services
- Manage user session (detect login/logout)
- Maintain conversation history per tab
- Coordinate service calls
- Handle authentication and session persistence

**Key Features**:

**Session Management**:
- Detects user login via cookie monitoring (`UserSettings` cookie)
- Detects logout when cookie is removed
- Persists user session across browser restarts using `chrome.storage.local`
- Generates session IDs to isolate conversation history between logins
- Cleans up data on logout (conversations, cache, user info)

**Message Routing**:
- `IDENTIFY_USER`: Identifies current Ivanti user
- `SEND_MESSAGE`: Processes chat messages through AI
- `CONFIRM_SERVICE_REQUEST`: Creates service requests
- `CLEAR_CONVERSATION`: Clears chat history
- `PREFETCH_DATA`: Preloads common data
- `GET_CACHED_USER`: Returns cached user for instant UI load

**Logout Detection** (3-layer approach):
1. **Primary**: `chrome.cookies.onChanged` listener (event-driven, immediate)
2. **Backup**: Periodic cookie check every 30 seconds
3. **Auth Probe**: API call every 15 seconds to detect 401/403 responses

---

#### 3. **Service Layer** (`src/background/services/`)

The system uses a modular service architecture where each service has a specific responsibility:

##### **AI Service** (`aiService.ts`)
**Purpose**: Processes user messages through AI and generates responses.

**Key Responsibilities**:
- Builds context-aware prompts with ticket info, user info, conversation history
- Integrates documentation and knowledge base data
- Detects user intent (create incident, create SR, search, etc.)
- Routes to specialized agents (Service Request Agent)
- Handles action extraction (CREATE_INCIDENT, UPDATE_INCIDENT, etc.)
- Manages conversation state machine for SR creation flow

**How It Works**:
1. Receives user message
2. Corrects typos using `typoCorrection` service
3. Detects intent using `intelligentIntentDetector`
4. Fetches relevant context:
   - Current ticket data (if viewing a ticket)
   - User profile and roles
   - Conversation history
   - Ivanti documentation
   - Knowledge base articles
5. Builds comprehensive system prompt
6. Calls AI provider (Gemini/Ollama/Grok)
7. Parses response for actions and thinking steps
8. Returns formatted response to UI

**State Machine for Service Requests**:
- `IDLE`: No active SR creation
- `CATALOG_SHOWN`: User saw list of offerings
- `OFFERING_SUGGESTED`: AI suggested specific offering
- `FIELDSET_SHOWN`: User saw confirmation form
- `COMPLETED`: SR was created

---

##### **Agent System** (Agentic AI Pattern)

**What Makes It "Agentic"**:
Traditional AI assistants generate responses based on prompts alone, which can lead to hallucinations. The agentic system uses a **ReAct pattern** (Reasoning + Acting):

1. **THINK**: Plan what needs to be done
2. **ACT**: Call tools (Ivanti APIs) to get real data
3. **OBSERVE**: Process tool results
4. **THINK**: Refine plan based on observations
5. **RESPOND**: Generate response using ONLY grounded facts

**Key Components**:

**Agent Core** (`agentCore.ts`):
- `AgentStepManager`: Tracks thinking steps (pending → in_progress → completed/error)
- `AgentContextBuilder`: Builds grounded context from tool results
- `AgentResponseValidator`: (Future) Validates AI responses against facts

**Service Request Agent** (`serviceRequestAgent.ts`):
Implements the full agentic pipeline for SR creation:

```
User: "create sr"
↓
Step 1: Find offerings (TOOL CALL → fetchRequestOfferings)
↓
Step 2: Fetch fieldset (TOOL CALL → fetchRequestOfferingFieldset)
↓
Step 3: Analyze fields (REASONING → required vs optional)
↓
Step 4: Auto-fill (REASONING → from user profile + conversation)
↓
Step 5: Check readiness (REASONING → are all required fields filled?)
↓
Step 6: Build grounded context (only facts from tool results)
↓
AI Model: Generate response using ONLY grounded facts
↓
Response: Clear guidance with no hallucinations
```

**Benefits**:
- ✅ **No Hallucinations**: All facts come from tools, not imagination
- ✅ **Visible Progress**: User sees each step as it happens
- ✅ **Generic**: Works for ANY request offering (adapts to metadata)
- ✅ **Self-Healing**: Errors are caught, explained, and fixed
- ✅ **Guided**: Shows dropdown options, missing fields, what to do next

---

##### **Ivanti Data Service** (`ivantiDataService.ts`)
**Purpose**: Handles all communication with Ivanti APIs.

**Key Operations**:
- **OData Queries**: Fetch incidents, users, categories, services, teams
- **REST API**: Create/update/delete incidents, fetch request offerings
- **Service Requests**: Fetch offerings, fieldsets, create SRs
- **Error Handling**: Retry logic, fallback strategies

**Key Functions**:
- `fetchIvantiData()`: Generic OData query function
- `createIncident()`: Creates new incidents
- `updateIncident()`: Updates existing incidents
- `deleteIncident()`: Deletes incidents
- `fetchRequestOfferings()`: Gets all available request offerings
- `fetchRequestOfferingFieldset()`: Gets form fields for an offering
- `createServiceRequest()`: Creates service requests with field mapping

**How It Works**:
1. Uses user's browser session cookies for authentication
2. Makes API calls from background service worker (has access to cookies)
3. Handles Ivanti's complex field mapping (parameters with RecIds)
4. Normalizes data structures for consistent use across the system

---

##### **User Identity Service** (`userIdentity.ts`)
**Purpose**: Identifies the currently logged-in Ivanti user.

**Multi-Strategy Detection**:
1. **Primary**: Ivanti API endpoint (`/HEAT/api/v1/User/current`)
2. **Secondary**: Cookie-based detection
3. **Fallback**: DOM scraping (from injected script or page content)

**How It Works**:
1. Tries API endpoint first (most reliable)
2. If API fails, checks cookies for user info
3. If cookies fail, falls back to DOM scraping
4. Returns user object with: RecId, loginId, email, fullName, roles, teams

---

##### **Conversation Manager** (`conversationManager.ts`)
**Purpose**: Manages conversation history and context.

**Key Features**:
- Maintains conversation history per tab
- Automatically summarizes long conversations to save tokens
- Extracts key information from conversations
- Builds context for AI prompts

**How It Works**:
1. Stores messages in memory (per tab)
2. When conversation gets long, summarizes older messages
3. Extracts important facts (ticket numbers, user names, etc.)
4. Provides context to AI service for better responses

---

##### **Knowledge Base Service** (`knowledgeBaseService.ts`)
**Purpose**: Searches and retrieves relevant KB articles.

**How It Works**:
1. Searches KB articles by keywords
2. Ranks articles by relevance
3. Formats KB content for AI context
4. Provides KB data to AI for better answers

---

##### **Data Prefetch Service** (`dataPrefetchService.ts`)
**Purpose**: Proactively fetches commonly used data to improve performance.

**Prefetched Data**:
- Categories
- Services
- Teams
- Departments

**How It Works**:
1. Runs in background after user identification
2. Caches data for fast access
3. Reduces latency for common queries

---

##### **Cache Service** (`cacheService.ts`)
**Purpose**: Multi-level caching for performance.

**Cache Levels**:
1. **Memory Cache**: Fast, temporary storage
2. **Persistent Storage**: Survives browser restarts

**Features**:
- TTL (Time-To-Live) management
- Cache invalidation strategies
- Automatic cleanup

---

##### **Adaptive Memory Service** (`adaptiveMemoryService.ts`)
**Purpose**: Stores and retrieves instance-specific facts and conversation memories.

**Key Features**:
- Stores facts about the Ivanti instance (categories, services, etc.)
- Stores conversation memories (user preferences, past actions)
- Retrieves relevant facts/memories based on current query
- Marks facts as "used" to track relevance

---

##### **Intelligent Intent Detector** (`intelligentIntentDetector.ts`)
**Purpose**: Detects user intent before processing full AI request.

**Intents Detected**:
- Create incident
- Create service request
- Search/lookup
- Update/edit
- Delete
- General question

**How It Works**:
1. Quick pattern matching for common intents
2. LLM-based detection for complex queries
3. Routes to appropriate handlers

---

##### **Intent Router** (`intentRouter.ts`)
**Purpose**: Routes requests to appropriate handlers based on intent.

**How It Works**:
1. Receives detected intent
2. Routes to specialized handler
3. Coordinates multi-step workflows

---

##### **Ivanti Documentation Service** (`ivantiDocumentation.ts`)
**Purpose**: Retrieves relevant Ivanti documentation for context.

**How It Works**:
1. Searches documentation by topic
2. Formats docs for AI context
3. Provides authoritative source for AI responses

---

##### **Typo Correction Service** (`typoCorrection.ts`)
**Purpose**: Corrects common typos in user input.

**How It Works**:
1. Detects common IT/technical typos
2. Suggests corrections
3. Non-intrusive (only suggests, doesn't force)

---

##### **Roles Service** (`rolesService.ts`)
**Purpose**: Fetches user roles and permissions.

**How It Works**:
1. Fetches roles from Ivanti API
2. Provides permission context to AI
3. Enables role-based action suggestions

---

#### 4. **UI Components** (`src/components/`)

##### **ChatWidget** (`ChatWidget.tsx`)
**Purpose**: Main chat interface component.

**Key Features**:
- Message rendering with markdown support
- Action buttons for ticket operations
- Thinking steps progress indicator (shows agent progress)
- Theme-aware styling
- Model selector (Gemini/Ollama/Grok)
- Conversation history display

**How It Works**:
1. Renders chat messages (user and assistant)
2. Shows thinking steps when agent is working
3. Displays action cards (create incident, confirm SR, etc.)
4. Handles user input and sends to background
5. Updates UI with responses

---

##### **Theme System**
**Purpose**: Customizable UI themes.

**Components**:
- `ThemeEditor.tsx`: Comprehensive theme customization
- `ThemeSettings.tsx`: Theme management interface
- `LiveThemePreview.tsx`: Real-time preview

**Features**:
- Color customization for all UI elements
- Live preview
- Export/import themes
- Persistent storage

---

## 🔄 Data Flow Examples

### Example 1: User Creates an Incident

```
1. User types: "I need help with my email"
   ↓
2. Content Script (ChatWidget) → sends message to Background
   ↓
3. Background → AI Service
   ↓
4. AI Service:
   - Corrects typos
   - Detects intent: "create incident"
   - Fetches user context, ticket context, documentation
   - Builds prompt with context
   - Calls Gemini API
   ↓
5. Gemini responds with: "I'll help you create an incident. What's the subject?"
   ↓
6. User: "Email not working"
   ↓
7. AI Service:
   - Detects missing fields (Category required)
   - Fetches available categories from cache/prefetch
   - Asks for category
   ↓
8. User: "Service Desk"
   ↓
9. AI Service:
   - Extracts action: CREATE_INCIDENT
   - Calls ivantiDataService.createIncident()
   ↓
10. Ivanti API creates incident, returns RecId
   ↓
11. AI Service adds system message to conversation: "Incident 10119 created"
   ↓
12. Response sent to UI: "I've created incident 10119 for your email issue..."
```

---

### Example 2: User Creates a Service Request (Agent Mode)

```
1. User types: "I need a laptop"
   ↓
2. Content Script → Background → AI Service
   ↓
3. AI Service detects intent: "create service request"
   ↓
4. AI Service → Service Request Agent
   ↓
5. Agent Step 1: Finding offerings
   - Tool: fetchRequestOfferings()
   - Result: 15 offerings found
   - Status: ✅ Completed
   ↓
6. Agent Step 2: Loading form fields
   - Tool: fetchRequestOfferingFieldset("Computer Request")
   - Result: 7 fields loaded
   - Status: ✅ Completed
   ↓
7. Agent Step 3: Analyzing fields
   - Reasoning: 2 required, 5 optional
   - Status: ✅ Completed
   ↓
8. Agent Step 4: Auto-filling
   - Reasoning: Fill "Requested By" = current user, "Email" = from profile
   - Result: 3 fields auto-filled
   - Status: ✅ Completed
   ↓
9. Agent Step 5: Checking readiness
   - Reasoning: Missing "Computer Type", "Location"
   - Result: NOT READY
   - Status: ✅ Completed
   ↓
10. Agent Step 6: Building context
    - Builds grounded facts from tool results
    - Creates field guide with dropdown options
    - Status: ✅ Completed
    ↓
11. AI Model receives grounded context
    - Generates friendly explanation
    - Shows missing fields with dropdown options
    ↓
12. UI displays:
    - Thinking steps progress (all ✅)
    - Response: "I've prepared the form. I need: Computer Type (Desktop/Laptop/Tablet), Location (Manila/Cebu/Remote)"
    - Confirmation card with fields
```

---

### Example 3: User Searches for Incidents

```
1. User types: "show my incidents"
   ↓
2. AI Service:
   - Detects intent: "search incidents"
   - Gets current user RecId
   - Calls ivantiDataService.fetchIvantiData()
   - Query: /incidents?$filter=ProfileLink_RecID eq 'USER_RECID'
   ↓
3. Ivanti API returns incidents
   ↓
4. AI Service:
   - Formats incidents for display
   - Builds response with incident details
   - Adds to conversation history
   ↓
5. UI displays formatted list of incidents
```

---

## 🔐 Security Architecture

### Authentication
- **No Credential Storage**: Extension uses user's browser session cookies
- **Session-Based**: All API calls authenticated via cookies from Ivanti session
- **Automatic Logout Detection**: Cleans up data when user logs out

### API Key Security
- **Environment Variables**: API keys stored in `.env.local` (gitignored)
- **Build-Time Injection**: Vite inlines env vars at build time
- **Background Only**: Only background service worker can access keys
- **No Exposure**: Keys never sent to content scripts or web pages

### Data Privacy
- **Local Storage**: Conversation history stored locally in browser
- **No Third Parties**: Data only sent to AI provider (Gemini/Ollama/Grok)
- **User Context**: User data only used for context within extension

---

## 🎨 User Experience Flow

### Initial Load
1. User opens Ivanti page
2. Content script detects page load
3. Checks for cached user (instant UI load)
4. If no cache, identifies user (shows loading)
5. Prefetches common data in background
6. Chat widget appears, ready to use

### Conversation Flow
1. User types message
2. UI shows "thinking" indicator
3. If agent mode: Shows thinking steps progress
4. Response appears with formatting
5. If action needed: Shows action card (create incident, confirm SR)
6. User interacts with action card
7. System processes action
8. Updates conversation with result

### Error Handling
- **API Errors**: User-friendly error messages
- **Network Errors**: Retry logic with clear messages
- **AI Errors**: Graceful fallback, helpful guidance
- **Validation Errors**: Clear field-level error messages

---

## 🚀 Performance Optimizations

### Caching Strategy
- **Memory Cache**: Fast access to frequently used data
- **Persistent Cache**: Survives browser restarts
- **Prefetching**: Common data loaded in background
- **TTL Management**: Automatic cache invalidation

### Lazy Loading
- **On-Demand Services**: Services loaded only when needed
- **Code Splitting**: Vite bundles code efficiently
- **Background Processing**: Heavy operations don't block UI

### API Optimization
- **Batch Requests**: Multiple data fetches combined when possible
- **Selective Fields**: Only fetch needed fields ($select in OData)
- **Pagination**: Large datasets fetched in chunks

---

## 🔧 Configuration System

### Environment Variables (`.env.local`)
```bash
# Required: AI Provider API Key
VITE_GEMINI_API_KEY=your-key-here
VITE_OLLAMA_URL=http://localhost:11434
VITE_GROK_API_KEY=xai-your-key-here

# Optional: Provider Selection
VITE_AI_PROVIDER=gemini  # or 'ollama' or 'grok'

# Optional: Model Selection
VITE_OLLAMA_MODEL=llama3.2
VITE_GROK_MODEL=grok-beta

# Optional: Ivanti API Key (for admin operations)
VITE_IVANTI_API_KEY=your-key-here
```

### Configuration File (`config.ts`)
- **Ivanti Config**: Base URL, endpoints, tenant ID
- **AI Config**: Provider selection, model selection, API URLs
- **System Prompts**: AI behavior and instructions

---

## 📊 Key Metrics & Monitoring

### What Gets Logged
- User identification events
- API call success/failure
- AI processing times
- Agent step completion
- Error occurrences
- Cache hit/miss rates

### Debug Tools
- **Background Logs**: `chrome://extensions` → Service Worker link
- **Content Script Logs**: Browser DevTools console on Ivanti page
- **React DevTools**: For UI component debugging

---

## 🎯 System Goals Summary

### Primary Goals ✅
1. **Natural Language Interface**: Users interact with Ivanti using plain English
2. **Context Awareness**: System knows current ticket, user, permissions
3. **Intelligent Automation**: AI understands intent and guides users
4. **Zero Hallucinations**: Agent system ensures all facts come from tools
5. **Seamless Integration**: Works within Ivanti UI without disruption

### Secondary Goals ✅
1. **Performance**: Fast responses through caching and prefetching
2. **Reliability**: Robust error handling and fallback strategies
3. **Security**: No credential storage, session-based auth
4. **Extensibility**: Modular architecture for easy feature additions
5. **User Experience**: Beautiful UI with theme customization

---

## 🔮 Future Enhancements

### Planned Features
- [ ] Additional specialized agents (incident lookup, KB search, user search)
- [ ] Multi-agent orchestration for complex queries
- [ ] Enhanced conversation analytics
- [ ] Bulk operations support
- [ ] Advanced search capabilities
- [ ] Integration with more Ivanti modules
- [ ] Mobile browser support
- [ ] Offline mode support

---

## 📌 Operational System Context (for AI/system prompts)

- **What it is:** Chrome MV3 extension that injects a React chat UI into Ivanti Service Manager (`success.serviceitplus.com`) so users can interact via natural language with ticket/user context.
- **Architecture:** Content script (UI) ↔ Background service worker (orchestrator) ↔ Services (Ivanti APIs, AI providers, cache/prefetch, intent/typo). Providers: Gemini primary, Ollama local, Grok optional.
- **Core flows:**
  - **User identification:** Ivanti API first; fallback to cookies/DOM; session persisted in `chrome.storage.local`; logout detection via cookie events + periodic probes; cleanup clears user, history, cache.
  - **Message handling:** Content → background `handleSendMessage` → `aiService.processMessage` (typo correction, intent detection, context build: user/ticket/docs/KB/history) → AI provider → returns message + actions + thinkingSteps → UI renders.
  - **Service Request agent:** ReAct steps: find offering → fetch fieldset → analyze required/optional → autofill from profile/context → check readiness → build grounded context → ask for missing fields/options → user must click Confirm & Submit (no hallucinated submission).
  - **Incident ops:** create/update/delete via `ivantiDataService`; requires CauseCode on resolve; actions like `CREATE_INCIDENT`, `UPDATE_INCIDENT`, `DELETE_INCIDENT`.
  - **Data services:** Ivanti OData/REST for incidents, service requests, categories, services, teams, roles, KB, docs; caching + prefetch of common lookups.
  - **UI:** `ChatWidget` shows chat, markdown, thinking steps, action cards (SR confirm), theme editor/settings, live preview.
- **Anti-hallucination:** Tool-first agentic flow, grounded context; thinking steps; avoid claiming SR submission unless Confirm & Submit actually runs; (future) AgentResponseValidator to enforce grounding.
- **Security:** Uses user cookies; no creds in content scripts; AI keys via env; logout cleanup removes stored user/convos/cache.
- **Done vs gaps:** Done—context-aware chat, SR agent with thinking steps, incident CRUD actions, user identity with persistence, prefetch/cache, KB/docs context, themes, license reports. Gaps—no full multi-agent orchestration; incident lookup/status agent not formalized; SR field parsing can improve; response validation not wired everywhere; provider failover limited; CI attribution file; richer UI errors/quick actions.

Use this block verbatim as system/background context for any AI agent working on this extension.

---

## 📝 Key Takeaways

### What Makes This System Special

1. **Agentic AI Architecture**: Uses ReAct pattern to prevent hallucinations
2. **Multi-Layer Security**: Cookie-based auth, no credential storage, automatic logout detection
3. **Context-Aware**: Automatically detects ticket context, user info, permissions
4. **Modular Design**: Clean separation of concerns, easy to extend
5. **Performance Optimized**: Caching, prefetching, lazy loading
6. **User-Centric**: Natural language interface, beautiful UI, helpful guidance

### Why This Architecture Works

- **Separation of Concerns**: Each service has a single responsibility
- **Layered Architecture**: Content → Background → Services → APIs
- **Event-Driven**: Cookie monitoring, message passing, reactive updates
- **Fail-Safe Design**: Multiple fallback strategies, graceful error handling
- **Extensible**: Easy to add new agents, services, or features

---

**Last Updated**: January 2025  
**Version**: 1.0.0  
**Status**: Production Ready

---

## 🎯 Strategic Vision (Agentic Ivanti Assistant)

- **Purpose:** AI assistant for Ivanti to make work easier by understanding who is logged in, what their role allows, and acting like a role-aware template-driven agent.
- **Goal:** Move from “assistant” to fully agentic behavior—AI plans, calls tools, and executes workflows (with confirmations where needed).
- **Self-healing & automation:** AI should ask what’s happening, diagnose, and trigger fixes (e.g., through n8n workflows for tasks like cleaning memory when usage is high).
- **Role-aware actions:** Example: “I’m a system analyst” → AI knows permitted actions and proposes/executes them.
- **Knowledge-driven:** Use Ivanti KB/docs plus live data to guide troubleshooting and remediation.
- **n8n integration:** Use n8n workflows as callable tools for automated remediations and system tasks.

---

## 🌟 North Star Summary (Agentic, Role-Aware, Self-Healing)

- **Identity & roles first:** Always know who is logged in and what their role permits; drive templates, guardrails, and allowed actions from roles.
- **Agentic, not just chat:** Plan, call tools, execute workflows with confirmations; minimize user back-and-forth.
- **Self-healing:** Ask what’s happening, diagnose, then act—trigger n8n workflows for remediation (e.g., clean memory when usage is high).
- **Knowledge + live data:** Combine Ivanti KB/docs with live Ivanti data; ground responses in tool results to avoid hallucinations.
- **Automation backbone:** Use n8n as the execution layer for repeatable ops tasks; AI decides, n8n does.
- **Outcome:** “I’m a system analyst” → AI proposes/executes the role-allowed actions using validated templates and steps.