#!/bin/bash
# Create test pack files for Git pack examples
#
# Usage: ./create-test-pack.sh [output-directory]
#
# This script creates a temporary Git repository, adds several
# commits with various object types, then extracts the pack files.

set -e

# Get absolute path for output directory
OUTPUT_DIR="${1:-.}"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"

echo "Creating test pack files..."
echo "Output directory: $OUTPUT_DIR"

# Create temporary directory
TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

cd "$TMPDIR"

# Initialize git repo
git init --initial-branch=main > /dev/null 2>&1

# Configure git for this repo
git config user.email "test@example.com"
git config user.name "Test User"

# Create various file types for testing
echo "Creating initial files..."

# Create text files
cat > README.md << 'EOF'
# Test Repository

This is a test repository for demonstrating Git pack file operations.

## Contents

- Various text files
- Source code
- Multiple commits with changes
EOF

cat > hello.txt << 'EOF'
Hello, World!
This is a simple text file.
EOF

# Create directory structure
mkdir -p src

cat > src/main.js << 'EOF'
/**
 * Main application entry point
 */
function main() {
  console.log("Hello from main!");
  return 0;
}

module.exports = { main };
EOF

cat > src/utils.js << 'EOF'
/**
 * Utility functions
 */
function greet(name) {
  return `Hello, ${name}!`;
}

function add(a, b) {
  return a + b;
}

module.exports = { greet, add };
EOF

# Initial commit
git add .
git commit -m "Initial commit with basic project structure"

echo "Creating additional commits for delta testing..."

# Make several commits to create delta opportunities
for i in {1..5}; do
  # Modify hello.txt slightly (good for deltas)
  echo "Line $i added to the file" >> hello.txt

  # Modify source file
  echo "// Comment $i" >> src/main.js

  git add .
  git commit -m "Update $i: Add line to files"
done

# Create a larger file
echo "Creating larger file..."
for i in {1..100}; do
  echo "This is line number $i in the large file with some padding content to make it bigger" >> large.txt
done
git add large.txt
git commit -m "Add large text file"

# Create an annotated tag
git tag -a v1.0 -m "Version 1.0 release"

# Force garbage collection to create pack files
echo "Running git gc..."
git gc --aggressive > /dev/null 2>&1

# Find the pack file
PACK_FILE=$(ls .git/objects/pack/*.pack 2>/dev/null | head -1)
IDX_FILE=$(ls .git/objects/pack/*.idx 2>/dev/null | head -1)

if [ -z "$PACK_FILE" ] || [ -z "$IDX_FILE" ]; then
  echo "Error: Pack files not created"
  exit 1
fi

# Copy pack files to output directory
# Create git-repo subdirectory if needed
mkdir -p "$OUTPUT_DIR/git-repo"
cp "$PACK_FILE" "$OUTPUT_DIR/git-repo/test.pack"
cp "$IDX_FILE" "$OUTPUT_DIR/git-repo/test.idx"

# Set proper permissions (git creates pack files as read-only)
chmod 644 "$OUTPUT_DIR/git-repo/test.pack" "$OUTPUT_DIR/git-repo/test.idx"

# Report results
echo ""
echo "Created test pack files:"
echo "  Pack: $OUTPUT_DIR/git-repo/test.pack ($(du -h "$OUTPUT_DIR/git-repo/test.pack" | cut -f1))"
echo "  Index: $OUTPUT_DIR/git-repo/test.idx ($(du -h "$OUTPUT_DIR/git-repo/test.idx" | cut -f1))"
echo ""

# Show pack contents
echo "Pack contents:"
git verify-pack -v "$OUTPUT_DIR/git-repo/test.pack" 2>/dev/null | head -20
if [ $(git verify-pack -v "$OUTPUT_DIR/git-repo/test.pack" 2>/dev/null | wc -l) -gt 20 ]; then
  echo "... (truncated)"
fi

echo ""
echo "Done!"
