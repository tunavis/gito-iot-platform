# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Clean install dependencies (faster and more reliable than npm install)
RUN npm ci --legacy-peer-deps

# Copy source code
COPY . .

# Build Next.js app
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Install dumb-init (PID 1 process manager)
RUN apk add --no-cache dumb-init

# Copy package files
COPY package*.json ./

# Install production dependencies only (clean install)
RUN npm ci --only=production --legacy-peer-deps

# Copy built app from builder
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.js ./

# Create non-root user
RUN addgroup -g 1001 nextjs && \
    adduser -D -u 1001 -G nextjs nextjs && \
    chown -R nextjs:nextjs /app

USER nextjs

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Expose port
EXPOSE 3000

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start Next.js
CMD ["npm", "start"]
