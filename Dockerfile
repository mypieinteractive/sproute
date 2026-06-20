# File: Dockerfile
# Version: V1.4
# Changes from previous version:
# - Appended a chained command to the npm update step to navigate into the global npm directory and explicitly install undici@^6.27.0 to resolve the CVE-2026-12151 vulnerability flagged by Trivy.

# Use the official, modern Node 20 alpine image
FROM node:20-alpine

# Force Alpine package updates for security patches
RUN apk update && apk upgrade --no-cache

# Update the global npm package manager to the latest version to clear base image CVEs,
# and forcefully patch its internal 'undici' dependency to secure the build pipeline.
RUN npm install -g npm@latest && \
    cd $(npm root -g)/npm && \
    npm install undici@^6.27.0

# Create and change to the app directory
WORKDIR /usr/src/app

# Copy application dependency manifests to the container image
COPY package*.json ./

# Install production dependencies
RUN npm install --only=production

# Copy local code to the container image
COPY . ./

# Run the web service on container startup
CMD [ "npm", "start" ]
