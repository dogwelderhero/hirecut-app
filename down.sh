#!/usr/bin/env bash
# Stop hirecute started with ./up.sh. Runs inside it are discarded.
set -u
if docker rm -f hirecute-local >/dev/null 2>&1; then
  echo "Stopped."
else
  echo "It was not running."
fi
