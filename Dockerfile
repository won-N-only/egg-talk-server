FROM public.ecr.aws/docker/library/node:21-alpine AS base

ARG MONGODB_URI
ARG JWT_SECRET
ARG PORT

ENV MONGODB_URI=$MONGODB_URI
ENV JWT_SECRET=$JWT_SECRET
ENV PORT=$PORT

WORKDIR /usr/src/app

COPY src ./
COPY nest-cli.json ./
COPY package*.json ./
COPY tsconfig*.json ./

RUN npm ci
RUN npm run build

EXPOSE $PORT

CMD node dist/main
