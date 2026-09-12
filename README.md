# BioRegional OS

**A local-first operating system for a bioregional commons.**

Real ecological boundaries in 3D, the BioRegional Commons protocol enforced in
code, and an AI you can point at any of it — running entirely on one computer,
with no account and no cloud.

![AGPL-3.0](https://img.shields.io/badge/licence-AGPL--3.0-4A5D4E) ![Node 22+](https://img.shields.io/badge/node-22%2B-4A5D4E) ![local-first](https://img.shields.io/badge/data-stays%20on%20your%20machine-D4AF37)

---

## Start in one step

**Mac:** double-click `bin/Start BioRegional OS.command`.

**Anything else:**

```bash
npm run setup
npm run os -- --open
```

Lost at any point? `npm run help` — or click the green **I'm lost** button in the
app. Broken? `npm run doctor -- --fix`.

New to this entirely → **[docs/START_HERE.md](docs/START_HERE.md)**

> **What you see first is demonstration data — a fictional commons.** A fresh
> install opens on Barton Creek in Austin, Texas: an invented chapter, invented
> people and invented observations, used to show how the twelve stages fit
> together. None of it is a real report, and no organization named in it has
> anything to do with it. Click **Find my bioregion** to replace it with your own
> place, or `npm run seed -- --reset` to start over.

*Live* ecological data — water, weather, soil, species, hazards — is exactly that,
and comes from the public sources listed in
**[docs/DATA_SOURCES.md](docs/DATA_SOURCES.md)**. The seeded *commons* around it
is fiction; the *land* it sits on is real.

---

## What it does

**A 3D map of the actual ecoregions you live in.** Not decoration — live polygons
from the EPA Ecoregions Level III & IV dataset, extruded and interactive, with a
globe view for the wider mosaic. Your places, hubs and observations sit on top of
it. Every place resolves to its real ecoregion, biome and HUC12 watershed.

**It starts where you are.** The first thing a new person sees is one question —
where are you? — answered live: your ecoregion, your watershed, the soil under
you, what lives around you, and the nearest gage measured against its own record.
Nothing is written down until you say so, and there is no account to make.

**It tells you something before it asks you for anything.** The first screen opens
with what the land is doing today: the nearest gage measured against its own median
for *this calendar day* across the whole period of record, live weather and any
official hazard alert, and sun, moon and daylight computed on your own machine — so
that part answers even with the wifi off. Then one line: *what did you notice?*

**Every ecoregion in the country, readable with the network unplugged.** `npm run
data` downloads a dossier per region — plants and animals ranked by how often they
are actually seen, soil, climate normals, water, hazards, community assets — about
100 KB each, roughly 97 MB for all 967. Threatened species are named but never
located. Culture is deliberately not downloaded. Every run is resumable and
refetches only what has actually gone stale.

**Live ecological data.** USGS stream gages flow in as signals automatically —
discharge and gage height, refreshed on demand, cached so the map still works
with no internet.

**Everything a person can do, Claude can do, and vice versa.** One registry of
tools feeds the MCP server, the in-app assistant, the REST API *and* the forms in
the interface — the forms are generated from the tools' own schemas. There is no
privileged path that skips a consent gate.

**A protocol that is actually enforced.** The BioRegional Commons manual is not a
PDF sitting next to the software; it *is* the software. A council item without a
Land Seat report is refused. A project cannot reach the build stage with an open
consent gate. Paid work without acknowledged terms is refused. A chapter that
hasn't published what it does *not* represent fails its own viability test.

**It tells you what came of it.** When somebody's observation becomes a project,
and that project reaches the council, the person who noticed it is told so — by
name, on the first screen. Only observations a *person* made are ever attributed
to a person; a gage reading and a NOAA warning are credited to nobody.

**It tells you what to do next.** The Today view walks all twelve stages and
reports what is blocking, what has slipped past a date it committed to, and what
the protocol expects to exist and doesn't — each with the rule it comes from, so
you can argue with it, and the button that fixes it.

**It tends itself while it runs.** A heartbeat locates new places against real
ecological boundaries, refreshes water readings, and watches review dates. Not a
launchd timer: on macOS those cannot read `~/Desktop` and fail *silently*, and a
scheduler that lies about running is worse than none.

**An AI that runs the whole thing — and cannot govern it.** Every tool in the
registry, exposed identically to Claude Code (over MCP), the Claude Desktop app,
and an assistant inside the page (`npm run connect` prints the live count). It reads the same data the map draws. It cannot decide
legitimacy, rights, funding, cultural permission, safety clearance, or who
deserves care — those refusals live in the engines, not in a prompt.

**Built to connect to anything.** Local only, or shared over your wifi with a QR
code a phone can scan. Exports plain GeoJSON for QGIS, ValueFlows JSON-LD for
hREA and Bonfire, KOI manifests for other chapters, and finds its neighbours over
the Murmurations network.

---

## The five places in it

The interface groups into five, in the order a commons actually moves: what the
land is doing, where you are, the work, the people, and what leaves the building.

**Today** — What the land is doing right now: water against its own record for
this calendar day, weather, any official hazard alert, and sun and moon computed
on your own machine. Then *what did you notice?*, then what your observations
turned into, then what needs doing across all twelve stages, ranked by what
blocks other work. Each item cites the protocol rule it comes from, so you can
argue with it, and carries the button that fixes it.

**Place**

| | |
|---|---|
| **My Place** | Chapter identity — what it represents and what it explicitly does not — the ground beneath it, and the ten-question Minimum Viable Chapter Test with the specific fix for every failure |
| **Atlas** | The 3D ecoregion map — terrain and globe, EPA Level III and IV, relief on/off, your places and signals on top |

**The work**

| | |
|---|---|
| **Listen** | The front door. Someone brings a need; the commons answers and can be appealed |
| **Signals** | What the land and people are showing. Human observations start unverified; USGS water refreshes itself |
| **Quests** | Projects and their consent/safety gates. A good idea never overrides a red flag |
| **Measure** | Indicators, baselines and decision triggers. A reading that moves away from target says so |

**Together**

| | |
|---|---|
| **Council** | Decisions, the Land Seat report, red flags, review dates |
| **Gatherings** | Events, scored on care provision — meals, transport, childcare, accessibility |
| **Exchange** | Contributions as ValueFlows events. Flags a commons running on unpaid labour |

**What travels**

| | |
|---|---|
| **The card** | The week in one paste-ready block, text and PNG, for the group chat people already use. The app's job is not to become the place the group gathers |
| **Learn** | Knowledge written so it can travel, plus the doctrine the OS runs on |
| **Federation** | Other chapters, discovered over Murmurations |

---

## Every way in

```bash
npm run connect
```

Prints all of them: this computer, phones on your wifi (with a scannable QR),
Claude Code, Claude Desktop, raw exports for other tools, offline/paper, and a
clean copy to hand another community.

---

## Commands

| | |
|---|---|
| `npm run setup` | First time. Safe to re-run. |
| `npm run os -- --open` | Start it, open the browser |
| `npm run os -- --share` | Also let phones on the same wifi in |
| `npm run help` | Menu of plain-language help |
| `npm run connect` | Every way to connect, with a QR code |
| `npm run doctor -- --fix` | Diagnose and repair |
| `npm run update` | Refresh reference data, rebuild the interface |
| `npm run update -- --package` | Clean copy for another community, without your data |
| `npm run backup` | One complete file you can copy anywhere. Do this |
| `npm run backup -- --verify <f>` | Open a backup and say what is really in it |
| `npm run erase` | Remove the commons — all of it. Refuses without `--force` |
| `npm run data` | Download the ecoregions around you, for offline use |
| `npm run data -- --status` | What is downloaded, what has gone stale |
| `npm run seed -- --reset` | Start over with the demonstration commons (fictional) |
| `npm test` | The protocol test suite — proves the gates actually refuse |

---

## The documentation

| | |
|---|---|
| **[START_HERE.md](docs/START_HERE.md)** | New to all of this. Start here |
| **[PROTOCOL.md](docs/PROTOCOL.md)** | The BioRegional Commons manual — the rules this software enforces |
| **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** | How it is put together, and the reasoning behind every choice worth arguing with |
| **[CLAUDE_CODE.md](docs/CLAUDE_CODE.md)** | Driving the whole commons from Claude Code over MCP |
| **[LIBRARY.md](docs/LIBRARY.md)** | The offline ecoregion library — what is in a dossier, and what is deliberately left out |
| **[DATA_SOURCES.md](docs/DATA_SOURCES.md)** | The endpoint-verified catalogue of open data behind the Atlas |
| **[INTEROP.md](docs/INTEROP.md)** | What it connects to, and the licensing reasoning for integrating by protocol rather than by copying code |
| **[DAILY_USE.md](docs/DAILY_USE.md)** | Why it is built to give before it asks, and what it refuses to do — no streaks, no points, no feed |
| **[SOCIAL_LAYER.md](docs/SOCIAL_LAYER.md)** | Why the app's job is to produce the thing pasted into the group chat, not to become the group chat |

---

## Your data

Your whole commons lives in `data/commons.db`. Nothing is uploaded anywhere,
ever. There is no telemetry and no account.

**To back it up:**

```bash
npm run backup
```

One file, written while the OS keeps running, and checked before it tells you it
worked. Keep it somewhere that is not this computer, and check one any time with
`npm run backup -- --verify <file>`.

Do **not** just copy `commons.db` by hand. The database keeps recent writes in a
separate write-ahead log, so that file on its own is usually out of date — and it
fails silently, because the copy opens and looks completely normal. For the same
reason, erasing means deleting `commons.db` *and* its `-wal` and `-shm`
companions; `npm run doctor` will tell you if any are left behind.

---

## Built on

Open protocols and open data, integrated as adapters rather than copied code —
EPA Ecoregions, USGS WBD and NWIS, Murmurations, ValueFlows/REA, KOI-net,
CoMapeo, farmOS/OpenTEAM, MapLibre, deck.gl. The licensing reasoning and the full
table are in **[docs/INTEROP.md](docs/INTEROP.md)**.

Eleven of the twelve Atlas layers now carry live data — soil, plants and medicinal
uses, phenology, hazards, care infrastructure. The twelfth is the chapter's own
work, and is correctly empty until there is some. The endpoint-verified catalogue
behind them, and the design for adding a source without creating a second path, is
in **[docs/DATA_SOURCES.md](docs/DATA_SOURCES.md)**.

The protocol comes from the Green Fire **BioRegional Commons** manual
(**[docs/PROTOCOL.md](docs/PROTOCOL.md)**) and the civic doctrine of the Green
Fire Research and Innovation Center. The commercial media offerings of that
business are deliberately not part of this.

---

## Licence

**AGPL-3.0-or-later.** Use it, adapt it, run it for your own bioregion. If you
run a modified version as a service for others, your changes belong to the
commons too.

This is an organizing tool, not a substitute for legal counsel, ecological
assessment, permits, insurance, youth safeguarding, or government-to-government
and rights-holder consultation. See the Safety and Legal Limits section of the
protocol.
