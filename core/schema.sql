-- ============================================================
-- BioRegional OS — core schema
-- Implements the BioRegional Commons protocol (Green Fire, v1.1)
-- Every table maps to a named part of the manual.
-- Interop field names follow upstream open standards where they exist:
--   murmurations_*  -> Murmurations Protocol profile fields
--   vf_*            -> ValueFlows / REA vocabulary
--   rid             -> KOI-net Reference Identifier
-- ============================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------- Identity & provenance (KOI-inspired) ----------
-- Every object in the OS gets a Reference Identifier so knowledge can
-- travel between chapters without the underlying material moving.
CREATE TABLE IF NOT EXISTS rids (
  rid           TEXT PRIMARY KEY,          -- orn:bros.<type>:<chapter>/<local_id>
  object_type   TEXT NOT NULL,
  local_id      TEXT NOT NULL,
  chapter_id    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  sensitivity   TEXT NOT NULL DEFAULT 'public'
                CHECK (sensitivity IN ('public','members','council','restricted','sacred')),
  UNIQUE (object_type, local_id, chapter_id)
);

-- ---------- Chapter: the unit of legitimacy ----------
CREATE TABLE IF NOT EXISTS chapters (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  scale             TEXT NOT NULL DEFAULT 'site'
                    CHECK (scale IN ('site','watershed','bioregion','ecoregional')),
  -- The manual requires every chapter to publish what it does and does NOT represent.
  represents        TEXT NOT NULL DEFAULT '',
  does_not_represent TEXT NOT NULL DEFAULT '',
  provisional_scope TEXT NOT NULL DEFAULT '',
  founded_at        TEXT NOT NULL DEFAULT (datetime('now')),
  charter_adopted   INTEGER NOT NULL DEFAULT 0,
  -- Murmurations profile fields, so the chapter is discoverable by the wider network
  murmurations_primary_url TEXT,
  murmurations_schema      TEXT DEFAULT 'organizations_schema-v1.0.0',
  murmurations_published_at TEXT,
  lat REAL, lng REAL,
  locality TEXT, region TEXT, country TEXT
);

-- ---------- Stage 1: Locate — places, watersheds, bioregions ----------
CREATE TABLE IF NOT EXISTS places (
  id          TEXT PRIMARY KEY,
  chapter_id  TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  region      TEXT,
  description TEXT,
  lat REAL, lng REAL,
  -- resolved against vendored open datasets (One Earth / RESOLVE / USGS WBD)
  bioregion_code   TEXT,   -- One Earth Bioregions 2023 code, e.g. NA19
  bioregion_name   TEXT,
  ecoregion_id     INTEGER,-- RESOLVE Ecoregions 2017 ECO_ID
  ecoregion_name   TEXT,
  realm            TEXT,
  biome            TEXT,
  watershed_huc    TEXT,   -- USGS Watershed Boundary Dataset HUC code
  watershed_name   TEXT,
  -- Atlas layer 4 — land and soil. Resolved once and then left alone: soil does
  -- not change on a heartbeat. (USDA SSURGO, ISRIC SoilGrids, USGS 3DEP, NLCD)
  soil_series      TEXT,
  soil_map_unit    TEXT,
  soil_order       TEXT,
  soil_drainage    TEXT,
  soil_hydric      INTEGER,
  soil_ph          REAL,
  soil_organic_matter REAL,   -- percent, depth-weighted over the top 30 cm
  soil_clay_pct    REAL,
  soil_awc         REAL,      -- available water capacity, cm/cm
  soil_source      TEXT,
  elevation_m      REAL,
  land_cover       TEXT,
  land_cover_code  INTEGER,
  -- Atlas layer 6 — the standing hazard condition, which is a property of the
  -- place and not an event, so it does not belong in the signal stream.
  flood_zone       TEXT,
  in_floodplain    INTEGER,
  health_score     INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS hubs (
  id          TEXT PRIMARY KEY,
  chapter_id  TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  place_id    TEXT REFERENCES places(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  -- hub types named in the manual
  type        TEXT NOT NULL DEFAULT 'Field Station'
              CHECK (type IN ('Council and Culture House','Field Station','Maker and Repair Lab',
                              'Learning Commons','Media and Data Lab','Food, Seed, and Water Node',
                              'Resilience and Care Node','Stewardship Hub','Civic Commons')),
  description TEXT,
  lat REAL, lng REAL,
  stewards_count INTEGER NOT NULL DEFAULT 0
);

-- ---------- Stage 4: Map — the Living Commons Atlas (12 layers) ----------
CREATE TABLE IF NOT EXISTS atlas_layers (
  id          TEXT PRIMARY KEY,
  chapter_id  TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  layer_no    INTEGER NOT NULL CHECK (layer_no BETWEEN 1 AND 12),
  name        TEXT NOT NULL,
  source      TEXT,              -- upstream dataset or local survey
  source_license TEXT,
  sensitivity TEXT NOT NULL DEFAULT 'public'
              CHECK (sensitivity IN ('public','members','council','restricted','sacred')),
  geojson_path TEXT,
  notes       TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- Stage 2: Listen — community intake ----------
CREATE TABLE IF NOT EXISTS intake (
  id          TEXT PRIMARY KEY,
  chapter_id  TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'need'
              CHECK (kind IN ('need','idea','story','resource','opportunity','concern')),
  body        TEXT NOT NULL,
  submitted_by TEXT,
  contact     TEXT,
  private     INTEGER NOT NULL DEFAULT 0,   -- private needs intake (Care as Infrastructure)
  affected_parties TEXT,
  status      TEXT NOT NULL DEFAULT 'received'
              CHECK (status IN ('received','acknowledged','in_council','routed','declined','appealed')),
  response    TEXT,
  -- When the answer was actually given. Without it, "how long does somebody
  -- wait to be heard?" can only be measured against now, which answers a
  -- different question and flatters the commons every time a need is closed.
  responded_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- Stage 3: Observe — signals from land and people ----------
CREATE TABLE IF NOT EXISTS signals (
  id          TEXT PRIMARY KEY,
  chapter_id  TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  place_id    TEXT REFERENCES places(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'Ecological'
              CHECK (category IN ('Hydrological','Ecological','Climate','Disturbance',
                                  'Social','Infrastructure','Cultural')),
  severity    TEXT NOT NULL DEFAULT 'Info' CHECK (severity IN ('Info','Watch','Critical')),
  location_name TEXT,
  lat REAL, lng REAL,
  description TEXT,
  author      TEXT,
  verified    INTEGER NOT NULL DEFAULT 0,
  -- observation interop: farmOS/OpenTEAM-style quantity, and source provenance
  observed_at TEXT,
  quantity_value REAL,
  quantity_unit  TEXT,
  source_adapter TEXT,        -- 'manual' | 'usgs' | 'comapeo' | 'farmos' | ...
  source_ref     TEXT,
  sensitivity TEXT NOT NULL DEFAULT 'public'
              CHECK (sensitivity IN ('public','members','council','restricted','sacred')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- Stages 6-12: Quests (the Green Fire Quest pathway) ----------
CREATE TABLE IF NOT EXISTS quests (
  id          TEXT PRIMARY KEY,
  chapter_id  TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  place_id    TEXT REFERENCES places(id) ON DELETE SET NULL,
  signal_id   TEXT REFERENCES signals(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  category    TEXT,
  location_name TEXT,
  lat REAL, lng REAL,
  description TEXT,
  -- the 12 steps of the Green Fire Quest
  stage       TEXT NOT NULL DEFAULT 'signal'
              CHECK (stage IN ('signal','listening','baseline','council_review','research',
                               'co_design','resource_plan','prototype','teach_tell','test',
                               'decide','report_replicate')),
  status      TEXT NOT NULL DEFAULT 'Open'
              CHECK (status IN ('Open','Active','Paused','Complete','Stopped')),
  -- the project definition the manual requires before build
  need_statement     TEXT,
  desired_condition  TEXT,
  smallest_experiment TEXT,
  ecological_fit     TEXT,
  budget_note        TEXT,
  maintenance_owner  TEXT,
  end_of_life_plan   TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Red flags and consent gates. A high score never overrides a red flag.
CREATE TABLE IF NOT EXISTS quest_gates (
  id          TEXT PRIMARY KEY,
  quest_id    TEXT NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
  gate        TEXT NOT NULL
              CHECK (gate IN ('rights_holder_consent','indigenous_consent','land_access',
                              'youth_safeguarding','permits_insurance','ecological_assessment',
                              'maintenance_owner','affected_party_process','data_consent')),
  required    INTEGER NOT NULL DEFAULT 1,
  satisfied   INTEGER NOT NULL DEFAULT 0,
  evidence    TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  UNIQUE (quest_id, gate)
);

-- ---------- Stage 11: Measure — monitoring that changes decisions ----------
CREATE TABLE IF NOT EXISTS indicators (
  id          TEXT PRIMARY KEY,
  quest_id    TEXT REFERENCES quests(id) ON DELETE CASCADE,
  chapter_id  TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  unit        TEXT,
  baseline_value REAL,
  baseline_at    TEXT,
  target_value   REAL,
  target_by      TEXT,
  method         TEXT,
  cadence        TEXT,
  -- the manual's decision trigger: a result that forces a change
  decision_trigger TEXT,
  stewardship_horizon TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS measurements (
  id           TEXT PRIMARY KEY,
  indicator_id TEXT NOT NULL REFERENCES indicators(id) ON DELETE CASCADE,
  value        REAL NOT NULL,
  uncertainty  REAL,
  measured_at  TEXT NOT NULL DEFAULT (datetime('now')),
  measured_by  TEXT,
  method_note  TEXT,
  source_adapter TEXT
);

-- ---------- Stage 5: Convene — council, decisions, the Land Seat ----------
CREATE TABLE IF NOT EXISTS decisions (
  id          TEXT PRIMARY KEY,
  chapter_id  TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  quest_id    TEXT REFERENCES quests(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  body        TEXT,
  -- decision methods, straight from the manual
  method      TEXT NOT NULL DEFAULT 'consent'
              CHECK (method IN ('publish_notify','delegated_after_advice','consent',
                                'participatory_fund','supermajority_consensus',
                                'explicit_permission','emergency')),
  scale       TEXT NOT NULL DEFAULT 'site'
              CHECK (scale IN ('site','watershed','bioregion','ecoregional')),
  status      TEXT NOT NULL DEFAULT 'proposed'
              CHECK (status IN ('proposed','in_review','decided','reversed','expired')),
  reversible  INTEGER NOT NULL DEFAULT 1,
  -- every agenda carries a Land Seat report
  land_seat_report     TEXT,
  land_seat_steward    TEXT,
  downstream_effects   TEXT,
  uncertainty_note     TEXT,
  red_flags            TEXT,
  affected_parties     TEXT,
  review_date          TEXT,
  reconsideration_until TEXT,
  decided_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- Stage 9 & 7: Culture — gatherings tied to real projects ----------
CREATE TABLE IF NOT EXISTS gatherings (
  id          TEXT PRIMARY KEY,
  chapter_id  TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  quest_id    TEXT REFERENCES quests(id) ON DELETE SET NULL,
  place_id    TEXT REFERENCES places(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'session'
              CHECK (kind IN ('session','council','workshop','work_party','listening',
                              'screening','market','ceremony')),
  starts_at   TEXT,
  location_name TEXT,
  description TEXT,
  -- Care as Infrastructure: a gathering without care provision is incomplete
  care_meals INTEGER NOT NULL DEFAULT 0,
  care_transport INTEGER NOT NULL DEFAULT 0,
  care_childcare INTEGER NOT NULL DEFAULT 0,
  care_accessibility INTEGER NOT NULL DEFAULT 0,
  care_notes  TEXT,
  rsvp_count  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- Stage 10: Exchange & Care (ValueFlows / REA shaped) ----------
-- Agents, resources, and economic events, following the ValueFlows vocabulary
-- so a chapter ledger can federate with hREA / Bonfire ValueFlows implementations.
CREATE TABLE IF NOT EXISTS agents (
  id          TEXT PRIMARY KEY,
  chapter_id  TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  vf_agent_type TEXT NOT NULL DEFAULT 'Person'
              CHECK (vf_agent_type IN ('Person','Organization','EcologicalAgent')),
  role        TEXT,
  contact     TEXT,
  murmurations_primary_url TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS exchange_events (
  id          TEXT PRIMARY KEY,
  chapter_id  TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  quest_id    TEXT REFERENCES quests(id) ON DELETE SET NULL,
  -- ValueFlows action verbs
  vf_action   TEXT NOT NULL
              CHECK (vf_action IN ('work','produce','consume','use','transfer',
                                   'give','receive','raise','lower','cite','accept')),
  provider_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  receiver_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  resource_name TEXT,
  vf_quantity  REAL,
  vf_unit      TEXT,
  -- the manual insists these relationships are named BEFORE work begins
  relationship TEXT NOT NULL DEFAULT 'volunteer'
              CHECK (relationship IN ('paid','contractor','apprentice','credit',
                                      'work_trade','volunteer','revenue_share')),
  terms_ack   INTEGER NOT NULL DEFAULT 0,
  note        TEXT,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- Stage 9: Teach & Tell — learning that travels ----------
CREATE TABLE IF NOT EXISTS learn (
  id          TEXT PRIMARY KEY,
  chapter_id  TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  quest_id    TEXT REFERENCES quests(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'guide'
              CHECK (kind IN ('guide','workshop','toolkit','case_study','story','protocol')),
  summary     TEXT,
  body_path   TEXT,
  license     TEXT NOT NULL DEFAULT 'CC-BY-SA-4.0',
  travels     INTEGER NOT NULL DEFAULT 1,  -- may this be federated to other chapters?
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- Media consent register ----------
CREATE TABLE IF NOT EXISTS media_consent (
  id          TEXT PRIMARY KEY,
  chapter_id  TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  subject     TEXT NOT NULL,
  purpose     TEXT NOT NULL,
  granted_by  TEXT,
  granted_at  TEXT,
  review_before_publication INTEGER NOT NULL DEFAULT 1,
  withdrawable INTEGER NOT NULL DEFAULT 1,
  withdrawn_at TEXT,
  benefit_sharing TEXT,
  sensitive_location_masked INTEGER NOT NULL DEFAULT 0,
  notes       TEXT
);

-- ---------- Data / AI engine: the transparent AI log ----------
-- The manual: AI assists but does not govern. Every material use gets logged.
CREATE TABLE IF NOT EXISTS ai_log (
  id          TEXT PRIMARY KEY,
  chapter_id  TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  tool        TEXT NOT NULL,
  purpose     TEXT NOT NULL,
  data_class  TEXT NOT NULL DEFAULT 'public'
              CHECK (data_class IN ('public','members','council','restricted','sacred')),
  affected_object_rid TEXT,
  human_reviewer TEXT,
  known_limits TEXT,
  correction_path TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- Stage 12: Federation — chapters that share without merging ----------
CREATE TABLE IF NOT EXISTS federation_peers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'chapter'
              CHECK (kind IN ('chapter','network','registry','index')),
  protocol    TEXT NOT NULL DEFAULT 'murmurations'
              CHECK (protocol IN ('murmurations','koi','activitypub','valueflows','manual')),
  url         TEXT,
  bioregion_name TEXT,
  last_synced_at TEXT,
  status      TEXT NOT NULL DEFAULT 'known'
              CHECK (status IN ('known','connected','sharing','paused')),
  -- One line of what they last published, and when this commons read it.
  -- Stored rather than fetched on view: a panel that refreshes when you look at
  -- it teaches you to look at it, which is the feed this deliberately is not.
  summary     TEXT,
  summary_at  TEXT,
  notes       TEXT
);

-- ---------- Stage 4: Map — datasets a locality publishes, found not enumerated ----------
-- A candidate is NOT a layer. A dataset discovered on a city portal arrives with
-- a licence nobody has read, and the whole point of the upstream registry is
-- that no unreviewed licence reaches an export. So discovery lands here and only
-- an unambiguous public-domain dedication promotes itself; everything else waits
-- for a person, and the operator chases them.
CREATE TABLE IF NOT EXISTS discovered_datasets (
  id            TEXT PRIMARY KEY,
  chapter_id    TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT,
  publisher     TEXT,
  portal        TEXT,
  portal_type   TEXT,              -- socrata | arcgis
  subject       TEXT,              -- what was being looked for
  source_url    TEXT,
  api_url       TEXT,
  atlas_layer   INTEGER CHECK (atlas_layer IS NULL OR atlas_layer BETWEEN 1 AND 12),
  license_raw   TEXT,              -- exactly as the portal stated it, never normalised away
  license_class TEXT NOT NULL DEFAULT 'unknown'
                CHECK (license_class IN ('public_domain','open_with_conditions','unrecognised','unknown')),
  license_note  TEXT,              -- why it was classified that way, in words
  status        TEXT NOT NULL DEFAULT 'candidate'
                CHECK (status IN ('candidate','approved','declined')),
  reviewed_by   TEXT,              -- 'automatic (public domain)' or a person's name
  reviewed_at   TEXT,
  review_note   TEXT,
  discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (chapter_id, source_url)
);

-- ---------- Upstream open-source / open-data registry ----------
CREATE TABLE IF NOT EXISTS upstream_sources (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  project     TEXT NOT NULL,
  kind        TEXT NOT NULL,     -- dataset | protocol | schema | api
  license     TEXT NOT NULL,
  url         TEXT NOT NULL,
  adapter     TEXT,
  vendored_path TEXT,
  last_fetched_at TEXT,
  notes       TEXT
);

CREATE INDEX IF NOT EXISTS idx_signals_chapter ON signals(chapter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quests_chapter  ON quests(chapter_id, status);
CREATE INDEX IF NOT EXISTS idx_intake_chapter  ON intake(chapter_id, status);
CREATE INDEX IF NOT EXISTS idx_rids_type       ON rids(object_type, chapter_id);
CREATE INDEX IF NOT EXISTS idx_events_quest    ON exchange_events(quest_id);

-- ---------- Stages 11-12: the season, closed and opened ----------
-- The protocol's loop is seasonal, not daily. A season is closed with an impact
-- and learning report (stage 11) and the next one opens with a priority list
-- (stage 6, reached through stage 12's "what should stop, continue, change or
-- travel?"). Kept as rows rather than as files because the whole point is that
-- the NEXT season can read the last one.
CREATE TABLE IF NOT EXISTS seasons (
  id          TEXT PRIMARY KEY,
  chapter_id  TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,               -- 'Autumn 2026', or whatever they call it
  opened_at   TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at   TEXT,
  closed_by   TEXT,
  -- The computed half: what the database can say about what changed.
  report      TEXT,                        -- JSON, written at close
  -- The half no machine can answer, which is why closing refuses without them.
  what_did_not_change TEXT,
  unintended_effects  TEXT,
  whose_experience_is_missing TEXT,
  -- Stage 12, decided by people reading the report.
  stops       TEXT,
  continues   TEXT,
  changes     TEXT,
  travels     TEXT,
  -- Stage 6 for the season this one opens into.
  priorities  TEXT
);
