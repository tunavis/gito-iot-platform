#!/usr/bin/env bash
# One-command startup: installs/updates dependencies, then launches the
# Bridge UI (which hosts the device simulator's controls). Re-run this any
# time — pip install is a no-op once dependencies are already satisfied.
set -e
cd "$(dirname "$0")"
echo "Installing/updating dependencies..."
pip install -r requirements.txt --quiet
echo
echo "Starting Gito Device Simulator..."
echo "Open http://localhost:5555 in your browser."
echo
python3 bridge_ui.py
