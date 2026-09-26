FROM node:22-alpine
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && chown -R app:app /app
COPY --chown=app:app src ./src
USER app
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node","src/server.js"]
