FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ===================================================
# Production image
# ===================================================
FROM node:20-alpine AS production

WORKDIR /app

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled output
COPY --from=builder /app/dist ./dist
COPY src/db/schema.sql ./dist/db/

# Create data directory
RUN mkdir -p /app/data

EXPOSE 3001
CMD ["node", "dist/index.js"]
