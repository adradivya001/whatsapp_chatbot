FROM node:18-alpine

# Create app directory
WORKDIR /app

# Install app dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy app source
COPY . .

# Default port
ENV PORT=3000
EXPOSE 3000

# Start the app
CMD ["node", "index.js"]
