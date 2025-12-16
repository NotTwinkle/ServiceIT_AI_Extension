#!/bin/bash

# Generate License Compliance Files
# This script generates THIRD_PARTY_LICENSES.md and license reports

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "📋 Generating license compliance files..."
echo ""

# Check if license-checker is available
if ! command -v license-checker &> /dev/null; then
    echo "⚠️  license-checker not found. Installing..."
    npm install -g license-checker
fi

# Create licenses directory
mkdir -p licenses

# Generate summary
echo "1️⃣ Generating license summary..."
npx license-checker --summary > licenses/summary.txt
cat licenses/summary.txt

# Generate JSON report
echo ""
echo "2️⃣ Generating license report (JSON)..."
npx license-checker --json > licenses/licenses.json

# Generate CSV report
echo "3️⃣ Generating license report (CSV)..."
npx license-checker --csv > licenses/licenses.csv

# Verify licenses
echo ""
echo "4️⃣ Verifying license compliance..."
if npx license-checker --onlyAllow "MIT;ISC;Apache-2.0;BSD-3-Clause;MPL-2.0;CC-BY-4.0" 2>/dev/null; then
    echo "✅ All licenses are commercial-friendly!"
else
    echo "⚠️  Some packages have non-standard licenses. Review manually."
fi

echo ""
echo "✅ License files generated in licenses/ directory"
echo "📄 Review: licenses/licenses.json"
echo "📊 Summary: licenses/summary.txt"
