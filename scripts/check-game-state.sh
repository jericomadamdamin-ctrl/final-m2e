#!/bin/bash
# Diagnostic script to test game-state edge function
# Run: ./scripts/check-game-state.sh
# Requires: .env with VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY

set -e
cd "$(dirname "$0")/.."
# Don't exit on curl timeout
set +e
# Load only the vars we need (avoid parsing complex .env lines)
if [ -f .env ]; then
  export VITE_SUPABASE_URL=$(grep '^VITE_SUPABASE_URL=' .env | cut -d'=' -f2- | tr -d '"')
  export VITE_SUPABASE_ANON_KEY=$(grep '^VITE_SUPABASE_ANON_KEY=' .env | cut -d'=' -f2- | tr -d '"')
fi

URL="${VITE_SUPABASE_URL}/functions/v1/game-state"
ANON="${VITE_SUPABASE_ANON_KEY}"

echo "=== Testing game-state at $URL ==="
echo ""

echo "1. Without x-app-session (expect 400 Missing app session token):"
RESP=$(curl -s --max-time 10 -w "\n%{http_code}" -X POST "$URL" \
  -H "Authorization: Bearer $ANON" \
  -H "Content-Type: application/json")
BODY=$(echo "$RESP" | head -n -1)
CODE=$(echo "$RESP" | tail -1)
echo "   HTTP $CODE"
echo "   Body: $BODY"
echo ""

echo "2. With invalid x-app-session (expect 400 Invalid session token):"
RESP=$(curl -s --max-time 10 -w "\n%{http_code}" -X POST "$URL" \
  -H "Authorization: Bearer $ANON" \
  -H "x-app-session: invalid-token-12345" \
  -H "Content-Type: application/json")
BODY=$(echo "$RESP" | head -n -1)
CODE=$(echo "$RESP" | tail -1)
echo "   HTTP $CODE"
echo "   Body: $BODY"
echo ""

if [ "$CODE" = "000" ]; then
  echo "   (HTTP 000 = connection timeout - try running from your terminal)"
  echo ""
fi

echo "=== To view logs: Supabase Dashboard ==="
echo "   https://supabase.com/dashboard/project/kinfgzrpwdoroahsnzbr/functions/game-state"
echo "   -> Logs or Invocations tab"
