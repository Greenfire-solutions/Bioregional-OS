// ── Files in, files out ───────────────────────────────────────────────────
// The only two routes in this OS that carry bytes rather than JSON.
//
// There is no multipart parsing here and no upload library, deliberately: the
// browser sends the file as the raw request body with its name in a header,
// which is a contract small enough to read in one sitting and to re-implement
// from a phone with `fetch`. Every dependency this project does not have is a
// dependency that cannot break somebody's Saturday.
//
// Both routes are gated. Uploads write to the steward's disk; reads hand over
// evidence attached to work, which is exactly the material the sensitivity
// ladder exists for. An earlier version of this file in another project had
// both of them open to anyone who could reach the port, and the proof photos
// behind paid work were world-readable.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { one } from '../../core/db.mjs';
import { storeMedia, resolveStored, getMedia } from '../../engines/proof.mjs';
import { isInlineSafe, MAX_BYTES } from '../../core/media.mjs';
import { LADDER, FULL } from '../clearance.mjs';

/** A connection at least this high may put a file into the commons. */
const MAY_UPLOAD = 'members';

const atLeast = (have, need) => LADDER.indexOf(have) >= LADDER.indexOf(need);

/**
 * POST /api/media
 *
 * Body: the file's bytes, exactly as they are.
 * Headers: x-bros-filename (required — its extension decides the type)
 * Query:  caption, lat, lng, captured_at, shows_people, consent_id, by, chapter
 */
export async function uploadMedia(req, url, { chapterId, clearance }) {
  if (req.method !== 'POST') return { status: 405, body: { error: 'POST required' } };
  if (!atLeast(clearance, MAY_UPLOAD)) {
    return { status: 403, body: {
      error: 'not_from_here',
      message: 'Putting a file into the commons needs a device enrolled in it. Ask the steward for a code.',
      needs: MAY_UPLOAD, has: clearance,
    } };
  }
  if (!chapterId) return { status: 400, body: { error: 'no_chapter', message: 'No chapter to file this against.' } };

  const q = Object.fromEntries(url.searchParams);
  const filename = String(req.headers['x-bros-filename'] ?? q.filename ?? '').trim();
  if (!filename) {
    return { status: 400, body: {
      error: 'missing_required',
      message: 'Send the file name in the x-bros-filename header — its extension is how the type is known.',
    } };
  }

  // Read with a running total rather than collecting first and checking after.
  // A refusal that arrives only once 900 MB has been buffered into this
  // process's memory is not a refusal, it is a way to stop the OS.
  const chunks = [];
  let total = 0;
  try {
    for await (const c of req) {
      total += c.length;
      if (total > MAX_BYTES) {
        req.destroy();
        return { status: 413, body: {
          error: 'too_large',
          message: `That file is over the ${MAX_BYTES / 1048576} MB limit.`,
        } };
      }
      chunks.push(c);
    }
  } catch {
    return { status: 400, body: { error: 'upload_interrupted', message: 'The file did not arrive in full.' } };
  }

  const out = storeMedia(chapterId, {
    filename,
    buffer: Buffer.concat(chunks),
    original_name: filename,
    caption: q.caption ?? null,
    lat: q.lat != null && q.lat !== '' ? Number(q.lat) : null,
    lng: q.lng != null && q.lng !== '' ? Number(q.lng) : null,
    captured_at: q.captured_at ?? null,
    shows_people: q.shows_people === '1' || q.shows_people === 'true',
    consent_id: q.consent_id || null,
    uploaded_by: q.by || null,
  });
  if (out?.error) {
    const status = out.error === 'unsupported_type' ? 415
      : out.error === 'too_large' ? 413
      : out.error === 'consent_required' || out.error === 'consent_withdrawn' ? 409
      : 400;
    return { status, body: out };
  }
  return out;
}

/**
 * GET /api/media/:id — the file itself.
 *
 * Writes its own response, so it returns undefined and the wrapper in api.mjs
 * leaves it alone.
 *
 * Three things here are load-bearing and none of them is obvious:
 *
 *   • The Content-Type comes from the STORED extension, never from anything a
 *     caller said. A caller-chosen type is how any uploaded file becomes
 *     text/html on this origin — stored scripting against the one browser this
 *     OS grants everything to.
 *   • X-Content-Type-Options: nosniff, so a browser does not re-decide that for
 *     itself.
 *   • Anything not an image, video or audio file is served as a download rather
 *     than rendered in place.
 */
export function serveMedia(req, res, id, clearance) {
  const m = getMedia(id);
  if (!m) return notFound(res);

  // The sensitivity ladder, applied to bytes. `withhold()` in the JSON wrapper
  // walks objects looking for ids and cannot see a file stream at all, so this
  // gate has to be made here or the ladder simply stops at the edge of the
  // media store — which is where the photographs are.
  const level = one('SELECT sensitivity FROM rids WHERE object_type=? AND local_id=?', 'media', id)?.sensitivity
    ?? 'members';
  if (clearance !== FULL && !atLeast(clearance, level)) {
    res.writeHead(403, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({
      error: 'withheld',
      message: 'That is above what this connection may read.',
    }));
  }

  if (m.withdrawn_at) {
    // 410, not 404. The difference is the whole point of keeping the row: this
    // file existed, somebody asked for it to be removed, and that is a fact the
    // commons states rather than pretending nothing was ever here.
    res.writeHead(410, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({
      error: 'withdrawn',
      message: 'This file was withdrawn' +
        (m.withdrawn_reason ? `: ${m.withdrawn_reason}` : '.'),
      withdrawn_at: m.withdrawn_at,
    }));
  }

  const file = resolveStored(m.stored_name);
  if (!file || !existsSync(file) || !statSync(file).isFile()) return notFound(res);

  const stat = statSync(file);
  res.writeHead(200, {
    'content-type': m.content_type,
    'content-length': String(stat.size),
    'cache-control': 'private, max-age=3600',
    'x-content-type-options': 'nosniff',
    'content-disposition': isInlineSafe(m.content_type)
      ? 'inline'
      : `attachment; filename="${(m.original_name || m.stored_name).replace(/["\\]/g, '')}"`,
  });
  createReadStream(file).pipe(res);
  return undefined;
}

function notFound(res) {
  res.writeHead(404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify({ error: 'not_found' }));
  return undefined;
}
