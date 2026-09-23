#!/bin/bash
# pyre install script - curl installation for macOS and Linux
set -euo pipefail

REPO="somalip/pyre"
TOOL="pyre"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

info() { echo -e "${GREEN}[pyre]${NC} $1"; }
err() { echo -e "${RED}[pyre]${NC} $1" >&2; }

OS="$(uname -s)"
if [[ "$OS" != "Darwin" && "$OS" != "Linux" ]]; then
  err "This installer supports macOS and Linux (detected $OS). On Windows, run install.ps1 in PowerShell."
  exit 1
fi

if ! command -v npm &> /dev/null; then
  err "Node.js (>= 18) and npm are required. Install from https://nodejs.org"
  exit 1
fi

info "Detected platform: $OS"
info "Installing ${TOOL} globally via npm..."
npm install -g pyre-cli || npm install -g "@$REPO"

info "Verifying installation..."
if command -v "$TOOL" &> /dev/null; then
  info "${TOOL} installed successfully!"
  info "Run '${TOOL} live' or '${TOOL} --help' to get started."
else
  info "Installation complete. If '${TOOL}' is not found in your PATH, restart your shell or check npm global bin path."
fi
