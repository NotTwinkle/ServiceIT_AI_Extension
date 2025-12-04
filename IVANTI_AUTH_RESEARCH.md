# Ivanti User Identification Research Report

**Research Date:** Tuesday, December 2, 2025
**Target Systems:** Ivanti Service Manager (ISM), Ivanti Neurons (ITSM), Ivanti EPM

## Executive Summary

Identifying the currently logged-in user in Ivanti environments can be achieved through three primary vectors: **Server-Side** (trusted context), **Client-Side** (session artifacts), and **Extension-Based** (accessing client artifacts).

For a Chrome Extension, the most reliable "unofficial" method is **Script Injection** to read the global `HEAT` or `session` objects, while the most robust "official" method is using the **REST API** with a session key extracted from cookies.

---

## 1. Server-Side Methods
*These methods are used within Ivanti's internal scripting engines (QuickActions, Business Rules) or via direct API calls.*

### A. Ivanti Service Manager (ISM) QuickActions
ISM provides built-in functions to retrieve user context within server-side scripts.

| Function | Description | Context |
| :--- | :--- | :--- |
| `CurrentLoginId()` | Returns the Login ID (username) of the current user. | Business Rules, QuickActions |
| `CurrentUserEmail()` | Returns the email address of the current user. | Business Rules, QuickActions |
| `CurrentRole()` | Returns the current active role of the user. | Business Rules, QuickActions |
| `GetSessionKey()` | Returns the active session ID string. | Internal Scripting |

### B. REST API (Official)
You can query the backend to ask "Who am I?" if you have a valid session token.

**Endpoint:** `GET /api/rest/Session/User`
*   **Headers:** `Authorization: rest_api_key={SessionKey}`
*   **Response:** Returns a JSON object with `LoginId`, `Email`, `Role`, etc.

**Endpoint:** `GET /api/odata/me` (Newer versions)
*   **Headers:** `Authorization: Bearer {Token}`

---

## 2. Client-Side Methods
*These artifacts exist in the browser and can be inspected by Developer Tools.*

### A. Cookies
Ivanti uses specific cookies to maintain sessions.

*   **ISM (HEAT):**
    *   `ASP.NET_SessionId`: Standard session ID.
    *   `.ASPXAUTH`: Forms authentication ticket (often encrypted).
    *   `hws`: Heat Web Session cookie (critical for API calls).

*   **Neurons:**
    *   Uses OIDC/OAuth tokens, often stored in `LocalStorage` rather than simple cookies.

### B. Global JavaScript Objects
The ISM web interface populates global variables with session data.

*   **`window.HEAT`**: The main namespace for the application.
*   **`HEAT.Session`**: Contains properties like `HEAT.Session.user`, `HEAT.Session.role`.
*   **`window.g_session_id`**: Often holds the current session key.

---

## 3. Extension-Based Methods (Critical)
*How a Chrome Extension (like Service IT Plus Assistant) can retrieve this data.*

### Method A: Script Injection (Recommended for Context)
Chrome Extensions run in an "isolated world" and cannot directly read `window.HEAT`. You must inject a script into the "main world" to retrieve it.

**How it works:**
1. Extension injects a small `<script>` tag into the page body.
2. The script reads `window.HEAT.Session.CurrentUser`.
3. The script posts a message back to the extension via `window.postMessage`.

**Code Example:**
```javascript
// inject.js
window.postMessage({ type: "IVANTI_USER", user: window.HEAT?.Session?.CurrentUser }, "*");
```

**Pros:** No API calls needed; fast.
**Cons:** Relies on internal JS objects (unofficial).

### Method B: Cookie Extraction (Recommended for API)
If you need to make API calls *on behalf of the user* (not just know their name), you need their session cookie.

**How it works:**
1. Extension requests `cookies` permission in `manifest.json`.
2. Use `chrome.cookies.get()` to read the `hws` or `.ASPXAUTH` cookie.
3. Send this cookie to your backend (n8n) or use it to call the Ivanti API directly.

**Code Example:**
```typescript
chrome.cookies.get({ url: "https://success.serviceitplus.com", name: "hws" }, (cookie) => {
  console.log("Session Key:", cookie.value);
});
```

**Pros:** Allows full API access as the user.
**Cons:** High security risk; requires host permissions.

### Method C: UI Scraping (Fallback)
If technical methods fail, you can simply read the user's name from the HTML header.

**How it works:**
1. Use `document.querySelector` to find the profile element.
2. Selector often looks like: `.header-user-name` or `[data-qa="header-profile-name"]`.

**Pros:** Zero permissions needed.
**Cons:** Breaks if Ivanti changes their UI layout.

---

## 4. Summary & Recommendation

| Method | Reliability | Difficulty | Access Type | Recommendation |
| :--- | :--- | :--- | :--- | :--- |
| **API (Server)** | High | Medium | Full Data | **Official & Best** for data operations. |
| **Script Injection** | High | High | Identity Only | **Best** for getting context (Name/Role). |
| **Cookies** | High | Low | Session Key | **Required** if making API calls. |
| **UI Scraping** | Low | Low | Name Only | **Fallback** only. |

**For "Service IT Plus Assistant":**
Since you are using a "Backend for Frontend" pattern:
1.  **Do NOT** send the user's session cookie to n8n (security risk).
2.  **DO** use **Script Injection** or **UI Scraping** to get the `LoginId` (e.g., "jdoe").
3.  Send `LoginId` + `RecId` to n8n.
4.  Let n8n use its *own* Service Account to perform actions (logging the requestor as "jdoe").

This maintains the security boundary while giving you the context you need.

