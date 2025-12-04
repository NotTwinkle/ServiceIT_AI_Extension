# Build Instructions

## Prerequisites

- Node.js 18+ installed
- npm or yarn package manager

## Step 1: Install Dependencies

```bash
npm install
```

This will install all required packages including:
- React 18
- Vite
- Tailwind CSS
- TypeScript
- Lucide React icons

## Step 2: Add Icons

Before building, add icon files to `public/icons/`:
- `icon16.png` (16x16px)
- `icon48.png` (48x48px)
- `icon128.png` (128x128px)

See `public/icons/README.md` for icon requirements.

## Step 3: Build the Extension

```bash
npm run build
```

This will:
1. Compile TypeScript to JavaScript
2. Bundle React components
3. Process Tailwind CSS
4. Output everything to the `dist/` folder

## Step 4: Load in Chrome

1. Open Chrome browser
2. Navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top-right corner)
4. Click "Load unpacked"
5. Select the `dist/` folder from this project
6. The extension should now appear in your extensions list

## Step 5: Test

1. Navigate to `https://success.serviceitplus.com/`
2. Open any ticket (with a `RecId` parameter in the URL)
3. Look for the floating chat bubble in the bottom-right corner
4. Click to open the chat interface

## Development Mode

For development with automatic rebuilds:

```bash
npm run dev
```

After making changes, you'll need to:
1. Reload the extension in `chrome://extensions/`
2. Refresh the Ivanti page

## Troubleshooting

### Build Errors

If you get build errors:
1. Delete `node_modules/` and `dist/`
2. Run `npm install` again
3. Run `npm run build`

### Extension Not Loading

If the extension doesn't load:
1. Check the Chrome console for errors
2. Verify all files are in the `dist/` folder
3. Ensure `manifest.json` is valid JSON
4. Check that icon files exist (or comment out the icons section in manifest.json temporarily)

### Chat Not Appearing

If the chat bubble doesn't appear:
1. Open Chrome DevTools (F12)
2. Check Console for errors
3. Verify you're on `success.serviceitplus.com`
4. Check if the content script is injected (look for `#serviceit-assistant-root` in the DOM)

### n8n Webhook Errors

If messages aren't sending:
1. Verify the webhook URL is correct in `src/components/ChatWidget.tsx`
2. Check that your n8n instance is running
3. Verify the API secret matches
4. Check network tab in DevTools for failed requests


