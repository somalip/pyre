#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-9876}"
PASSWORD="${2:-mysecret}"

# Detect non-loopback IPs
IPS=$( (
  hostname -I 2>/dev/null | tr ' ' '\n' | grep -v '^$' | grep -v '^127\.'
  ip addr show 2>/dev/null | grep -oP 'inet \K[\d.]+' | grep -v '^127\.'
  ifconfig 2>/dev/null | grep -oP 'inet \K[\d.]+' | grep -v '^127\.'
) | sort -u | grep -v '^$' | tr '\n' ' ' )

if [ -z "$IPS" ]; then
  echo "Could not detect a non-loopback IP address."
  exit 1
fi

SELECTED_IP=$(echo "$IPS" | awk '{print $1}')

echo ""
echo "Detected IP(s): $IPS"
echo "Using: $SELECTED_IP"
echo ""
echo "Starting P2P server on $SELECTED_IP:$PORT ..."
echo ""

cd /workspace/GitHub/pyre
npm run start -- p2p server --p2p-host "$SELECTED_IP" --p2p-port "$PORT" --p2p-password "$PASSWORD" &
SERVER_PID=$!

# Give the server a moment to bind
sleep 1

echo ""
echo "=========================================="
echo "Run this on the CLIENT machine:"
echo "=========================================="
echo "pyre p2p connect \\"
echo "  --p2p-host $SELECTED_IP \\"
echo "  --p2p-port $PORT \\"
echo "  --p2p-password $PASSWORD"
echo "=========================================="
echo ""
echo "Server PID: $SERVER_PID"
echo "Press Ctrl+C to stop."

wait $SERVER_PID
