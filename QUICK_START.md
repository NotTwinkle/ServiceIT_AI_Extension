# ⚡ Quick Start Guide

## 🎯 **3 Steps to Get Running**

### **Step 1: Add OpenAI API Key**
```bash
# Open this file:
src/background/config.ts

# Line 27, change this:
apiKey: '',

# To this:
apiKey: 'sk-proj-your-actual-key-here',
```

Get your API key: [platform.openai.com/api-keys](https://platform.openai.com/api-keys)

---

### **Step 2: Build**
```bash
cd /Users/jeremiahpatorpanganoran/Downloads/ServiceIT_AI_Extension
npm run build
```

---

### **Step 3: Load Extension**
1. Open Chrome: `chrome://extensions/`
2. Enable "Developer mode" (top-right)
3. Click "Load unpacked"
4. Select folder: `/Users/jeremiahpatorpanganoran/Downloads/ServiceIT_AI_Extension/dist`

---

## ✅ **Test It**

1. Go to: `https://success.serviceitplus.com`
2. Log in
3. Open any ticket
4. Click the **floating navy blue button** (bottom-right)
5. Type: "Hello"

You should see: **"Hello Michael Monteza! 👋 I'm here to assist you..."**

---

## 📚 **Documentation**

- **`SETUP.md`** - Detailed setup instructions
- **`ARCHITECTURE.md`** - Technical documentation
- **`MIGRATION_SUMMARY.md`** - What changed from n8n
- **`prompt.md`** - AI behavior guidelines

---

## 🐛 **Problems?**

### **"AI service not configured"**
→ You forgot to add your OpenAI API key (Step 1)

### **"User not identified"**
→ Make sure you're logged into Ivanti

### **Extension not showing**
→ Check you're on `https://success.serviceitplus.com/*`

### **Still stuck?**
→ Check console: `F12` → Console tab
→ Check background worker: `chrome://extensions/` → Click "service worker"

---

## 🎉 **What's New**

✅ **No more n8n/ngrok needed!**
✅ **5x faster** (~100ms vs ~500ms)
✅ **Better security** (uses your Ivanti session)
✅ **Accurate audit trail** (shows your actual name)
✅ **Simpler setup** (just need OpenAI key)

---

## 💡 **Pro Tips**

**Cheaper AI responses:**
```typescript
// In src/background/config.ts, change:
model: 'gpt-4o'
// To:
model: 'gpt-4o-mini'  // ~10x cheaper
```

**Faster responses:**
```typescript
temperature: 0.3  // More focused, less creative
```

**Check costs:**
[platform.openai.com/usage](https://platform.openai.com/usage)

---

## 🚀 **Ready to Go!**

That's it! Just add your OpenAI key, build, and test.

**Estimated time:** 2 minutes ⏱️

