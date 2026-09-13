# Where this is

Written 2026-09-12, at the end of a long build session; updated the same evening. This is the handover
note: what exists, what does not, and what the next person — or the next
session — should not have to rediscover.

Everything in **Built** is tested and pushed. Everything in **Not built** is
either researched and deliberately deferred, or known-missing. Nothing here is
aspiration; if it says built, `npm test` covers it.

---

## How to check the state yourself, in four commands

```
npm test          # the protocol suite — proves the gates REFUSE
npm run prove     # presses every button — proves the app RESPONDS
npm run doctor    # is this machine set up, are the upstreams answering
npm run data -- --status   # how much of the ecoregion library is downloaded
```

`npm test` asserts refusals. `npm run prove` runs every tool and every REST
route against a throwaway commons and tells a clean refusal from a crash — the
second is the one that catches a button doing nothing, because that failure is
invisible from a screenshot.

---

## Built

### The loop, end to end
All twelve protocol stages are enforced in code, and all four phases of
`docs/DAILY_USE.md` are shipped — the ground, first run, closing the loops, the
group card, and the long rhythms (carrying, the turning, place attention, the
neighbours, the seven numbers).

### The front door
`The commons` is the landing view: where you are, what needs doing with the
button that does each thing, the projects with what is actually in their way,
who is carrying what, and what is around you. The fifteen protocol-stage tabs
still exist behind it.

### The map as the playing field
Everything drawable is on it — places, hubs, projects, needs, gatherings,
observations, instrument readings — as HTML markers over the deck.gl canvas,
with a key in the corner that doubles as per-kind switches. Clicking one opens
a panel beside the map.

### Protocol fidelity
Four controls that read as in-place and enforced nothing were found and fixed:
the ecological-assessment gate never fired, the Land Seat was unconnected to
the land, the project score did not exist, and the AI log depended on the AI
volunteering. The suite now compares `docs/PROTOCOL.md` and `core/schema.sql`
to the code on every run.

### Two security fixes
`?clearance=sacred` was honoured from the query string. And
`offerWantProfile()` — the one function that publishes an intake item to a
world-readable global index — was the only place that did not check
`intake.private`.

### Device enrolment, with a screen
A second person can write, without accounts. **Together → Devices** mints the
code and shows it as a QR; the join page redeems it, typed or from the link's
fragment; the token rides as a header on every call. Revocation keeps the row.

### Setup cannot finish empty
`settledIn()` in `engines/firstrun.mjs` names the three things a founded
commons still lacks — a place with coordinates, a person, three human
observations — and the board keeps them at the top of *What needs doing*, each
with its button, until they exist. Gage readings never count. `settling_in`
is the tool.

### The door the enrolment engine was protecting
`POST /api/tool` ran every tool in the registry for whoever was on the wifi.
The clearance layer existed and three export routes asked it; the tool route
never did, so with `--share` on a stranger could mint a coordinator code or
revoke the steward's devices. `ai/access.mjs` is now the policy — public,
members, council, keyboard, with the keyboard as the default for anything
unlisted — and every answer leaving over HTTP is stripped of objects above the
connection's clearance, with the count reported as `withheld`.

---

## Not built, and what it would take

Ordered by how much each would change what a real chapter can do.

**1. US only.** The ecoregion index is EPA: 85 Level III, 967 Level IV.
`data/upstream/global-ecoregions.geojson` is absent, so `look_around` outside
the United States resolves a place and finds no ecoregion polygon. The intended
source is RESOLVE 2017 (CC-BY) — One Earth is CC-BY-**NC** and must not be
redistributed. See `docs/DATA_SOURCES.md`.

**2. The region library is fully downloaded for the United States.**
Regenerable and gitignored, so a fresh clone starts empty: `npm run data -- --all`
compiles it and skips what is current. An uncompiled region still shows its
identity and a download button. Ask `npm run data -- --status` for the live
figure rather than reading one here.

**3. Communications: researched, nothing built.** `docs/COMMUNICATIONS.md`
carries the whole decision. The recommendation is **inbound only** — a
neighbour can text or speak a need and get an acknowledgement; the OS never
broadcasts. Before any of it: `contact_channels`, shaped like `media_consent`
with `granted_at` / `withdrawable` / `withdrawn_at`, because `agents.contact`
and `intake.contact` are free text with no channel type, no verification and no
opt-out, and retrofitting consent onto a live roster is work nobody ever does.

**4. Voice: researched, nothing built.** Secondary but first-class — capture
and playback, never an interaction channel. Note the blocker recorded in the
doc: `getUserMedia` needs a secure context, so over `http://192.168.x.x` the
`/join` page **cannot** record audio. The way round is
`<input type="file" accept="audio/*" capture>`.

**5. No sync between two stewards' machines.** `--share` is same-wifi only. The
outbox design (one append-only file per device, never the live database) is
written up and unbuilt.

**6. Nothing happens when the laptop is closed.** Deliberate and documented,
and still a real constraint on what a chapter can rely on.

---

## Notes for future builds

Small things seen while building, deliberately left:

- **A quest cannot go backwards, and nothing yet says who could send it back.**
  `canAdvance` now refuses any move that is not to the immediately next stage,
  in either direction, because until 2026-09-13 it enforced no order at all: a
  quest at `council_review` could be rewound eleven stages to `signal` and then
  teleported four forward, in silence. The depth checks — gates, maintenance
  owner, baseline, something written down — all looked at the DESTINATION and
  never at where the quest was. One step forward is the safe rule and it is the
  one the tool description and the button already promised. But sending work
  back is a real thing a council does, and the protocol question — who may do
  it, and what is recorded when they do — has not been answered. Answer it
  before building a way to do it.

- **Settling in is a list, not a gate.** Nothing refuses while it is
  incomplete; the operator (`whats_next`) does not know about it, only the
  board does. If a chapter should be *unable* to open a project or schedule a
  gathering before it is settled, that is a protocol decision to make first.
- **First run does not ask for the three things itself.** `begin_here` founds
  and stops; the board picks it up on the next screen. Folding the three into
  the first-run flow would be one screen more and is probably right.
- **The join page's RSVP is disabled on a fresh install** because every seeded
  gathering is in the past. Seed one relative to today.
- **`add_agent` asks for `vf_agent_type`** in a form; the settling step
  prefills Person, but the form still shows the field.
- **The launcher ignores `PORT` in `.env` from Finder** on a protected folder,
  because the bundle cannot read the file. It uses 4180. The trace line in
  `~/Library/Logs/BioRegional OS.log` says so.
- **The desktop layout has no narrow-width rules.** The join page is the only
  screen designed for a small window.

## Known rough edges on the map

Found by an audit on 2026-09-12 and deliberately left, with the reasoning:

- **A badge's number has no unit.** "9" is open gates, "24" is people coming,
  "18" is people coming. Two markers can legitimately both read "8" meaning
  different things. The kind is carried by colour and shape and the meaning is
  in the key, which is enough to read but not enough to read *fast*. A unit
  glyph on the pill would fix it.
- **Long titles still truncate on hover** at about 17rem — "Barton Creek Autumn
  Watershed Ass…". Wider labels start colliding again; the real fix is
  two-line labels, which the collision pass does not yet measure.
- **Globe mode is off-key.** Markers are a single pale dot and the ecoregion
  polygons render fully saturated with white seams — a different application's
  palette. Terrain mode is the one that was designed.
- **Ecoregion polygons show tessellation artifacts** at high zoom: black
  triangular wedges across the fill. Upstream geometry plus deck.gl's
  triangulation, not the markers.

## Things that bit, and will bite again

- **`grep` returns nothing on `scripts/test.mjs` in some shells.** It cost an
  audit a false finding this session ("the tests do not exist" — they did). Use
  python or `rg` on that file.
- **Paths contain a space.** `new URL(...).pathname` keeps it percent-encoded
  and hands a subprocess a file that does not exist. Use `fileURLToPath`, or
  `isMain()` from `scripts/lib.mjs`.
- **A layer added without removing the one it replaces looks finished.** The map
  drew places, hubs and signals twice for a while, and the only symptom was that
  a switch did nothing.
- **Defence in depth hides a broken half.** Revocation is enforced twice and the
  first mutation test passed because the other half caught it. Test each half
  alone or you have one defence nobody has checked.
- **A test that asserts a list of names goes stale silently.** Assert the
  property.
- **A collision rule that can never say yes looks like one working hard.** Every
  place name collided with its OWN marker's reserved footprint, so no place name
  was ever drawn — and the code read as a careful collision pass the whole time.
  If a rule never fires, check that it *can*.
- **Editing CSS with a string cut deleted the entire stylesheet** and the build
  still succeeded; the app rendered as unstyled HTML. `git checkout --` the file
  and reapply narrowly. Check `wc -l` after any scripted edit to a file you did
  not read first.

---

## The rules that are not obvious from the code

These are argued at length in the docs and are easy to undo by accident.

- **Only open obligations count** in the care ledger. Count completed work and
  it becomes a scoreboard; count what is still owed and the number falls when
  work finishes, which is what a warning does.
- **No data is not a zero.** A chapter with no gatherings has no care score.
- **The seven numbers do not add up.** The moment there is one number, that
  number is what gets managed.
- **A dataset may inform a decision and may never close a consent gate.**
- **Three gates never graduate**: rights-holder consent, indigenous consent,
  youth safeguarding. The test is whether the person clicking could be the
  person the gate protects.
- **Revocation is a status change, never a deletion** — for devices, people and
  consent alike. Replicated data cannot be recalled, and deleting the row
  orphans the work rather than undoing it.
- **A clearance is a fact about the connection.** Nothing a client *claims*
  raises it; a device token is a secret it was *given*, which is different.
- **Nothing over a network reaches `restricted` or `sacred`**, whatever it
  presents.
