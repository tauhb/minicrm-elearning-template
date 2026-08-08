FROM node:20-alpine

WORKDIR /app

# Install deps first (better layer caching)
COPY package.json package-lock.json* ./
RUN npm install --omit=optional

# Copy source
COPY tsconfig.json ./
COPY src ./src

# tsx is a dev dependency; we install it explicitly at runtime path
ENV NODE_ENV=production
ENV LOG_LEVEL=info

CMD ["npx", "tsx", "src/index.ts"]
