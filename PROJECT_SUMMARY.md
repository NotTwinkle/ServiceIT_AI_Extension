# Service IT Plus AI Assistant - Project Summary

## 📋 Overview

**Service IT Plus AI Assistant** is a sophisticated Chrome Extension that integrates AI-powered assistance directly into Ivanti Service Manager (success.serviceitplus.com). The extension provides intelligent, context-aware support for IT service management tasks, enabling users to interact with Ivanti data through natural language conversations.

### Key Value Propositions
- 🤖 **AI-Powered Assistance**: Natural language interface for IT service management
- 🎯 **Context-Aware**: Automatically detects current ticket context and user information
- 🔒 **Secure**: Direct integration with Ivanti APIs using user's browser session
- ⚡ **Real-Time**: Instant responses with intelligent data fetching
- 🎨 **Customizable**: Full theme customization with live preview
- 📚 **Knowledge-Enhanced**: Integrates Ivanti documentation and knowledge base

---

## 🏗️ Architecture

### System Architecture

The extension follows a **Chrome Extension Manifest V3** architecture with the following components:

```
┌─────────────────────────────────────────────────────────────┐
│                    Chrome Extension                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐      ┌──────────────┐                    │
│  │ Content      │◄────►│ Background   │                    │
│  │ Script       │      │ Service      │                    │
│  │ (React UI)   │      │ Worker       │                    │
│  └──────────────┘      └──────────────┘                    │
│         │                      │                            │
│         │                      │                            │
│         ▼                      ▼                            │
│  ┌──────────────────────────────────────┐                 │
│  │      Ivanti Service Manager API       │                 │
│  │  (success.serviceitplus.com)          │                 │
│  └──────────────────────────────────────┘                 │
│                                                              │
│         │                      │                            │
│         ▼                      ▼                            │
│  ┌──────────────────────────────────────┐                 │
│  │      AI Provider (Gemini/Ollama)      │                 │
│  └──────────────────────────────────────┘                 │
└─────────────────────────────────────────────────────────────┘
```

### Component Layers

1. **Content Script Layer** (`src/content/`)
   - React-based UI components
   - DOM injection and interaction
   - User interface rendering

2. **Background Service Worker** (`src/background/`)
   - API communication
   - Data processing
   - State management
   - Message routing

3. **Service Layer** (`src/background/services/`)
   - Modular service architecture
   - Separation of concerns
   - Reusable business logic

---

## 🚀 Core Features

### 1. AI-Powered Chat Assistant
- **Natural Language Processing**: Understands user queries in plain English
- **Context Awareness**: Automatically detects current ticket (RecId) and user context
- **Multi-Turn Conversations**: Maintains conversation history with intelligent summarization
- **Action Execution**: Can perform Ivanti operations (create/update/delete tickets)
- **Typo Correction**: Automatically corrects common typos in user input
- **Documentation Integration**: Pulls relevant Ivanti documentation for context

### 2. Intelligent Data Services
- **User Identity Detection**: Multiple strategies to identify current user
- **Data Prefetching**: Proactively fetches common data (categories, services, teams)
- **Ivanti Data Operations**: Full CRUD operations on incidents, service requests
- **Knowledge Base Integration**: Searches and retrieves relevant KB articles
- **Roles & Permissions**: Fetches user roles and permissions for context

### 3. Advanced Conversation Management
- **Conversation Summarization**: Automatically summarizes long conversations
- **Context Extraction**: Extracts key information from conversation history
- **Session Management**: Isolates conversations per browser session
- **Change Detection**: Tracks changes in ticket data for context updates

### 4. Theme Customization
- **Live Theme Preview**: Real-time preview of theme changes
- **Theme Editor**: Comprehensive theme customization interface
- **Theme Settings**: Persistent theme storage and management
- **Brand Colors**: Service IT Plus branding (Navy Blue #002b5c, Orange #ff9900)

### 5. User Experience Enhancements
- **Loading States**: Smooth loading indicators during operations
- **Error Handling**: Graceful error handling with user-friendly messages
- **Responsive Design**: Works seamlessly within Ivanti interface
- **Accessibility**: ARIA labels and keyboard navigation support

---

## 🛠️ Tech Stack

### Frontend
- **React 18**: Modern UI framework
- **TypeScript**: Type-safe development
- **Vite**: Fast build tool and dev server
- **Tailwind CSS**: Utility-first CSS framework (scoped with `sit-` prefix)
- **Lucide React**: Icon library

### Chrome Extension
- **Manifest V3**: Latest Chrome extension standard
- **Service Worker**: Background processing
- **Content Scripts**: DOM injection and interaction
- **Storage API**: Persistent data storage

### AI Integration
- **Google Gemini API**: Primary AI provider (gemini-2.5-flash-lite)
- **Ollama**: Alternative local AI provider support
- **Model Selection**: Configurable AI models per provider

### Additional Libraries
- **react-markdown**: Markdown rendering for AI responses
- **remark-gfm**: GitHub Flavored Markdown support
- **driver.js**: User onboarding/tutorials
- **webextension-polyfill**: Cross-browser compatibility

---

## 📁 Project Structure

```
ServiceIT_AI_Extension/
├── src/
│   ├── background/              # Background service worker
│   │   ├── index.ts            # Main background entry point
│   │   ├── config.ts           # Configuration (API keys, endpoints)
│   │   └── services/           # Business logic services
│   │       ├── aiService.ts           # AI message processing
│   │       ├── cacheService.ts        # Caching layer
│   │       ├── changeDetectionService.ts  # Ticket change detection
│   │       ├── conversationManager.ts    # Conversation management
│   │       ├── dataPrefetchService.ts # Data prefetching
│   │       ├── ivantiDataService.ts   # Ivanti API operations
│   │       ├── ivantiDocumentation.ts # Documentation integration
│   │       ├── knowledgeBaseService.ts # KB article search
│   │       ├── rolesService.ts        # Roles & permissions
│   │       ├── typoCorrection.ts      # Typo correction
│   │       └── userIdentity.ts        # User identification
│   │
│   ├── components/              # React UI components
│   │   ├── ChatWidget.tsx      # Main chat interface
│   │   ├── LoadingScreen.tsx   # Loading states
│   │   ├── LiveThemePreview.tsx # Theme preview
│   │   ├── ThemeEditor.tsx     # Theme customization
│   │   └── ThemeSettings.tsx   # Theme management
│   │
│   ├── content/                 # Content script
│   │   ├── index.tsx           # Main content script entry
│   │   ├── inject.js           # DOM injection logic
│   │   ├── brute-force-scanner.js # User name detection
│   │   └── debug-kb.js         # Debug utilities
│   │
│   ├── types/                   # TypeScript type definitions
│   │   └── theme.ts            # Theme type definitions
│   │
│   └── styles.css               # Global styles & Tailwind directives
│
├── public/
│   └── icons/                   # Extension icons
│
├── manifest.json                # Chrome extension manifest
├── package.json                 # Dependencies & scripts
├── vite.config.ts              # Vite configuration
├── tailwind.config.js          # Tailwind configuration
├── tsconfig.json               # TypeScript configuration
└── README.md                    # Quick start guide
```

---

## 🔧 Services Overview

### AI Service (`aiService.ts`)
- Processes user messages through AI provider (Gemini/Ollama)
- Builds context-aware prompts with ticket and user information
- Handles action execution (create/update/delete tickets)
- Manages conversation history and summarization
- Integrates documentation and knowledge base context

### Ivanti Data Service (`ivantiDataService.ts`)
- **CRUD Operations**: Create, read, update, delete incidents and service requests
- **OData Queries**: Complex queries using Ivanti OData endpoints
- **REST API**: Direct REST API calls for specific operations
- **Error Handling**: Comprehensive error handling and retry logic

### User Identity Service (`userIdentity.ts`)
- **Multi-Strategy Detection**: 
  - Ivanti API endpoints (primary)
  - Cookie-based detection
  - DOM scraping (fallback)
- **Session Management**: Persistent user session across browser restarts
- **Logout Detection**: Automatic detection of user logout

### Conversation Manager (`conversationManager.ts`)
- **History Management**: Maintains conversation history per session
- **Summarization**: Automatically summarizes long conversations
- **Key Extraction**: Extracts important information from conversations
- **Context Building**: Builds context for AI prompts

### Data Prefetch Service (`dataPrefetchService.ts`)
- **Proactive Fetching**: Prefetches commonly used data
- **Caching**: Caches prefetched data for performance
- **Categories, Services, Teams**: Common lookup data

### Knowledge Base Service (`knowledgeBaseService.ts`)
- **Article Search**: Searches KB articles by keywords
- **Relevance Scoring**: Ranks articles by relevance
- **Content Formatting**: Formats KB content for AI context

### Cache Service (`cacheService.ts`)
- **Multi-Level Caching**: Memory and persistent storage
- **TTL Management**: Time-to-live for cached data
- **Cache Invalidation**: Smart cache invalidation strategies

### Change Detection Service (`changeDetectionService.ts`)
- **Ticket Monitoring**: Monitors ticket changes
- **Change Notifications**: Notifies about relevant changes
- **Context Updates**: Updates AI context with changes

### Typo Correction Service (`typoCorrection.ts`)
- **Common Typos**: Corrects common IT/technical typos
- **Context-Aware**: Understands context for better corrections
- **Non-Intrusive**: Only suggests corrections, doesn't force them

### Ivanti Documentation Service (`ivantiDocumentation.ts`)
- **Documentation Retrieval**: Fetches relevant Ivanti documentation
- **Context Formatting**: Formats docs for AI context
- **Search Integration**: Searches documentation by topic

### Roles Service (`rolesService.ts`)
- **Role Fetching**: Retrieves user roles and permissions
- **Permission Context**: Provides permission context to AI
- **Role-Based Actions**: Enables role-based action suggestions

---

## ⚙️ Configuration

### Environment Variables

Create a `.env.local` file in the project root:

```bash
# Required: Google Gemini API Key
VITE_GEMINI_API_KEY=your-gemini-api-key-here

# Optional: AI Provider Selection (default: 'gemini')
VITE_AI_PROVIDER=gemini  # or 'ollama'

# Optional: Ollama Configuration (if using Ollama)
VITE_OLLAMA_URL=http://localhost:11434
VITE_OLLAMA_MODEL=llama3.2

# Optional: Ivanti API Key (for admin operations)
VITE_IVANTI_API_KEY=your-ivanti-api-key-here
```

### Configuration File (`src/background/config.ts`)

- **Ivanti Configuration**: Base URL, endpoints, tenant ID
- **AI Configuration**: Provider selection, model selection, API keys
- **System Prompts**: AI behavior and instructions
- **Endpoint Definitions**: All Ivanti API endpoints

### Key Configuration Points

1. **Ivanti Base URL**: `https://success.serviceitplus.com`
2. **AI Model**: `gemini-2.5-flash-lite` (optimized for free tier)
3. **Temperature**: `0.7` (balanced creativity/accuracy)
4. **Max Tokens**: `1500` (response length limit)

---

## 🚦 Setup & Installation

### Prerequisites
- Node.js 18+ and npm
- Google Chrome browser
- Google Gemini API key (or Ollama setup for local AI)

### Installation Steps

1. **Clone/Download the repository**
   ```bash
   cd ServiceIT_AI_Extension
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure API keys**
   - Create `.env.local` file
   - Add your `VITE_GEMINI_API_KEY`
   - See `SETUP_API_KEY.md` for detailed instructions

4. **Build the extension**
   ```bash
   npm run build
   ```

5. **Load in Chrome**
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `dist` folder

### Development Mode

For development with hot reload:
```bash
npm run dev
```

Note: You'll need to reload the extension in Chrome after changes.

---

## 🔐 Security Considerations

### API Key Security
- ✅ API keys stored in `.env.local` (gitignored)
- ✅ Keys never committed to repository
- ✅ Keys only accessible to background service worker
- ⚠️ **Never share API keys publicly**

### Ivanti Integration
- ✅ Uses user's browser session cookies (no credential storage)
- ✅ All API calls from background service worker
- ✅ No sensitive data in content scripts
- ✅ Automatic logout detection

### Data Privacy
- ✅ Conversation history stored locally
- ✅ No data sent to third parties (except AI provider)
- ✅ User data only used for context within extension

---

## 📊 API Integration

### Ivanti API Endpoints

The extension uses multiple Ivanti API endpoints:

**OData Endpoints:**
- `/HEAT/api/odata/businessobject/incidents` - Incidents
- `/HEAT/api/odata/businessobject/servicereqs` - Service Requests
- `/HEAT/api/odata/businessobject/employees` - Employees/Users
- `/HEAT/api/odata/businessobject/categorys` - Categories
- `/HEAT/api/odata/businessobject/ci__services` - Services
- `/HEAT/api/odata/businessobject/standarduserteams` - Teams
- `/HEAT/api/odata/businessobject/departments` - Departments
- `/HEAT/api/odata/businessobject/frs_def_roles` - Roles

**REST Endpoints:**
- `/HEAT/api/v1/User/current` - Current user info
- `/HEAT/api/rest/Template/...` - Request Offerings
- `/HEAT/api/rest/ServiceRequest/PackageData` - Fieldset data

### AI Provider APIs

**Google Gemini:**
- Endpoint: `https://generativelanguage.googleapis.com/v1beta`
- Models: `gemini-2.5-flash-lite`, `gemini-2.5-flash`, `gemini-2.5-pro`
- Authentication: API key in request header

**Ollama (Local):**
- Endpoint: Configurable (default: `http://localhost:11434`)
- Models: `llama3.2`, `llama3.1`, `mistral`, etc.
- Authentication: None (local)

---

## 🎨 UI Components

### ChatWidget
- Main chat interface component
- Message rendering with markdown support
- Action buttons for ticket operations
- Thinking status indicators
- Theme-aware styling

### ThemeEditor
- Comprehensive theme customization
- Color pickers for all theme elements
- Live preview integration
- Export/import themes

### ThemeSettings
- Theme management interface
- Theme selection and switching
- Default theme restoration
- Theme persistence

### LoadingScreen
- Loading states during operations
- Progress indicators
- Status messages

### LiveThemePreview
- Real-time theme preview
- Side-by-side comparison
- Preview updates on changes

---

## 🔄 Development Workflow

### Making Changes

1. **Edit source files** in `src/`
2. **Run dev mode**: `npm run dev` (auto-rebuilds)
3. **Reload extension** in Chrome (`chrome://extensions/`)
4. **Test changes** in Ivanti Service Manager

### Debugging

- **Background Service Worker**: Check logs in `chrome://extensions/` → Service Worker link
- **Content Script**: Check browser DevTools console on Ivanti page
- **React Components**: React DevTools extension recommended

### Testing Checklist

- [ ] User identity detection works
- [ ] AI responses are generated correctly
- [ ] Ticket context is detected
- [ ] Actions (create/update/delete) work
- [ ] Theme customization works
- [ ] Conversation history persists
- [ ] Logout detection works

---

## 📝 Key Features in Detail

### Context Awareness
The extension automatically detects:
- **Current Ticket**: Extracts RecId from URL or page content
- **Current User**: Multiple detection strategies (API, cookies, DOM)
- **User Roles**: Fetches roles and permissions
- **Page Context**: Understands what page user is on

### Conversation Intelligence
- **Multi-Turn Conversations**: Maintains full conversation history
- **Smart Summarization**: Summarizes old messages to save tokens
- **Follow-Up Detection**: Recognizes follow-up questions
- **Context Extraction**: Extracts key info from conversation

### Action Execution
The AI can execute actions like:
- Create new incidents/service requests
- Update existing tickets
- Delete tickets (with confirmation)
- Search for users, categories, services
- Fetch ticket details

### Error Handling
- **Graceful Degradation**: Falls back to alternative strategies
- **User-Friendly Messages**: Clear error messages
- **Retry Logic**: Automatic retries for transient failures
- **Logging**: Comprehensive logging for debugging

---

## 🚧 Known Limitations

1. **API Rate Limits**: Gemini API has rate limits on free tier
2. **Ivanti API Compatibility**: Some endpoints may vary by Ivanti version
3. **Browser Compatibility**: Chrome/Chromium only (Manifest V3)
4. **Session Persistence**: Requires browser storage permissions

---

## 📚 Documentation Files

- **README.md**: Quick start guide
- **PROJECT_SUMMARY.md**: This file - comprehensive overview
- **SETUP_API_KEY.md**: Detailed API key setup instructions
- **IMPLEMENTATION_PLAN.md**: Development roadmap (if exists)

---

## 🎯 Future Enhancements

Potential improvements:
- [ ] Support for additional AI providers
- [ ] Enhanced conversation analytics
- [ ] Bulk operations support
- [ ] Advanced search capabilities
- [ ] Integration with more Ivanti modules
- [ ] Mobile browser support
- [ ] Offline mode support

---

## 📄 License

Proprietary - Service IT Plus

---

## 👥 Support

For issues, questions, or contributions, please refer to the repository or contact the development team.

---

**Last Updated**: December 2024
**Version**: 1.0.0
**Status**: Active Development
