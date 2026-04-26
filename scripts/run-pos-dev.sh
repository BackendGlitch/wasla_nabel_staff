#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./scripts/run-pos-dev.sh [machine_id] [printer_device]
#
# Examples:
#   ./scripts/run-pos-dev.sh
#   ./scripts/run-pos-dev.sh station-a-pos-01 /dev/usb/lp0

MACHINE_ID="${1:-station-pos-01}"
PRINTER_DEVICE="${2:-/dev/usb/lp0}"

export STAFF_MACHINE_TYPE="pos"
export STAFF_MACHINE_ID="${MACHINE_ID}"
export STAFF_PRINTER_DEVICE="${PRINTER_DEVICE}"

echo "[wasla-pos] STAFF_MACHINE_TYPE=${STAFF_MACHINE_TYPE}"
echo "[wasla-pos] STAFF_MACHINE_ID=${STAFF_MACHINE_ID}"
echo "[wasla-pos] STAFF_PRINTER_DEVICE=${STAFF_PRINTER_DEVICE}"

npm run dev
