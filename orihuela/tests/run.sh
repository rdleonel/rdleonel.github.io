#!/usr/bin/env bash
# Roda a suíte do Orihuela: sobe um servidor local, executa cada teste e derruba o servidor.
# Uso, a partir da raiz do repositório:  bash orihuela/tests/run.sh [nome-do-teste]
set -u
cd "$(dirname "$0")/../.." || exit 1

PORT=${PORT:-8765}
export BASE="http://127.0.0.1:$PORT/orihuela/"
export OUT=${OUT:-$(mktemp -d)}
export NODE_PATH=${NODE_PATH:-$(npm root -g 2>/dev/null)}

echo "Servidor em $BASE   |   capturas em $OUT"
npx --yes http-server . -p "$PORT" -s -c-1 > /dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
sleep 1

TESTS=${1:-"nav func quotes batch update"}
FALHAS=0

# teste da leitura de prints (Node puro, sem navegador)
if [ -z "${1:-}" ]; then
  echo ""
  echo "=== vision (unidade) ==="
  if ! node orihuela/tests/unit-vision.js; then FALHAS=$((FALHAS + 1)); echo "--- FALHOU: vision"; fi
fi
for t in $TESTS; do
  echo ""
  echo "=== $t ==="
  if ! node "orihuela/tests/e2e-$t.js"; then
    FALHAS=$((FALHAS + 1))
    echo "--- FALHOU: $t"
  fi
done

echo ""
if [ "$FALHAS" -eq 0 ]; then echo "Tudo passou."; else echo "$FALHAS teste(s) falharam."; fi
exit "$FALHAS"
