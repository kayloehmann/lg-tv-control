FROM node:22-alpine

RUN apk add --no-cache openssh-client
ARG APP_UID=1026
RUN adduser -D -u "${APP_UID}" app
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public

ENV NODE_ENV=production PORT=3000
EXPOSE 3000
USER app
CMD ["node", "src/server.mjs"]
