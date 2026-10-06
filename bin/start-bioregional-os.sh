#!/bin/bash
#
#  THE ACTUAL BIOREGIONAL OS LAUNCH LOGIC. Safe to edit: it lives outside the
#  app bundle, so changing it never breaks the icon's signature.
#
#  Runs one of two ways, and behaves the same in both:
#    - directly from "BioRegional OS.app", when macOS lets the bundle read here
#    - inside a Terminal window (--via-terminal), when macOS privacy blocks the
#      bundle from ~/Desktop. Terminal already holds that permission.
#
#  It makes sure what opens is the code on disk now: a server started before
#  the newest server-side file is restarted, and the interface is rebuilt when
#  app/src is newer than app/dist.
#
set -u

VIA_TERMINAL=0
[ "${1:-}" = "--via-terminal" ] && VIA_TERMINAL=1

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"     # the Bioregional-OS folder
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH:/usr/bin:/bin:/usr/sbin:/sbin"
for d in "$HOME"/.nvm/versions/node/*/bin; do [ -d "$d" ] && export PATH="$PATH:$d"; done

PORT="${PORT:-$(grep -E '^PORT=' "$HERE/.env" 2>/dev/null | tail -1 | cut -d= -f2)}"
PORT="${PORT:-4180}"
URL="http://localhost:$PORT"
# One log for every click and for the server, in ~/Library/Logs (never the
# project: a blocked launcher cannot read back a log under ~/Desktop).
LOG="$HOME/Library/Logs/BioRegional OS.log"
mkdir -p "$HOME/Library/Logs" 2>/dev/null
say() { printf '   %s  %s\n' "$(date '+%H:%M:%S')" "$*" >> "$LOG" 2>/dev/null; }
printf '\n── %s  click  port=%s  via_terminal=%s  here=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$PORT" "$VIA_TERMINAL" "$HERE" >> "$LOG" 2>/dev/null

# When this runs inside a borrowed Terminal window (--via-terminal), close that
# window on the way out. The closer is detached from the tty (setsid) so
# Terminal sees a finished window and closes it without asking. It talks
# Terminal-to-Terminal, which needs no Automation permission.
MYTTY="$(tty 2>/dev/null || true)"
close_window() {
  [ "$VIA_TERMINAL" = 1 ] || return 0
  case "$MYTTY" in /dev/tty*) ;; *) return 0 ;; esac
  /usr/bin/perl -MPOSIX -e 'fork and exit; POSIX::setsid(); exec @ARGV' /bin/bash -c "
    sleep 1.5
    /usr/bin/osascript >/dev/null 2>&1 <<OSA
      tell application \"Terminal\"
        repeat with w in windows
          try
            if tty of selected tab of w is \"$MYTTY\" then
              close w saving no
              exit repeat
            end if
          end try
        end repeat
      end tell
OSA
  " >/dev/null 2>&1
}

die() {
  say "FAILED: $1"
  close_window
  /usr/bin/osascript -e 'activate' -e "display dialog \"$1\" with title \"BioRegional OS\" buttons {\"OK\"} default button 1 with icon caution" >/dev/null 2>&1
  exit 1
}
note() { /usr/bin/osascript -e "display notification \"$1\" with title \"BioRegional OS\"" >/dev/null 2>&1; }

/bin/cat "$HERE/package.json" >/dev/null 2>&1 || die "Can't read the BioRegional OS project.\n\nExpected: $HERE/package.json"
cd "$HERE" || die "Can't enter $HERE"

if ! command -v node >/dev/null 2>&1; then
  say "node not found on PATH=$PATH"
  close_window
  /usr/bin/osascript -e 'activate' -e 'display dialog "Node is not installed yet. Opening nodejs.org. Download the big green LTS button, install it, then double-click this icon again." with title "BioRegional OS" buttons {"OK"} default button 1' >/dev/null 2>&1
  open "https://nodejs.org"; exit 1
fi

# First time here: setup takes minutes and should be watched, so it gets the
# visible window of the .command file.
if [ ! -d node_modules ] || [ ! -d app/node_modules ] || [ ! -f app/dist/index.html ]; then
  say "first-time setup, handing over to the .command window"
  /usr/bin/open -a Terminal "$HERE/bin/Start BioRegional OS.command"
  close_window
  exit 0
fi

# Identity, not liveness: the answer must be this OS's own status document, and
# the listener must be running out of THIS folder (its command line is relative,
# so the working directory is the proof).
listener() { /usr/sbin/lsof -ti tcp:$PORT -sTCP:LISTEN 2>/dev/null | head -1; }
alive() { /usr/bin/curl -s -m 3 "$URL/api/status" 2>/dev/null | /usr/bin/grep -q '"chapters"'; }
ours() {
  local pid; pid=$(listener); [ -n "$pid" ] || return 1
  /usr/sbin/lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | /usr/bin/grep -qxF "n$HERE"
}
# Was the running server started before the newest server-side file was saved?
stale() {
  local pid raw started newest
  pid=$(listener); [ -n "$pid" ] || return 1
  raw=$(/bin/ps -o lstart= -p "$pid" 2>/dev/null); [ -n "$raw" ] || return 1
  started=$(/bin/date -j -f "%a %b %e %T %Y" "$raw" +%s 2>/dev/null | head -1)
  case "$started" in ''|*[!0-9]*) return 1 ;; esac
  newest=$(/usr/bin/find server core engines adapters ai content package.json .env -type f \( -name '*.mjs' -o -name '*.json' -o -name '*.md' -o -name '.env' \) -exec /usr/bin/stat -f %m {} + 2>/dev/null | sort -rn | head -1)
  case "$newest" in ''|*[!0-9]*) return 1 ;; esac
  [ "$newest" -gt "$started" ]
}

# The interface is a built bundle. Rebuild it when its source is newer.
REBUILT=0
if [ -n "$(/usr/bin/find app/src app/index.html app/package.json app/vite.config.js -type f -newer app/dist/index.html 2>/dev/null | head -1)" ]; then
  say "interface source is newer than the build, rebuilding"
  note "BioRegional OS is rebuilding its interface. This takes a moment."
  if npm run build >> "$LOG" 2>&1; then REBUILT=1; say "rebuilt"; else say "rebuild FAILED, opening the previous build"; note "The interface rebuild failed, so this is the previous build. See ~/Library/Logs/BioRegional OS.log"; fi
fi

if alive; then
  if ! ours; then
    die "Port $PORT is answering as BioRegional OS, but not from this folder, so it may be an older copy.\n\nQuit that one first, then click the icon again."
  fi
  if stale; then
    say "running server predates the code, restarting it"
    kill "$(listener)" 2>/dev/null
    for _ in 1 2 3 4 5 6; do [ -z "$(listener)" ] && break; sleep 0.5; done
  else
    say "already running from this folder, opening"
    open "$URL"
    close_window
    exit 0
  fi
elif [ -n "$(listener)" ]; then
  if ours; then
    say "our server holds the port but does not answer, clearing it"
    kill "$(listener)" 2>/dev/null; sleep 1
  else
    die "Port $PORT is in use by another program, so BioRegional OS cannot start.\n\nClose that program, or set a different PORT in the .env file."
  fi
fi

say "starting server"
nohup node --disable-warning=ExperimentalWarning --env-file-if-exists=.env server/index.mjs >> "$LOG" 2>&1 &
SPID=$!
disown $SPID 2>/dev/null

for _ in $(seq 1 60); do alive && break; kill -0 $SPID 2>/dev/null || break; sleep 0.5; done
if alive; then
  say "up, opening $URL"
  open "$URL"
  close_window
  exit 0
fi
die "BioRegional OS did not start.\n\nThe reason is in ~/Library/Logs/BioRegional OS.log\n\nTry, in Terminal in this folder:  npm run doctor -- --fix"
