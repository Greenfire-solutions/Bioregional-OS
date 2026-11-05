# The open data the Atlas is missing

*Researched and endpoint-verified 2026-09-12. Every "verified" line below was
called live from this machine on that date and its response inspected.*

The protocol names twelve Living Commons Atlas layers. When this catalogue was
researched the OS resolved two of them. Most are now wired; the twelfth is the
chapter's own work and is correctly empty. **This sentence is the kind that
rots**, so it states no figure: `npm run doctor` and `adapters/registry.mjs` are
where the coverage actually lives.

*Updated 2026-09-12 after building `soil.mjs`, `life.mjs`, `hazards.mjs` and
`registry.mjs`. Where research and the build disagreed, the build won and this
document was corrected; trap S6 in particular was wrong.*

This document is the catalogue of free and open data that fills those layers, and
— more importantly — the design for how it joins the system that already exists
without creating a second path.

---

## Part 1 — What is already wired

| Layer | Source | Adapter | Licence |
|---|---|---|---|
| 1. Ecoregions | EPA Ecoregions L3/L4 | `ecoregion.mjs`, `layers.mjs` | Public domain |
| 2. Watersheds | USGS WBD (HUC12/HUC8) | `watershed.mjs` | Public domain |
| 3. Water systems | USGS NWIS values + daily statistics | `watershed.mjs` | Public domain |
| 4. Land and soil | SSURGO · SoilGrids · 3DEP · NLCD | `soil.mjs` | Public domain / CC-BY |
| 5. Habitat and biodiversity | iNaturalist · GBIF · PAD-US | `life.mjs` | CC0–CC-BY / public domain |
| 6. Climate stress and hazards | NWS alerts · FEMA NFHL · USDM · FIRMS | `hazards.mjs` | Public domain |

Layers 7 through 12 are still whatever a human typed in.

---

## Part 2 — The catalogue, by Atlas layer

Legend: **✓ verified** = called live 2026-09-12 and the shape of the answer
confirmed. **key** = requires an account, which breaks the "no account" promise,
so it must be an optional adapter that degrades to absent.

### Layer 3 — Water systems (completing it)

| Source | Licence | Endpoint | Status |
|---|---|---|---|
| **USGS NWIS Statistics** — 30-year daily median and percentiles per gage. This is what turns "41 cfs" into "the lowest this date in three years". | Public domain | `waterservices.usgs.gov/nwis/stat/` | **✓ verified — but see trap S1: no JSON, `format=rdb` only** |
| **Water Quality Portal** (USGS + EPA + tribes, 430M results) — nitrate, E. coli, turbidity, temperature at monitoring stations | Public domain | `waterqualitydata.us/data/Station/search`, `/data/Result/search` | Documented, CSV/JSON |
| **USGS Groundwater levels** (NWIS `gwlevels`) — well depth over time, for a commons on a shared aquifer | Public domain | `waterservices.usgs.gov/nwis/gwlevels/` | Same service family as the working gage adapter |
| **EPA ATTAINS** — which reaches are legally listed as impaired, and for what | Public domain | `attains.epa.gov/attains-public/api/` | Documented |
| **NHDPlus HR flowlines** — flow direction, which the protocol asks for by name in layer 2 | Public domain | `hydro.nationalmap.gov/arcgis/rest/services/NHDPlus_HR/MapServer` | Same host as the working WBD adapter |

### Layer 4 — Land and soil

| Source | Licence | Endpoint | Status |
|---|---|---|---|
| **USDA SSURGO via Soil Data Access** — the authoritative US soil survey. Map unit, component, drainage class, taxonomic order, hydric rating, and per-horizon pH, organic matter, clay/sand %, available water capacity | Public domain | POST `SDMDataAccess.sc.egov.usda.gov/Tabular/post.rest` | **✓ verified.** Barton Creek returned *Speck clay loam, 1–5% slopes, stony* — Mollisol, well drained, non-hydric, 0–36 cm: 2% OM, pH 7.0, 32% clay, AWC 0.18 |
| **ISRIC SoilGrids v2** — the same questions answered anywhere on Earth at 250 m: pH, organic carbon, bulk density, clay/silt/sand, CEC, nitrogen, six depths | CC-BY-4.0 | `rest.isric.org/soilgrids/v2.0/properties/query` | **✓ verified — see trap S2: values are scaled integers** |
| **USGS 3DEP elevation (EPQS)** — elevation at a point, 1 m lidar where flown | Public domain | `epqs.nationalmap.gov/v1/json` | **✓ verified** — 628.8 ft at the Barton Creek seed place |
| **NLCD land cover** (MRLC) — 30 m developed/forest/grassland/wetland/cropland classes, 2001→present, so *change* is available, not just state | Public domain | `mrlc.gov/geoserver/mrlc_display/wms` GetFeatureInfo | **✓ verified — see trap S3: returns a palette index, not a class name** |
| **ESA WorldCover** — 10 m global land cover, 11 classes | CC-BY-4.0 | WMS/WMTS + AWS Open Data | The global counterpart to NLCD |
| **USDA Cropland Data Layer** | Public domain | `nassgeodata.gmu.edu/CropScape/` | **Did not respond from this machine** — retry on his network |

### Layer 5 — Habitat and biodiversity *(and the herb layer)*

This is the layer with the most open data and the most ethical weight. Read Part 4
before wiring any of it.

| Source | Licence | Endpoint | Status |
|---|---|---|---|
| **GBIF occurrences** — every digitised museum specimen, survey and citizen record on Earth | CC0 / CC-BY per dataset | `api.gbif.org/v1/occurrence/search` | **✓ verified** — 82,010 plant records in the Barton Creek bounding box alone, no key |
| **iNaturalist** — what people have actually seen here, with photos, and `species_counts` gives a ranked local species list in one call | CC0–CC-BY-NC per observation | `api.inaturalist.org/v1/observations/species_counts` | **✓ verified** — 2,784 plant species in that same box, no key |
| **USDA PLANTS** — native vs introduced status, wetland indicator, growth habit, the authority for "does this belong here" | Public domain | `plantsdb.xyz` (community REST mirror); bulk via USDA | Bulk download is the honest local-first option |
| **Dr. Duke's Phytochemical and Ethnobotanical Databases** — USDA ARS. Plant → chemical → biological activity → ethnobotanical use. The single richest open medicinal-plant dataset in existence | **CC0** | Bulk tables on Ag Data Commons; web UI at `phytochem.nal.usda.gov` | No API. Vendor the tables — they are CC0, they don't change fast, and local-first is the point |
| **Native American Ethnobotany Database** (Moerman / BRIT) — 45,000 uses of 4,000 plants by 300 nations | Academic, attribution; not a blanket open licence | `naeb.brit.org` | **Do not auto-ingest. See Part 4.** |
| **LANDFIRE Existing Vegetation Type** — 30 m NatureServe ecological systems: the actual plant community standing on a site | Public domain | `landfire.gov`, Earth Engine catalogue | The bridge between "ecoregion" and "what grows in my field" |
| **PAD-US protected areas** — is this parcel public land, what agency, what GAP protection status | Public domain | `apps.fs.usda.gov/arcx/rest/services/EDW/EDW_PADUS_01/MapServer` | **✓ verified via the USFS mirror** — `gis1.usgs.gov` returned 502 |
| **USA-NPN phenology (SI-x)** — spring first-leaf and first-bloom, current year, 6-day forecast, 30-year normal and the anomaly against it | Public domain | `geoserver.usanpn.org/geoserver/wms` GetFeatureInfo | **✓ verified** — 30-year average leaf-out at Barton Creek is **day 26** (26 January). Anomaly against that is the best single "the land is early/late this year" number available free |
| **Falling Fruit** — mapped urban edibles | CC-BY-**NC**-SA | `fallingfruit.org` | NonCommercial — same treatment as One Earth: reference, never redistributed |
| **eBird** | Free, **key** | `api.ebird.org/v2` | Optional adapter |

### Layer 6 — Climate stress and hazards

| Source | Licence | Endpoint | Status |
|---|---|---|---|
| **NOAA / api.weather.gov** — forecast, current conditions, and **active alerts** on a 2.5 km grid | Public domain, no key | `api.weather.gov/points/{lat},{lon}` | **✓ verified.** Requires a `User-Agent` — the OS already sends one |
| **Open-Meteo** — ERA5 reanalysis back to 1940, gap-free, global. This is where "same week last year" gets its weather, and where first/last frost dates come from | CC-BY-4.0, no key | `archive-api.open-meteo.com` | **Free tier is non-commercial, ≤10k calls/day.** Use api.weather.gov inside the US; Open-Meteo for history and for the rest of the world |
| **US Drought Monitor** — the weekly D0–D4 class for a county | Public domain | `usdmdataservices.unl.edu/api/` | **Host resolves but did not answer from this machine.** Verify on his network before building against it |
| **FEMA National Flood Hazard Layer** — is this site in a regulatory floodplain | Public domain | `hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28` | **✓ verified** |
| **NASA FIRMS** — active fire detections, near real time | Free, **key** | `firms.modaps.eosdis.nasa.gov/api/` | Optional adapter |
| **MTBS / NIFC** — burn severity history and active fire perimeters | Public domain | `burnseverity.cr.usgs.gov`, NIFC ArcGIS Open Data | |
| **OpenAQ** — air quality, global | Open, **key** | `api.openaq.org/v3` | Optional adapter |

### Layers 7 & 8 — Human settlement, accessibility, care and essential systems

| Source | Licence | Endpoint |
|---|---|---|
| **US Census ACS + TIGER** — population, income, vehicle access, tenure, at block-group grain | Public domain | `api.census.gov` (free key), `tigerweb.geo.census.gov` ArcGIS |
| **CDC/ATSDR Social Vulnerability Index** — 15 factors per tract. This is the layer that tells a commons where care is already thin | Public domain | `svi.cdc.gov/dataDownloads` |
| **EPA EJScreen** | Public domain | **Removed from EPA's site in Feb 2025.** Reconstructed and mirrored by Public Environmental Data Partners at `screening-tools.com` / `pedp-ejscreen.azurewebsites.net`. A live example of why this project caches everything to disk |
| **OpenStreetMap via Overpass** — clinics, pharmacies, food banks, libraries, shelters, drinking fountains, bus stops, springs, community gardens, farmers markets | ODbL | `overpass-api.de/api/interpreter` — **✓ verified**, returned *Seiders Spring* and market/garden nodes around Barton Creek |

### Layers 9 & 10 — Skills, spaces, tools; food, energy, material, money, information flows

| Source | Licence | Notes |
|---|---|---|
| **USDA Local Food Directories** | Public domain | Farmers markets, CSAs, food hubs, on-farm markets |
| **OpenStreetMap / Overpass** | ODbL | Makerspaces, repair cafés, tool libraries, `craft=*`, `shop=second_hand` |
| **Open Infrastructure Map / OSM power tags** | ODbL | Substations, lines, generation — the visible energy grid |
| **EIA open data** | Public domain, free key | State and utility-level generation mix |
| **Murmurations index** | Already wired | The only one of these where the entries are *other commons* |

### Layer 11 — Culture, history, community memory

| Source | Licence | Notes |
|---|---|---|
| **Native Land Digital** — territories, treaties, languages | Free, **key required** (verified: a keyless call returns a 400) | Read Part 4. This is not a lookup, it is a prompt to go talk to people |
| **National Register of Historic Places** | Public domain | NPS ArcGIS services |
| **Wikidata / Wikipedia geosearch** | CC0 / CC-BY-SA | Place-name etymology, local history, linked identifiers |

### Layer 12 — Active projects, maintenance, outcomes

Already the OS's own `quests`, `indicators` and `measurements`. Nothing upstream
belongs here — this is the layer the commons writes itself.

---

## Part 3 — How it weaves

The architecture already has the right sockets. Almost nothing new has to be
invented; what matters is refusing to invent a second path.

### Socket 1 — `adapters/` + `http.mjs`

Every new source is one file that calls `getJSON()`. It inherits the disk cache,
the timeout, and the stale-but-served fallback for free. **A new data source is a
new adapter file and nothing else.** No new plumbing, no new cache, no new
offline story.

Two of the sources above are not JSON — SSURGO is POST-with-SQL and NWIS
Statistics is tab-separated RDB. `http.mjs` needs a `postJSON()` and a `getText()`
sibling, sharing the same cache key strategy. That is the one piece of shared
infrastructure this whole catalogue requires.

### Socket 2 — `signals`, the universal observation shape

`signals` already carries `quantity_value`, `quantity_unit`, `observed_at`,
`source_adapter`, `source_ref`, `verified` and `sensitivity`. Every time-series
source above — drought class, air quality, water chemistry, phenology anomaly,
groundwater depth — lands there **with no schema change**, exactly the way USGS
gage data does today. The dedupe key `(source_adapter, source_ref, title)` that
`ingestWater()` already uses generalises unchanged.

### Socket 3 — `places`, the resolution row

`locate()` currently fills ecoregion + watershed. The same call should fill soil,
elevation, land cover, protected status and floodplain. `places` needs a handful
of columns (`soil_series`, `soil_order`, `drainage_class`, `soil_ph`,
`soil_organic_matter`, `awc`, `elevation_m`, `land_cover`, `protected_status`,
`flood_zone`, `leaf_out_doy`) and `locate()` needs its `Promise.all` widened.
**One place resolution, one row, all of it.**

### Socket 4 — `atlas_layers`, which is already a provenance registry

The table has `source`, `source_license`, `sensitivity` and `layer_no` 1–12. It
was built for exactly this. Every adapter should register its layer on first
successful fetch, so `list_atlas_layers` stops being a list of what someone
remembered to type and becomes **a live report of which of the twelve layers this
chapter can actually see, with the licence attached**.

### Socket 5 — `ai/tools.mjs`, the one registry

`ground_today`, `soil_at`, `who_lives_here`, `hazards_at` — each is one entry.
Each appears at once in Claude Code over MCP, the in-app assistant, `POST
/api/tool`, and as a generated form in the interface. This is the existing rule
and it needs no amendment.

### Socket 6 — `heartbeat.mjs`

The `TASKS` array takes `{name, every, why, run}`. New entries: refresh weather
and alerts hourly, drought weekly, phenology daily in spring, soil and elevation
**never** (they don't change — resolve once at `locate()` and stop). The `why`
field is not decoration; it is what stops the heartbeat from becoming a polling
loop nobody can justify.

### Socket 7 — `indicators`, and this is the real prize

The protocol rule is *monitoring must change decisions*. Today a chapter must
type in its own baseline, which means in practice the baseline is a guess or is
missing. With these feeds, `add_indicator` can **pre-fill a defensible baseline
from public record** — creek discharge against its own 30-year median, soil
organic matter from the survey, tree canopy from NLCD, leaf-out against the
30-year normal — each citing its source and licence.

That is the difference between a commons that asserts a change and one that can
**evidence** it. It is also what makes `decision_trigger` honest: a trigger set
against a real baseline can actually fire.

### The one thing to build that did not exist yet — now built

**`adapters/registry.mjs` — one declarative table of every upstream source.**
It exists; this section is kept because the argument for it is the argument for
keeping it the only home, and because a section headed "does not exist yet"
about a thing that does is exactly the rot this document warns about.

The project already made this decision once, correctly, for tools. It was made
again for data, before every adapter knew a little about its own sources:

```
{ id, atlas_layer, name, licence, attribution, requires_key,
  coverage: 'us' | 'global', cadence, default_sensitivity, resolve(lat,lng) }
```

Then the Atlas legend, the GeoJSON export attribution block, the
`list_atlas_layers` gap report, the heartbeat schedule, the doctor's connectivity
check, and the "what can this chapter see" answer all read from **one place**. If
that registry doesn't exist, six files will each grow their own half-copy of it,
and the licence string will be the first thing to drift — which is the one kind of
drift that is a legal problem rather than a bug.

---

## Part 4 — The sources that must not default to public

The sensitivity ladder (`public → members → council → restricted → sacred`) is
not decoration here. Three of the richest sources above are exactly the material
the protocol says must never be published without permission.

**Rare and endangered species locations.** GBIF and iNaturalist obscure
coordinates for sensitive taxa upstream — but a local database that aggregates
many obscured records, cross-references them against habitat and land cover, and
draws them on one map can re-reveal what the obscuring was protecting. Poaching
of orchids, cacti, ginseng and turtles is driven by exactly this. **Any occurrence
record for a taxon flagged threatened, endangered or sensitive must be created at
`restricted`, not `public`** — and the existing `atlasGeoJSON()` redaction marker
already does the right thing with it.

**Ethnobotanical knowledge.** Dr. Duke's is CC0 and can be vendored freely. The
Moerman/NAEB database is different: it is a compilation of specific Indigenous
nations' knowledge, recorded by ethnographers, much of it without anything a
modern reader would call consent. It is a legitimate scholarly resource and it is
**not** a feed. Ingesting it and attaching "the Tonkawa used this plant for..." to
a map pin is precisely the extraction the Data/AI engine's mandate forbids —
*organize knowledge without extracting or replacing people*. Treat it as a
**citation a human can reach for**, held at `council`, never auto-attached to a
place, and never exported.

**Native Land Digital.** Its own terms say it is not authoritative and must not
be used to make or contest land claims. So the correct wiring is not a lookup
that fills a field. It is a **prompt attached to the `indigenous_consent` gate**:
"these nations are associated with this territory — this is a starting point for
who to contact, not a substitute for contacting them, and not evidence the gate
is satisfied." The gate still closes only on `evidence` and a named `reviewed_by`,
exactly as `satisfyGate()` already requires. A dataset must never be able to close
a consent gate.

**The general rule this suggests:** the registry's `default_sensitivity` field
should be the *upstream* default, and any adapter that cannot determine whether a
record is sensitive must fail **closed** — `members`, not `public`. The imported
field data path in `geo.mjs` already does this. Make it the rule rather than one
adapter's good habit.

---

## Part 5 — Verified traps

**S1 · NWIS Statistics has no JSON.** `format=json` returns HTTP 400 with an HTML
error page. Only `format=rdb` works — tab-separated, with `#` comment headers and
a type-definition row after the header row. `getJSON()` cannot be used; this needs
`getText()` plus a small RDB parser. (Confirmed both ways, 2026-09-12.)

**S2 · SoilGrids values are scaled integers.** Each layer carries a
`unit_measure.d_factor`. pH comes back as `70` meaning 7.0; clay as g/kg. Divide
by `d_factor` or every soil number in the OS is wrong by an order of magnitude,
silently and plausibly.

**S3 · NLCD GetFeatureInfo returns `PALETTE_INDEX`, not a class.** The answer to
"what is the land cover here" is the integer `24`. The code→class table
(11 open water … 24 developed high intensity … 41 deciduous forest …) has to live
locally. Same trap shape as the EPA layer-7-not-layer-8 discovery.

**S4 · SSURGO is POST-only, raw SQL, and untyped.** `Content-Type:
application/json`, body `{"format":"JSON+COLUMNNAME","query":"SELECT ..."}`. The
point-query function is
`SDA_Get_Mukey_from_intersection_with_WktWgs84('point(lon lat)')` — **longitude
first**. The response is `{"Table":[[col names],[row],[row]]}` with everything as
strings. Errors come back as an **OGC XML document**, so a parser that assumes
JSON will throw on the error path rather than report it.

**S5 · PAD-US: use the USFS mirror.** `gis1.usgs.gov` returned 502;
`apps.fs.usda.gov/arcx/rest/services/EDW/EDW_PADUS_01/MapServer` answered
normally. Both serve the same dataset.

**S6 · CORRECTED — the US Drought Monitor works; it was refusing our user agent.**
The research pass recorded this host as unreachable because every `curl` request
returned an empty body. It does not time out and it is not down: it **rejects
some user agents outright**, and the OS's own agent string is accepted. Two more
things about it, both found only by building against it:

- **There is no `format` parameter.** It answers CSV unless you send
  `accept: application/json`. This is why `getJSON` now takes a `headers` option
  — and why the cache key includes the headers, since the same URL genuinely
  returns two different documents depending on what you asked for.
- **Its JSON field names are lowercase** (`d0`…`d4`, `validStart`), the newest
  week comes back **first**, and the class percentages are **cumulative** — D1
  coverage is counted inside D0. Reading them as exclusive shares makes a county
  look far drier than it is.

Travis County resolves correctly through the finished adapter: D2, severe
drought, 35.17% of the county, valid 2026-09-08.

The general lesson is worth more than the fix: **a source that fails from `curl`
has not been tested.** Test from the program, with the program's own headers.

CropScape (`nassgeodata.gmu.edu`) genuinely did not answer, and is unused.

**S7 · Four sources need an account**, which breaks the OS's no-account promise:
Native Land, NASA FIRMS, OpenAQ, eBird. They belong behind an optional
`.env` key, and every one of them must degrade to *absent* rather than *broken*.

**S8 · Two licences are NonCommercial** — Falling Fruit (CC-BY-NC-SA) and One
Earth, already handled. Same rule: reference labels only, geometry never
redistributed.

**S10 · GBIF's `facetLimit` is global, and "earliest year" is the casualty.**
Asking for `facet=year&facetLimit=8` returns the eight *busiest* years, not the
eight earliest — so `min()` over them reports 2013 for a place whose records
start in **1801**. Facets take a per-facet override: `year.facetLimit=250` gives
the true span while the other facets keep their top handful.

**S11 · GBIF facets on the kingdom KEY, not the name.** `facet=kingdomKey`
returns `{"1": 1408812, "6": 137379}`. There is no `facet=kingdom`; asking for it
returns an empty facet and no error, so the counts silently vanish.

**S12 · `schema.sql` is all `CREATE TABLE IF NOT EXISTS`, so a new column never
reaches an existing commons.** Adding a column to the schema file works
perfectly on a fresh database and leaves anyone who has been using the OS with a
"no such column" error that points nowhere near the cause. `core/db.mjs` now
carries an `ADDED_COLUMNS` list applied on open. Any future column goes in both
places.

**S9 · Open-Meteo's free tier is non-commercial.** Inside the US, api.weather.gov
is public domain with no such clause and should be preferred. Open-Meteo is the
history source and the global fallback, and that distinction should be written
into the registry, not left to whichever adapter was written first.

---

## Part 6 — Build order

**Built and tested 2026-09-12.** Items 1 through 5 of the original order are done.

- `http.mjs` → `postJSON()` (POST-with-SQL, and it surfaces SDA's OGC XML errors
  instead of throwing a JSON parse error on top of them) and a `headers` option
  on `getJSON`, with headers folded into the cache key.
- **`adapters/registry.mjs`** — every source declared once: licence,
  attribution, Atlas layer, coverage, cadence, default sensitivity, key
  requirement. `upstream_sources` is its persisted face, and `last_fetched_at`
  records which sources have actually answered. The duplicate copy of the twelve
  layer names that was living inside the `list_atlas_layers` handler is gone.
- **`adapters/soil.mjs`** — SSURGO with a depth-weighted 0–30 cm rooting zone,
  SoilGrids as the global fallback (d_factor applied), 3DEP elevation, NLCD
  class names. All folded into `locate()`, which now resolves layers 1, 2, 4 and
  the standing half of 6 in one pass and **skips the land half if it has already
  answered** — soil does not change on a heartbeat.
- **`adapters/life.mjs`** — iNaturalist species counts, GBIF record depth by
  facet, PAD-US protection. Two disclosure rules are structural rather than
  checked afterwards: the common list carries no coordinates because
  `species_counts` returns none, and GBIF is queried with `limit=0` so **a
  coordinate for a rare taxon never enters the process at all**. The threatened
  block is exported as `THREATENED_SENSITIVITY = 'restricted'` and the test suite
  asserts it is not `public`.
- **`adapters/hazards.mjs`** — NWS alerts, FEMA flood zone, US Drought Monitor,
  NASA FIRMS. The first upstream allowed to raise a Watch or Critical without a
  human, so two restraints are built in: **only things that started become
  signals** (a flood zone and a drought class are standing conditions and live on
  the place record), and **an unreachable source reports as unreachable** rather
  than rendering as "no alerts".
- New `places` columns with an idempotent migration in `db.mjs`; a
  `watch_hazards` heartbeat task; `soil_at`, `life_here`, `hazards_at` and
  `upstream_sources` in the one tool registry, with protocol tests to match.

Atlas coverage more than doubled, and most of the sources declared at the time
answered live on the first run. Ask `npm run doctor` for where it stands now.

### Built 2026-09-12 — locality discovery

`adapters/discover.mjs`, `discovered_datasets`, four tools, an operator item.
Auto-approval is **public domain only**, by decision.

**The licence gate is the whole safety story**, so it is an allowlist and
everything else is held. The trap it exists for, verified live: ArcGIS Hub
returns the literal string `'none'` for most of its catalogue, and `'none'`
means *nobody filled this in* — absent a licence the default is all rights
reserved. Anything reading that as "no restrictions" would auto-publish most of
the ArcGIS catalogue. `''`, `'custom'`, `'other'` and `'unknown'` fail the same
way and are refused the same way. Open-with-conditions licences — CC-BY, ODbL,
share-alike — are held too: attribution and share-alike are obligations somebody
has to accept **on behalf of** the commons, and a machine cannot accept an
obligation.

**Licence and relevance are separate gates**, which cost two bugs to learn.
Searching Austin for "creek" returns library circulation figures, because a
portal ranks by its own relevance. Reading the Atlas layer off the *search term*
filed that library dataset as a water layer — and being public domain, it
auto-approved straight onto the map. The layer now comes from the dataset's own
title and description, and a dataset naming nothing recognisable gets no layer
and is never mapped. The matched word is recorded, so a wrong guess is arguable
rather than mysterious.

The same applies to the results themselves: ArcGIS answered "trees Asheville
North Carolina" with everything about North Carolina. A candidate is now kept
only if it names the subject or shares the subject's Atlas layer — which keeps
"Waterway Setbacks" for a creek search, since it never says "creek" and is
exactly what was wanted. Austin went from 19 loose results to 10 real ones.

**Asheville is the test that matters**, because it is the one that proves this
generalises: no Socrata portal is indexed there, and the answer says so —
*"No open-data portal is indexed for Asheville, so only the global catalogue was
searched"* — rather than presenting a stranger's dataset as the city's own. "No
portal" is a fact about the locality; "the portal has nothing" is a fact about
the subject; a person can act on the second and only shrug at the first.

Approval by hand refuses without a **named reviewer**, for the same reason quest
gates do. Declining refuses without a reason, because a refusal nobody can read
gets re-litigated next season.

### Built 2026-09-12 — layers 7 through 11, and the baseline

**Atlas coverage: 11 of 12.** Layer 12 is the chapter's own quests and
measurements and correctly has no upstream.

- **`community.mjs`** — layers 7, 8, 9 and 10 in one Overpass query. Care,
  food, skills, flows. **One tag lesson worth keeping: `amenity=shelter` in OSM
  is a bus shelter.** Within 3 km of Barton Creek it matches 135 objects — 109
  bus stops, 9 gazebos, 8 pergolas — and not one is a refuge. Mapping it to care
  infrastructure would have told a chapter it has 135 shelters when it has none.
  A refuge is `social_facility=shelter`. Similarly `power=generator` matches
  every mapped rooftop solar panel: 242 against 2 substations, which made
  "energy infrastructure" the largest category in the layer and the headline
  read *most numerous: energy infrastructure (244)*. True and useless.
  Distributed generation is now its own count-only category.
- **`culture.mjs`** — layer 11, empty after two sweeps, now the richest. Barton
  Springs appears on **235 digitised newspaper pages, earliest 1887**; 112
  research papers name it; 60 historic sites and 12 Wikipedia articles sit
  within 5 km; and **2,934 field recordings** of what lives here.
- **`phenology.mjs`** — the season clock's evidence. *"Leaf-out here normally
  begins around January 26; this year is running 3 days late."* Plus hardiness
  zone 9a and forty years of monthly normals.

**The sound layer's licence rule.** A recording's MEDIA licence is a different
field from its observation's, and the default is CC-BY-NC. Sampled live: 41
CC-BY-NC, 2 CC-BY, 2 with no licence at all. So audio is **linked at its own
host and never copied**, nothing carrying media may enter an export or a shared
card, and a null licence is excluded first — an unlicensed recording is all
rights reserved, which is the `'none' is not a licence` trap in a different
field of a different API. Counts, species and dates are facts and travel freely.

**Indicator pre-fill — the one that changes what the protocol can enforce.**
The rule is *monitoring must change decisions*, but a `decision_trigger` set
against a guessed baseline cannot honestly fire, so the rule existed on paper.
`propose_baseline` now draws the starting value from public record — creek
discharge against its own 48-year median for this calendar day, soil organic
matter from the survey, species richness, the normal first-leaf date, climate
normals — each carrying its source, licence and method. **It refuses rather than
guesses**, because a wrong baseline makes a decision look evidenced when it is
not.

Two bugs found in that work, both the plausible kind. `day_median` does not
exist on the gage context — the field is `day_of_year_median` — and `??` fell
through to the SEVEN-DAY median, a different statistic answering a different
question. Both read 0 that day, so it looked right; the real 48-year answer is
1.2 ft³/s. And the licence lookup used `require()` inside an ES module, which
threw, was swallowed by a catch, and returned null for every baseline. A missing
licence renders as a missing licence.

### What remains

1. **Water quality** — the Water Quality Portal answers with 284 monitoring
   stations around Barton Creek and is not yet wired; NHDPlus HR would add the
   flow direction the protocol asks for by name.
2. **`community.mjs`** — Overpass for care and food infrastructure, CDC SVI for
   where care is already thin. Atlas layers 7–10, and four layers are
   substantially one Overpass query each.
2. **`phenology.mjs`** — USA-NPN SI-x against the 30-year normal. Small, and it
   answers the season clock's question directly: is this year early or late?
3. **Indicator pre-fill.** The feeds now exist, so `add_indicator` can offer a
   baseline from public record — creek discharge against its own 30-year median,
   soil organic matter from the survey, canopy from NLCD. This is the one that
   changes what the protocol can *enforce*, and it is now unblocked.
4. **Surface layer 4 and 5 in the interface.** The data reaches `ground_today`
   and the tools; it is not yet on the Atlas or in the Ground strip.
5. **Water quality** (WQP) and **flow direction** (NHDPlus HR) to finish layer 3
   properly.

Layer 11 (culture) and the consent-gated sources in Part 4 stay last, and stay
manual, on purpose.

---

# Second sweep — 2026-09-12

The first pass went looking for soil, plants, water and weather, and found them.
This pass went looking for **everything else**: free APIs, public GitHub
datasets, and anything downloadable. Same rule as before — every line marked
verified was called live from this machine and its answer inspected.

It changed the shape of the problem. The first pass produced a list of sources.
This one produced **a different idea about where sources come from**.

## The finding that matters most

**Stop enumerating sources. Start discovering them.**

Two catalogue APIs index the open-data portals of most US cities and counties,
and both answer without a key:

- **Socrata Discovery API** — `api.us.socrata.com/api/catalog/v1` — **✓ verified**
- **ArcGIS Hub API** — `hub.arcgis.com/api/v3/datasets` — **✓ verified**

Asked what Austin publishes about creeks, Socrata returns nine datasets
including **Watershed Reach Integrity Scores**, **Watershed Reach Index and
Problem Scores**, **Water Quality Sampling Data**, **Erosion Hazard Zone Review
Buffer** and **Waterway Setbacks**.

No federal feed has any of that. It is the municipality's own monitoring of the
exact creek this chapter organizes around — and the equivalent exists for
thousands of other localities, under names nobody could guess in advance.

That is the whole argument. Hardcoding `datahub.austintexas.gov` would serve one
chapter. A `discover.mjs` that asks *"what does my locality publish about
water / trees / parks / flooding?"* serves every chapter, in every bioregion,
including the ones that do not exist yet. It turns a US-federal-shaped OS into
one that gets sharper the more local you are — which is the direction a
bioregional tool should get sharper in.

It also needs the registry's discipline more than anything else here: results
come back with wildly varying licences, so a discovered dataset must be
registered with its licence and a **`members`** default sensitivity, never
auto-published.

## New sources, by layer

### Layer 3 — Water systems
| Source | Licence | Status |
|---|---|---|
| **NOAA Tides & Currents** — water level, currents, 302 stations, for any coastal or estuarine chapter | Public domain | **✓ verified**, no key |
| **HydroSHEDS / HydroRIVERS** — global river network and flow direction, the worldwide answer to NHDPlus | CC-BY-4.0 (non-commercial clause on some layers — check per layer) | **✓ download live** |

### Layer 4 — Land and soil
| Source | Licence | Status |
|---|---|---|
| **USDA Plant Hardiness Zone API** (`phzmapi.org`) — the single most practically useful number for anyone growing anything. Zone by ZIP, no key, no account | Public domain | **✓ verified** — 78704 returns zone **9a**, 20–25 °F |
| **NASA POWER** — 40 years of global agroclimatology as monthly normals: temperature, precipitation, solar, humidity. Works anywhere on Earth | Public domain (NASA) | **✓ verified**, no key |
| **Natural Earth** — public-domain vector basemap, coastlines, rivers, boundaries at three scales | **Public domain** | **✓ download live** — the one basemap with no attribution obligation at all |

### Layer 5 — Habitat and biodiversity
| Source | Licence | Status |
|---|---|---|
| **iNaturalist sound recordings** — filter observations by `sounds=true` and get field recordings of birds, frogs, insects, with a licence on each | CC0–CC-BY-NC per recording | **✓ verified** — **4,371 recordings within 15 km of Barton Creek**, no key |
| **GBIF species API** — vernacular names, synonyms, taxonomy, separate from occurrences | CC0 | **✓ verified** |

### Layer 6 — Climate stress and hazards
| Source | Licence | Status |
|---|---|---|
| **USGS Earthquake FDSN** — events by radius and magnitude, any timeframe | Public domain | **✓ verified**, no key |
| **GDACS** (Global Disaster Alert and Coordination System) — earthquakes, cyclones, floods, drought, wildfire, **globally**. This is the answer to "the NWS only covers the US" | Open, UN/EC | **✓ verified**, no key. Requires an `eventlist` parameter |

### Layers 7 & 8 — Settlement, accessibility, care
| Source | Licence | Status |
|---|---|---|
| **Open Referral / HSDS + HSDA** — the open standard for community resource directories: the 211 data model for services, organizations and the locations you reach them at. **A protocol, not a dataset** | Open specification | Exactly the shape this OS already integrates (Murmurations, ValueFlows, KOI). Layer 8 is a schema problem before it is a data problem |
| **GTFS** — the transit feed standard. Accessibility to a hub is a GTFS question | Open specification | Feed registries mostly need a key; the spec does not |
| **EPA Envirofacts** — TRI releases, permitted facilities, enforcement. Who is discharging what, near here | Public domain | **✓ verified**, no key |
| **FCC Census Block API** — point to census block, tract and county FIPS. Already load-bearing: the drought adapter uses it | Public domain | **✓ verified**, no key |

### Layers 9 & 10 — Skills, institutions, flows
| Source | Licence | Status |
|---|---|---|
| **ProPublica Nonprofit Explorer** — every 501(c)(3) by state and name, with revenue, assets and filings. This answers "who else is already organized here, and what are they running on" | Free API, attribution | **✓ verified**, no key |
| **WRI Global Power Plant Database** — every power station on Earth with fuel, capacity and owner | CC-BY-4.0 | **✓ download live** |
| **Overture Maps** — places, buildings, transportation, addresses, globally, from Amazon/Meta/Microsoft/TomTom | CDLA-Permissive-2.0 (buildings are ODbL, being OSM-derived) | The heavyweight option for layers 7–10 if Overpass ever stops being enough |
| **Who's On First** — openly licensed gazetteer, continents down to neighbourhoods and venues | CC-BY | Stable identifiers, which is what RIDs want to hang off |
| **GeoNames** — full country dumps, no key needed for the download (the *API* needs an account) | CC-BY-4.0 | **✓ download live** |

### Layer 11 — Culture, history, community memory
This layer was empty in the first pass. It is not empty any more.

| Source | Licence | Status |
|---|---|---|
| **Chronicling America / Library of Congress** — digitised historic newspapers, searchable by place and phrase, full text, public domain. *What did this creek appear in the paper for, in 1898?* | **Public domain** | **✓ verified** at `loc.gov/collections/chronicling-america/?fo=json` — the old `chroniclingamerica.loc.gov` API is now a 404 |
| **OpenAlex** — the open research graph. **112 papers mention Barton Springs.** A chapter's own bioregion has a scientific literature, and almost no community knows it exists | CC0 | **✓ verified**, no key |
| **Wikipedia GeoSearch** — every article with coordinates within a radius | CC-BY-SA | **✓ verified**, no key |
| **Wikidata SPARQL** — structured facts, linked identifiers, place etymology | CC0 | **✓ verified**, no key |
| **OSM `historic=*` via Overpass** — memorials, ruins, markers, sites | ODbL | **✓ verified** |

## The key-gated tier

These are good sources that require an account, which breaks the OS's no-account
promise. Verified as requiring a key: **OpenAQ**, **NPS**, **Recreation.gov
(RIDB)**, **Transitland**, **OpenChargeMap**, **GeoNames API**, **DPLA**,
**Xeno-canto** (it was open and is not any more), **eBird**, **NASA FIRMS**,
**US Census**, **USDA Local Food Directories**.

The registry already has `requires_key` and `missingKeys()`. What is missing is
the human half: something like `npm run connect` for data — a page that says
*here is what a key would unlock, here is where to get it, here is where to put
it* — and every one of them degrading to a named absence rather than an error.

## Sources that resisted

**CropScape** (USDA Cropland Data Layer) still did not answer. **Open Food
Facts** returned a 503. **Mutual Aid Hub** has no API — it is a single-page app
with no public data endpoint, which is a pity, because a directory of mutual aid
networks is precisely layer 8. **CKAN at `catalog.data.gov`** has moved; the
Socrata and ArcGIS Hub catalogues cover the same ground better.

## What this implies for the architecture

Three things, in the order they would be built.

**1. The registry needs a second kind of entry.** Everything in it today is a
*resolver*: give it a point, it returns a value. Socrata and ArcGIS Hub are
*discoverers*: give them a locality and a subject, they return **datasets**,
each with its own licence, geometry and refresh cadence. Those need a different
shape — `discover(locality, subject)` alongside `resolve(lat, lng)` — and a
holding area, because a discovered dataset is a candidate a human should approve
before it becomes an Atlas layer. Registering it automatically would let an
unreviewed licence into an export, which is the one failure this whole registry
exists to prevent.

**2. Layer 8 is a schema problem, not a data problem.** Open Referral/HSDS
already describes care infrastructure properly, and the OS's doctrine is to
speak protocols rather than vendor code. Shaping the care tables to HSDS now —
before there is data in them — costs nothing and means a chapter can import a
211 feed, or publish one, without a migration later. This is the same decision
that was already made correctly for ValueFlows.

**3. There is a sound layer nobody else is building.** 4,371 CC-licensed field
recordings within fifteen kilometres of one seed place, with a licence on each,
reachable without a key. Every bioregional and mapping tool in the ecosystem
treats a place as something you look at. A commons that can also *hear* its
watershed — this year against last year, dawn against dusk, before a development
against after — is a genuinely new instrument, and the data for it is already
public and already local. It is the cheapest distinctive thing available here.
