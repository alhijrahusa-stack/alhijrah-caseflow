FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
ENV NODE_ENV=production
ENV APP_BASE_URL=https://alhijrah-caseflow-production-716b.up.railway.app
EXPOSE 3000
CMD ["npm","start"]
