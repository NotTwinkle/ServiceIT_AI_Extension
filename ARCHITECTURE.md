# Architecture Documentation

## 🏗️ **System Overview**

Service IT Plus Assistant is a Chrome Extension that provides AI-powered assistance for Ivanti Service Manager. The extension uses a **Backend-for-Frontend (BFF)** pattern where the background service worker acts as a secure API layer.

---

## 📦 **Components**

### **1. Content Script (`src/content/index.tsx`)**
**Responsibility:** UI and user interaction

**Functions:**
- Renders the chat widget on Ivanti pages
- Scrapes display name from DOM (fallback for user identification)
- Communicates with background script via `chrome.runtime.sendMessage`
- Only runs in **main frame** (not iframes) to prevent duplication

**Key Features:**
- Floating button with hover label ("AI Assistant")
- Chat interface with message history
- Typing indicator
- Auto-scrolling messages

**Security:**
- No API keys stored here (accessible by web page)
- No direct API calls
- All logic delegated to background script

---

### **2. Background Service Worker (`src/background/index.ts`)**
**Responsibility:** Business logic, API orchestration, security

**Functions:**
- User identity detection
- AI message processing
- Conversation history management
- API key storage (secure)

**Message Handlers:**
- `IDENTIFY_USER` - Identifies logged-in Ivanti user
- `SEND_MESSAGE` - Processes chat messages through AI
- `CLEAR_CONVERSATION` - Clears conversation history

**Security:**
- API keys never exposed to content scripts
- Tab-based conversation isolation
- Automatic cleanup on tab close

---

### **3. User Identity Service (`src/background/services/userIdentity.ts`)**
**Responsibility:** Determine who the current user is

**Strategy 1: API-Based (Primary)**
```typescript
// Executes in page context to access cookies
fetch('https://success.serviceitplus.com/api/core/users/current', {
  credentials: 'include' // Uses browser session cookies
})
```

**Returns:**
- `recId` - User's Record ID in Ivanti
- `loginId` - Username
- `fullName` - Display name
- `email` - Email address
- `roles` - User's roles
- `teams` - User's teams

**Strategy 2: Name Search (Fallback)**
```typescript
// If API fails, search by display name from DOM
GET /api/odata/businessobject/ProfileLink?$filter=FullName eq 'Michael Monteza'
```

**Handles Edge Cases:**
- Multiple users with same name → Prefers active users
- Missing API endpoints → Falls back to OData
- Network errors → Uses DOM-scraped name as last resort

---

### **4. AI Service (`src/background/services/aiService.ts`)**
**Responsibility:** OpenAI integration and prompt engineering

**Main Function:**
```typescript
processMessage(
  userMessage: string,
  currentUser: IvantiUser,
  ticketId: string | null,
  conversationHistory: ChatMessage[]
): Promise<AIResponse>
```

**Prompt Engineering:**
- Injects user context (name, role, teams, ticket ID)
- Follows `prompt.md` guidelines
- Maintains conversation history
- Generates natural language responses

**Model Configuration:**
- Model: `gpt-4o` (configurable to `gpt-4o-mini`)
- Temperature: `0.7` (balanced creativity/accuracy)
- Max Tokens: `1500` (sufficient for most responses)

**Response Format:**
```typescript
{
  message: string,        // Natural language response
  actions?: IvantiAction[] // Suggested API actions (future)
}
```

---

### **5. Configuration (`src/background/config.ts`)**
**Responsibility:** Centralized configuration

**Ivanti Config:**
```typescript
{
  baseUrl: 'https://success.serviceitplus.com',
  endpoints: {
    currentUser: '/api/core/users/current',
    currentUserAlt: '/api/user/me',
    userByName: '/api/odata/businessobject/ProfileLink',
    incidents: '/api/odata/businessobject/Incident',
    serviceRequests: '/api/odata/businessobject/ServiceReq',
  }
}
```

**AI Config:**
```typescript
{
  apiKey: 'sk-...',        // OpenAI API key (user must add)
  model: 'gpt-4o',         // AI model
  temperature: 0.7,        // Creativity level
  maxTokens: 1500,         // Response length limit
  systemPrompt: '...'      // Base instructions
}
```

---

## 🔄 **Data Flow**

### **User Identification Flow**
```
1. Extension loads on Ivanti page
   ↓
2. Content script requests user identification
   ↓
3. Background script tries API (Strategy 1)
   ├─ Success → Returns full user object with recId
   └─ Failure → Try name search (Strategy 2)
      ├─ Success → Returns matched user
      └─ Failure → Returns DOM-scraped name
   ↓
4. Content script caches user info
   ↓
5. Chat widget displays personalized greeting
```

### **Message Processing Flow**
```
1. User types message in chat
   ↓
2. Content script sends to background:
   {
     type: 'SEND_MESSAGE',
     message: 'Close this ticket',
     ticketId: '12345'
   }
   ↓
3. Background retrieves cached user
   ↓
4. Background builds OpenAI prompt:
   - System context (user, role, ticket)
   - Conversation history
   - User message
   ↓
5. Background calls OpenAI API
   ↓
6. OpenAI returns response
   ↓
7. Background sends to content script:
   {
     success: true,
     message: 'I can help close ticket 12345...',
     actions: []
   }
   ↓
8. Content script displays response in chat
```

---

## 🔐 **Security Architecture**

### **Threat Model**

| Attack Vector | Mitigation |
|--------------|------------|
| **API Key Theft** | Stored in background script only (not accessible from web pages) |
| **Session Hijacking** | Uses browser's native cookie handling (httpOnly support) |
| **XSS Injection** | React auto-escapes, content script isolated from page JS |
| **CSRF** | All API calls use `credentials: 'include'` with same-origin cookies |
| **Man-in-the-Middle** | HTTPS required for both Ivanti and OpenAI |

### **Permission Model**

```json
{
  "permissions": [
    "scripting",  // Execute fetch() in page context (for cookies)
    "activeTab"   // Access current tab info
  ],
  "host_permissions": [
    "https://success.serviceitplus.com/*",  // Ivanti API
    "https://api.openai.com/*"               // OpenAI API
  ]
}
```

**Why `scripting`?**
- Background scripts run in isolated context (no cookies)
- `chrome.scripting.executeScript` injects fetch into page context
- This allows using the user's session cookies for Ivanti API calls

---

## 🎨 **UI/UX Design**

### **Color Palette**
- **Navy Blue** (`#002b5c`) - Primary brand color
- **Orange** (`#ff9900`) - Accent color
- **White** (`#ffffff`) - User message text
- **Gray** (`#f3f4f6`) - Bot message background

### **Components**

**Floating Button:**
- Size: 80x80px (20x20 larger than standard)
- Position: Fixed bottom-right (60px from bottom, 24px from right)
- Hover: Scale 1.1, enhanced shadow
- Hover Label: "AI Assistant" (two-tone text)
- Pulse Animation: Continuous attention-grabbing ring

**Chat Window:**
- Size: 400x600px
- Position: Fixed bottom-right
- Header: Logo + "Service IT Plus" + Ticket ID
- Background: Watermark logo (5% opacity)
- Messages: Fade-in-up animation

**Message Bubbles:**
- User: Navy blue background, white text, right-aligned
- Bot: Light gray background, dark text, left-aligned
- Avatar: Service IT logo
- Timestamp: Relative time (future enhancement)

---

## 🔧 **Build Configuration**

### **Vite Setup (`vite.config.ts`)**
```typescript
{
  input: {
    content: 'src/content/index.tsx',   // Content script
    background: 'src/background/index.ts' // Service worker
  },
  output: {
    entryFileNames: '[name].js',  // content.js, background.js
    assetFileNames: (asset) => {
      if (asset.name === 'style.css') return 'content.css';
      return '[name].[ext]';
    }
  }
}
```

### **TypeScript Config**
- Target: ES2020
- Module: ESNext
- Strict mode enabled
- JSX: React

---

## 📊 **Performance Characteristics**

### **Metrics**

| Operation | Time | Notes |
|-----------|------|-------|
| **Extension Load** | ~50ms | Content script injection |
| **User Identification (API)** | ~100-200ms | Depends on Ivanti response time |
| **User Identification (Fallback)** | ~300-500ms | Includes OData query |
| **AI Message Processing** | ~1-3s | OpenAI API call (model dependent) |
| **Message Rendering** | ~16ms | React rendering |

### **Memory Usage**
- Content Script: ~5MB (React + UI)
- Background Worker: ~2MB (Services + History)
- Total: ~7MB per tab

### **Network**
- Ivanti API: ~1-2 requests per session
- OpenAI API: 1 request per message
- No polling/websockets (event-driven only)

---

## 🚀 **Future Enhancements**

### **Phase 2: Action Execution**
- Parse AI responses for action intents
- Generate Ivanti API calls (PATCH, POST)
- Request user confirmation for destructive operations
- Execute actions and show results

### **Phase 3: Advanced Features**
- Ticket summarization
- SLA predictions
- Bulk operations
- Custom reports
- Team analytics

### **Phase 4: Enterprise Features**
- Multi-tenant support
- SSO integration
- Audit logging
- Usage analytics
- Admin dashboard

---

## 🧪 **Testing Strategy**

### **Unit Tests** (Future)
- User identity service (mock Ivanti responses)
- AI service (mock OpenAI responses)
- Message routing

### **Integration Tests** (Future)
- Content ↔ Background communication
- API error handling
- Session expiry handling

### **Manual Testing Checklist**
- [ ] User identification works on Ivanti login
- [ ] Chat opens/closes smoothly
- [ ] Messages send and receive correctly
- [ ] AI responses are contextual
- [ ] Works across different Ivanti pages
- [ ] Handles network errors gracefully
- [ ] No console errors in production

---

## 📚 **References**

- [Chrome Extension Manifest V3](https://developer.chrome.com/docs/extensions/mv3/)
- [OpenAI API Documentation](https://platform.openai.com/docs/api-reference)
- [Ivanti REST API Guide](https://help.ivanti.com/ht/help/en_us/ISM/2020/API)
- [React Best Practices](https://react.dev/)

---

## 📝 **Change Log**

### Version 1.0.0 (December 2024)
- Initial release
- Direct Ivanti API integration (removed n8n dependency)
- OpenAI GPT-4o integration
- User auto-detection (API + DOM fallback)
- Personalized chat interface
- Conversation history management

