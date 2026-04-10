#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERT_DIR="$ROOT_DIR/.local/https"
CA_KEY="$CERT_DIR/dev-local-ca.key"
CA_CERT="$CERT_DIR/dev-local-ca.pem"
CA_SERIAL="$CERT_DIR/dev-local-ca.srl"
SERVER_KEY="$CERT_DIR/localhost-key.pem"
SERVER_CERT="$CERT_DIR/localhost.pem"
CSR_FILE="$CERT_DIR/localhost.csr"
EXT_FILE="$CERT_DIR/localhost.ext"
KEYCHAIN_PATH="${HOME}/Library/Keychains/login.keychain-db"
CA_COMMON_NAME="Colorado Traffic Tracker Local Dev CA"

mkdir -p "$CERT_DIR"

if [[ ! -f "$CA_KEY" || ! -f "$CA_CERT" ]]; then
  openssl genrsa -out "$CA_KEY" 2048
  openssl req -x509 -new -sha256 -key "$CA_KEY" \
    -days 3650 \
    -out "$CA_CERT" \
    -subj "/CN=${CA_COMMON_NAME}"
fi

cat > "$EXT_FILE" <<'EOF'
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=@alt_names

[alt_names]
DNS.1=localhost
IP.1=127.0.0.1
IP.2=::1
EOF

openssl genrsa -out "$SERVER_KEY" 2048
openssl req -new -key "$SERVER_KEY" -out "$CSR_FILE" -subj "/CN=localhost"
openssl x509 -req \
  -in "$CSR_FILE" \
  -CA "$CA_CERT" \
  -CAkey "$CA_KEY" \
  -CAcreateserial \
  -out "$SERVER_CERT" \
  -days 825 \
  -sha256 \
  -extfile "$EXT_FILE"

rm -f "$CSR_FILE" "$EXT_FILE"

if [[ "$(uname -s)" == "Darwin" ]]; then
  if ! security find-certificate -c "$CA_COMMON_NAME" "$KEYCHAIN_PATH" >/dev/null 2>&1; then
    security add-trusted-cert -d -r trustRoot -k "$KEYCHAIN_PATH" "$CA_CERT"
  fi
fi

printf '\nLocal HTTPS assets are ready in %s\n' "$CERT_DIR"
printf 'Browser-safe dashboard URL: https://localhost/dashboard/\n'
