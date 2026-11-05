# What this is built on, and how

BioRegional OS is assembled from the open bioregional/regenerative ecosystem. It
does **not** vendor anyone's codebase. It speaks their **protocols, schemas and
open data**, which is what actually makes systems interoperate — and which keeps
the licensing clean.

## Why adapters instead of copied code

Most of the ecosystem is strong copyleft: Terraso is AGPL-3.0, farmOS GPL-2.0,
LiteFarm GPL-3.0, CoMapeo GPL-3.0, Murmurations GPL-3.0, Open Food Network
AGPL-3.0. Bundling those into one distributed work creates obligations across the
whole thing, and — more practically — a copy of someone's code goes stale the day
you make it. A protocol adapter does not.

**This project is AGPL-3.0-or-later**, which is compatible with all of the above
and keeps it genuinely open: anyone who runs a modified version as a service owes
the community their changes.

## The integrations

| Layer | Upstream | Licence | How it is used |
|---|---|---|---|
| Ecoregion boundaries | **EPA Ecoregions Level III & IV** | Public domain (US Gov) | Live query. `adapters/ecoregion.mjs`, `adapters/layers.mjs`. This is the 3D map. |
| Watersheds | **USGS Watershed Boundary Dataset** | Public domain | HUC12 subwatershed + HUC8 subbasin per point. `adapters/watershed.mjs` |
| Live water | **USGS NWIS Instantaneous Values** | Public domain | Discharge + gage height → Hydrological signals |
| Water in context | **USGS NWIS Statistics** | Public domain | Median / p10 / p90 for *this calendar day* across the full record, so "low" means low for a September. RDB. `adapters/watershed.mjs` |
| Weather + hazards | **NWS api.weather.gov** | Public domain (US Gov) | Current conditions, today's forecast, active hazard alerts. No key, no account. `adapters/weather.mjs` |
| Weather (rest of world) | **Open-Meteo** | CC-BY-4.0, no account | Global fallback where the NWS has no coverage. Carries no official hazard feed, and says so rather than implying all-clear. |
| Sun and moon | *none — computed here* | Public domain algorithm (NOAA) | Sunrise, sunset, daylight and its daily change, moon phase, next solstice/equinox. `adapters/sky.mjs`. The one reading that can never be stale or rate-limited. |
| Geocoding | **Nominatim** (OpenStreetMap) | ODbL, no key | Free-form place lookup for the first run. One request per second, enforced in `adapters/geocode.mjs`. Nothing is bulk-downloaded. |
| Geocoding (fallback) | **Open-Meteo geocoding** | CC-BY-4.0, no account | A settlement gazetteer for when Nominatim is unavailable. |
| Discovery / federation | **Murmurations Protocol** | GPL-3.0 (service) | Profile generation, live schema validation, Index search. `adapters/murmurations.mjs` |
| Economic accounting | **ValueFlows / REA** | Open vocabulary | The Exchange tables are VF-shaped; exports JSON-LD for **hREA** (Holochain) and **bonfire_valueflows**. `adapters/valueflows.mjs` |
| Knowledge federation | **KOI-net** (BlockScience / Metagov / Regen Network) | MIT | RID manifests + bundles: labels travel, material stays. `adapters/koi.mjs` |
| Field mapping | **CoMapeo / Mapeo** (Digital Democracy) | GPL-3.0 | GeoJSON import shaped for CoMapeo category fields. `adapters/geo.mjs` |
| Farm records | **farmOS / OpenTEAM** | GPL-2.0 | Observation shape (quantity/unit/observed_at) on signals |
| Base map | **MapLibre GL** + **CARTO Positron** | BSD-3 / open tiles | No API key required |
| 3D rendering | **deck.gl** | MIT | `GeoJsonLayer` extrusion, `_GlobeView` |

## What is not wired yet

The table above covers Atlas layers 1 and 2 and part of 3. Layers 4-12 — land and
soil, habitat and biodiversity, climate hazards, settlement, care systems, skills,
flows, culture — have open data available for all of them. The catalogue, with every
endpoint verified live, the licences checked, and the sources that must **not** default
to public sensitivity, is in **[DATA_SOURCES.md](DATA_SOURCES.md)**.

## Global ecoregions (optional)

The 3D map covers the United States live, from EPA. For elsewhere, drop a GeoJSON
at `data/upstream/global-ecoregions.geojson`:

- **RESOLVE Ecoregions 2017** — 844 ecoregions, **CC-BY-4.0**. Safe to vendor and
  redistribute with attribution. Recommended.
- **One Earth Bioregions 2023** — 185 bioregions, **CC-BY-NC-4.0**. NonCommercial,
  so this project does **not** redistribute its geometry. Its bioregion names are
  used as reference labels only. If your use is noncommercial you may add it
  yourself; if you intend to sell anything built on this, don't.

## The Green Fire doctrine

`content/greenfire/doctrine.json` carries the civic and ecological framework from
the Green Fire Research and Innovation Center — the twelve-stage loop, the seven
engines, the four scales, the Land Seat, care infrastructure, elder-guidance
protocol, and the AI limits.

The commercial media offerings from the Green Fire site (packages, cinematic,
studio, workshops, pricing, booking) are deliberately **not** included. This is
the commons, not the business.

## Where each protocol rule lives in the code

| Rule from the manual | Enforced in |
|---|---|
| Chapter must publish what it does NOT represent | `chapters.does_not_represent`, checked by `minimumViableTest` |
| Every council item carries a Land Seat report | `engines/council.mjs` → `propose()` |
| Irreversible decisions need a heavier method | `engines/council.mjs` → `IRREVERSIBLE_METHODS` |
| Monitoring must change decisions | `decide()` requires a review date; `indicators.decision_trigger` |
| A red flag overrides a high score | `engines/quest.mjs` → `canAdvance()` |
| Gates close on evidence and a named reviewer | `engines/quest.mjs` → `satisfyGate()` |
| Terms before work begins | `engines/exchange.mjs` → `record()` |
| Care is infrastructure | `gatherings.care_*`, `careGaps()` |
| AI assists but does not govern | `engines/stewardship.mjs` → `AI_FORBIDDEN`, `logAI()` |
| Sensitive material is protected | `core/ids.mjs` → `visibleAt()`, applied in `geo.mjs` and `koi.mjs` |
| Knowledge travels responsibly | `learn.travels`, `adapters/koi.mjs` → `bundle()` |
