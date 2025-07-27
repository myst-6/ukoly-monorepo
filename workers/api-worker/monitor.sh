#!/bin/bash

TIME_LIMIT=$1
MEMORY_LIMIT_KB=$2
COMMAND=$3

ulimit -v "$MEMORY_LIMIT_KB"

STDOUT_FILE=$(mktemp)
TIME_FILE=$(mktemp)

# Run with timeout and capture output and resource usage
timeout --preserve-status --kill-after=1 "$TIME_LIMIT" /usr/bin/time -f "%e %M" -o "$TIME_FILE" \
  bash -c "$COMMAND" > "$STDOUT_FILE"
STATUS=$?

# Output program stdout
cat "$STDOUT_FILE"

# Parse execution time and memory usage
read TIME_S MEM_KB < "$TIME_FILE"
TIME_MS=$(awk "BEGIN {printf \"%.0f\", $TIME_S * 1000}")

# Clean up
rm -f "$STDOUT_FILE" "$TIME_FILE"

# Print time/memory stats to stdout
echo "${TIME_MS}"
echo "${MEM_KB}"

# Exit cleanly with reason
exit "$STATUS"
