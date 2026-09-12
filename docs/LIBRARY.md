# The ecoregion library

Every ecoregion in the United States, downloadable into this repository, readable
with the network unplugged, and refreshed only when it has actually gone stale.

## What you get per region

| | |
|---|---|
| **Identity** | Level IV and III names and codes, division, biome, states, extent |
| **Plants** | Species recorded, ranked by how often they are actually seen, with common names |
| **Animals** | Birds, mammals, reptiles and amphibians, fish, insects — same treatment |
| **Fungi** | Same |
| **Threatened species** | Names and status only. **Locations are deliberately never stored** |
| **Soil** | USDA SSURGO map units at verified points inside the region, ISRIC SoilGrids elsewhere |
| **Climate** | Monthly normals, from NASA POWER / Open-Meteo |
| **Water** | Watersheds, gages and water quality at sampled points |
| **Hazards** | Drought, flood zone, active alerts and fires |
| **Local resources** | Community assets from OpenStreetMap — the human layers of the Atlas |
| **Culture** | **Not downloaded.** See below — this is a deliberate refusal |

Roughly **100 KB per region**, so about **97 MB for all 967**.

## Getting it

```bash
npm run data                  # the regions this chapter sits in
npm run data -- --near        # ...and the ones next door
npm run data -- --region 30c  # one region by code
npm run data -- --all         # every ecoregion in the country
npm run data -- --status      # what is downloaded, what is stale
npm run data -- --offline     # prove it reads with no connection
```

Every run is **resumable**. Stop it with Control+C and run it again whenever —
it never refetches a section that is still current, so a second run costs almost
nothing.

## Staying current

Each part of a dossier has its own cadence, because a drought and a soil survey
do not change at the same speed:

| Section | Refreshed |
|---|---|
| identity | never re-asked — it ships with the software |
| hazards | every 7 days |
| life | every 30 days |
| water | every 30 days |
| resources | every 60 days |
| climate | every 180 days |
| soil | every 10 years |
| culture | never automatically |

While the OS is running, the heartbeat refreshes **one stale region per beat** —
the library is not urgent, and these are free public services that should not be
hit in a burst. Nothing happens while the OS is closed, and nothing needs the
network to be *read*.

## Why culture is not downloaded

Every other section here is open data. Culture is not.

The protocol is explicit: cultural knowledge and Indigenous knowledge require
explicit permission from the holder; no Elder speaks for a whole nation without
confirmation; restricted knowledge must not be entered into AI systems without
documented consent. Bulk-fetching a territory map into 967 files and labelling it
"culture" would break all three at once, and would be exactly the extraction the
manual was written against.

So the culture section ships as a **consultation slot**: who to contact, what has
to happen first, and an empty place for what is shared *with permission*. It is
marked `restricted` by default.

Getting a real answer here means talking to people. The software cannot do that
part, and pretending otherwise would be worse than leaving it blank.

## Threatened species

Counted and named, never located. The protocol forbids publishing sensitive
species locations, and a downloadable file that anyone can copy is the last place
a poacher-legible coordinate should live.

## Offline

Every read path — `region_brief`, `find_species`, `list_regions`, `regions_at`,
`neighbouring_regions` — touches only the filesystem. Copy the folder to a laptop
that has never had a network and it all still answers.

`npm run data -- --offline` demonstrates this.

## Sources and credit

Every section declares *which registry sources it drew on*, by id — never a
licence string of its own. `adapters/registry.mjs` is the single place a source
is declared, and `SECTION_SOURCES` in `adapters/dossier.mjs` is just the mapping:

```
identity  → epa-ecoregions
life      → inaturalist
climate   → nasa-power
soil      → usda-ssurgo, isric-soilgrids, usgs-3dep, mrlc-nlcd
water     → usgs-nwis, water-quality-portal, nhdplus-hr, usgs-wbd
resources → openstreetmap
hazards   → nws, usdm, fema-nfhl, nasa-firms
```

Attribution is rendered from the registry when the file is written, so a dossier
that travels to another chapter carries correct credit without duplicating a
licence anywhere. Two tests enforce this: one asserts the dossier adapter
contains no licence string at all, the other that every source it claims is
actually declared.

An older dossier is backfilled with source ids the next time it is written — no
refetch needed.

## Beyond the United States

The EPA dataset is US-only. The dossier machinery is not — it works from a bbox
and a name. To cover elsewhere, add a region index in the same shape from
**RESOLVE Ecoregions 2017** (846 ecoregions, CC-BY-4.0, safe to redistribute).

One Earth's Bioregions 2023 is **CC-BY-NC**, so its geometry is not vendored
here. Its bioregion names are used as reference labels only.
