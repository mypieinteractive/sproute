# File: Dockerfile
# Version: V1.3
# Changes from previous version:
# - Added 'RUN npm install -g npm@latest' immediately after the OS update to patch the global NPM vulnerabilities that ship by default within the Node Alpine base image.

# Use the official, modern Node 20 alpine image
FROM node:20-alpine

# Force Alpine package updates for security patches
RUN apk update && apk upgrade --no-cache

# Update the global npm package manager to the latest version to clear base image CVEs
RUN npm install -g npm@latest

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
