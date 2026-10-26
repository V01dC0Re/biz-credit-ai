#!/bin/sh
set -eu

: "${WG_PRIVATE_KEY:?Set WG_PRIVATE_KEY in .env to connect to the LLM}"

umask 077
mkdir -p /etc/wireguard
cat > /etc/wireguard/wg0.conf <<EOF
[Interface]
PrivateKey = ${WG_PRIVATE_KEY}
Address = ${WG_ADDRESS:-10.154.53.14/16}

[Peer]
PublicKey = ${WG_PEER_PUBLIC_KEY:-81kxTfIHmSpiPMZdeEBakD0w1seqr+C27aQePY2D0F4=}
Endpoint = ${WG_ENDPOINT:-93.190.110.225:56598}
AllowedIPs = 10.154.0.1/32
PersistentKeepalive = 25
EOF

echo '[llm-proxy] Starting WireGuard wg0...'
wg-quick up wg0
echo '[llm-proxy] Forwarding :8080 to LLM at 10.154.0.1:8080'
exec socat TCP-LISTEN:8080,fork,reuseaddr TCP:10.154.0.1:8080
