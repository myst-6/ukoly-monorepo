#!/bin/bash

# Usage: monitor.sh <time_limit_ms> <memory_limit_kb> <command>
TIME_LIMIT_MS=$1
MEMORY_LIMIT_KB=$2
shift 2
COMMAND="$@"

# Create temporary files
TEMP_DIR=$(mktemp -d)
PID_FILE="$TEMP_DIR/pid"
MEMORY_FILE="$TEMP_DIR/memory"
TIME_FILE="$TEMP_DIR/time"

# Function to cleanup
cleanup() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        kill -9 $PID 2>/dev/null
    fi
    rm -rf "$TEMP_DIR"
}

# Set up trap for cleanup
trap cleanup EXIT

# Start the command in background
eval "$COMMAND" &
PID=$!
echo $PID > "$PID_FILE"

# Start memory monitoring
(
    max_memory=0
    start_time=$(date +%s.%N)
    
    while kill -0 $PID 2>/dev/null; do
        # Check if process still exists
        if ! kill -0 $PID 2>/dev/null; then
            break
        fi
        
        # Get current memory usage (RSS in KB)
        if [ -f "/proc/$PID/status" ]; then
            current_memory=$(grep VmRSS "/proc/$PID/status" | awk '{print $2}')
            if [ ! -z "$current_memory" ] && [ "$current_memory" -gt "$max_memory" ]; then
                max_memory=$current_memory
            fi
            
            # Check memory limit
            if [ "$current_memory" -gt "$MEMORY_LIMIT_KB" ]; then
                echo "MEMORY_LIMIT_EXCEEDED" > "$MEMORY_FILE"
                kill -9 $PID
                exit 1
            fi
        fi
        
        # Check time limit
        current_time=$(date +%s.%N)
        elapsed_ms=$(echo "($current_time - $start_time) * 1000" | bc -l | cut -d. -f1)
        if [ "$elapsed_ms" -gt "$TIME_LIMIT_MS" ]; then
            echo "TIME_LIMIT_EXCEEDED" > "$TIME_FILE"
            kill -9 $PID
            exit 1
        fi
        
        sleep 0.005  # 5ms intervals
    done
    
    # Record final memory usage
    echo "$max_memory" > "$MEMORY_FILE"
    
    # Calculate final execution time
    end_time=$(date +%s.%N)
    elapsed_ms=$(echo "($end_time - $start_time) * 1000" | bc -l | cut -d. -f1)
    echo "$elapsed_ms" > "$TIME_FILE"
) &

# Wait for the command to finish
wait $PID
EXIT_CODE=$?

# Read results
if [ -f "$MEMORY_FILE" ]; then
    MAX_MEMORY=$(cat "$MEMORY_FILE")
else
    MAX_MEMORY=0
fi

if [ -f "$TIME_FILE" ]; then
    EXECUTION_TIME=$(cat "$TIME_FILE")
else
    EXECUTION_TIME=0
fi

# Output results in JSON format
echo "{\"exit_code\": $EXIT_CODE, \"max_memory_kb\": $MAX_MEMORY, \"execution_time_ms\": $EXECUTION_TIME}" 