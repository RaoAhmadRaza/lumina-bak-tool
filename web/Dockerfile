FROM node:20-bookworm-slim

# zip is required by the download route to build the CSV archive
RUN apt-get update && apt-get install -y zip && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
