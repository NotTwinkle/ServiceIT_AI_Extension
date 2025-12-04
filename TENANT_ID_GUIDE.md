# How to Find Your Ivanti Tenant ID

## 🔍 **Methods to Find Tenant ID**

### **Method 1: Check the URL (Easiest)**
When you're logged into Ivanti, check your browser's address bar:

```
https://success.serviceitplus.com/HEAT/[TENANT_ID]/Default.aspx
```

The tenant ID is usually the segment after `/HEAT/` and before `/Default.aspx` or other paths.

**Example:**
- URL: `https://success.serviceitplus.com/HEAT/ABC123/Default.aspx`
- Tenant ID: `ABC123`

---

### **Method 2: Check API Response Headers**
1. Open browser DevTools (`F12`)
2. Go to **Network** tab
3. Make any request in Ivanti (refresh page, click a link)
4. Look for response headers:
   - `X-Tenant-Id`
   - `X-Tenant-ID`
   - `Tenant-Id`

---

### **Method 3: System Settings (Admin Access Required)**
1. Log in as administrator
2. Go to: **System Tools** → **Configuration** → **Tenant Information**
3. The tenant ID will be displayed there

---

### **Method 4: API Call (If You Have Access)**
Try calling:
```
GET https://success.serviceitplus.com/api/core/tenant
```

The response may include the tenant ID.

---

## ⚠️ **Important Notes**

1. **Tenant ID is Optional**: For most operations, the extension uses your browser session cookies, so the tenant ID is **not required** unless you're doing admin-level operations.

2. **Default Tenant**: If you don't specify a tenant ID, Ivanti will use the default tenant from your session.

3. **Multi-Tenant**: If your organization uses multiple tenants, you may need to specify which one to use.

---

## 📝 **How to Add It to Config**

If you find your tenant ID, add it here:

```typescript
// In src/background/config.ts
export const IVANTI_CONFIG = {
  // ...
  tenantId: 'YOUR_TENANT_ID_HERE', // Add it here
  // ...
};
```

Then rebuild:
```bash
npm run build
```

---

## 🧪 **Test Without Tenant ID First**

**Try the extension first without the tenant ID!** It should work fine for most operations since it uses your session cookies. Only add the tenant ID if you encounter issues or need admin-level operations.

---

## ❓ **Still Can't Find It?**

If you can't find the tenant ID:
1. **Check with your Ivanti administrator**
2. **Look in Ivanti documentation** for your organization
3. **Try leaving it blank** - it might not be needed!

The extension is designed to work **without** the tenant ID for most use cases. 🎯

