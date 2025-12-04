// DEBUG SCRIPT: Check Knowledge Base Contents
// Paste this in the browser console to see what's currently stored

(async () => {
  console.log('%c[DEBUG] Checking Knowledge Base...', 'color: #f59e0b; font-weight: bold; font-size: 14px;');
  
  try {
    const result = await chrome.storage.local.get(['ivanti_knowledge_base']);
    const kb = result.ivanti_knowledge_base;
    
    if (!kb) {
      console.log('%c[DEBUG] ❌ No knowledge base found!', 'color: #ef4444; font-weight: bold;');
      console.log('Solution: Reload the extension to build a new knowledge base.');
      return;
    }
    
    console.log('%c[DEBUG] ✅ Knowledge Base Found:', 'color: #10b981; font-weight: bold;');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // Summary
    console.log(`📊 Total Employees: ${kb.employees?.length || 0}`);
    console.log(`🎫 Total Incidents: ${kb.incidents?.length || 0}`);
    console.log(`📂 Total Categories: ${kb.categories?.length || 0}`);
    console.log(`🔧 Total Services: ${kb.services?.length || 0}`);
    console.log(`👥 Total Teams: ${kb.teams?.length || 0}`);
    console.log(`🏢 Total Departments: ${kb.departments?.length || 0}`);
    console.log(`📝 User Tickets: ${kb.userTickets?.length || 0}`);
    console.log(`⏰ Last Updated: ${new Date(kb.lastUpdated).toLocaleString()}`);
    console.log(`📦 KB Version: ${kb.version}`);
    
    const ageInSeconds = Math.floor((Date.now() - kb.lastUpdated) / 1000);
    console.log(`⏱️  Age: ${ageInSeconds} seconds (${Math.floor(ageInSeconds / 60)} minutes)`);
    
    // Check storage size
    const kbSize = new Blob([JSON.stringify(kb)]).size;
    const kbSizeKB = (kbSize / 1024).toFixed(2);
    const kbSizeMB = (kbSize / 1024 / 1024).toFixed(2);
    console.log(`💾 Storage Size: ${kbSizeKB} KB (${kbSizeMB} MB)`);
    
    // Chrome storage quota
    const quota = await chrome.storage.local.getBytesInUse();
    const quotaMB = (quota / 1024 / 1024).toFixed(2);
    console.log(`📊 Total Storage Used: ${quotaMB} MB / 10 MB limit`);
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // Search for specific employees
    console.log('%c[DEBUG] Searching for "Lance"...', 'color: #3b82f6; font-weight: bold;');
    const lanceResults = kb.employees?.filter(emp => 
      emp.DisplayName?.toLowerCase().includes('lance') ||
      emp.LoginID?.toLowerCase().includes('lance') ||
      emp.PrimaryEmail?.toLowerCase().includes('lance')
    );
    
    if (lanceResults && lanceResults.length > 0) {
      console.log(`%c[DEBUG] ✅ Found ${lanceResults.length} employee(s) matching "Lance":`, 'color: #10b981; font-weight: bold;');
      lanceResults.forEach((emp, i) => {
        console.log(`${i + 1}. ${emp.DisplayName} (${emp.PrimaryEmail || emp.LoginID}) - ${emp.Status}`);
      });
    } else {
      console.log('%c[DEBUG] ❌ No employees found matching "Lance"', 'color: #ef4444; font-weight: bold;');
      console.log('Possible reasons:');
      console.log('1. Lance Nunez is not in the first 99 employees fetched');
      console.log('2. The name might be spelled differently in Ivanti');
      console.log('3. The employee might be inactive or in a different status');
      console.log('');
      console.log('Solution: Reload the extension to fetch more employees (200-500)');
    }
    
    // Show first 10 employees as sample
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('%c[DEBUG] Sample Employees (first 10):', 'color: #8b5cf6; font-weight: bold;');
    kb.employees?.slice(0, 10).forEach((emp, i) => {
      console.log(`${i + 1}. ${emp.DisplayName} (${emp.PrimaryEmail || emp.LoginID})`);
    });
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('%c[DEBUG] To reload the extension and fetch more data:', 'color: #f59e0b; font-weight: bold;');
    console.log('1. Go to chrome://extensions/');
    console.log('2. Click the refresh icon on "Service IT Plus Assistant"');
    console.log('3. Refresh this page');
    console.log('4. Wait for the loading screen to complete');
    console.log('5. Run this debug script again to verify more employees were loaded');
    
  } catch (error) {
    console.error('%c[DEBUG] ❌ Error:', 'color: #ef4444; font-weight: bold;', error);
  }
})();

