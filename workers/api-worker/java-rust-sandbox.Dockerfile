# Base image with all required tools
# If running in dev on macbook, use the following line
# FROM --platform=linux/arm64 docker.io/cloudflare/sandbox:0.1.3
FROM docker.io/cloudflare/sandbox:0.1.3

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies and monitoring tools
RUN apt-get update
# Install Eclipse Temurin (OpenJDK 21)
RUN apt-get install -y wget gnupg software-properties-common \
  && wget -O- https://packages.adoptium.net/artifactory/api/gpg/key/public | gpg --dearmor | tee /usr/share/keyrings/adoptium-archive-keyring.gpg > /dev/null \
  && echo "deb [signed-by=/usr/share/keyrings/adoptium-archive-keyring.gpg] https://packages.adoptium.net/artifactory/deb stable main" > /etc/apt/sources.list.d/adoptium.list \
  && apt-get update \
  && apt-get install -y temurin-21-jdk \
  && apt-get clean
RUN apt-get install -y rustc
RUN apt-get install -y cargo
RUN apt-get install -y coreutils
RUN apt-get install -y time
RUN apt-get install -y procps
RUN apt-get install -y bc
RUN apt-get clean

# Create monitoring script
COPY monitor.sh /usr/local/bin/monitor.sh
RUN chmod +x /usr/local/bin/monitor.sh

# Expose port for container communication
EXPOSE 3000

# Run server for cloudflare sandbox sdk to communicate with the container
CMD ["bun", "index.ts"]