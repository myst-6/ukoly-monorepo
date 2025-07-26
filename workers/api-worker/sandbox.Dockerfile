# Base image with all required tools
FROM ubuntu:22.04

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies and monitoring tools
RUN apt-get update && apt-get install -y \
    # Compilation tools
    gcc \
    g++ \
    rustc \
    cargo \
    openjdk-17-jdk \
    python3 \
    python3-pip \
    nodejs \
    npm \
    # Monitoring tools
    time \
    procps \
    bc \
    # Utilities
    curl \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Create monitoring script
COPY monitor.sh /usr/local/bin/monitor.sh
RUN chmod +x /usr/local/bin/monitor.sh

# Set up working directory
WORKDIR /workspace

# Create a non-root user for security
RUN useradd -m -s /bin/bash coder
USER coder 