# How it is put together

One Node process, one SQLite file, one browser page. No container, no cloud, no
build server, no account.

```
Bioregional-OS/
├── bin/Start BioRegional OS.command   double-click launcher (macOS)
├── core/          schema.sql · db.mjs · ids.mjs (RIDs) · seed
├── engines/       the Seven Engines — where the protocol is enforced
│   ├── council.mjs        decisions, Land Seat, Minimum Viable Chapter Test
│   ├── bioregional.mjs    locate, observe, seasonal dashboard
│   ├── quest.mjs          the 12-step quest pathway, consent gates, care
│   ├── exchange.mjs       ValueFlows ledger, benefit flow
│   └── stewardship.mjs    Data/AI engine, consent audit, AI limits
├── adapters/      interop with the open ecosystem (see INTEROP.md)
├── ai/            tools.mjs — ONE tool registry · system.mjs — the prompt
├── mcp/server.mjs MCP stdio server → Claude Code / Claude Desktop
├── server/        local HTTP: REST API + SSE assistant + serves the app
├── app/           React + Vite + deck.gl 3D map
├── content/       Green Fire doctrine (media business excluded)
├── docs/          the manual and these guides
└── data/commons.db   your entire commons, one file
```

## The one-registry decision

`ai/tools.mjs` defines every capability once: name, JSON Schema, and a handler
that calls an engine. That registry is exposed three ways:

- **MCP** (`mcp/server.mjs`) — Claude Code and Claude Desktop
- **The in-app assistant** (`server/routes/ai.mjs`) — streaming Anthropic tool loop
- **REST** (`POST /api/tool`) — anything else, including the UI's own buttons

So Claude Code, the in-app assistant and the interface all hit the same protocol
gates. There is no privileged path that skips consent.

## Data flow

```
person / Claude  ─┐
                  ├─→ ai/tools.mjs ─→ engines/ ─→ core/db.mjs ─→ commons.db
browser UI      ─┘                       │
                                          └─→ adapters/ ─→ EPA · USGS · Murmurations
                                                           (cached to disk, works offline)
```

## Choices worth knowing

**`node:sqlite`, not better-sqlite3.** Node 22+ ships SQLite. No native
compilation means the OS installs on an old Mac, a Chromebook, a Pi, without a
toolchain. This is why Node 22 is the floor.

**Everything cached to disk.** Every upstream fetch is written to
`data/upstream/cache/`. If the network is gone, the last good answer is served
and flagged `stale`. A commons that stops working when the wifi drops is not a
commons tool.

**Sensitivity is a ladder, checked on the way out.** `public → members → council
→ restricted → sacred`. Exports report `redacted_features` / `withheld` counts
rather than silently dropping rows, so protection is visible instead of invisible.

**RIDs everywhere.** Every object gets `orn:bros.<type>:<chapter>/<id>`. That is
what lets a method travel to another chapter as a label, without the underlying
community data moving.

## Extending it

Add a capability by adding one entry to `ai/tools.mjs` with a handler that calls
an engine. It appears in Claude Code, the in-app assistant and the REST API at
once — no registration anywhere else.
