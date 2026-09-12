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

---

## What it does

**A 3D map of the actual ecoregions you live in.** Not decoration — live polygons
from the EPA Ecoregions Level III & IV dataset, extruded and interactive, with a
globe view for the wider mosaic. Your places, hubs and observations sit on top of
it. Every place resolves to its real ecoregion, biome and HUC12 watershed.

**Live ecological data.** USGS stream gages flow in as signals automatically —
discharge and gage height, refreshed on demand, cached so the map still works
with no internet.

**A protocol that is actually enforced.** The BioRegional Commons manual is not a
PDF sitting next to the software; it *is* the software. A council item without a
Land Seat report is refused. A project cannot reach the build stage with an open
consent gate. Paid work without acknowledged terms is refused. A chapter that
hasn't published what it does *not* represent fails its own viability test.

**An AI that runs the whole thing — and cannot govern it.** 23 tools, exposed
identically to Claude Code (over MCP), the Claude Desktop app, and an assistant
inside the page. It reads the same data the map draws. It cannot decide
legitimacy, rights, funding, cultural permission, safety clearance, or who
deserves care — those refusals live in the engines, not in a prompt.

**Built to connect to anything.** Local only, or shared over your wifi with a QR
code a phone can scan. Exports plain GeoJSON for QGIS, ValueFlows JSON-LD for
hREA and Bonfire, KOI manifests for other chapters, and finds its neighbours over
the Murmurations network.

---

## The tabs

| | |
|---|---|
| **My Place** | Chapter identity and the ten-question Minimum Viable Chapter Test, with the specific fix for every failure |
| **Atlas** | The 3D ecoregion map — terrain and globe, Level III and IV, relief on/off |
| **Signals** | What the land and people are showing. Human observations start unverified; USGS water refreshes itself |
| **Quests** | Projects and their consent/safety gates. A good idea never overrides a red flag |
| **Council** | Decisions, the Land Seat report, red flags, review dates |
| **Gatherings** | Events, scored on care provision — meals, transport, childcare, accessibility |
| **Exchange** | Contributions as ValueFlows events. Flags a commons running on unpaid labour |
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
| `npm run seed -- --reset` | Start over with the example commons |

---

## Your data

One file: `data/commons.db`. Copy it to back up; delete it to erase. Nothing is
uploaded anywhere, ever. There is no telemetry and no account.

---

## Built on

Open protocols and open data, integrated as adapters rather than copied code —
EPA Ecoregions, USGS WBD and NWIS, Murmurations, ValueFlows/REA, KOI-net,
CoMapeo, farmOS/OpenTEAM, MapLibre, deck.gl. The licensing reasoning and the full
table are in **[docs/INTEROP.md](docs/INTEROP.md)**.

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
