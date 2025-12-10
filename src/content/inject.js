(function() {
  console.log("🔍 ServiceIT: Inject script loaded in " + window.location.href);
  console.log("🔍 ServiceIT: Scanning for ALL possible user data sources...");
  
  let attempts = 0;
  const maxAttempts = 60; // 30 seconds (increased timeout for Neurons 2025.3)

  async function scanForUser() {
    try {
      // Log what's available in window object (comprehensive scan)
      if (attempts === 0) {
        const allKeys = Object.keys(window);
        console.log("🔍 ServiceIT: Total window keys:", allKeys.length);
        console.log("🔍 ServiceIT: Window object keys (first 100):", allKeys.slice(0, 100));
        
        // Look for Ivanti-specific keys
        const ivantiKeys = allKeys.filter(k => 
          k.toLowerCase().includes('ivanti') || 
          k.toLowerCase().includes('heat') || 
          k.toLowerCase().includes('user') ||
          k.toLowerCase().includes('session')
        );
        console.log("🔍 ServiceIT: Ivanti-related keys:", ivantiKeys);
      }

      // 0. FIRST: Try to scrape role from the UI (most reliable)
      console.log("🔍 ServiceIT: Attempting to scrape role from UI...");
      let roleFromUI = null;
      
      // Strategy A: Look for role in the user profile dropdown (top-right corner)
      // In the screenshot, "Self Service" appears below "SITLance"
      try {
        // Wait a moment for UI to render
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Look for text in the top-right area that matches known roles
        // Expanded list to match all possible role names
        const knownRoles = [
          'Admin', 'Administrator', 
          'Self Service', 'Self Service User', 'SelfService', 'SelfServiceMobile',
          'Service Desk Analyst', 'ServiceDeskAnalyst',
          'Manager', 'Supervisor', 'Agent', 'Analyst',
          'HR Manager', 'Finance Manager', 'Project Manager',
          'Configuration Manager', 'Portfolio Manager'
        ];
        
        // Scan all text elements in the page header
        const allElements = document.querySelectorAll('*');
        for (const el of allElements) {
          // Check if element is in the top 150px of the page
          const rect = el.getBoundingClientRect();
          if (rect.top < 150 && rect.top >= 0) {
            const text = el.textContent?.trim() || '';
            // Check if text exactly matches a known role
            if (knownRoles.includes(text)) {
              roleFromUI = text;
              console.log("✅ ServiceIT: Found role in UI:", roleFromUI);
              break;
            }
            // Also check if text contains a known role (for cases like "Self Service User")
            for (const role of knownRoles) {
              if (text.includes(role) && text.length < 50) { // Avoid matching long text
                roleFromUI = role;
                console.log("✅ ServiceIT: Found role in UI (partial match):", roleFromUI);
                break;
              }
            }
            if (roleFromUI) break;
          }
        }
        
        // If not found in header, check for role info in any visible area
        if (!roleFromUI) {
          for (const el of allElements) {
            const text = el.textContent?.trim() || '';
            // Look for pattern like "Role: Self Service" or just "Self Service" near user name
            if (text.includes('Role:') || text.includes('role:')) {
              const roleMatch = text.match(/Role:\s*(.+)/i);
              if (roleMatch && knownRoles.includes(roleMatch[1].trim())) {
                roleFromUI = roleMatch[1].trim();
                console.log("✅ ServiceIT: Found role label:", roleFromUI);
                break;
              }
            }
          }
        }
      } catch (e) {
        console.log("ServiceIT: Could not scrape role from UI:", e);
      }
      
      // Store UI role in sessionStorage if found
      if (roleFromUI) {
        try {
          sessionStorage.setItem('currentActiveRoleFromUI', roleFromUI);
          console.log("✅ ServiceIT: Stored UI role in sessionStorage:", roleFromUI);
        } catch (e) {
          console.error("ServiceIT: Could not store UI role");
        }
      }
      
      // 1. Check window.Session (Found by brute-force scanner!)
      if (window.Session) {
        console.log("✅ ServiceIT: Found window.Session:", window.Session);
        console.log("🔍 ServiceIT: Session keys:", Object.keys(window.Session));
        const s = window.Session;
        
        // LOG ALL ROLE-RELATED FIELDS FOR DEBUGGING
        console.log("🔍 ServiceIT: Debugging role fields:");
        console.log("  - CurrentRole:", s.CurrentRole);
        console.log("  - currentRole:", s.currentRole);
        console.log("  - ActiveRole:", s.ActiveRole);
        console.log("  - activeRole:", s.activeRole);
        console.log("  - Role:", s.Role);
        console.log("  - role:", s.role);
        console.log("  - Roles:", s.Roles);
        console.log("  - roles:", s.roles);
        
        // Extract any available user data
        // PRIORITY: Use UI-scraped role first, then session data
        const sessionRole = s.CurrentRole || s.currentRole || s.ActiveRole || s.activeRole || s.Role || s.role;
        const userData = {
          recId: s.RecId || s.recId || s.UserId || s.userId || s.EmployeeRecId,
          loginId: s.LoginId || s.loginId || s.UserName || s.username || s.Email,
          email: s.Email || s.email,
          fullName: s.DisplayName || s.displayName || s.FullName || s.fullName || s.UserName,
          role: roleFromUI || sessionRole, // PREFER UI role over session
          isSuperAdmin: s.IsSuperAdmin,
          appName: s.AppName,
          source: roleFromUI ? 'UI scrape + window.Session' : 'window.Session'
        };
        
        console.log("🔍 ServiceIT: Role decision:");
        console.log("  - UI Role:", roleFromUI);
        console.log("  - Session Role:", sessionRole);
        console.log("  - Using:", userData.role);
        
        // Store the current active role in sessionStorage for later use
        if (userData.role) {
          try {
            sessionStorage.setItem('currentActiveRole', userData.role);
            console.log("✅ ServiceIT: Stored active role in sessionStorage:", userData.role);
          } catch (e) {
            console.error("ServiceIT: Could not store role in sessionStorage");
          }
        }
        
        // If we found any useful data, return it
        if (userData.loginId || userData.fullName || userData.recId) {
          console.log("✅ ServiceIT: Extracted user data from window.Session:", userData);
          return userData;
        }
      }

      // 2. HEAT Object (Standard ISM)
      if (window.HEAT) {
        console.log("✅ ServiceIT: Found window.HEAT");
        console.log("🔍 ServiceIT: HEAT keys:", Object.keys(window.HEAT));
        
        if (window.HEAT.Session) {
          console.log("✅ ServiceIT: Found HEAT.Session");
          console.log("🔍 ServiceIT: HEAT.Session keys:", Object.keys(window.HEAT.Session));
          
          if (window.HEAT.Session.CurrentUser) {
            const u = window.HEAT.Session.CurrentUser;
            console.log("✅ ServiceIT: Found HEAT.Session.CurrentUser:", u);
            
            // Extract all available user fields including RecId
            return {
              recId: u.RecId || u.recId || u.EmployeeId || u.employeeId || u.UserId || u.userId,
              loginId: u.LoginId || u.loginId || u.UserName || u.username,
              email: u.Email || u.email || u.PrimaryEmail || u.primaryEmail,
              fullName: u.DisplayName || u.displayName || u.FullName || u.fullName,
              firstName: u.FirstName || u.firstName,
              lastName: u.LastName || u.lastName,
              team: u.Team || u.team || u.OrganizationalUnit || u.organizationalUnit,
              department: u.Department || u.department,
              role: u.Role || u.role,
              source: 'HEAT.Session.CurrentUser'
            };
          }
        }
      }

      // 2. Check for ExtJS Application (Ivanti often uses ExtJS)
      if (window.Ext && window.Ext.application) {
        console.log("✅ ServiceIT: Found Ext.application");
        const app = window.Ext.application;
        console.log("🔍 ServiceIT: Ext.application keys:", Object.keys(app));
        
        // Try to find user in ExtJS app
        if (app.currentUser) {
          console.log("✅ ServiceIT: Found Ext.application.currentUser:", app.currentUser);
          return {
            recId: app.currentUser.RecId || app.currentUser.id,
            loginId: app.currentUser.LoginId || app.currentUser.username,
            fullName: app.currentUser.DisplayName || app.currentUser.name,
            source: 'Ext.application.currentUser'
          };
        }
      }

      // 3. Check for global user variables (common patterns)
      const globalUserVars = ['currentUser', 'user', 'loggedInUser', 'sessionUser', 'g_user'];
      for (const varName of globalUserVars) {
        if (window[varName]) {
          console.log(`✅ ServiceIT: Found window.${varName}:`, window[varName]);
          const u = window[varName];
          return {
            recId: u.RecId || u.recId || u.id || u.userId,
            loginId: u.LoginId || u.loginId || u.username || u.email,
            fullName: u.DisplayName || u.displayName || u.name || u.fullName,
            source: `window.${varName}`
          };
        }
      }

      // 4. Older Global Variables
      if (window.g_session_user_id) {
        console.log("✅ ServiceIT: Found window.g_session_user_id:", window.g_session_user_id);
        return { loginId: window.g_session_user_id, source: 'window.g_session_user_id' };
      }

      // 5. Neurons / App Object
      if (window.app && window.app.user) {
        console.log("✅ ServiceIT: Found window.app.user:", window.app.user);
        return {
          recId: window.app.user.id || window.app.user.userId,
          loginId: window.app.user.username,
          fullName: window.app.user.name,
          source: 'window.app.user'
        };
      }

      // 6. LocalStorage / SessionStorage Scan
      // Check for OIDC user (common in Neurons)
      const oidcUser = localStorage.getItem('oidc.user');
      if (oidcUser) {
        try {
          const parsed = JSON.parse(oidcUser);
          console.log("✅ ServiceIT: Found localStorage oidc.user:", parsed);
          if (parsed && parsed.profile) {
            return {
              recId: parsed.profile.sub || parsed.profile.id,
              loginId: parsed.profile.preferred_username || parsed.profile.email,
              fullName: parsed.profile.name,
              email: parsed.profile.email,
              source: 'localStorage:oidc.user'
            };
          }
        } catch(e) {
          console.error("ServiceIT: Error parsing oidc.user:", e);
        }
      }

      // 7. Check all localStorage keys for user data
      if (attempts === 5) {
        console.log("🔍 ServiceIT: LocalStorage keys:", Object.keys(localStorage));
        const allLocalKeys = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key) allLocalKeys.push(key);
        }
        console.log("🔍 ServiceIT: All localStorage keys:", allLocalKeys);
        
        for (const key of allLocalKeys) {
          const value = localStorage.getItem(key);
          console.log(`🔍 ServiceIT: localStorage['${key}']:`, value?.substring(0, 300));
          
          // Try to parse as JSON
          if (value) {
            try {
              const parsed = JSON.parse(value);
              if (parsed && typeof parsed === 'object') {
                console.log(`  ✅ Successfully parsed as JSON:`, parsed);
                
                // Look for user data in parsed object
                if (parsed.user || parsed.profile || parsed.displayName || parsed.email) {
                  console.log("  🎯 FOUND USER DATA IN LOCALSTORAGE!");
                  return {
                    recId: parsed.recId || parsed.id || parsed.userId,
                    loginId: parsed.loginId || parsed.email || parsed.username,
                    fullName: parsed.displayName || parsed.name || parsed.fullName,
                    email: parsed.email,
                    source: `localStorage:${key}`
                  };
                }
              }
            } catch (e) {
              // Not JSON, skip
            }
          }
        }
      }

      // 8. Check sessionStorage
      if (attempts === 5) {
        console.log("🔍 ServiceIT: SessionStorage keys:", Object.keys(sessionStorage));
        const allSessionKeys = [];
        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i);
          if (key) allSessionKeys.push(key);
        }
        console.log("🔍 ServiceIT: All sessionStorage keys:", allSessionKeys);
        
        for (const key of allSessionKeys) {
          const value = sessionStorage.getItem(key);
          console.log(`🔍 ServiceIT: sessionStorage['${key}']:`, value?.substring(0, 300));
          
          // Try to parse as JSON
          if (value) {
            try {
              const parsed = JSON.parse(value);
              if (parsed && typeof parsed === 'object') {
                console.log(`  ✅ Successfully parsed as JSON:`, parsed);
                
                // Look for user data
                if (parsed.user || parsed.profile || parsed.displayName || parsed.email) {
                  console.log("  🎯 FOUND USER DATA IN SESSIONSTORAGE!");
                  return {
                    recId: parsed.recId || parsed.id || parsed.userId,
                    loginId: parsed.loginId || parsed.email || parsed.username,
                    fullName: parsed.displayName || parsed.name || parsed.fullName,
                    email: parsed.email,
                    source: `sessionStorage:${key}`
                  };
                }
              }
            } catch (e) {
              // Not JSON, skip
            }
          }
        }
      }
      
      // 9. Check for ASP.NET page data (Ivanti Neurons uses ASP.NET)
      if (attempts === 10 && typeof __Page !== 'undefined') {
        console.log("✅ ServiceIT: Found __Page object:", __Page);
        if (__Page.user || __Page.currentUser) {
          const u = __Page.user || __Page.currentUser;
          return {
            recId: u.RecId || u.recId,
            loginId: u.LoginId || u.loginId,
            fullName: u.DisplayName || u.displayName,
            source: '__Page'
          };
        }
      }

    } catch (e) {
      console.error("ServiceIT: Scan error", e);
    }
    return null;
  }

  const poller = setInterval(async () => {
    attempts++;
    const user = await scanForUser();
    
    if (user) {
      clearInterval(poller);
      console.log("ServiceIT: Inject found user!", user);
      window.postMessage({ type: 'SERVICEIT_USER_DETECTED', user: user }, '*');
    } else if (attempts >= maxAttempts) {
      clearInterval(poller);
      console.log("ServiceIT: Inject timed out looking for user object");
    }
  }, 500);

})();
