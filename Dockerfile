FROM node:18-alpine

WORKDIR /app

EXPOSE 3000

COPY package.json yarn.lock ./

RUN yarn install

COPY . ./

CMD ["npm", "run", "dev"]