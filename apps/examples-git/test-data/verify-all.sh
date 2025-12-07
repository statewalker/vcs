#!/bin/bash
# Verify all generated pack files with native git
#
# Usage: ./verify-all.sh [directory]
#
# This script finds all .pack files in the specified directory (or ./git-repo)
# and verifies each one using git verify-pack.

set -e

DIR="${1:-./git-repo}"

if [ ! -d "$DIR" ]; then
  echo "Error: Directory not found: $DIR"
  exit 1
fi

echo "=== Verifying All Pack Files ==="
echo ""
echo "Directory: $DIR"
echo ""

# Find all pack files
PACK_FILES=$(find "$DIR" -name "*.pack" -type f 2>/dev/null | sort)

if [ -z "$PACK_FILES" ]; then
  echo "No pack files found in $DIR"
  exit 0
fi

TOTAL=0
VALID=0
FAILED=0

for PACK_FILE in $PACK_FILES; do
  TOTAL=$((TOTAL + 1))
  BASENAME=$(basename "$PACK_FILE")

  # Get corresponding index file
  IDX_FILE="${PACK_FILE%.pack}.idx"

  printf "  [%d] %-40s " "$TOTAL" "$BASENAME"

  # Check if index exists
  if [ ! -f "$IDX_FILE" ]; then
    # Try to create temporary index
    TEMP_IDX=$(mktemp)
    if git index-pack -o "$TEMP_IDX" "$PACK_FILE" > /dev/null 2>&1; then
      IDX_FILE="$TEMP_IDX"
    else
      echo "✗ FAILED (cannot create index)"
      FAILED=$((FAILED + 1))
      rm -f "$TEMP_IDX"
      continue
    fi
  fi

  # Verify pack
  if git verify-pack "$PACK_FILE" > /dev/null 2>&1; then
    # Count objects
    OBJ_COUNT=$(git verify-pack -v "$PACK_FILE" 2>&1 | grep -c "^[0-9a-f]\{40\}" || echo "0")
    echo "✓ VALID ($OBJ_COUNT objects)"
    VALID=$((VALID + 1))
  else
    echo "✗ FAILED"
    FAILED=$((FAILED + 1))
  fi

  # Clean up temp index if created
  if [ -f "$TEMP_IDX" ]; then
    rm -f "$TEMP_IDX"
  fi
done

echo ""
echo "=== Summary ==="
echo ""
echo "Total pack files: $TOTAL"
echo "Valid:            $VALID"
echo "Failed:           $FAILED"
echo ""

if [ "$FAILED" -gt 0 ]; then
  echo "⚠ Some pack files failed verification!"
  exit 1
else
  echo "✓ All pack files are valid!"
  exit 0
fi
