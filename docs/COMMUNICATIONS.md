# Communications

How a chapter reaches its people, and how its people reach it. Researched
2026-09-12 across four parallel streams — message transport under bad
connectivity, voice, identity and sign-in, and the field record of what
actually survives in community deployments, each stream citing its own sources
inline.

No count of sources is written down here, and that is this project's own rule
rather than modesty: a number next to the word "sources" reads as the upstream
registry in `adapters/registry.mjs`, and the suite refuses it. Prose about state
rots and nothing tells you.

This document exists because the question "should the OS send messages?" has an
answer that is not obvious, and because two of the four streams reached opposite
conclusions. The disagreement is recorded here rather than resolved away.

---

## 1. The recommendation

**Build inbound. Never build broadcast. Never build a chat.**

A neighbour can text or speak a need to the commons and get an acknowledgement.
The commons never sends anything unasked, never hosts a conversation, and never
becomes a place people have to check.

This narrows the rule already in `engines/dispatch.mjs` — *it sends nothing* —
to what that rule was actually defending. The amended form:

> **The OS never broadcasts. It may answer.**

Announcements stay what they are: a card a human pastes into the group chat
they already use, under their own name, at a moment they judge.

**Before any of that**, build the consent layer. `agents.contact` and
`intake.contact` are free-text columns today with no verification, no channel
type, no opt-out and no consent record. Every stream independently said the same
thing: retrofitting consent onto a live roster is work nobody ever does.

---

## 2. The disagreement, and why it is narrower than it looks

The transport stream concluded: build inbound SMS. The field-evidence stream
concluded: refuse in-app messaging entirely, stay a companion.

Both are well-sourced. Reading them against each other, almost all of the
field stream's objections are objections to **many-to-many conversation**:

- moderation load (a Mastodon admin's *"no more than 50 to 100 active users"*;
  witches.town and KNZK both closed under administrative load)
- the critical-mass trap (Grudin: early adopters abandon a groupware tool before
  the mass arrives; a chat with 3 of 30 people is worse than no chat)
- the feed failure mode already recorded in `DAILY_USE.md §3.6`
- append-only logs that cannot delete or edit, and identity that cannot recover
- Nextdoor, which had a company, a budget and researchers, and still could not
  moderate its way out

The field stream states its own test plainly, while arguing that CoMapeo is not
a precedent for chat:

> Peer-to-peer observation sync has no moderation surface, no edit/delete
> problem, no identity-recovery problem and no critical-mass problem — a single
> person's observations are still valuable. Messages have all four.

**Inbound-only intake passes that test on all four counts.** One neighbour
texting one need to the commons is not a conversation. It has no many-to-many
surface, no feed, and it is valuable when exactly one person uses it — the same
shape as the `/join` QR page that already exists, with SMS as the transport
instead of a camera. It is the Listen stage, reached by a different door.

So the two streams do not actually disagree about chat. They disagree about
whether "a neighbour texts a need" is messaging or intake. It is intake.

### What remains a real conflict

One thing does not dissolve, and it should not be pretended away:

**A phone number costs money every month.** Roughly $11.50/month for a
60-member chapter through a cloud aggregator, plus about $19 once and thirty
minutes of A2P registration forms. The field stream's sustainability argument is
that this project's entire advantage is having **no recurring cost at all** —
that ODK and KoboToolbox survived eleven years by *selling* hosting, and that
every managed service re-creates the thing that killed the dead projects. A
volunteer stops paying a card and messages fail silently.

That objection is correct and unresolved. It is why SMS is behind a trigger in
§4 rather than in the first build.

---

## 3. Why inbound at all, when the group chat exists

The companion strategy is right and is already well argued in
`docs/SOCIAL_LAYER.md`. Two things it cannot do:

**It is structurally one-way.** The card goes out; nothing comes back.
`intakePromise()` measures how long a neighbour waits to be heard, and in pure
companion mode the OS can never close that loop itself — a steward has to notice
a reply in WhatsApp and retype it.

**The group chat only reaches people in the group chat.** GSMA (September 2025)
puts 3.1 billion people — 38% of the world — inside mobile coverage and not
using mobile internet, against roughly 300 million outside coverage altogether.
The *usage* gap is two orders of magnitude larger than the *coverage* gap. The
elderly neighbour with a feature phone, the person who left the chat because it
was too noisy, and everyone never added are precisely who the commons claims to
serve, and SMS is the one interface all of them already operate.

**The corollary, which is the bigger trap:** never build a second object that
has to be kept current in both the app and the chat — a roster, a task list, an
events calendar. A study of 81 community health workers in Bihar found WhatsApp
had become the de facto backbone *alongside* the official app, with the cost
named exactly: *"We have to maintain both app entries and WhatsApp reporting —
double work."* Across 29 UK mutual aid groups and 32 organiser interviews,
**zero** adopted any purpose-built tool.

---

## 4. Tiers, and what triggers each

**Tier 0 — paper, the printed card, the projected QR.** Always on, no cost, no
licence, no maintenance. Already built. This is the floor, not the fallback.
Never make a higher tier a precondition for it.

**Tier 1 — inbound SMS.** Trigger: the chapter has members who do not come to
gatherings and do not read the group chat, *and* somebody has agreed to own the
bill. Not before both.

**Tier 2 — LoRa radio.** Trigger: **no cellular coverage at all**. This is the
coverage gap — 4% of the world. Entering Tier 2 to solve a Tier 1 problem is the
most common mistake in this space.

**Tier 3 — device-to-device sync.** Trigger: a second steward's laptop exists.
This is not a member channel at all; see §7.

---

## 5. Voice

**Secondary, but first-class: a capture-and-keep channel, never an interaction
channel.** A recording is a complete contribution, equal to a typed one and to a
paper field sheet. The system should hold, protect and play back a recording. It
should not be something you talk *to*.

The evidence is consistent and one-directional:

- **Voice input loses to the keypad, and experience never fixes it.** DTMF 74%
  task completion vs speech 61% across 45 low-education participants; with
  speech, completion fell to 42% once a recognition error occurred. Over a
  seven-month field deployment touchtone beat voice every single week, 100% of
  users preferred it, and *"we found no evidence of a decrease"* in input errors
  over time. The recognizer was 94% accurate. People still did not want it.
- **Every open voice channel in the literature is held up by paid moderators** —
  10–15 full-time staff at CGNet Swara and Gram Vaani; 400–500 messages a day
  each listened to by a person at Mobile Vaani. Avaaj Otalo's forum collapsed
  the month the NGO stopped answering, and users did not self-organise to fill
  the gap. A one-laptop, one-steward system has no moderation capacity.
- **Expect tens of recordings, not thousands.** The closest analogue that exists
  — a shared communal tablet used for oral governance in Mankosi, South Africa,
  over ten months — produced about 35 meeting recordings. One custodian,
  curating.

### What the closest analogue got wrong, which you will hit

Wind and outdoors ruined many recordings; oral governance happens outside, and a
watershed group meets on riverbanks. Half the files had the wrong date because
the battery drained and the clock reset. And a UI default caused a genuine
social crisis: profiles were listed **alphabetically**, husbands often renamed
wives with names starting "Nom", so the women clustered visibly and the Headman
was reproached — 70% of accounts were deleted. **Sort nothing alphabetically.**

Voice also reproduces existing exclusion rather than correcting it: 88% of
recorded voices in Mankosi were male, against roughly 40% female meeting
attendance. Sangeet Swara ran 94% male; Baang saw 6% female participation.

### The disqualifying finding for automatic transcription

Roughly **1% of Whisper transcriptions contain entire hallucinated phrases that
exist nowhere in the audio, and 38% of those include explicit harms** —
fabricated violence, invented associations, implied authority. The trigger is
long pauses and disfluent speech: an elder speaking slowly, somebody searching
for a word, a deliberate silence.

So: **audio is the record, text is only an index.** Any machine transcript is
`transcript_draft`, never `transcript`, and it is never published unreviewed.
Refuse to transcribe languages outside the well-served tier entirely — a
60%-error output is worse than none because it *looks* like a transcript.

Indigenous-language ASR essentially does not exist in open form. Māori, Sámi,
Navajo, Inuktitut, Cree, Cherokee, Mohawk, Ojibwe and Hawaiian are all absent
from Common Voice; Meta's MMS is CC-BY-NC and so is an AGPL blocker. Te Hiku
Media's Māori models sit under the Kaitiakitanga License, deliberately not open
source: *"By simply open sourcing our data and knowledge, we further allow
ourselves to be colonised digitally in the modern world."* That is the correct
precedent, not an obstacle. **Make the model a pluggable boundary a community
points at on its own terms. Never bundle one.**

### The blocker to know before designing capture

`getUserMedia` requires a secure context. Over `http://192.168.x.x`,
`navigator.mediaDevices` is **undefined** — a TypeError, not a permission
prompt. **Today's `/join` page physically cannot record audio.** The cheap way
round is `<input type="file" accept="audio/*" capture>`, which is not
secure-context gated and hands off to the phone's own recorder that people
already know how to use. Start there.

---

## 6. Identity

**No accounts.** Device enrolment when a second person needs to write, and a
credential-free `people` table so contributions can be attributed, credited and
withdrawn without anyone ever signing in.

The field evidence is blunt. Asked whether to create 2,000 accounts for
enumerators, KoboToolbox's community answered no — give each person a random
identifier they type into the form. A deployment that took the credential path
reported enumerators using the shared login to browse the whole database. **The
failure mode of credentials here is account-wide exposure, not impersonation.**

LiteFarm ships a `Worker Without Account` role: a manager creates a person with
just a first name and no invite step, because there is nobody to click a link.
ODK's QR enrolment is passwordless by design but binds nothing to a device — one
code scans into unlimited phones — so their answer is forensic rather than
preventive: every submission carries a device id. And in both ODK and CoMapeo,
**revocation is a status change, never a deletion**: a revoked person stays
visible as the submitter of everything they filed, because replicated data
cannot be recalled.

Two guards worth taking directly:

- A person record can never be *promoted* into credential-holding by a role
  change — only by an explicit upgrade, which **resets consent**. Prior consent
  does not transfer to a new identity.
- Never make contact the primary key. LiteFarm had to mint synthetic
  `<uuid>@pseudo.com` addresses purely because email was a NOT NULL unique
  column.

### The migration trap, which is the actual reason to act

Kobo's own documentation warns that submissions made before authentication was
required *"may not have a username attached, so user-based rules cannot filter
them."* Every day of free-text `maintenance_owner` and `measured_by` is data no
future identity rule can ever govern. **That, not sign-in, is the argument for
adding a `people` table now.**

---

## 7. Sync between stewards, and the landmine under it

Device-to-device sync is not a member channel and does not carry conversation.
It carries observations, and the CoMapeo record shows that shape works at real
scale offline.

**The landmine: never let a file syncer touch a live `commons.db`,
`commons.db-wal` or `commons.db-shm`.** Two instances have no cross-network
write lock, and a syncer can ship the database and its log from different
instants. SQLite's own corruption guidance warns this is *"especially true of
network filesystems"*, and a file syncer is worse than one.

The shape that makes the hard problem vanish:

```
outbox/<deviceID>/2026-09-12.ndjson     ← only that device ever appends
```

Sync only `outbox/`. Keep the operational database local and never synced. One
writer per file makes file-level conflicts **structurally impossible**. Ingest
other devices' files through an immutable staging table, never directly into
live tables. Because observations and messages are immutable once written, every
merge is a fast-forward and no conflict-resolution interface is ever needed.

Steal one rule outright from Morango, Kolibri's sync engine, which has run this
architecture at NGO scale for a decade: **regenerate the device id whenever the
database file is detected as cloned or restored.** It is what stops two copies
of one chapter being merged as one chapter.

---

## 8. What this refuses, and why

| Refused | Why |
|---|---|
| In-app chat, threads, replies between members | Moderation has no owner here; the critical-mass trap; it is a feed with extra steps |
| Broadcast messaging from the OS | A human posting under their own name is a different social object from a bot on a schedule |
| Any second object kept current in both app and chat | *"Double work"* is the documented quote that kills adoption |
| Voice navigation, voice menus, an IVR phone tree | DTMF beats speech in every field deployment; needs an always-on public endpoint; dies four weeks after the toll-free subsidy stops |
| An open voice inbox or voice forum | Needs 10–15 full-time moderators at the scale where it works |
| Auto-published machine transcripts | ~1% wholly fabricated passages, 38% of those carrying explicit harm, triggered by slow speech |
| Ratings, ranking or voting on contributions | Flattening is what drives knowledge holders away |
| Alphabetical ordering of people, anywhere | It caused a real social crisis in the one comparable deployment |
| Mesh as the community channel | 233-byte payloads; default preset changes silently mute nodes bought months apart |
| Per-person accounts and passwords | Shared devices make this a safety property, not a convenience |
| Any required cloud dependency | Including a TK Label hub; no recurring cost is the sustainability plan |
| Audio as SQLite BLOBs | Files on disk, content-addressed — it is also the sovereignty answer |
| Federating person profiles | The index is unauthenticated and world-readable; erasure is one-way |

---

## 9. Consent, as engineering rather than intention

`media_consent` today is a register of intentions. `withdraw_consent` sets a
timestamp and returns an English sentence. Nothing stops anything. For text that
is a gap; for voice it becomes a harm.

What the governing frameworks require, stated as constraints:

1. **Default-deny with no unset state.** A recording that cannot name its
   protocol cannot be inserted. Not a nullable `is_public`.
2. **The ladder is not enough.** `public / members / council / restricted /
   sacred` is a rank, and TK Labels include Seasonal, Women General, Men
   Restricted — categories a rank cannot express.
3. **Consent records a process, not a signature.** Which language, whether an
   interpreter was present, whether comprehension was checked. Studies of
   low-literacy consent found comprehension failures came *not from literacy but
   from how information was delivered*, with thumbprints given by people who had
   not grasped what they authorised. `comprehension_checked` gates publication,
   never `signature_present`.
4. **Consent is append-only and expires.** An expired consent silently
   downgrades an item to private rather than continuing to publish.
5. **Segment-level, not item-level.** The unit is a time range. An item-level
   model cannot express "everything except minutes 14 to 19."
6. **Withdrawal must execute, not advise** — master audio, every derived
   encoding, the draft transcript, extracted quotes, exports, and any published
   profile. **Note the live gap:** `scripts/erase.mjs` covers `commons.db`, its
   log and the backups directory. Voice files would be the first community data
   living *outside* the database, and today they would survive an erase that
   told the person it was complete. That file's own comment calls this *"a
   consent failure, not untidiness."*

The anti-pattern to avoid by name: StoryCorps' general release transfers all
rights worldwide, irrevocably, and makes the narrator indemnify the
organisation. The most famous community-voice project in the country uses a
total assignment. Copy exactly one thing from it — the narrator keeps a copy of
their own recording.

---

## 10. What is genuinely uncertain

- **The two streams disagreed and I resolved it by argument, not evidence.**
  §2's reading — that inbound intake is not messaging — is mine, not a finding.
  If it is wrong, the cost is a monthly bill and a channel nobody uses.
- **The paid-steward question is contested.** One flagship community network
  argues part-time paid staff become the most cost-effective answer at scale;
  another ran five successful years paying nobody and remains donor-dependent.
  At 10–30 people, design around a 20-minute weekly cap instead.
- **There is no published literature on SMS-based watershed or environmental
  monitoring at any scale.** This would be novel. Instrument it, do not assume.
- **Almost the entire voice evidence base is rural India, Pakistan and
  sub-Saharan Africa, 2009–2018.** The literacy finding transfers; the
  device-access finding does not. No field study of community voice archiving in
  a North American watershed group appears to exist.
- **The participatory-voice movement is not ascendant.** Gram Vaani went from
  70+ staff to 28; Awaaz.De pivoted to fintech; AMARC's domain now serves a
  forex blog. The field has shifted to WhatsApp and LLMs.
- **Whether the twelve-stage loop is right at all** is unevidenced in both
  directions. Nothing says it is wrong; nothing supports it. What makes it safe
  to be wrong is a recorded override — see the note in `ARCHITECTURE.md`.
