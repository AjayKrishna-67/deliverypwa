# syntax=docker/dockerfile:1.7
# =============================================================================
# Delivery-PWA — Next.js 16 standalone image
#
# Build (NEXT_PUBLIC_* are inlined into the JS bundles by `next build`, so they
# must be build args — the .env* files are deliberately NOT in the context):
#
#   docker build -f dockerfile -t delivery-pwa \
#     --build-arg NEXT_PUBLIC_VENDURE_ADMIN_API=https://kaaikani.co.in/admin-api \
#     --build-arg NEXT_PUBLIC_VAPID_PUBLIC_KEY=... \
#     --build-arg NEXT_PUBLIC_GOOGLE_MAPS_KEY=... \
#     --build-arg NEXT_PUBLIC_GOOGLE_MAP_ID=... \
#     --build-arg NEXT_PUBLIC_SOUTH_MITHAI_INVOICE_CHANNELS=8 \
#     .
#
# Run (server-only secrets are read at request time, so they are runtime env):
#
#   docker run -p 3000:3000 \
#     -e VAPID_PRIVATE_KEY=... \
#     -e GOOGLE_MAPS_SERVER_KEY=...   # optional, falls back to the public key
#     delivery-pwa
# =============================================================================


# ---- 1. deps: install with bun so bun.lock (the lockfile CI uses) is honoured -
FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile


# ---- 2. build: `next build` under Node, the runtime it will actually run on --
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_VENDURE_ADMIN_API
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
ARG NEXT_PUBLIC_GOOGLE_MAPS_KEY
ARG NEXT_PUBLIC_GOOGLE_MAP_ID
ARG NEXT_PUBLIC_SOUTH_MITHAI_INVOICE_CHANNELS

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build \
    # The tracer pulls these into standalone, but the server never loads them:
    #  - typescript (19 MB): only used to read next.config.ts, which `next build`
    #    has already serialised into server.js
    #  - sharp/@img (33 MB, glibc + musl copies): only used by the /_next/image
    #    optimizer, and the only <Image> sources (the logos) are `unoptimized`
    && cd .next/standalone/node_modules \
    && rm -rf typescript sharp @img


# ---- 3. icu: English-only ICU data, ~7.5 MB instead of icu-data-full's 32 MB --
# The app formats with en-IN (₹1,23,456.78, lowercase am/pm), en-US and en-CA.
# Alpine's default icu-data-en has no en-IN, which causes a server/client
# hydration mismatch on every price, and icu-data-full adds about 30 MB of
# locales nobody uses. This keeps every non-locale item (time zones,
# normalisation, break iterators, plural rules) plus the root and en* bundles,
# and drops other locales, legacy codepage converters, non-en collation and
# transliterators. TextDecoder('utf-8'/'utf-16') does not need the converters.
FROM alpine:3.22 AS icu
RUN apk add --no-cache icu icu-data-full \
    && cd /usr/share/icu/*/ \
    && icupkg -l icudt*l.dat > all.txt \
    && { grep -E '(^|/)[a-z]{2,3}(_[A-Za-z0-9]+)*[.]res$' all.txt \
           | grep -vE '(^|/)(root|en|en_001|en_150|en_IN|en_US|en_US_POSIX|en_CA|pool|res_index)[.]res$'; \
         grep -E '[.]cnv$|^coll/|^translit/' all.txt \
           | grep -vE '^coll/(root|en|ucadata|res_index)'; } | sort -u > rm.txt \
    # the output basename IS the ICU package name: it must stay icudt<ver>l.dat
    && mkdir /out && icupkg -r rm.txt icudt*l.dat /out/$(ls icudt*l.dat)


# ---- 4. run: bare Alpine + distro Node (53 MB) + trimmed ICU data ------------
# node:22-alpine is 167 MB by itself (a 123 MB static node binary); Alpine's
# nodejs package links the system ICU, so its locale data can be swapped out.
FROM alpine:3.22 AS run
RUN apk add --no-cache nodejs \
    && rm -f /usr/share/icu/*/icudt*l.dat \
    && addgroup -S -g 1001 nodejs \
    && adduser  -S -u 1001 -G nodejs nextjs
COPY --from=icu /out/ /usr/share/icu/76.1/

WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

# standalone = server.js + .next/server + only the node_modules it traced
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
# static chunks and public/ are not traced; standalone serves them from here
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public       ./public

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
