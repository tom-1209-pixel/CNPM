FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY db ./db
ENV PORT=3001
EXPOSE 3001
USER node
CMD ["node", "src/index.js"]
