FROM node:18-slim

# Install system dependencies for Puppeteer/Chromium
RUN apt-get update \
    && apt-get install -y wget gnupg \
    && apt-get install -y chromium \
    && apt-get install -y libatk-bridge2.0-0 libgtk-3-0 libasound2 libnss3 libxss1 libxtst6 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set environment variables
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Create and define the application's working directory.
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install application dependencies
RUN npm install

# Copy application source code
COPY . .

# Expose the application port
EXPOSE 8080

# Start the application
CMD [ "npm", "start" ]
