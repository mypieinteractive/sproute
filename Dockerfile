# File: Dockerfile
# Version: V1.1
# Changes from previous version:
# - Swapped base image from `node:20-slim` to `node:20-alpine` to eliminate the 16 OS-level Debian vulnerabilities detected by Trivy.

# Use the official, modern Node 20 alpine image
FROM node:20-alpine

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
