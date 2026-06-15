# File: Dockerfile
# Version: V1.2
# Changes from previous version:
# - Added 'RUN apk update && apk upgrade --no-cache' to force Alpine to patch the libcrypto3 and libssl3 vulnerabilities before building the app.

# Use the official, modern Node 20 alpine image
FROM node:20-alpine

# Force Alpine package updates for security patches
RUN apk update && apk upgrade --no-cache

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
