#!/usr/bin/env bash
set -euo pipefail
if [[ -z "${CHIBBO_SMOKE_URL:-}" ]]; then
  CHIBBO_SMOKE_URL="$(aws cloudformation describe-stacks --stack-name ChibboApplicationDev --query 'Stacks[0].Outputs[?OutputKey==`ApplicationUrl`].OutputValue' --output text)"
fi
case "$CHIBBO_SMOKE_URL" in https://*) ;; *) echo "HTTPS smoke URL is required" >&2; exit 1;; esac
curl --fail --silent --show-error --max-time 15 "${CHIBBO_SMOKE_URL}/api/health"
