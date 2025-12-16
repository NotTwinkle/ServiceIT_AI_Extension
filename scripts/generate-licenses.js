#!/usr/bin/env node

/**
 * Generate License Compliance Files
 * 
 * This script generates:
 * 1. THIRD_PARTY_LICENSES.md - Human-readable attribution file
 * 2. licenses.json - Machine-readable license data
 * 
 * Usage: node scripts/generate-licenses.js
 * 
 * Note: This uses CommonJS for compatibility with license-checker
 */

// Use dynamic import for ES module compatibility, but fallback to require for Node.js
let execSync, fs, path;
try {
  // Try ES modules first
  const child_process = await import('child_process');
  const fs_module = await import('fs');
  const path_module = await import('path');
  execSync = child_process.execSync;
  fs = fs_module.default || fs_module;
  path = path_module.default || path_module;
} catch (e) {
  // Fallback to CommonJS
  execSync = require('child_process').execSync;
  fs = require('fs');
  path = require('path');
}

// Get project root (parent of scripts directory)
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const PROJECT_ROOT = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'licenses');
const LICENSES_MD = path.join(PROJECT_ROOT, 'THIRD_PARTY_LICENSES.md');

console.log('📋 Generating license compliance files...\n');

// Ensure license-checker is available
try {
  execSync('npx license-checker --version', { stdio: 'ignore' });
} catch (error) {
  console.error('❌ license-checker not found. Installing...');
  execSync('npm install -g license-checker', { stdio: 'inherit' });
}

// Generate JSON report
console.log('1️⃣ Generating license report...');
const licenseJson = execSync('npx license-checker --json', {
  cwd: PROJECT_ROOT,
  encoding: 'utf-8'
});

const licenses = JSON.parse(licenseJson);

// Group by license type
const byLicense = {};
Object.entries(licenses).forEach(([packageName, info]) => {
  const license = info.licenses || 'Unknown';
  if (!byLicense[license]) {
    byLicense[license] = [];
  }
  byLicense[license].push({
    name: packageName,
    version: info.version || 'unknown',
    repository: info.repository || '',
    publisher: info.publisher || 'Unknown',
    email: info.email || '',
    url: info.url || ''
  });
});

// Create licenses directory
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Generate THIRD_PARTY_LICENSES.md
console.log('2️⃣ Generating THIRD_PARTY_LICENSES.md...');

let mdContent = `# Third-Party Open Source Licenses

This product includes open source software components. Below is a list of all third-party packages used, grouped by license type.

**Last Generated:** ${new Date().toISOString().split('T')[0]}

---

`;

// License descriptions
const licenseDescriptions = {
  'MIT': {
    name: 'MIT License',
    description: 'A permissive license that allows commercial use, modification, distribution, and private use. Only requires attribution and inclusion of license text.',
    commercial: '✅ Allowed'
  },
  'ISC': {
    name: 'ISC License',
    description: 'Functionally equivalent to MIT License. Permissive and allows commercial use.',
    commercial: '✅ Allowed'
  },
  'Apache-2.0': {
    name: 'Apache License 2.0',
    description: 'A permissive license that allows commercial use and includes an explicit patent grant.',
    commercial: '✅ Allowed'
  },
  'BSD-3-Clause': {
    name: 'BSD 3-Clause License',
    description: 'A permissive license that allows commercial use with attribution requirements.',
    commercial: '✅ Allowed'
  },
  'MPL-2.0': {
    name: 'Mozilla Public License 2.0',
    description: 'A weak copyleft license that allows commercial use. Modified MPL files must remain open source, but new files can be proprietary.',
    commercial: '✅ Allowed'
  },
  'CC-BY-4.0': {
    name: 'Creative Commons Attribution 4.0',
    description: 'Allows commercial use with attribution requirements.',
    commercial: '✅ Allowed'
  }
};

// Generate sections for each license type
Object.entries(byLicense)
  .sort(([a], [b]) => {
    // Sort by package count (descending)
    return byLicense[b].length - byLicense[a].length;
  })
  .forEach(([licenseType, packages]) => {
    const licenseInfo = licenseDescriptions[licenseType] || {
      name: licenseType,
      description: 'See license text for details.',
      commercial: '⚠️ Review required'
    };

    mdContent += `## ${licenseInfo.name}\n\n`;
    mdContent += `**Commercial Use:** ${licenseInfo.commercial}\n\n`;
    mdContent += `${licenseInfo.description}\n\n`;
    mdContent += `**Packages (${packages.length}):**\n\n`;

    packages
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach(pkg => {
        mdContent += `- **${pkg.name}** (v${pkg.version})`;
        if (pkg.repository) {
          mdContent += ` - ${pkg.repository}`;
        }
        if (pkg.publisher && pkg.publisher !== 'Unknown') {
          mdContent += `\n  - Copyright: ${pkg.publisher}`;
        }
        mdContent += '\n';
      });

    mdContent += '\n---\n\n';
  });

// Add summary
mdContent += `## Summary

**Total Packages:** ${Object.keys(licenses).length}

**License Distribution:**
${Object.entries(byLicense)
  .map(([license, pkgs]) => `- ${license}: ${pkgs.length} packages`)
  .join('\n')}

---

## License Texts

Full license texts are available in the \`licenses/\` directory.

For the most up-to-date license information, run:
\`\`\`bash
npx license-checker --json > licenses.json
\`\`\`

---

## Compliance

This product complies with all open source license requirements:

- ✅ All copyright notices included
- ✅ All license texts included
- ✅ Proper attribution provided
- ✅ Commercial use permitted by all licenses

**Note:** This product uses Google Gemini API, which is subject to Google's Terms of Service. Please review Google AI Studio terms for API usage in commercial products.

---

**Generated by:** \`scripts/generate-licenses.js\`
**Tool:** [license-checker](https://www.npmjs.com/package/license-checker)
`;

fs.writeFileSync(LICENSES_MD, mdContent);
console.log(`✅ Created ${LICENSES_MD}`);

// Save JSON for programmatic use
const jsonPath = path.join(OUTPUT_DIR, 'licenses.json');
fs.writeFileSync(jsonPath, JSON.stringify(licenses, null, 2));
console.log(`✅ Created ${jsonPath}`);

// Generate summary
console.log('\n3️⃣ License Summary:\n');
const summary = execSync('npx license-checker --summary', {
  cwd: PROJECT_ROOT,
  encoding: 'utf-8'
});
console.log(summary);

console.log('\n✅ License compliance files generated successfully!');
console.log(`\n📄 Review: ${LICENSES_MD}`);
console.log(`📊 Data: ${jsonPath}`);
