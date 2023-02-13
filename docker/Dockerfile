FROM node:14.18.2

WORKDIR /app

COPY . /app

RUN yarn

entrypoint ["yarn", "start:bundler"]