# Service IT Plus Assistant - Setup Guide

## 🎉 **New Architecture (No n8n Required!)**

The extension now runs **completely standalone** with AI processing built directly into the extension.

---

## 📋 **Prerequisites**

1. **OpenAI API Key** - Get one from [platform.openai.com](https://platform.openai.com/api-keys)
2. **Chrome Browser** - Version 88+ (Manifest V3 support)
3. **Access to Ivanti** - Must be logged in to `https://success.serviceitplus.com`

---

## ⚙️ **Configuration Steps**

### **Step 1: Add Your OpenAI API Key**

1. Open `/Users/jeremiahpatorpanganoran/Downloads/ServiceIT_AI_Extension/src/background/config.ts`
2. Find this line:
   ```typescript
   apiKey: '', // TODO: Add your OpenAI API key (sk-...)
   ```
3. Replace with your actual API key:
   ```typescript
   apiKey: 'sk-proj-your-actual-key-here',
   ```

### **Step 2: (Optional) Configure Ivanti Settings**

If your Ivanti instance uses different API endpoints:

```typescript
export const IVANTI_CONFIG = {
  baseUrl: 'https://success.serviceitplus.com', // Your Ivanti URL
  
  endpoints: {
    currentUser: '/api/core/users/current', // Adjust if different
    // ... other endpoints
  }
};
```

### **Step 3: Build the Extension**

```bash
cd /Users/jeremiahpatorpanganoran/Downloads/ServiceIT_AI_Extension
npm install  # If not already done
npm run build
```

### **Step 4: Load into Chrome**

1. Open Chrome and go to `chrome://extensions/`
2. Enable **"Developer mode"** (top-right toggle)
3. Click **"Load unpacked"**
4. Select the `dist` folder: `/Users/jeremiahpatorpanganoran/Downloads/ServiceIT_AI_Extension/dist`
5. The extension should now appear in your extensions list

### **Step 5: Test on Ivanti**

1. Navigate to `https://success.serviceitplus.com`
2. Log in with your Ivanti credentials
3. Open any ticket
4. You should see the **floating AI Assistant button** (bottom-right, navy blue with logo)
5. Click it to open the chat

---

## 🔐 **How It Works (Security)**

### **User Authentication**
```
Content Script → Background Script → Ivanti API (with browser cookies)
                                   ↓
                              User identified!
```

The extension uses **YOUR browser session cookies** to call Ivanti APIs. This means:
- ✅ No API keys needed for Ivanti
- ✅ Works with your permissions only (not admin)
- ✅ Audit trail shows YOUR name
- ✅ Session expires when you log out

### **AI Processing**
```
User types message → Background Script → OpenAI API
                                       ↓
                   ← AI generates response ←
```

- **OpenAI API key** is stored securely in the extension's background script
- **Not accessible** from web pages or content scripts
- **Only you** have access to the extension package

---

## 🎯 **Features**

### **1. User Auto-Detection**
The extension automatically identifies you using:
1. **Ivanti REST API** (`/api/core/users/current`) - Most reliable
2. **Fallback DOM Scraping** - If API fails

### **2. AI Chat**
- Natural language processing via GPT-4o
- Context-aware (knows which ticket you're viewing)
- Personalized (knows your name and role)

### **3. Smart Actions** (Coming Soon)
- "Close this ticket" → Generates API call
- "Assign to Desktop Support" → Updates assignment
- "Show me October incidents" → Fetches and analyzes

---

## 🐛 **Troubleshooting**

### **Issue: "User not identified"**
**Solution:**
1. Make sure you're logged in to Ivanti
2. Refresh the page
3. Check browser console for errors (`F12` → Console tab)

### **Issue: "AI service not configured"**
**Solution:**
1. Check that you added your OpenAI API key to `src/background/config.ts`
2. Rebuild: `npm run build`
3. Reload extension in `chrome://extensions/`

### **Issue: "OpenAI API error"**
**Solution:**
1. Verify your API key is valid
2. Check you have credits: [platform.openai.com/usage](https://platform.openai.com/usage)
3. Check console for specific error message

### **Issue: Extension not showing**
**Solution:**
1. Make sure you're on `https://success.serviceitplus.com/*`
2. Check that the extension is enabled in `chrome://extensions/`
3. Look for errors in extension service worker:
   - Go to `chrome://extensions/`
   - Find "Service IT Plus Assistant"
   - Click "service worker" link
   - Check console

---

## 📊 **Architecture Overview**

```
┌─────────────────────────────────────────┐
│  Content Script (Ivanti Page)          │
│  - Chat UI                              │
│  - Display name scraper (fallback)     │
│  - Sends messages to Background        │
└─────────────────┬───────────────────────┘
                  │ chrome.runtime.sendMessage
                  ▼
┌─────────────────────────────────────────┐
│  Background Service Worker              │
│  ✓ User Identity Service                │
│  ✓ AI Service (OpenAI)                  │
│  ✓ Conversation History                 │
│  ✓ API Key Storage (secure)             │
└─────────────────┬───────────────────────┘
                  │
        ┌─────────┴─────────┐
        ▼                   ▼
┌──────────────┐    ┌──────────────┐
│ Ivanti API   │    │ OpenAI API   │
│ (w/ cookies) │    │ (w/ API key) │
└──────────────┘    └──────────────┘
```

---

## 📝 **What Changed from n8n?**

| Feature | Old (n8n) | New (Direct) |
|---------|-----------|--------------|
| **Backend** | External n8n server | Built into extension |
| **Network** | Extension → ngrok → n8n → Ivanti | Extension → Ivanti (direct) |
| **Speed** | ~500ms+ | ~100ms |
| **Auth** | n8n API key (admin) | Browser cookies (your session) |
| **Setup** | n8n workflow + webhook | Just OpenAI API key |
| **Security** | Webhook publicly accessible | No external endpoints |
| **Audit Trail** | Shows "API User" | Shows your actual name |

---

## 💡 **Tips**

1. **Cost Optimization**: Change `model: 'gpt-4o-mini'` in `config.ts` for cheaper responses
2. **Faster Responses**: Set `temperature: 0.3` for more deterministic answers
3. **Debugging**: Check both:
   - Content script console (page console, `F12`)
   - Background worker console (`chrome://extensions/` → "service worker")

---

## 🚀 **Next Steps**

1. Add your OpenAI API key
2. Build and load the extension
3. Test on Ivanti
4. Enjoy your AI assistant! 🎉

For issues or questions, check the console logs or contact support.

