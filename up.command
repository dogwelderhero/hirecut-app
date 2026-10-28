#!/usr/bin/env bash
# macOS: double-click to start hirecute (the scenario split decides).
# To open one scenario, run in Terminal:  ./up.sh recruiter
cd "$(dirname "$0")" && ./up.sh "$@"
echo
read -r -p "Press Enter to close this window." _
