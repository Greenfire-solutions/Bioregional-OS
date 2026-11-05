// ── How an action on a list gets carried out ──────────────────────────────
//
// One home, because there were two and they had already drifted: Commons.jsx
// knew six tools needed no form, Today.jsx knew three. So the same item —
// "who is carrying what" — ran instantly on the board and, on Today, opened a
// modal titled `carrying` with NO FIELDS AT ALL and a Save button, because
// `carrying`'s schema has no properties. Same list, same action, two behaviours.
//
// This is verbs.js's argument applied to what a button DOES rather than what it
// says. A tool is added here once.

/**
 * Tools that need nothing from a person.
 *
 * Opening a form to show somebody an empty form is a step that exists only
 * because the interface could not tell.
 */
export const DIRECT = new Set([
  'locate_place', 'ingest_water_data', 'council_agenda',
  'carrying', 'place_attention',
  // `refresh_library` was here and is not a tool — the nearest real one is
  // `download_region`, which takes a region code and therefore wants a form.
  // A ghost in a list like this is silent: the name simply never matches, so
  // the tool that WAS meant falls through to the generated form and nobody
  // notices. Same shape as the two ghosts in MATERIAL_TOOLS, which cost the
  // transparency register every AI-driven baseline and federation publish.
  // The suite now checks every list of tool names, including this one.
]);

/**
 * Tools whose real surface is a SCREEN, not a generated form.
 *
 * The operator asks for the weekly card, and "Write to the group" opened a
 * ToolForm whose one question was `days — how far back "this week" reaches`.
 * Nobody wants to answer that. Running it gave a green tick and a collapsed
 * disclosure triangle labelled "what was recorded", containing raw JSON, for a
 * tool that recorded nothing — while the real card screen, with copy-as-text,
 * copy-as-image, print, and the button that marks it sent, sat one tab away.
 *
 * The item also never cleared, because `mark_card_sent` is only called from
 * that screen. So the round asked for the card every week forever, and the one
 * route to doing it was the one place the button did not go.
 */
export const GO_TO = new Map([
  ['card_for_the_week', 'card'],
]);

/**
 * What should happen when somebody presses an action: 'go', 'run' or 'form'.
 * Both lists are consulted here so neither caller can consult only one.
 */
export function actionKind(tool) {
  if (GO_TO.has(tool)) return 'go';
  if (DIRECT.has(tool)) return 'run';
  return 'form';
}

export const goesTo = (tool) => GO_TO.get(tool) ?? null;
