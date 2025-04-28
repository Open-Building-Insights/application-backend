# Build stage
FROM node:16 AS build-env

ADD package.json /app/
ADD package-lock.json /app/
ADD server.js /app/
ADD .env /app/
ADD models/ /app/models/
ADD swagger.yaml /app/
RUN apt-get update
RUN cd /app && npm ci --only=production

# Runtime stage
FROM node:16
COPY --from=build-env /app /app
WORKDIR /app
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
