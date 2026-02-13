#!/usr/bin/env bash
set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get the root directory (parent of scripts)
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo -e "${BLUE}=== Dependency Update Script ===${NC}\n"

# Parse arguments
INTERACTIVE=false
CHECK_ONLY=false
RUN_TESTS=false
RUN_BUILD=false

while [[ $# -gt 0 ]]; do
  case $1 in
    -i|--interactive)
      INTERACTIVE=true
      shift
      ;;
    -c|--check-only)
      CHECK_ONLY=true
      shift
      ;;
    -t|--test)
      RUN_TESTS=true
      shift
      ;;
    -b|--build)
      RUN_BUILD=true
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  -i, --interactive   Interactive mode (review changes before applying)"
      echo "  -c, --check-only    Only check for outdated dependencies"
      echo "  -t, --test          Run tests after updating"
      echo "  -b, --build         Run build after updating"
      echo "  -h, --help          Show this help message"
      echo ""
      echo "Examples:"
      echo "  $0                  # Update all dependencies automatically"
      echo "  $0 -c               # Check for outdated dependencies"
      echo "  $0 -i -t -b         # Interactive update with tests and build"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

# Step 1: Check for outdated dependencies
echo -e "${YELLOW}📋 Checking for outdated dependencies...${NC}\n"
pnpm outdated -r || true
echo ""

if [ "$CHECK_ONLY" = true ]; then
  echo -e "${GREEN}✅ Check complete. Use without -c flag to update.${NC}"
  exit 0
fi

# Create a helper Node.js script to update the catalog
UPDATE_CATALOG_SCRIPT=$(cat <<'EOF'
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const workspaceFile = path.join(process.cwd(), 'pnpm-workspace.yaml');
const content = fs.readFileSync(workspaceFile, 'utf8');

// Get outdated packages info
let outdatedInfo = {};
try {
  const outdatedOutput = execSync('pnpm outdated -r --format json', {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  });

  // Parse the JSON object (not line-delimited)
  const outdatedData = JSON.parse(outdatedOutput);

  // Extract latest versions
  for (const [pkgName, info] of Object.entries(outdatedData)) {
    if (info.latest) {
      outdatedInfo[pkgName] = info.latest;
    }
  }
} catch (e) {
  // pnpm outdated returns non-zero when packages are outdated
  // Try to parse stdout if available
  const output = e.stdout?.toString() || '';
  if (output) {
    try {
      const outdatedData = JSON.parse(output);
      for (const [pkgName, info] of Object.entries(outdatedData)) {
        if (info.latest) {
          outdatedInfo[pkgName] = info.latest;
        }
      }
    } catch (parseErr) {
      console.error('Failed to parse outdated info:', parseErr.message);
    }
  }
}

// Debug: show what we found
console.log('Found outdated packages:');
for (const [pkg, version] of Object.entries(outdatedInfo)) {
  console.log(`  ${pkg}: ${version}`);
}
console.log('');

// Update catalog entries
let updatedContent = content;
let updatedCount = 0;

const catalogMatch = content.match(/^catalog:\s*$/m);
if (catalogMatch) {
  const lines = content.split('\n');
  const catalogIndex = lines.findIndex(line => /^catalog:\s*$/.test(line));

  for (let i = catalogIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    // Check if we're still in the catalog section (lines starting with spaces)
    if (!line.startsWith('  ') && line.trim() !== '') {
      break;
    }

    // Parse catalog entry: extract package name and version
    // Formats:
    //   "package-name": "^version"
    //   "@scope/package": "^version"
    //   package-name: "^version"
    const match = line.match(/^\s+"?([^":]+)"?\s*:\s*"([~^]?)(.+)"$/);
    if (match) {
      const pkgName = match[1];
      const semverPrefix = match[2]; // ^ or ~ or empty
      const currentVersion = match[3];

      if (outdatedInfo[pkgName]) {
        const newVersion = outdatedInfo[pkgName];
        // Replace just the version number, keeping the prefix
        const newLine = line.replace(
          `"${semverPrefix}${currentVersion}"`,
          `"${semverPrefix}${newVersion}"`
        );

        if (newLine !== line) {
          lines[i] = newLine;
          updatedCount++;
          console.log(`✓ ${pkgName}: ${currentVersion} → ${newVersion}`);
        }
      }
    }
  }

  updatedContent = lines.join('\n');
}

if (updatedCount > 0) {
  fs.writeFileSync(workspaceFile, updatedContent, 'utf8');
  console.log(`\n✅ Updated ${updatedCount} packages in catalog`);
} else {
  console.log('ℹ️  No catalog updates needed (catalog already up to date or no matching packages found)');
}
EOF
)

# Step 2: Update catalog using pnpm native approach
echo -e "${YELLOW}📦 Updating catalog in pnpm-workspace.yaml...${NC}\n"

if [ "$INTERACTIVE" = true ]; then
  echo -e "${YELLOW}Interactive mode: Review catalog changes${NC}"
  echo -e "Current outdated packages shown above. Do you want to update the catalog? (y/n)"
  read -r response
  if [[ ! "$response" =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Catalog update skipped${NC}\n"
  else
    node -e "$UPDATE_CATALOG_SCRIPT"
  fi
else
  node -e "$UPDATE_CATALOG_SCRIPT"
fi

echo ""

# Step 3: Update dependencies using pnpm
echo -e "${YELLOW}📥 Updating and installing dependencies...${NC}\n"

if [ "$INTERACTIVE" = true ]; then
  # In interactive mode, use pnpm update with interactive flag if available
  pnpm update --latest -r
else
  # Auto-update all dependencies
  pnpm update --latest -r
fi

echo ""
echo -e "${GREEN}✅ Dependencies updated successfully!${NC}\n"

# Step 4: Run tests if requested
if [ "$RUN_TESTS" = true ]; then
  echo -e "${YELLOW}🧪 Running tests...${NC}\n"
  if pnpm test; then
    echo -e "${GREEN}✅ Tests passed!${NC}\n"
  else
    echo -e "${RED}❌ Tests failed. Please review the changes.${NC}\n"
    exit 1
  fi
fi

# Step 5: Run build if requested
if [ "$RUN_BUILD" = true ]; then
  echo -e "${YELLOW}🔨 Running build...${NC}\n"
  if pnpm build; then
    echo -e "${GREEN}✅ Build successful!${NC}\n"
  else
    echo -e "${RED}❌ Build failed. Please review the changes.${NC}\n"
    exit 1
  fi
fi

echo -e "${BLUE}=== Summary ===${NC}"
echo -e "Catalog: ${GREEN}Updated in pnpm-workspace.yaml${NC}"
echo -e "Dependencies: ${GREEN}Updated using pnpm update --latest -r${NC}"
echo -e "Installation: ${GREEN}Complete${NC}"

if [ "$RUN_TESTS" = true ]; then
  echo -e "Tests: ${GREEN}Passed${NC}"
fi

if [ "$RUN_BUILD" = true ]; then
  echo -e "Build: ${GREEN}Successful${NC}"
fi

echo ""
echo -e "${GREEN}🎉 All done!${NC}"
