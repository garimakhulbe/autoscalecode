FROM ubuntu:14.04

# make sure apt is up to date
RUN apt-get update

# install nodejs and npm
RUN apt-get install -y git git-core nodejs npm

ADD src src
WORKDIR /src

RUN cd /src && npm install azure-common azure-arm-resource azure-storage log4js adal-node
RUN chmod +x start.sh

#ENTRYPOINT ["/src/start.sh"]
