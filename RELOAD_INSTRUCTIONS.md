# 🔄 Extension Reload Instructions

## To Apply the New Employee Fetching Logic:

### Method 1: Reload Extension (Recommended)
1. Open Chrome and go to `chrome://extensions/`
2. Find **"Service IT Plus Assistant"**
3. Click the **refresh/reload icon** (circular arrow)
4. Go back to your Ivanti page and refresh it
5. Wait for the loading screen to complete

### Method 2: Full Reinstall
1. Run `npm run build` in terminal
2. Go to `chrome://extensions/`
3. Toggle the extension **OFF** then **ON**
4. Refresh your Ivanti page

## What Should Happen:

You should see these logs in the console:

```
[KnowledgeBase] 📥 Fetching all employees...
[KnowledgeBase] Cleared old employee cache entries
[KnowledgeBase] Attempting to fetch employees with pagination...
[KnowledgeBase] Fetched batch 0-100: 100 returned, 100 new (total: 100)
[KnowledgeBase] Fetched batch 100-200: 100 returned, 100 new (total: 200)
[KnowledgeBase] Fetched batch 200-300: 50 returned, 50 new (total: 250)
...
[KnowledgeBase] ✅ Loaded XXX unique employees (should be 200-500+, not 99)
```

## New Features:
- **Pagination**: Fetches employees in batches (0-100, 100-200, etc.)
- **Pattern Search with Pagination**: If pagination fails, searches by letter (a, b, c...) with pagination
- **Deduplication**: Uses Set to track unique RecIds
- **Target**: 200-500 unique employees instead of 99

## If Lance Nunez Still Not Found:
1. Check the total employee count in logs: `[KnowledgeBase] ✅ Loaded XXX unique employees`
2. If it's still around 99, the Ivanti API might have other restrictions
3. We can try alternative approaches like searching by specific departments or teams

