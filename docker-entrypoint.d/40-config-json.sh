#!/bin/sh
# Writes config.json from the environment at every start. A file that compose
# copies into the container (configs: content:) is lost when Watchtower
# recreates it, the environment is not. With none of the variables set, the
# config.json in place (the image's, or a mounted one) is left alone.
set -eu

out=/usr/share/nginx/html/config.json

if [ -z "${API_BASE_URL:-}${MTLS_API_BASE_URL:-}${ADDRESS_BASE_URL:-}${MTLS_ADDRESS_BASE_URL:-}${TILES_BASE_URL:-}${MTLS_TILES_BASE_URL:-}" ]; then
  exit 0
fi

# JSON string escaping for the characters a URL could carry.
json() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

cat > "$out" <<EOF
{
  "apiBaseUrl": "$(json "${API_BASE_URL:-}")",
  "mtlsApiBaseUrl": "$(json "${MTLS_API_BASE_URL:-}")",
  "addressBaseUrl": "$(json "${ADDRESS_BASE_URL:-}")",
  "mtlsAddressBaseUrl": "$(json "${MTLS_ADDRESS_BASE_URL:-}")",
  "tilesBaseUrl": "$(json "${TILES_BASE_URL:-}")",
  "mtlsTilesBaseUrl": "$(json "${MTLS_TILES_BASE_URL:-}")"
}
EOF
echo "$0: wrote $out from the environment"
