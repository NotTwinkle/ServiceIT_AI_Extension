# Service IT Plus Assistant

An AI-powered Chrome Extension for Ivanti Service Manager (success.serviceitplus.com).

## Features

- 🤖 AI-powered chat assistant for IT tickets
- 🎨 Modern UI with Service IT Plus branding
- 🔒 Secure Backend-for-Frontend architecture
- ⚡ Real-time chat interface
- 🎯 Context-aware based on current ticket (RecId)

## Tech Stack

- **Framework:** React 18 + TypeScript
- **Build Tool:** Vite
- **Styling:** Tailwind CSS (scoped to avoid conflicts)
- **Icons:** Lucide React
- **Manifest:** Chrome Extension Manifest V3

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure Gemini API Key (REQUIRED):**
   
   The AI Assistant requires a Google Gemini API key to function. Follow these steps:
   
   a. Get your API key:
      - Visit https://ai.google.dev/
      - Sign in with your Google account
      - Click "Get API Key" and create a new key
   
   b. Create `.env.local` file in the project root:
      ```bash
      # Create the file
      touch .env.local
      ```
   
   c. Add your API key to `.env.local`:
      ```
      VITE_GEMINI_API_KEY=your-actual-api-key-here
      ```
   
   **Important:** 
   - The `.env.local` file is already in `.gitignore` (won't be committed)
   - Never share your API key publicly
   - The extension will NOT work without this key

3. **Build the extension:**
   ```bash
   npm run build
   ```

4. **Load in Chrome:**
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" (top right)
   - Click "Load unpacked"
   - Select the `dist` folder from this project

## Development

For development with hot reload:

```bash
npm run dev
```

This will watch for changes and rebuild automatically. You'll need to refresh the extension in Chrome after changes.

## Project Structure

```
ServiceIT_AI_Extension/
├── src/
│   ├── content/
│   │   └── index.tsx          # Entry point for content script
│   ├── components/
│   │   └── ChatWidget.tsx     # Main chat UI component
│   └── styles.css             # Tailwind directives
├── manifest.json              # Chrome extension manifest
├── vite.config.ts             # Vite configuration
├── tailwind.config.js         # Tailwind configuration
├── package.json               # Dependencies
└── README.md                  # This file
```

## Security

This extension follows the Backend-for-Frontend (BFF) security pattern:

- ✅ No API keys stored in the extension
- ✅ All Ivanti API calls go through n8n backend
- ✅ Extension only communicates with authorized webhook
- ✅ Secure header authentication (`x-api-secret`)

## Backend Integration

The extension communicates with n8n webhook at:
```
https://lorinda-sawdustish-incontrovertibly.ngrok-free.dev/webhook/ivanti-chat
```

**Request Format:**
```json
{
  "message": "User's message",
  "ticketId": "10060",
  "timestamp": "2025-12-02T..."
}
```

**Expected Response:**
```json
{
  "response": "AI's response message"
}
```

## Styling

The extension uses Tailwind CSS with a `sit-` prefix to avoid conflicts with the host site. All styles are scoped to `#serviceit-assistant-root`.

## Colors

- **Navy Blue:** `#002b5c` (Primary brand color)
- **Orange:** `#ff9900` (Accent color)

## License

Proprietary - Service IT Plus


