#!/bin/bash
# pyre install script - curl installation for macOS
set -euo pipefail

REPO="somalip/pyre"
TOOL="pyre"
BIN_DIR="${BIN_DIR:-/usr/local/bin}"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

info() { echo -e "${GREEN}[pyre]${NC} $1"; }
err() { echo -e "${RED}[pyre]${NC} $1" >&2; }

if [[ "$(uname)" != "Darwin" ]]; then
  err "pyre requires macOS. Detected $(uname)."
  exit 1
fi

if ! command -v npm &> /dev/null; then
  err "Node.js/npm is required. Install from https://nodejs.org"
  exit 1
fi

info "Installing ${TOOL} via npm..."
npm install -g "@$REPO"

info "Verifying installation..."
if command -v "$TOOL" &> /dev/null; then
  info "${TOOL} installed successfully!"
  info "Run ${TOOL} --help to get started."
else
  info "Installation complete. If the command is not found, restart your shell."
fi
