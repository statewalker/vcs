#!/bin/bash
# Verify pack file integrity using native git
#
# Usage: ./verify-pack.sh <pack-file>
#
# This script uses git verify-pack to check:
# - Pack file structure validity
# - Object checksums
# - Delta chain integrity
# - Index consistency (if .idx exists)

set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <pack-file>"
  echo ""
  echo "Examples:"
  echo "  $0 ./git-repo/test.pack"
  echo "  $0 ./git-repo/test.pack.repacked"
  exit 1
fi

PACK_FILE="$1"

# Check if pack file exists
if [ ! -f "$PACK_FILE" ]; then
  echo "Error: Pack file not found: $PACK_FILE"
  exit 1
fi

# Get corresponding index file
IDX_FILE="${PACK_FILE%.pack}.idx"

echo "=== Git Pack Verification ==="
echo ""
echo "Pack file: $PACK_FILE"
echo "Index file: $IDX_FILE"
echo ""

# Check if index exists
if [ ! -f "$IDX_FILE" ]; then
  echo "Warning: Index file not found, creating temporary index..."
  echo ""

  # Create temporary index
  TEMP_IDX=$(mktemp)
  trap "rm -f $TEMP_IDX" EXIT

  echo "--- Creating Index with git index-pack ---"
  if git index-pack -o "$TEMP_IDX" "$PACK_FILE"; then
    echo "✓ Index created successfully"
    IDX_FILE="$TEMP_IDX"
  else
    echo "✗ Failed to create index"
    exit 1
  fi
  echo ""
fi

# Verify pack
echo "--- Verifying Pack Structure ---"
if git verify-pack "$PACK_FILE" 2>&1; then
  echo "✓ Pack structure is valid"
else
  echo "✗ Pack structure verification failed"
  exit 1
fi
echo ""

# Verbose verification (shows all objects)
echo "--- Pack Contents (git verify-pack -v) ---"
git verify-pack -v "$PACK_FILE" 2>&1 | head -30
TOTAL_OBJECTS=$(git verify-pack -v "$PACK_FILE" 2>&1 | grep -c "^[0-9a-f]\{40\}" || echo "0")
echo ""
if [ "$TOTAL_OBJECTS" -gt 30 ]; then
  echo "... (showing first 30 of $TOTAL_OBJECTS objects)"
fi
echo ""
echo "Total objects: $TOTAL_OBJECTS"
echo ""

# Statistics
echo "--- Pack Statistics (git verify-pack -s) ---"
git verify-pack -s "$PACK_FILE" 2>&1 || true
echo ""

# Summary
echo "=== Verification Complete ==="
echo ""
echo "Pack file: VALID"
echo "Objects: $TOTAL_OBJECTS"

# File sizes
PACK_SIZE=$(du -h "$PACK_FILE" | cut -f1)
IDX_SIZE=$(du -h "$IDX_FILE" | cut -f1)
echo "Pack size: $PACK_SIZE"
echo "Index size: $IDX_SIZE"
