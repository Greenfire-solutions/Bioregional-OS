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

**The bugs that survive review are the ones whose output is plausible.** Not the
ones whose output is wrong — those get caught by looking. Three found while
building this, all of which passed every test and every build:

- a blank cell read as zero, which assembled a clean all-clear entirely out of
  missing data — and an all-clear looks like good news;
- a statistic read from a column the service does not send, so a comparison
  branch was skipped — and a missing comparison looks like a shorter sentence;
- an editing slip that deleted three map layers — and a map with only base tiles
  looks like a map that has not finished loading.

None was visible in output that looked reasonable. So: anywhere an upstream value
decides whether something is *said at all*, test the parse and test the absent
case. And when a change is visual, open it — a green build is not evidence.

**A `??` is safe when the answer says which side won.** Two fallbacks that look
identical are not: trying SSURGO and then SoilGrids for the same soil question is
fine, because the result carries `source` and `source_id` and a reader can always
see which answered. `day_of_year_median ?? week_median` was lethal, because both
are plausible numbers, they answer different questions, and nothing in the output
says which one you got. The test is therefore not *"are both sides plausible"* but
**"can the caller tell which side won?"** — which is also why falling back from a
value to absence is always safe, and why a fallback between two identifier
schemes, two dates, or two selection criteria is not. Where the answer cannot say,
make it say: a `source` field, an `at_is`, an `actionable` flag.

**The string is for people, the field is for code.** A function here once decided
what the council had done by running `/decided/` against a sentence the same file
writes. Every other bug found while building this was a wrong *value*; that one
was a wrong *channel* — rewording a sentence for clarity would have silently
changed a claim about a decision. If code needs to know something, give it a
field. Prose is an output, never an input.

**When you add a guard, grep for its own default.** A category was excluded from
being a headline, and two lines later a `[0] ?? categories[0]` put it back —
restoring exactly the case the guard existed for. Not carelessness: the guard and
the fallback were written minutes apart with different things in mind, and
neither looked wrong alone. The fallback you wrote before the guard existed is
still sitting there agreeing with the version of you that had not thought of it yet.

**A test that cannot fail is worse than no test**, because it occupies the space
a real one would take *and* makes the count look better. Three distinct varieties
turned up while building this, and from the outside all three are identical — a
green line with a confident name:

1. **Pointed at a copy.** A rule was duplicated into a test-only twin so it could
   be checked without a network call. Breaking the real one changed nothing. A
   test-only duplicate of a rule is not a test of that rule; it is a second place
   for the rule to live, with the test aimed at the wrong one.
2. **Asserting something that cannot be false.** A check that a card contained no
   URL — true whether the guard existed or not, because the upstream sentence
   never contains one. Real code, true assertion, no possible failure.
3. **Subject genuinely protected, but not by this.** The assertion passes when
   its guard is removed because something else — an allowlist's structure, a
   neighbouring assertion, a `.trim()` on the next line — is holding the property
   up. Defence in depth is good; an assertion not earning its name is not, and
   adjacency moves. A neighbour gets refactored and the protection leaves with it.

4. **Fails, but for a reason that is not the one it names.** A bundle test
   reported "carries its credit" as broken when what it had actually proven was
   that the sensitivity ladder holds — it had grabbed a *sacred* record and the
   export correctly refused it. This one is the most dangerous of the four,
   because it is red rather than green: the instinct is to make the test pass,
   and doing so would have unhooked a working gate. A red test is evidence that
   something is true, not evidence of what you assumed.

It has a twin that is harder to see because it is green: **a test that asserts a
sentence will pass for as long as the sentence is a lie.** A check matched the
words `own quests` in a coverage note claiming nothing upstream fills Atlas layer
12. Replacing it with the state the note describes — `sourcesForLayer(12).length
=== 0` — failed immediately: Murmurations had been declared at layer 12 for as
long as the note had been wrong, and the assertion read only the sentence.

Both come from reading prose instead of state, and so does a third: four
documents claimed a tool count — 59, 49, 48 and 23 — while the registry held 77.
Nobody lied; each number was true when it was typed. **Prose about state rots,
and nothing tells you.** The suite now reads the documents and compares, so a
count either matches the registry or the document carries no number at all.

**And it concentrates in the front door.** Every count that had rotted was in
README, the help menu, the `npm run connect` output or the Claude Code guide —
not one was in interior prose. That is not coincidence. Interior comments get
re-read whenever somebody works on the code beside them; the front door is
written once, at the moment its author knows the most about the project, and is
then never re-read by anyone who already knows the answer. **The highest-drift
prose in any project is the prose its authors have no reason to look at again** —
which is also the only prose a stranger reads. The same blind spot has a earlier
form: `npm run data` and the offline ecoregion library were not stale in the
front door, they had never been added to it at all.

Its common cause is **asserting phrasing instead of meaning**. A check pinned to
the sentence `check their terms before redistributing` failed the moment the
wording moved to `before passing it on` — nothing was broken, and the fix is to
loosen the assertion, which is how a suite rots. Assert what a thing *means*: the
note names a year, the credit equals what the registry holds, the record is
refused for being sacred.

The only way to tell any of these apart from a real test is to **break the guard
and see whether the test named for it fails** — not the suite, that test. If a
test has never failed, make it fail once on purpose. And when one does fail, read
what it actually proved before believing what it claims.

**A test over a derived collection needs a test that the collection is not
empty.** `sections.every(...)` passes when there are no sections; a matcher
checked against generated examples passes when nothing is generated. Both are
tautologies one layer up from an assertion that cannot fail — the check runs, the
collection is empty, and it proves nothing. Assert the length somewhere adjacent.

**Known soft spot: the representation gate is held by the code after it.**
`beginHere()` refuses a chapter that does not say what it does *not* represent.
Break that gate and the suite does fail — but by an exception, because the next
lines call `.trim()` on the thing the gate guarantees. The protection therefore
lives in an accident of the code downstream rather than in the gate. Anyone
adding a `?? ''` on those lines would delete the protocol's first refusal and the
suite would stay green. If you are that person: the gate is the check above, not
the crash below.

**The working tree flatters the artifact, in two directions.** Both were found in
one hour and neither is visible from inside the repository:

1. **Committed code importing uncommitted code.** `dispatch.mjs` and
   `api.mjs` were pushed importing `core/seedData.js`, which had never been
   committed. The suite passed — it ran in the tree, where the file was sitting
   right there — and the published repository could not load a module at all.
   The same shape one layer out: committed tests exercising an uncommitted
   adapter, so a stranger's clone reported failures for nothing broken.
2. **Committed tests that only run where the artifact already ran.** The tree
   runs 223 checks and a fresh clone runs 215. The nine that never run are the
   region-library tests, because they need a downloaded dossier and a clone has
   none — leaving 779 lines of `dossier.mjs`, `library.mjs` and `scripts/data.mjs`
   unexercised by anybody who has not already used the feature. The suite says
   so out loud rather than skipping silently, which is why it was findable, but
   it is a gap that stays open forever because every tree anyone looks at is
   green.

No test suite can catch either, because the suite runs in the tree. The
instrument for the first is cloning the published repository and running it; for
the second it is **diffing the list of checks that ran in each**. A small
committed fixture would close the second.

**A defect whose severity depends on timing will be dismissed by a single
test.** The documented backup instruction — copy `data/commons.db` — is wrong
because the database runs in WAL mode. On one machine the copy opened fine and
was merely stale by one deleted chapter. On another, at the same commit, it had
no schema at all and would not open: 304 KB in the file against 1,199 KB
uncheckpointed in the log. Same bug, and the outcome swung from *silently wrong*
to *will not open* purely on when a checkpoint last ran.

That is worse than a consistently broken thing, not better. A community testing
their backup procedure once, on a good day, gets a file that opens, and concludes
the procedure works. The erase half was the more serious: "delete it to erase"
left most of a commons on disk, so a chapter removing material a rights-holder
asked to have removed would believe it was gone. A consent failure wearing the
costume of a housekeeping instruction.

It was found by **restoring a backup** — deleting a chapter, copying the file,
starting a server against the copy, and finding the chapter still there. That is
the only test of a backup there is, and it is the one nobody performs until the
day it matters.

**To see what you shipped, leave the place that made it.** Everything found by
reading this repo was found from inside it — where nothing is missing, every
optional file is already downloaded, and the first-run path is the one path
nobody takes. Cloning what had actually been published and running it surfaced a
failure invisible from in here by construction: a stranger's first `npm test`
went red for a region they had never been asked to download. That is a different
blindness from stale prose. Prose rots because nobody re-reads it; this could not
be seen from where anyone was standing. Clone it, print it, open it on a phone,
paste the card into a chat — the artifact is not the repository.

**A marker that over-claims is worse than no marker.** The demonstration commons
exports 73 features, 67 of them real: 66 live USGS gage readings and a live NOAA
hazard alert. A notice reading *"nothing here is a real observation"* was
therefore backwards on a file that is 92% measurement, and it contradicted the
attribution block beside it in the same object, which correctly credited NOAA and
USGS by name. One object, two fields, opposite claims — and the false one was the
one written to be read. **The commons is fiction; the land underneath it is not.**
The notice is now two claims kept deliberately apart, declared once in
`core/seedData.js` and imported by the card and both exports, and the tests
assert the structure rather than the sentences — including that the land claim
does not disclaim reality. Teaching a reader to doubt a live hazard alert is a
worse outcome than saying nothing at all.

**Who observed it is a protocol question, not a data question.** Every adapter
writes into the same `signals` table. `core/provenance.mjs` declares the human
sources once and treats everything else as automated, so a new upstream is
excluded from attribution by default rather than by remembering.

**RIDs everywhere.** Every object gets `orn:bros.<type>:<chapter>/<id>`. That is
what lets a method travel to another chapter as a label, without the underlying
community data moving.

## Extending it

Add a capability by adding one entry to `ai/tools.mjs` with a handler that calls
an engine. It appears in Claude Code, the in-app assistant and the REST API at
once — no registration anywhere else.

## The protocol and the code, checked against each other

`docs/PROTOCOL.md` is the product. The code is how it is enforced. The failure
mode that matters here is not a bug — it is a control that reads, to anyone
auditing the manual against the source, as being in place, and enforces nothing.

Four of those were found on 2026-09-12, all by a person reading the two
documents side by side. Each had the same shape: something declared in one place
and never reached from the other.

- **A gate the schema allowed and no quest ever got.** `quest_gates` permitted
  nine gates; `openQuest` created five. The four absent were
  `ecological_assessment`, `indigenous_consent`, `youth_safeguarding` and
  `data_consent` — so in a bioregional OS nothing was ever blocked pending an
  ecological assessment, and the two consent gates that most need to exist were
  the ones that did not. The CHECK constraint listed them, the tool's enum
  offered them, the interface rendered them.

- **A field required and unconnected.** Every council item refused without a
  Land Seat report; the report was free text checked for non-emptiness. The
  measurements were on the same machine and never on the same page.

- **A rule enforced against a thing that did not exist.** The manual says a high
  project score never overrides a red flag. The override was implemented. The
  score was not.

- **A log that depended on the logged party volunteering.** `ai_log` existed,
  the operator counted unreviewed rows, the viability test checked it — and the
  only path that wrote a row was a tool the assistant had to call on itself.

The general rule, and it is the same one behind `adapters/registry.mjs` and the
count-drift check: **a rule stated in two places will eventually be stated
differently, and the drift is silent in the direction that flatters** — the
document still describes the control.

So the suite now compares them directly. `scripts/test.mjs` reads
`core/schema.sql` and `docs/PROTOCOL.md` at run time and asserts:

- every gate the schema allows is one a quest actually gets, and none is created
  that the schema would refuse;
- every decision the manual forbids AI from making is one `AI_FORBIDDEN`
  refuses;
- the manual still states twelve stages, and the quest pathway has one per
  stage.

Each was mutation-tested by deleting an entry and confirming the suite names the
exact thing that drifted. When a control is added to the manual, add the row
that checks it here — a control nothing checks is a paragraph.

### Where the ecological data actually reaches governance

Worth stating plainly, because it was the thinnest join in the system and is the
one most likely to thin again:

- `engines/landseat.mjs` composes what the land is doing from the database and
  locally-computed solar equations, and `council.propose()` freezes it onto the
  decision as `land_seat_context`. That frozen copy is what lets a review years
  later tell a drought decision from a wet-year one.
- The `ecological_assessment` gate blocks a quest from being built.
- `quest.score()` reads ecological fit, baselines and decision triggers into the
  "regenerative" component, so a project that cannot show it changed anything
  cannot rank as though it did.

Everything else the OS knows about the land — the dossiers, the Atlas, the
region library — is still a reference surface rather than a governance input.
That is a deliberate stopping point, not an oversight: a dataset may inform a
decision and may never close a consent gate.
