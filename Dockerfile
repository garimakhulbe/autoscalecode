FROM textlab/ubuntu-essential
# make sure apt is up to date
RUN apt-get update
RUN apt-get install -y nodejs npm

COPY src src
WORKDIR /src

RUN npm install azure-common azure-arm-resource azure-storage log4js adal-node
RUN chmod +x ./start.sh

ENTRYPOINT ["./start.sh"]
