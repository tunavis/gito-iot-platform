#!/bin/bash
# Script to detect mock data and temporary code in the codebase
# Used by CI/CD pipeline to prevent mock data from reaching production

set -e  # Exit on error

echo "=================================================="
echo "🔍 Scanning for Mock Data & Temporary Code"
echo "=================================================="
echo ""

EXIT_CODE=0
WARNINGS=0
ERRORS=0

# Colors for output
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# Function to check for patterns
check_pattern() {
  local pattern=$1
  local severity=$2  # "error" or "warning"
  local description=$3
  local files=$4

  echo "Checking: $description..."

  if grep -r "$pattern" $files 2>/dev/null; then
    if [ "$severity" = "error" ]; then
      echo -e "${RED}❌ ERROR: Found $description${NC}"
      ERRORS=$((ERRORS + 1))
      EXIT_CODE=1
    else
      echo -e "${YELLOW}⚠️  WARNING: Found $description${NC}"
      WARNINGS=$((WARNINGS + 1))
    fi
    echo ""
  else
    echo -e "${GREEN}✅ No $description found${NC}"
    echo ""
  fi
}

# Check Widget components for Math.random()
check_pattern \
  "Math.random()" \
  "error" \
  "Math.random() in Widget components (MOCK DATA)" \
  "web/src/components/Widgets/"

# Check for TODO: REMOVE MOCK DATA markers
check_pattern \
  "TODO: REMOVE MOCK DATA" \
  "warning" \
  "TODO: REMOVE MOCK DATA markers" \
  "web/src/"

# Check for TEMPORARY markers
check_pattern \
  "TEMPORARY" \
  "warning" \
  "TEMPORARY code markers" \
  "web/src/"

# Check for hardcoded demo data
check_pattern \
  "Demo data" \
  "warning" \
  "Demo data comments" \
  "web/src/components/"

# Check for commented out real implementations (sign that mock data might be active)
check_pattern \
  "REAL IMPLEMENTATION" \
  "warning" \
  "Commented REAL IMPLEMENTATION (might indicate active mock data)" \
  "web/src/components/Widgets/"

# Check for test/mock user credentials in code (excluding Sidebar display)
echo "Checking: Hardcoded test credentials..."
if grep -r "admin@gito.demo\|test@test.com" web/src/ api/app/ \
   --exclude="Sidebar.tsx" \
   --exclude="Sidebar_old.tsx" \
   --exclude-dir="__tests__" 2>/dev/null; then
  echo -e "${RED}❌ ERROR: Found Hardcoded test credentials${NC}"
  ERRORS=$((ERRORS + 1))
  EXIT_CODE=1
  echo ""
else
  echo -e "${GREEN}✅ No Hardcoded test credentials found${NC}"
  echo ""
fi

# Summary
echo "=================================================="
echo "📊 Scan Summary"
echo "=================================================="
echo -e "Errors: ${RED}$ERRORS${NC}"
echo -e "Warnings: ${YELLOW}$WARNINGS${NC}"
echo ""

if [ $ERRORS -gt 0 ]; then
  echo -e "${RED}❌ BUILD FAILED: Mock data or temporary code detected!${NC}"
  echo ""
  echo "This code cannot be deployed to production."
  echo "Please:"
  echo "  1. Remove all Math.random() from Widget components"
  echo "  2. Replace with real API calls"
  echo "  3. Remove hardcoded credentials"
  echo "  4. Check CLEANUP_TODO.md for details"
  echo ""
  exit $EXIT_CODE
elif [ $WARNINGS -gt 0 ]; then
  echo -e "${YELLOW}⚠️  BUILD PASSED WITH WARNINGS${NC}"
  echo ""
  echo "Consider cleaning up:"
  echo "  - TODO markers"
  echo "  - TEMPORARY code"
  echo "  - Demo data comments"
  echo ""
  exit 0
else
  echo -e "${GREEN}✅ ALL CHECKS PASSED - No mock data detected!${NC}"
  echo ""
  exit 0
fi
