FROM node:0.10-slim
COPY src src
WORKDIR /src

RUN npm install azure-common azure-arm-resource azure-storage log4js adal-node

ENTRYPOINT ["node","autoScale.js"]
