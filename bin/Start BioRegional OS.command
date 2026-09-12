#!/bin/bash
# Double-click this file to start BioRegional OS.
# It sets everything up the first time, then just starts.
cd "$(dirname "$0")/.." || exit 1
clear
printf '\n  🌿  BioRegional OS\n  ──────────────────────────────────────────────\n\n'

if ! command -v node >/dev/null 2>&1; then
  printf '  Node is not installed on this computer yet.\n\n'
  printf '  1. Go to  https://nodejs.org\n'
  printf '  2. Download the big green "LTS" button and install it\n'
  printf '  3. Double-click this file again\n\n'
  printf '  Press Return to close.'
  read -r _; exit 1
fi

if [ ! -d app/node_modules ] || [ ! -f app/dist/index.html ]; then
  printf '  First time here — setting things up. This takes a few minutes.\n\n'
  npm run setup || { printf '\n  Setup hit a problem. Press Return to close.'; read -r _; exit 1; }
fi

printf '\n  Starting… your browser will open by itself.\n'
printf '  Leave this window open while you use it.\n'
printf '  To stop: close this window, or press Control and C.\n\n'
npm run os -- --open

printf '\n  BioRegional OS has stopped. Press Return to close.'
read -r _
