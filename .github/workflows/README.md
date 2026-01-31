# CI/CD Pipeline - Production Safety Checks

## Overview

This directory contains GitHub Actions workflows that automatically check for mock data, temporary code, and other issues before deployment.

## Workflows

### 1. `production-checks.yml` ⛔ BLOCKING
**Triggers:** PRs to `main`, `master`, `production`, or `release/*` branches

**Checks:**
- ❌ **Mock Data Detection** (BLOCKS deployment)
  - Scans for `Math.random()` in Widget components
  - Scans for hardcoded credentials
  - Fails build if found

- 🎨 **Frontend Linting**
  - ESLint checks
  - TypeScript type checking

- 🐍 **Backend Linting**
  - Flake8 (Python errors)
  - Black (code formatting)

- 🔒 **Security Scan**
  - Trivy vulnerability scanner
  - Critical/High severity issues

**Result:** Build FAILS if any check fails. Code CANNOT be deployed.

---

### 2. `dev-checks.yml` ⚠️ WARNING ONLY
**Triggers:** PRs to `dev`, `develop`, or `feature/*` branches

**Checks:**
- ⚠️  **Mock Data Warning** (Non-blocking)
  - Warns about mock data but doesn't fail
  - Posts comment on PR

- 🧪 **Quick Tests**
  - Frontend build test
  - Basic validation

**Result:** Build passes even with warnings. Reminds developers to clean up.

---

## How It Works

### Branch Protection Strategy

```
Production Branches (main/master/production)
├─ ⛔ STRICT CHECKS (blocking)
├─ ❌ Fails on mock data
└─ ✅ Only clean code can merge

Development Branches (dev/feature/*)
├─ ⚠️  LOOSE CHECKS (warnings)
├─ 💡 Reminds about cleanup
└─ ✅ Allows mock data for testing
```

### Mock Data Detection Script

**Location:** `scripts/check-mock-data.sh`

**Scans for:**
- `Math.random()` in `web/src/components/Widgets/`
- `TODO: REMOVE MOCK DATA` markers
- `TEMPORARY` markers
- `Demo data` comments
- Hardcoded test credentials

**Exit codes:**
- `0` - No issues found ✅
- `1` - Errors found (blocks production) ❌

---

## Testing Locally

### Run the check manually:
```bash
# From project root
bash scripts/check-mock-data.sh
```

### Test on specific files:
```bash
# Check only Widget components
grep -r "Math.random()" web/src/components/Widgets/
```

---

## Bypassing Checks (Emergency Only!)

⚠️ **NOT RECOMMENDED** - Only use in emergencies!

### Option 1: Skip CI (GitHub)
```bash
git commit -m "Emergency fix [skip ci]"
```

### Option 2: Force merge (Admins only)
- Temporarily disable branch protection
- Merge manually
- Re-enable branch protection
- **Create ticket to fix immediately**

---

## Maintenance

### Adding new checks:

**Edit:** `scripts/check-mock-data.sh`

```bash
# Add new pattern check
check_pattern \
  "YOUR_PATTERN" \
  "error" \  # or "warning"
  "Description of what you're checking" \
  "path/to/scan/"
```

### Updating workflows:

**Edit:** `.github/workflows/production-checks.yml`

Add new job:
```yaml
new-check:
  name: 🔥 New Check
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - run: your-command-here
```

---

## Current Status

| Check | Status | Severity | Blocks Prod? |
|-------|--------|----------|--------------|
| Math.random() detection | ✅ Active | ERROR | Yes |
| TODO markers | ✅ Active | WARNING | No |
| TEMPORARY markers | ✅ Active | WARNING | No |
| Test credentials | ✅ Active | ERROR | Yes |
| Frontend linting | ✅ Active | ERROR | Yes |
| Backend linting | ✅ Active | ERROR | Yes |
| Security scan | ✅ Active | ERROR | Yes |

---

## Troubleshooting

### Build failing on mock data?

1. Check the error output:
   ```
   ❌ ERROR: Found Math.random() in Widget components (MOCK DATA)
   web/src/components/Widgets/KPICard.tsx:62:const mockValue = Math.random() * 100;
   ```

2. Remove the mock data:
   - See `CLEANUP_TODO.md` for instructions
   - Replace with real API call
   - Test thoroughly

3. Re-run checks:
   ```bash
   bash scripts/check-mock-data.sh
   ```

### False positive?

If the script incorrectly flags valid code:

1. Add exclusion to script:
   ```bash
   # Exclude specific file
   grep -r "Math.random()" web/src/ --exclude="ValidFile.tsx"
   ```

2. Or use different pattern matching
3. Document the exception in `CLEANUP_TODO.md`

---

## Future Enhancements

- [ ] Automated tests for widgets
- [ ] E2E tests in CI
- [ ] Performance benchmarks
- [ ] Bundle size checks
- [ ] Deployment preview environments
- [ ] Automated dependency updates

---

**Last Updated:** 2026-01-31
**Maintainer:** Development Team
