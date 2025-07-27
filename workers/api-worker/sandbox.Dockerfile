# Base image with all required tools
FROM docker.io/cloudflare/sandbox:0.1.3

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies and monitoring tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Compilation tools
    gcc \
    g++ \
    openjdk-17-jdk \
    python3 \
    python3-pip \
    nodejs \
    # Monitoring tools
    time \
    procps \
    bc \
    # Utilities
    curl \
    wget \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* \
    && find /usr -name "*.a" -delete

# Create monitoring script
COPY monitor.sh /usr/local/bin/monitor.sh
RUN chmod +x /usr/local/bin/monitor.sh

# Expose port for container communication
EXPOSE 3000

# Run server for cloudflare sandbox sdk to communicate with the container
CMD ["bun", "index.ts"]