#!/bin/bash

# Usage: monitor.sh <time_limit_ms> <memory_limit_kb> <command>
TIME_LIMIT_MS=$1
MEMORY_LIMIT_KB=$2
shift 2
COMMAND="$@"

# Start timing
START_TIME=$(date +%s%3N)  # milliseconds directly

# Convert to seconds for timeout as fallback
TIMEOUT_SECONDS=$(echo "scale=1; $TIME_LIMIT_MS / 1000" | bc -l)

# Run command in background 
eval "$COMMAND" &
PID=$!

# Monitor with very aggressive checking
MAX_MEMORY=0
MEMORY_EXCEEDED=false
TIME_EXCEEDED=false
EXIT_CODE=0

# Aggressive monitoring loop
while kill -0 $PID 2>/dev/null; do
    # Get current time in milliseconds
    CURRENT_TIME=$(date +%s%3N)
    ELAPSED_MS=$((CURRENT_TIME - START_TIME))
    
    # IMMEDIATE time check - kill if exceeded
    if [ "$ELAPSED_MS" -ge "$TIME_LIMIT_MS" ]; then
        TIME_EXCEEDED=true
        kill -9 $PID 2>/dev/null
        pkill -9 -P $PID 2>/dev/null  # Kill children too
        EXIT_CODE=124
        break
    fi
    
    # Quick memory check
    if [ -f "/proc/$PID/status" ]; then
        CURRENT_MEMORY=$(awk '/VmRSS:/ {print $2; exit}' "/proc/$PID/status" 2>/dev/null || echo "0")
        if [ "$CURRENT_MEMORY" -gt "$MAX_MEMORY" ]; then
            MAX_MEMORY=$CURRENT_MEMORY
        fi
        
        # IMMEDIATE memory kill if exceeded
        if [ "$CURRENT_MEMORY" -gt "$MEMORY_LIMIT_KB" ]; then
            MEMORY_EXCEEDED=true
            kill -9 $PID 2>/dev/null
            pkill -9 -P $PID 2>/dev/null  # Kill children too
            EXIT_CODE=137  # Killed by signal
            break
        fi
    fi
    
    # Check children processes too for memory
    for CHILD_PID in $(pgrep -P $PID 2>/dev/null); do
        if [ -f "/proc/$CHILD_PID/status" ]; then
            CHILD_MEMORY=$(awk '/VmRSS:/ {print $2; exit}' "/proc/$CHILD_PID/status" 2>/dev/null || echo "0")
            if [ "$CHILD_MEMORY" -gt "$MAX_MEMORY" ]; then
                MAX_MEMORY=$CHILD_MEMORY
            fi
            if [ "$CHILD_MEMORY" -gt "$MEMORY_LIMIT_KB" ]; then
                MEMORY_EXCEEDED=true
                kill -9 $PID $CHILD_PID 2>/dev/null
                pkill -9 -P $PID 2>/dev/null
                EXIT_CODE=137
                break 2
            fi
        fi
    done
    
    # Very short sleep for responsiveness
    sleep 0.02
done

# Get final exit code if process finished normally
if [ "$TIME_EXCEEDED" = false ] && [ "$MEMORY_EXCEEDED" = false ]; then
    wait $PID 2>/dev/null
    EXIT_CODE=$?
fi

# Calculate final execution time
END_TIME=$(date +%s%3N)
EXECUTION_TIME=$((END_TIME - START_TIME))

# Ensure we don't exceed Cloudflare Workers limits
if [ "$EXECUTION_TIME" -gt "$TIME_LIMIT_MS" ]; then
    TIME_EXCEEDED=true
    EXECUTION_TIME=$TIME_LIMIT_MS
fi

# Output clean JSON
printf '{"exit_code": %d, "max_memory_kb": %d, "execution_time_ms": %d, "time_exceeded": %s, "memory_exceeded": %s}\n' \
    "$EXIT_CODE" "$MAX_MEMORY" "$EXECUTION_TIME" "$TIME_EXCEEDED" "$MEMORY_EXCEEDED" 