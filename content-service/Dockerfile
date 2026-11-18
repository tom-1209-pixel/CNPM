FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY db ./db
ENV PORT=3002
EXPOSE 3002
USER node
CMD ["node", "src/index.js"]
