#--------------------------------------------------------------
# Builder image
#--------------------------------------------------------------
FROM rival-docker.jfrog.io/node:12.6.0-alpine AS builder


RUN apk add --no-cache curl git bash


#--------------------------------------------------------------
# Pull/build the dependencies
#--------------------------------------------------------------
FROM builder AS dependencies
ARG ARTIFACTORY_CREDENTIALS

WORKDIR /app
COPY package.json yarn.lock /app/

RUN curl -u "$ARTIFACTORY_CREDENTIALS" https://rival.jfrog.io/rival/api/npm/auth > .npmrc
RUN echo registry = https://rival.jfrog.io/rival/api/npm/npm/ >> .npmrc

# Regarding --ignore-scripts:
#   We sometimes have postinstall scripts in the scripts/ directory, and sometimes not.
#   Those aren't available in the build context here, so we can either add them, or
#   skip running them. Adding them is kind of messy (if we `COPY scripts/ .` and the
#   project doesn't have that directory, the build fails. If we `COPY . .`, we need
#   to ignore or remove node_modules). However, it's fine to skip running them, because
#   we always run `yarn` after copying stuff from the dependencies image, so the scripts
#   will be run before any code runs.
RUN yarn --ignore-scripts

#--------------------------------------------------------------
# Final image
#--------------------------------------------------------------
FROM builder AS final

WORKDIR /app
COPY --from=dependencies /app/node_modules node_modules/
