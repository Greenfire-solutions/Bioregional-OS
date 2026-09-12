# Daily use

*How BioRegional OS earns a place in someone's day — without any of the tricks
that would contradict what it is for.*

This is a design document, not a feature list. It exists because a commons tool
that is opened twice and then forgotten is worse than no tool: it takes the
group's attention once, spends their goodwill, and leaves the work in a database
nobody reads.

---

## 1. Where the project actually is

v1.0 is a **reference instrument**. It holds a real protocol, real ecological
boundaries, and a correct refusal model. Everything in it is true.

The uncommitted work is the beginning of something different — a **daily
instrument**:

- `engines/operator.mjs` → `whats_next()` walks all twelve stages and returns
  what is blocked, slipped, missing or waiting, each item citing the protocol
  rule it comes from and the tool that resolves it.
- `app/src/components/Today.jsx` → the first tab is no longer the map, it is
  *"what needs doing"*, with a **Start here** card.
- `engines/heartbeat.mjs` → the machine tends itself while it runs: locating
  places, refreshing water, watching review dates.
- `ToolForm.jsx` → any tool in the registry can be run from a generated form.

That is the right direction and it is half of the answer. The half that is
missing is this: **everything on the Today tab is work.** Opening it costs the
steward something and gives them a list of their own debts. No one builds a
daily habit around a page that only ever asks.

The rest of this document is about the other half.

---

## 2. The five constraints that rule out the normal playbook

Most retention advice assumes push notifications, accounts, a feed, and a
company measuring you. This project has none of them, by design.

| Constraint | What it forbids | What it gives instead |
|---|---|---|
| No accounts, no cloud | identity, social graph, email digests | nothing to leave, nothing to delete you |
| No push channel — it only runs while started | scheduled nagging | no lying scheduler (see the note in `heartbeat.mjs`) |
| One operator, a handful of members | feeds, ranking, "engagement" | every person is known by name |
| The protocol is the point | growth-at-all-costs mechanics | refusals that are legible |
| Care as Infrastructure | anything that manufactures guilt | a tool that can notice a person is carrying too much |

So the honest framing is not *"how do we hook them"* but:

> **What could this software know, or do, that would make a person worse off for
> not opening it?**

Everything below is an answer to that question.

---

## 3. What the research actually says

### 3.1 Learning is the engine, not points

The largest study of iNaturalist contributor motivation found **92%** rate
"improving species knowledge" as very or extremely important, and **84%**
"discovering information about local ecosystems" — and these stay top-ranked
*even for power users*. For newcomers, 72% cite species knowledge as the reason
they joined; social recognition was rated unimportant by **76%**, and career
motives registered at 5%.
([Participation Intensity Influences Motivations for Contributing to iNaturalist](https://theoryandpractice.citizenscienceassociation.org/articles/10.5334/cstp.823))

Competitive and metric-driven motives *do* rise with intensity — but they rise
on top of learning, they never replace it. Design implication: **the reward for
opening this app is knowing something about your place that you didn't know
yesterday.** Everything else is decoration on top of that.

### 3.2 Feedback closing the loop is the retention mechanism

Across citizen science, receiving feedback from the project — seeing that your
contribution went somewhere — is the repeatedly identified driver of continued
participation, and slow reporting of results is a repeatedly identified cause of
drop-off.
([eBird/iNaturalist engagement literature](https://academic.oup.com/condor/article/124/2/duac008/6532585),
[iNaturalist in BioScience](https://academic.oup.com/bioscience/article/75/11/953/8185761))

This app is unusually well positioned for it: a signal becomes a quest becomes a
council decision becomes a measurement. That chain exists in the schema
already. **It is never shown to the person who started it.**

### 3.3 Volunteers are sustained by relationships and place, not by the task

Systematic reviews of environmental volunteering find the durable motivations
are: contribution to something larger, **social interaction**, learning, an
ethic of care, and **commitment to a particular place** — and that motivation
shifts over time *from egoistic toward collectivistic*. What sustains volunteer
leaders specifically is time, community support and social relationships.
([Systematic review of environmental volunteer motivations](https://www.tandfonline.com/doi/full/10.1080/08941920.2024.2381202),
[Resources that sustain environmental volunteer activist leaders](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9976682/),
[Volunteer Functions Inventory](https://en.wikipedia.org/wiki/Volunteer_Functions_Inventory))

Design implication: the retention unit is **not the user, it is the pair** —
someone expecting something from someone else, by a date. The schema already has
`maintenance_owner`, `land_seat_steward`, `reviewed_by`. Those fields are the
social layer; right now they are only strings in a table.

### 3.4 Streaks work, and would be the wrong choice here

Streaks demonstrably move retention — the widely cited Duolingo figures are a
jump from roughly 12% to 55% — but the same literature reports rising anxiety,
guilt, dependency and burnout, satisfaction falling after ~day 90, and sharp
churn *after a streak breaks*, because the extrinsic scaffold crowds out the
original reason for showing up.
([Streak creep — The Decision Lab](https://thedecisionlab.com/insights/consumer-insights/streak-creep-the-perils-of-too-much-gamification),
[Keeping the streak alive — U. of Oulu](https://oulurepo.oulu.fi/bitstream/handle/10024/54117/nbnfioulu-202502121605.pdf),
[Streak design without burnout — Yu-kai Chou](https://yukaichou.com/gamification-analysis/streak-design-gamification-motivation-burnout/))

A commons whose members show up because a counter would reset is not a commons.
**No streaks.** Section 6 says what replaces them.

### 3.5 Rank consistency, and rank places — not people

Strava's most instructive feature is Local Legend: the King of the Mountain
rewards *speed*, Local Legend rewards **showing up most often on one specific
piece of ground in a rolling 90-day window**. The two-tier design sustains
engagement across the whole ability range instead of concentrating it in the
fastest 1%, and it is explicitly **place-bound**.
([Building Local Legends — Strava Engineering](https://medium.com/strava-engineering/building-local-legends-290879265c83),
[Strava segmented leaderboards](https://trophy.so/blog/how-strava-uses-segmented-leaderboards-to-drive-engagement))

This is the one competitive pattern worth stealing, and it should be pointed at
**places and practices**, never at members.

### 3.6 Neighbourhood platforms fail by becoming feeds

Nextdoor's decline is instructive because it is not a technology failure.
Content quality collapse, opaque moderation, anonymity-enabled abuse, and a
feed that rewards complaint produced a measurable outcome: a 2023 study found
neighbourhood-app users perceive local crime as higher than non-users
*independent of actual crime rates*.
([Why users are leaving Nextdoor](https://medium.com/@mking2k/why-users-are-leaving-nextdoor-19a6db690fb5),
[Apps like Nextdoor aren't making us more neighborly](https://www.sacurrent.com/news/bad-takes-apps-like-nextdoor-arent-making-us-more-paranoid-36295785/))

Design implication: **no feed, no comment threads, no anonymity.** Intake is
signed and answered; signals are verified by a named human. Both already are.
Keep it that way.

### 3.7 Civic tech dies of missing backing, not missing features

Reviews of discontinued civic tech converge: projects fail from misaligned
timelines and the absence of an active support base — organisations or people
"deputised" to keep the thing relevant — rather than from bad software. The
practitioner version: *apps need backing, apps must solve a real problem, and it
takes a village.*
([Failed yet successful: learning from discontinued civic tech](https://www.researchgate.net/publication/370176529_Failed_yet_successful_Learning_from_discontinued_civic_tech_initiatives),
[3 ingredients to making civic tech apps stick](https://www.govtech.com/archive/3-Ingredients-to-Making-Civic-Tech-Apps-Stick.html),
[Living labs for civic technologies](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10213287/))

The closest peer experience is Terran Collective's account of bioregional
coordination tooling, where after an initial event *"guilds fizzled out within
the first month"* for want of coordination tools people would actually keep
using — and the related observation that tools reachable only through a single
platform are poorly suited to adoption, and need non-digital fallbacks.
([Technology in service to life](https://medium.com/terran-collective/technology-in-service-to-life-tools-for-bioregional-coordination-165330c76490),
[Bioregional mapping schemes](https://twicefire.com/bioregional/bioregion-4/))

Design implication, and it is the big one: **do not ask the group to move here.**
They are in a group chat. The app's job is to produce the thing that gets pasted
into that chat.

### 3.8 Participation will be radically unequal, at any size

The 90-9-1 distribution holds across essentially every community studied; the
only real choice is the steepness of the curve.
([Nielsen Norman Group](https://www.nngroup.com/articles/participation-inequality/),
[Participation inequality in open source](https://livablesoftware.com/participation-inequality-open-source-90-9-1-principle/))

At n=12 that means **one steward and eleven readers**. So: single-player mode
must be complete and satisfying on its own — the standard bootstrap for anything
that needs a network later
([cdixon, single/multiplayer modes](https://cdixon.org/2010/06/12/designing-products-for-single-and-multiplayer-modes/)) —
and the 9 and the 90 need a *zero-effort* way to participate: read a card, scan
a QR, answer one question at a gathering.

### 3.9 Habits attach to existing moments; calm technology stays peripheral

Behaviour needs motivation, ability and a prompt to coincide, and the durable
version of the prompt is an **anchor onto something the person already does**
rather than an interruption invented by the software.
([Fogg Behavior Model](https://www.northbeam.io/blog/fogg-behavior-model-motivation-ability-and-prompts),
[Digital behaviour change designs for habit formation — systematic review](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11161714/))

Calm technology adds the constraint that matters here: information should live in
**peripheral awareness**, glanceable, demanding attention only in proportion to
urgency.
([Calm tech / attention management survey](https://arxiv.org/pdf/1806.06771),
[Designing calm](https://www.uxmatters.com/mt/archives/2025/05/designing-calm-ux-principles-for-reducing-users-anxiety.php))

And the "noticing nature" interventions — a single daily prompt to notice and
note what is around you — are a validated, low-burden format with wellbeing
outcomes, including in winter.
([Wellbeing in Winter: the Noticing Nature Intervention](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9082067/))

---

## 4. The design: three clocks, not one

The single biggest mistake available here is to design one daily loop. The work
of a commons does not have one rhythm — it has three, nested, and each has a
different person in front of it.

```
  DAY     ·  60 seconds  ·  anyone        ·  notice        ·  reward: you learn something
  WEEK    ·  20 minutes  ·  the steward   ·  the round     ·  reward: the list empties
  SEASON  ·  one evening ·  the council   ·  the turning   ·  reward: you can see a year
```

**Daily is for noticing, not for administration.** If the daily loop asks for
work, it dies in nine days. If it *gives* — today's water, today's light,
today's weather, what the same week looked like last year — then the weekly
work has a surface to sit on.

**Weekly is the steward's round.** `whats_next()` already is this. It needs to be
weekly-shaped: capped, deferrable, and capable of being *finished*.

**Seasonal is the commons' memory.** The twelve-stage loop is a seasonal cycle,
not a daily one. Opening and closing a season is where measurement, adaptation
and replication actually happen — and it is the moment the archive pays off.

---

## 5. Twelve mechanics, in build order

Each one says what it is, why (tied to §3), and where it goes.

### Tier 1 — the app must know something you don't

**1. `Ground` — the land today.**
A top strip on the Today tab, above the work: the nearest gage against its own
7-day and 1-year medians ("Barton Creek is at 41 cfs — down 18% this week, and
the lowest this date in three years"), today's sunrise/sunset and daylight
change, moon phase, the weather and any active alert, air quality and drought
status where available, days to first frost.

*Why:* §3.1 — learning is the retention engine, and none of this is in the app
today. This is the single highest-value change in this document: right now the
OS only knows what you typed into it.

*Where:* new `adapters/sky.mjs` (solar/lunar computed locally, no network),
`adapters/weather.mjs` (api.weather.gov — public domain, no key, no account),
extend `adapters/watershed.mjs` with USGS statistics service for the medians.
New heartbeat task. Surfaced by a `ground_today` tool in `ai/tools.mjs`, so
Claude Code gets it too.

**2. `Notice` — one question, two taps.**
"What did you notice?" with place pre-filled and a photo optional. Writes a
`signals` row exactly as today. No streak, no counter.

*Why:* §3.9, the noticing-nature format; §3.1, the act of noticing is itself the
learning.

*Where:* `Today.jsx` — a single-line composer, not a modal `ToolForm`.

**3. `Same week last year`.**
Under Ground: what this week held in previous years — observations, gage
readings, decisions, gatherings. Empty in year one; says so, and says when it
will not be.

*Why:* the local-first archive is this project's one true moat. No cloud service
has your chapter's history, and it compounds. It also converts "the database is
getting full" into "the place is becoming legible".

*Where:* `engines/bioregional.mjs`, a `this_week_in_history(chapter_id)` query.

### Tier 2 — close the loops

**4. `Because of you`.**
When a signal becomes a quest, a quest reaches a gate, a decision cites a
measurement — tell the person who started it, by name, on the Today tab.
"Your 14 March observation at Barton Springs is why the council is meeting."

*Why:* §3.2. This is the most evidence-backed retention mechanism available and
the chain already exists in the schema — `signals.id → quests.signal_id →
decisions.quest_id → indicators.quest_id`.

*Where:* `engines/operator.mjs`, a sibling of `whats_next()` called
`what_moved(chapter_id, since)`.

**5. `Answered` — the intake promise.**
Intake already tracks `status='received'` and flags at 14 days. Make the promise
explicit and visible: *"Needs brought: 6. Answered: 6. Longest wait: 3 days."*

*Why:* §3.3 and the protocol's own rule — a person must be able to submit a
need, receive a response, and appeal. A visible promise kept is why members
trust the thing enough to bring a second need.

**6. `Carrying` — the care ledger.**
Who holds how many open owners/stewards/reviewers, and who has held them
longest. When one person is above a threshold, the operator raises it as a
`blocking` item: *"Maya is the maintenance owner on 7 of 9 quests."*

*Why:* §3.8 predicts the 1% burns out; Care as Infrastructure says exhaustion is
a failure of the commons, not of the person. This is the mechanic that most
distinguishes this app from every productivity tool — **it can notice that a
human is carrying too much and say so.**

*Where:* `engines/operator.mjs`, plus an `exchange` check for unpaid hours.

### Tier 3 — meet the group where it already is

**7. `The card` — a weekly export for the group chat.**
One button producing a paste-ready block (and a PNG) for WhatsApp/Signal/email:
the creek, the weather, what moved, the one thing that needs a human this week,
and the next gathering with its care provision.

*Why:* §3.7 — the Terran lesson. The group will not move to a localhost URL.
The notification channel for a commons is **another human posting in the chat**,
and the app's job is to make that message trivially easy to send. This is the
highest-leverage social mechanic in the document, and it needs no accounts, no
server and no push.

*Where:* new `engines/dispatch.mjs`; `card_for_the_week` tool; button on Today.

**8. `The QR at the gathering`.**
`npm run connect` already prints a scannable code. Make it a *gathering* affordance:
project it, phones join on the wifi, and they land on a one-screen page — notice
something, RSVP, bring a need. No app, no account.

*Why:* §3.8 — the 90 need a zero-effort door, and co-presence is the only
reliable way to convert a reader into a contributor.

*Where:* `scripts/connect.mjs` + a `/join` route serving a minimal mobile view.

**9. `Paper mode`.**
Print the round, print the card, print a field sheet with the week's observation
prompts and a place for a name. Typed back in later.

*Why:* §3.7 — bioregional mapping work explicitly needs non-digital fallbacks,
and this is also the accessibility answer for elders and for anyone working in a
field with no signal.

### Tier 4 — the seasonal turn

**10. `The turning`.**
An explicit "close the season / open the season" ritual that walks stages 11 and
12: what changed, for whom, with what uncertainty; what stops, continues,
changes, travels. Produces the impact report and the next seasonal priority list
as artefacts.

*Why:* the protocol's own loop is seasonal; ritual and celebration are the
Culture engine's mandate and a documented sustainer of volunteer groups (§3.3).

**11. `Local Legend, for places`.**
A rolling 90-day view of which places have been *attended to* most — observations,
work, gatherings — and which have been neglected longest. "Nobody has been to
the Spring in 71 days."

*Why:* §3.5 — reward consistency, bind it to ground, and point it at places so
that it can never become a ranking of people.

**12. `The neighbours`.**
Once a week, what other chapters published over Murmurations — one line each.
Slow, ambient, no reciprocity obligation.

*Why:* §3.3 — belonging to something larger; §3.9 — peripheral awareness rather
than a feed.

---

## 6. What this app refuses, and why

Written down so it survives a future decision made at 1am.

| Refused | Why |
|---|---|
| Streaks and loss framing | §3.4 — anxiety, burnout, churn at the break, crowds out the reason for coming |
| Points, badges, XP | §3.1 — recognition is unimportant to 76% of the relevant population |
| Leaderboards of people | §3.3 — the 1% burn out; §3.5 — rank places instead |
| A feed, comments, anonymity | §3.6 — the Nextdoor failure mode is a feed that rewards complaint |
| Push nagging and red dots | §3.9 — calm technology; the heartbeat's own comment already makes this argument |
| Telemetry and DAU | there is no company here to optimise, and §7 has better numbers |
| Requiring the group to move platforms | §3.7 — this is what kills tools like this one |

The replacement for a streak is **§5.3 (`Same week last year`) and §5.11 (`Local
Legend for places`)**: consistency made visible as *the place's* record rather
than the person's, with no loss state. Missing a week costs nothing. Attending
for a year shows up as a line you cannot get anywhere else.

---

## 7. First run — the 60 seconds that decide everything

Currently a new person's first screen is **someone else's commons in Austin**.
That is an excellent demo and a poor first run.

The first 60 seconds should be:

1. Where are you? (one field, or the browser's location)
2. The OS resolves it live — ecoregion, Level IV, biome, HUC12 watershed, nearest
   gage — using code that already works.
3. One screen: *"You are in the Edwards Plateau, in the Barton Creek–Colorado
   River watershed. Your nearest gage is running at 41 cfs, below the median for
   this week. Sunset is at 7:42, four minutes earlier than yesterday."*
4. Then, and only then: "Would you like to see an example commons, or start
   yours?"

Nothing about that screen is a feature. It is the entire product promise
delivered before any work is asked for — and per §3.1 it is also the exact thing
that brings the person back tomorrow.

---

## 8. How we would know it is working — without telemetry

The success metric for a commons tool is not attention. Every one of these is
computable locally from `commons.db` and belongs on a single page:

| Question | Measure |
|---|---|
| Are needs being heard? | median days from intake `received` → `responded` |
| Does observation lead anywhere? | share of Critical signals with a quest behind them |
| Does monitoring change decisions? | decisions revised after a measurement crossed a trigger |
| Is the work spread? | number of distinct people named as owner/steward/reviewer in 90 days |
| Is care real? | mean care provision across gatherings |
| Is knowledge travelling? | completed quests with a published learning |
| Is it still alive? | days since the last human observation |

If those seven numbers are healthy and the app is opened twice a week, it is
working. If DAU is high and those numbers are flat, it is a toy.

---

## 9. Build order

**Phase 1 — give before you ask. ✅ built.** §5.1 Ground, §5.2 Notice, §5.3 Same
week last year.

- `adapters/sky.mjs` — sunrise, sunset, daylight and its daily change, moon phase,
  and the next solstice or equinox found by bisection. NOAA equations, computed on
  this machine: no key, no upstream, and it cannot go stale or be rate-limited.
- `adapters/weather.mjs` — NWS `api.weather.gov` (public domain, no account) for
  conditions, today's forecast and official hazard alerts; **Open-Meteo** as the
  global fallback so the OS works outside the United States. Where there is no
  official hazard feed it says so instead of implying all-clear.
- `adapters/watershed.mjs` → `gageContext()` — NWIS statistics give the median,
  p10 and p90 for *this calendar day* across the full period of record. A reading
  becomes a sentence: *"Colorado Rv at Austin is 966 ft³/s, below median for this
  date, over 128 years of record."* An intermittent creek reading zero is reported
  as dry, and whether it is usually dry on this date.
- `engines/ground.mjs` — composes all of it, picks the anchor place and the nearest
  gage, and writes the one headline that leads: hazard, then water doing something
  unusual, then the season turning, then the light.
- `ai/tools.mjs` — `ground_today` and `this_week_last_year`, so Claude Code, the
  in-app assistant, the REST API and the generated forms all get it at once.
- `engines/heartbeat.mjs` — `read_the_ground` every hour, whose real job is keeping
  the on-disk cache warm so the panel answers instantly and still answers offline.
- `app/src/components/Ground.jsx` — the strip above the work, and the one-line
  *what did you notice?* composer. An observation a person notices is filed as
  theirs; one the assistant records is filed as the assistant's, and the test
  suite enforces the difference.

**§7, the first run — also built.** A new person no longer lands in somebody
else's commons in Austin.

- `adapters/geocode.mjs` — Nominatim (free-form, global, ODbL, one request a
  second honoured in a shared gate) with the Open-Meteo gazetteer as fallback.
  One question — *where are you?* — or the browser's own location.
- `engines/firstrun.mjs` — `lookAround()` **writes nothing**. Ecoregion,
  watershed, the soil under the point, what lives around it, the nearest gage
  against its own record, weather, hazards and today's light, returned as
  sentences rather than fields. A person can find out what bioregion they live
  in and close the tab; that is a good outcome and the test suite asserts the
  database is untouched. `beginHere()` founds the chapter — and still refuses
  without both representation answers.
- Tools `look_around` and `begin_here`; `app/src/components/FirstRun.jsx`;
  mounted in `App.jsx` as a blocking screen when there is no chapter, and as a
  dismissible strip when the only chapter is the Austin example.

A real cold run, on an empty database, from typing "Asheville, North Carolina":

> You are in the **Broad Basins**, in the **Beaverdam Creek–French Broad River**
> watershed. Biome: Eastern Temperate Forests. Your nearest gage — SWANNANOA
> RIVER AT BILTMORE, NC, 3.1 km away — is 36.6 ft³/s, below median for this date,
> across 98 years of record. Most recorded around you: Pharaoh Cicada, American
> Black Bear, Wild Turkey, Eastern Gray Squirrel. Right now: clear, 72°F. Sunset
> is at 7:42 PM, and the day is losing 2m 13s a day.

Seven seconds, no account, nothing written down.

**Phase 2 — close the loops. ✅ built.** §5.4 Because of you, §5.5 Answered
(§5.3 shipped with Phase 1). All queries over data that already existed.

- `core/provenance.mjs` — one declaration of which signals a *person* put there.
  Every adapter writes into the same `signals` table: gages, NOAA alerts, fire
  detections, imported field data. So the list names the HUMAN sources and
  treats everything else as automated. That direction is the whole point — if it
  listed the machines, each new adapter would have to remember to add itself, and
  forgetting would mean crediting somebody for a warning NOAA issued. *"Because
  of you, the council acted" is a much worse thing to say falsely than to leave
  unsaid.* It also fixed a live bug: `thisWeekInHistory` had been excluding only
  `usgs`, so the moment a weather adapter landed, NOAA's alerts started appearing
  in the chapter's memory of the season as if people had noticed them.
- `engines/loops.mjs` — `whatMoved()` walks observation → quest → gate → decision
  → measurement → published learning and writes the sentence once, so the
  interface and the assistant say the same thing about the same row.
  `intakePromise()` measures the protocol's own front-door promise: brought,
  answered, who has waited longest, how many past fourteen days.
- Tools `what_moved` and `intake_promise`; `app/src/components/Loops.jsx`, sitting
  between the land and the work — what came of what people already did, before
  the list of what they have not done yet.

No counter, no total, no comparison between people. It is a statement about what
happened, addressed to whoever made it happen.

**Phase 3 — the group. ✅ built.** §5.7 The card, §5.8 QR at the gathering,
§5.9 Paper mode. The social layer, built as export rather than as a platform.
Research and the traps are in [SOCIAL_LAYER.md](SOCIAL_LAYER.md).

- `engines/dispatch.mjs` — the weekly card. **It sends nothing, and never will.**
  A person posts it, under their own name, when they judge the moment right: an
  undifferentiated group chat gets muted, and then the messages that mattered are
  missed too. Four sections in the order the digest research supports — the land
  (the part nobody else in that chat can produce), what people's observations
  turned into, the next gathering with its care spelled out, and **one ask
  answerable by somebody who is not the steward**. Text is the artefact; the
  image is for a noticeboard.
- `app/src/components/Card.jsx` — canvas rendering in the browser, no new
  dependency. Every one of the four traps here fails by producing a *plausible*
  image: fonts must be awaited or canvas silently paints a fallback face; the
  backing store is scaled and drawn in logical units; `toBlob` never
  `toDataURL`; preview and export are separate canvases. And the Copy button
  feature-detects, because **`navigator.clipboard` is undefined on a wifi
  address** — a page is a secure context only on HTTPS or localhost. Where it is
  missing the card says so and offers the selectable text instead of a button
  that does nothing.
- `app/src/components/Join.jsx` at `/join` — what a phone lands on after
  scanning. One screen, one field, no account, no app. A need brought here is
  **private by default**, because a code on a wall in a room is a public context.
  RSVP counts against a gathering that exists; a phone at the back of a room can
  never invent an event nobody scheduled.
- `app/src/components/FieldSheet.jsx` + print rules in `index.css` — paper as a
  full participation path. Every sheet carries its own place, watershed, date and
  a short code, so a sheet found in a coat pocket three weeks later is still
  transcribable and a returned sheet can never become an orphaned record.

The card carries **no media, ever** — a count and a name and a date about what has
been heard here, never a recording. Nearly everything this OS can reach is
CC-BY-NC, and anything on a card leaves the machine.

**Phase 4 — the long rhythms.** §5.6 Carrying, §5.10 The turning, §5.11 Local
Legend for places, §5.12 The neighbours, §8 the seven numbers.

Every one of these enters through `ai/tools.mjs` as a single registry entry, per
the one-registry rule — so each arrives in Claude Code, the in-app assistant and
the REST API at the same moment it arrives in the interface.

---

## 10. The sentence this is all trying to earn

> Someone opens this in the morning, learns something true about the place they
> live, writes down one thing they noticed, sees that what they noticed last
> month is why the council is meeting on Thursday — and closes it.

Nothing in that sentence is a trick, and all of it is buildable from what is
already here.
