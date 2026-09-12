# The social layer

*Research and design brief for Tier 3 of [DAILY_USE.md](DAILY_USE.md) — the card,
the QR at the gathering, and paper mode. **All three are now built**; this is the
reasoning they were built from, kept so the decisions can be argued with.*

---

## 1. Why this is what's next

Phases 1 and 2 are built and so is the first run. The OS now gives before it
asks, and it tells a person what their observation turned into. All of that is
**single-player**: it works perfectly for one steward sitting at one computer.

Tier 3 is the only part of the plan that addresses the failure mode the research
actually predicts for a tool like this. From DAILY_USE §3.7 and §3.8:
participation is radically unequal at any size, so at twelve members there is one
steward and eleven readers — and the eleven will not come to a localhost URL.
Terran Collective's bioregional guilds *"fizzled out within the first month"* for
want of coordination people would keep using.

Everything built so far makes the steward's twenty minutes a week better. Nothing
built so far reaches the other eleven people at all.

> **The thesis of Tier 3, in one line:** the app's job is not to become the place
> the group gathers. It is to produce the thing that gets pasted into the place
> they already gather, and to be scannable when they are all in one room.

---

## 2. The constraint that shapes all three

A new one, found while researching and worth stating before any design:

> **The Clipboard API is unavailable on the LAN.** A page is a secure context
> only over HTTPS or on `http://localhost` / `127.0.0.1`. Private-network
> reachability *does not count* — so on `http://192.168.x.x:4180`, which is
> exactly how `npm run os -- --share` serves phones, `navigator.clipboard` is
> **undefined**.
> ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/clipboard))

This is the session's recurring failure shape again: a "Copy" button that works
on the steward's machine and silently does nothing on every phone in the room, with
no error anywhere. It has to be designed for, not discovered.

The other standing constraints are unchanged: no accounts, no cloud, no push, no
public URL — which also means **no link previews**. A card cannot say "read more
at…", because there is no address that works for anyone not on the wifi. The card
has to be complete in itself.

---

## 3. What the research says

### 3.1 The group is already somewhere, and it is fragile there

Studies of neighbourhood mutual aid groups find they *did* live in WhatsApp —
wards existed as WhatsApp groups, and that was "the heart of Mutual Aid". What
sustained them: a division of labour between organisers and volunteers, explicit
care for members, pre-existing ties, and **micro-groups small enough to know their
area's needs in granular detail**.

And the warning: participants reported feeling *"really disconnected"* from
digital-only groups, and that it is hard to keep momentum on WhatsApp **with no
in-person meetings**.
([Neighbourhood-led Mutual Aid groups](https://www.tandfonline.com/doi/full/10.1080/17448689.2022.2164027),
[Mutual Aid in north London](https://dx.doi.org/10.1080/14742837.2021.1890574))

**Implication:** the card and the QR are not two features, they are two halves of
one mechanism. The card keeps the group warm between meetings; the QR converts
the meeting into contribution. Building only the card reproduces the exact
failure the research describes.

### 3.2 An undifferentiated group chat gets muted

The clearest finding against over-sending: when a group chat is undifferentiated,
members are alerted to every message even when most are irrelevant, so **many mute
the group and then miss the messages that did matter**.
([Resident-led innovation in communication](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12296428/))

**Implication:** one card a week, never more, and it must carry something no one
else in that chat can produce. The land data is exactly that. A card that
summarises what everyone already saw is a notification tax.

It also argues against automating the send even if we could. A human posting at a
moment they judge right is a different social object from a bot posting on a
schedule — and the OS has no send capability anyway, which turns out to be the
right design rather than a limitation.

### 3.3 The digest shape that works ends with one open question

Community digest practice converges on: a handful of one-line items, a welcome for
anyone new, and **one unanswered question that needs more input**.
([Community newsletter structure](https://kannect.co/blog/playbook/community-newsletter/),
[Hyper-local newsletter sections](https://printgoeshere.substack.com/p/hyper-local-newsletter-sections))

That last element maps onto something the OS already computes exactly:
`whats_next().first` — the one thing to do first, with the protocol rule it comes
from. And `intakePromise()` already knows whether anybody is waiting for an answer.

**Implication:** the card is not a summary. It is a summary *ending in a specific
ask directed at people who are not the steward.*

### 3.4 QR works in the room and nowhere else

Scan rates in high-intent in-person settings run **15–35%**, against **1–5%** for
passive placement like a poster. A specific call to action beats a generic "Scan
me" by up to **37%**, and simplicity of the landing action is the single biggest
lever on completion.
([Scan rate benchmarks](https://linkbreakers.com/help/article/qr-code-scan-rate-benchmarks-by-industry),
[Improving scan performance](https://www.uniqode.com/blog/qr-code-marketing-tips/qr-code-campaigns-high-conversion))

**Implication:** project the code *during* a gathering with a specific ask — "Scan
to add what you noticed today", not "Scan to join the commons" — and the landing
page must be one screen with one field, not a tour of the app.

### 3.5 Paper works, if the paper carries its own identity

The most useful hybrid-collection study pairs physical samples with digital
records. What worked: **99% of physical items had complete or traceable
information written on the outside**, which let the team match them up even when
the digital half was missing or wrong. What failed: duplicate records, records
that never got linked, and 24 participants who sent a physical sample with **no
digital record at all**.

Their design lessons: choose formats people already use, make a single step
collect multiple kinds of data, and keep an independent permanent copy.
([Combining Physical and Digital Data Collection](https://theoryandpractice.citizenscienceassociation.org/articles/10.5334/cstp.422))

**Implication:** a printed field sheet must be independently meaningful. Date,
place, chapter and a short code printed *on the sheet itself*, so a sheet found in
a coat pocket three weeks later is still transcribable — and so a person can hand
one back having never touched a screen.

### 3.6 Absence has two meanings and a card must not merge them

From the discovery work in this repo, proved by looking at real output rather than
by reasoning: searching a locality that has **no open-data portal indexed at all**
is a different fact from searching one whose portal **has nothing on the subject**.
The first is a fact about the place; the second is a fact about the question. A
person can act on the second and can only shrug at the first, and a summary that
renders both as an empty section teaches them to ignore the section.

This generalises directly to the card, which is mostly a stack of sections that
can each be empty. "Nobody noticed anything this week" and "the observation log
has never been used" look identical on a page and mean opposite things.

**Implication:** every section of the card states *which kind* of empty it is, or
is omitted entirely. A heading with nothing under it is the worst of the three.

### 3.7 A place can be heard, but almost none of it can be redistributed

Verified live rather than assumed: within 15 km of Barton Creek, iNaturalist holds
**2,934 research-grade observations carrying sound** — birds, frogs, insects —
keyless, each with a licence. Soundscape research ties acoustic richness to
ecological integrity, and ties sound specifically to **place attachment**, with
sound-memory association described as a spatiotemporal anchor and residents
showing markedly stronger attachment than visitors.
([Soundscape experience and mapping](https://www.nature.com/articles/s44384-025-00041-6),
[Soundscapes for urban biodiversity monitoring](https://academic.oup.com/jue/article/11/1/juaf002/8088407))

That is the exact variable DAILY_USE §3.3 names as the durable motivation for
environmental volunteers — commitment to a particular place — and every
bioregional tool in the survey treats a place as something you look at.

**But the licence is the design.** A sample of the media licences on those
recordings, which are a separate field from the observation's own licence:

| cc-by-nc | cc-by | none / all rights reserved |
|---|---|---|
| 29 | 2 | 1 |

iNaturalist's default for photos and sounds is **CC-BY-NC**.
([iNaturalist licensing](https://help.inaturalist.org/en/support/solutions/articles/151000173511-how-do-licenses-work-on-inaturalist-should-i-change-my-licenses-))
INTEROP.md already made this call once, for One Earth Bioregions: CC-BY-NC, so
its geometry is never redistributed. Audio is that rule in different clothes.

**Implications, and the middle one is a hard constraint on the card:**

1. **Stream, never vendor.** Link to `static.inaturalist.org`; the OS hosts
   nothing and redistributes nothing, and a person still hears their creek.
2. **No sound in a card, an export, or a printed sheet.** Anything that leaves
   the machine is redistribution. A card may carry the *fact* — *"37 recordings
   from this creek this spring, most recent a Painted Bunting on 6 May"* — which
   is attributable, licence-free, and arguably the better line anyway.
3. **A recording with no licence is not a free recording.** `license_code: null`
   is absent permission, not open permission — the same shape as `'none'` being
   read as a licence in the discovery work. Allowlist, absent branch first.

### 3.8 Elders are a participation question, not a font size

The inclusion literature is blunt that excluding older adults from design is
usually based on stereotype, and that peer-to-peer community learning is what
actually works.
([Inclusion of older adults in design of digital technology](https://research.tilburguniversity.edu/en/publications/inclusion-of-older-adults-in-the-research-and-design-of-digital-t/),
[Digital technology design in ageing societies](https://www.tandfonline.com/doi/full/10.1080/0144929X.2025.2584205))

**Implication:** paper mode is not a concession, it is a full participation path,
and it should be presented as one. The person who fills in a field sheet at the
gathering has contributed exactly as much as the person who typed into the app,
and the Exchange engine should be able to record it as such.

---

## 4. Designs

### 4.1 `The card` — `engines/dispatch.mjs` + a button on Today

**Shape**, from §3.3, in this order:

1. One line of ground — the creek against its own record, or the hazard. The part
   nobody else in that chat has.
2. What moved — at most two, from `whatMoved()`, naming the person.
3. The next gathering, with its care provision spelled out (meals, lift,
   childcare, step-free), because that is what decides whether somebody comes.
4. **One ask**, directed outward: the oldest unanswered need from
   `intakePromise()`, or `whats_next().first` phrased as a request rather than a
   task.

Since the card renders `whats_next()`, it inherits new stages for free as they
arrive. The discovery work has already added one worth having: a locally
published dataset whose licence nobody has read appears under stage **Map** with
an `approve_dataset` action. *"Austin publishes Watershed Reach Integrity Scores
for our creek and nobody has read the terms yet"* is a better ask to put in front
of eleven readers than most of what the operator produces, because it is
interesting before it is work — and because anyone in the group can do it, not
just the steward.

**Two formats, text first.** Text is what actually survives being pasted, is
searchable in the chat afterwards, is readable by a screen reader, and costs
nothing. The PNG is for the cases where formatting matters or somebody wants it
on a noticeboard.

**Generating the PNG: in the browser, on canvas.** No new dependency, no native
build, works on a 2019 Intel Mac. The traps, all of which produce plausible
output rather than errors:

- `await document.fonts.ready` before *every* draw. Canvas does not redraw when a
  font finishes loading, so a card exported a moment too early silently falls back
  to a system font and still looks fine.
- Scale the backing store by `devicePixelRatio`, apply one `ctx.scale()`, then
  draw in logical coordinates — otherwise it is soft on every Retina screen.
- `canvas.toBlob('image/png')`, never `toDataURL` — base64 wastes about a third of
  the buffer for no benefit.
- Render preview and export on separate canvases at different scales.
  ([Canvas high-quality export](https://konvajs.org/docs/data_and_serialization/High-Quality-Export.html))
- Target ~1080px wide; WhatsApp recompresses to about 1600px and centre-crops
  anything it treats as a preview, so keep everything inside the middle 80% and
  set type large enough to survive recompression.
  ([WhatsApp image sizes](https://mediasizes.com/whatsapp-image-size/))

**The copy button must feature-detect.** `navigator.clipboard` and
`ClipboardItem` where available (Baseline 2024; PNG is the one image type the
spec mandates); on Safari the async work has to happen *inside* the
`ClipboardItem` promise, not before it, or user activation is lost. Where
`window.isSecureContext` is false — every phone on the wifi — fall back to a
pre-selected `<textarea>` and a plain download link, and **say which is
happening** rather than showing a button that does nothing.
([Clipboard.write](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/write),
[Safari clipboard behaviour](https://www.clovu.me/posts/safari-clipboard-solution-en))

### 4.2 `The QR at the gathering` — a `/join` route + `scripts/connect.mjs`

`npm run connect` already renders a terminal QR, and `/api/status` already returns
`lan_url` and a QR data URL when `--share` is on. What is missing is the thing to
project and the thing to land on.

- **A project-this screen** in the app: the QR at full size, the chapter name, and
  one instruction carrying the specific ask (§3.4). Not "Scan to join".
- **`/join`** — one screen, one field: *what did you notice?* Plus a name box, no
  login. Optional: RSVP to the gathering that is happening, and *bring a need*,
  which is the Listen front door.
- Writes through `add_signal` with `source: 'notice'`, so the provenance rules in
  `core/provenance.mjs` already classify it correctly, and the coordinate is the
  place's — so the map already draws it as approximate, correctly.
- Must work with no clipboard, no camera permission beyond the scan, and no app.

### 4.3 `Paper mode` — print stylesheets and a field sheet

There are no print styles in the app at all today.

- **Print the round** (`whats_next`) and **print the card** — `@media print`
  rules, hiding the map, the assistant and the navigation.
- **The field sheet**: this week's prompts, ruled lines, and — per §3.5 — the
  chapter, place, date and a short code printed on the sheet itself, so it is
  independently transcribable and so a returned sheet can never become an
  orphaned record.
- A matching **transcribe screen** that takes the code and opens the right rows,
  so typing a stack of sheets back in is one flow rather than twelve form visits.

---

## 5. What to test, given this session's lesson

`docs/ARCHITECTURE.md` now records that the bugs which survive review are the ones
whose output is *plausible*. Tier 3 is full of them, so the tests should target
those specifically rather than the happy path:

| Failure | Why it survives review |
|---|---|
| Font not loaded at export | The card still renders, in the wrong typeface |
| Clipboard on the LAN | The button appears to work; nothing is on the clipboard |
| A card with no ask | Reads like a fine summary; produces no replies |
| A field sheet with no code | Looks complete until somebody tries to type it back |
| An empty section rendered as a heading | Looks like nothing happened, not like nothing was recorded |
| "Nothing here" conflated with "nowhere to look" | Both render as absence; only one of them is actionable |

And the rule the same document adds: when a change is visual, open it. A card is
entirely visual output — the tests can prove the *content* is right, but only
looking proves it is legible on a phone.

---

## 6. Questions for Jordan before building

1. **Is the card weekly, or on demand?** The research says one a week at most, but
   it is a person's judgement when to post. Recommendation: generate on demand,
   with the heartbeat quietly noticing when a week has passed and nothing has been
   sent — an item in the round, never a notification.
2. **Does the `/join` page let someone bring a *need*, or only an observation?**
   Needs are the Listen front door and the protocol's own promise, but they can be
   private, and a projected QR in a room is a public context.
3. **Should a paper contribution be recorded in the Exchange ledger** as a
   contribution like any other? §3.8 says yes; it is a protocol question.
