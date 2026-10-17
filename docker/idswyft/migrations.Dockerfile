# Idswyft's API image does not ship its SQL migrations (upstream bind-mounts them from a checkout). This tiny image
# fetches them from the SAME release tag the API is built from and copies them into a shared volume, so a fresh
# clone of DioteKo needs nothing outside this repository. Used by the `idswyft-migrations` service of
# docker-compose.idswyft.yml.
FROM alpine:3.20 AS source
ARG IDSWYFT_VERSION=v1.12.19
RUN apk add --no-cache git \
 && git clone --depth 1 --branch "${IDSWYFT_VERSION}" https://github.com/team-idswyft/idswyft-community.git /src

FROM alpine:3.20
COPY --from=source /src/supabase/migrations /migrations
CMD ["sh", "-c", "cp -R /migrations/. /shared/ && echo 'idswyft migrations copied:' && ls /shared | wc -l"]
