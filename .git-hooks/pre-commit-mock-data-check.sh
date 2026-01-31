#!/bin/bash
# Pre-commit hook to check for mock data before production commits
# To enable: cp .git-hooks/pre-commit-mock-data-check.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit

echo "🔍 Checking for mock data and TODO markers..."

# Check for Math.random() in widget components
if git diff --cached --name-only | grep -q "web/src/components/Widgets/"; then
  if git diff --cached | grep -q "Math.random()"; then
    echo "⚠️  WARNING: Found Math.random() in widget components"
    echo "   This appears to be mock data. Is this intentional?"
    echo ""
    read -p "   Continue commit anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      echo "❌ Commit aborted. Remove mock data or use -n flag to bypass hooks."
      exit 1
    fi
  fi
fi

# Check for TODO: REMOVE MOCK DATA markers
if git diff --cached | grep -q "TODO: REMOVE MOCK DATA"; then
  echo "📝 Found TODO: REMOVE MOCK DATA markers in staged files"
  echo "   Remember to clean these up before production!"
fi

# Check for TEMPORARY markers
if git diff --cached | grep -q "TEMPORARY"; then
  echo "📝 Found TEMPORARY code markers in staged files"
fi

echo "✅ Pre-commit checks passed"
exit 0
