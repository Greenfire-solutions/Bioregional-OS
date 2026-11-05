// ── Evidence: the file store, and the before-and-after pair ───────────────
// The one place bytes enter this commons.
//
// Everything here is local. A photograph taken on a phone at a creek goes into
// data/media on the steward's own machine and nowhere else — no bucket, no
// signed URL, no third party holding the evidence behind somebody else's
// account. That is the same promise the rest of the OS makes, and evidence is
// the worst possible place to stop keeping it.
//
// Four things this file refuses, each for a stated reason:
//
//   • a file type this OS will not serve safely        (core/media.mjs)
//   • a photograph of identifiable people with no consent record
//   • a proof that is not actually a PAIR
//   • a check signed by the person who did the work
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { all, one, create, run, ROOT } from '../core/db.mjs';
import { newId } from '../core/ids.mjs';
import { contentTypeOf, extensionOf, isAllowed, ALLOWED, MAX_BYTES, STORED_NAME } from '../core/media.mjs';

/** Where the bytes live. Beside commons.db, so one backup takes both. */
export function mediaDir() {
  return process.env.BROS_MEDIA || join(ROOT, 'data', 'media');
}

/**
 * Resolve a stored name inside the media directory, or null.
 *
 * Checked on the RESOLVED path, not by testing the string for "..". A prefix
 * check on the raw name misses percent-encodings, symlinks and "mediaX/" style
 * near misses, and the cost of getting it wrong is that a URL parameter reads
 * any file this process can — which, on the steward's own laptop, is all of them.
 */
export function resolveStored(name) {
  if (!name || !STORED_NAME.test(String(name))) return null;
  const root = resolve(mediaDir());
  const file = resolve(root, String(name));
  if (!file.startsWith(root + sep)) return null;
  return file;
}

/**
 * Take a file into the commons.
 *
 * `buffer` is the bytes. The caller has already decided who is allowed to be
 * doing this; what happens here is about the file itself.
 */
export function storeMedia(chapterId, {
  filename, buffer, original_name = null, caption = null, lat = null, lng = null,
  captured_at = null, shows_people = false, consent_id = null, uploaded_by = null,
  sensitivity = 'members',
} = {}) {
  if (!chapterId) return { error: 'no_chapter', message: 'No chapter to file this against.' };
  const name = String(original_name || filename || '').trim();
  if (!name) return { error: 'missing_required', message: 'A file needs a name, so its type is known.' };
  if (!isAllowed(name)) {
    return {
      error: 'unsupported_type',
      message: `This commons does not store "${extensionOf(name) || 'that'}" files. ` +
               `It takes: ${ALLOWED.join(' ')}.`,
      // Said plainly rather than left as a silent omission, because the one
      // people reach for is SVG and "it did not work" is the wrong lesson.
      note: 'SVG is deliberately not on the list: it is a picture to a person and a script to a browser.',
      allowed: ALLOWED,
    };
  }
  if (!buffer || !buffer.length) {
    return { error: 'empty_file', message: 'That file arrived with nothing in it.' };
  }
  if (buffer.length > MAX_BYTES) {
    return {
      error: 'too_large',
      message: `That file is ${(buffer.length / 1048576).toFixed(0)} MB. The limit is ` +
               `${MAX_BYTES / 1048576} MB — this is a field-evidence store on somebody's laptop.`,
    };
  }

  // ── The consent register, finally joined to something ──────────────────
  // media_consent has been in this schema since the beginning with nothing
  // pointing at it. The manual's position is explicit: a photograph of people
  // is taken under a consent that is reviewable and withdrawable. So the one
  // kind of file the protocol has a rule about cannot enter without the record
  // the rule is made of.
  //
  // It fires only when the person uploading SAYS the photograph shows people,
  // because no software can tell, and a system that guessed would be wrong in
  // the direction that matters.
  if (shows_people) {
    if (!consent_id) {
      return {
        error: 'consent_required',
        message: 'A photograph of identifiable people needs a consent record — who agreed, to what, ' +
                 'and whether they may withdraw it. That register already exists in this commons.',
        action: { tool: 'record_consent', input: {} },
      };
    }
    const consent = one('SELECT id, subject, withdrawn_at FROM media_consent WHERE id=? AND chapter_id=?',
      consent_id, chapterId);
    if (!consent) return { error: 'not_found', message: `No consent record ${consent_id} in this chapter.` };
    if (consent.withdrawn_at) {
      return {
        error: 'consent_withdrawn',
        message: `That consent was withdrawn on ${String(consent.withdrawn_at).slice(0, 10)}. ` +
                 'Withdrawn means withdrawn; it does not cover a new photograph.',
      };
    }
  }

  const id = newId('med');
  const stored = `${id}${extensionOf(name)}`;
  const dir = mediaDir();
  mkdirSync(dir, { recursive: true });
  const file = resolveStored(stored);
  if (!file) return { error: 'bad_name', message: 'That file could not be given a safe name.' };
  writeFileSync(file, buffer);

  // Hash what was WRITTEN, by reading it back — not the buffer that was handed
  // in. The claim a proof makes is about the bytes this commons is holding, and
  // hashing the input would certify a file that a full disk truncated. When the
  // read back fails, that is recorded as such rather than left to look like
  // proof of something.
  let sha256 = null;
  let hashSource = 'content';
  try {
    sha256 = createHash('sha256').update(readFileSync(file)).digest('hex');
  } catch {
    hashSource = 'unreadable';
  }

  const row = create('media', 'media', chapterId, {
    id,
    chapter_id: chapterId,
    stored_name: stored,
    original_name: name,
    content_type: contentTypeOf(name),
    bytes: buffer.length,
    sha256,
    hash_source: hashSource,
    lat: lat != null && lng != null ? Number(lat) : null,
    lng: lat != null && lng != null ? Number(lng) : null,
    captured_at,
    caption,
    shows_people: shows_people ? 1 : 0,
    consent_id: shows_people ? consent_id : null,
    uploaded_by,
  }, sensitivity);

  return { ...row, url: `/api/media/${id}` };
}

export function getMedia(id) {
  const m = one('SELECT * FROM media WHERE id=?', id);
  if (!m) return null;
  return { ...m, url: `/api/media/${m.id}`, shows_people: !!m.shows_people };
}

export function listMedia(chapterId, { limit = 100 } = {}) {
  return all(
    `SELECT id, original_name, content_type, bytes, sha256, hash_source, lat, lng, caption,
            shows_people, uploaded_by, created_at, withdrawn_at
       FROM media WHERE chapter_id=? ORDER BY created_at DESC LIMIT ?`, chapterId, limit)
    .map((m) => ({ ...m, url: `/api/media/${m.id}`, shows_people: !!m.shows_people }));
}

/**
 * Withdraw a file: the bytes go, the row stays.
 *
 * The row stays because a proof that pointed at it has to be able to say
 * "withdrawn" rather than quietly losing half of a pair and reading as though
 * the evidence was never there. That is the same reasoning the people, devices
 * and task_assignees tables use, applied to the one thing here that genuinely
 * has to be destroyable on request.
 */
export function withdrawMedia(id, { reason = null } = {}) {
  const m = one('SELECT * FROM media WHERE id=?', id);
  if (!m) return { error: 'not_found', message: `No file ${id}.` };
  if (m.withdrawn_at) return { already: true, media: getMedia(id) };
  const file = resolveStored(m.stored_name);
  if (file && existsSync(file)) rmSync(file, { force: true });
  run(`UPDATE media SET withdrawn_at=datetime('now'), withdrawn_reason=? WHERE id=?`,
    reason ? String(reason).trim() : null, id);
  const used = all(
    `SELECT id FROM proofs WHERE before_media_id=? OR after_media_id=?`, id, id).length;
  return {
    withdrawn: true,
    media: getMedia(id),
    note: used
      ? `The file is gone. ${used} proof${used === 1 ? '' : 's'} still name it, and now say so.`
      : 'The file is gone.',
  };
}

/**
 * Submit a before-and-after pair against a task.
 *
 * A PAIR, insisted on. Two loose uploads with a shared tag lets one arrive
 * without the other and still read as evidence — and the claim being made is
 * entirely comparative: this is what it was, this is what it is. One photograph
 * of a clear culvert proves that a culvert is clear, which nobody doubted.
 */
export function submitProof(taskId, {
  before_media_id, after_media_id, note = null, submitted_by = null,
} = {}) {
  const task = one('SELECT * FROM tasks WHERE id=?', taskId);
  if (!task) return { error: 'not_found', message: `No task ${taskId}.` };
  if (!before_media_id || !after_media_id) {
    return {
      error: 'pair_required',
      message: 'A proof is a pair: the ground before, and the same ground after. ' +
               `${!before_media_id ? 'The before' : 'The after'} is missing.`,
      note: 'Upload both files first — each upload answers with an id to pass here.',
    };
  }
  for (const [which, id] of [['before', before_media_id], ['after', after_media_id]]) {
    const m = one('SELECT id, chapter_id, withdrawn_at FROM media WHERE id=?', id);
    if (!m) return { error: 'not_found', message: `No file ${id} for the ${which}.` };
    if (m.chapter_id !== task.chapter_id) {
      return {
        error: 'wrong_chapter',
        message: `That ${which} file belongs to another chapter. Evidence does not cross between commons.`,
      };
    }
    if (m.withdrawn_at) {
      return { error: 'withdrawn', message: `That ${which} file has been withdrawn and cannot be used as evidence.` };
    }
  }
  if (before_media_id === after_media_id) {
    return {
      error: 'same_file',
      message: 'The before and the after are the same file. That is one photograph used twice, not a pair.',
    };
  }

  // ── The name is required, and this is the reason ───────────────────────
  // `reviewProof` refuses a check signed by the person who submitted the work.
  // That rule compares against `submitted_by` — so a proof filed WITHOUT a name
  // is a proof the rule can never fire on, and the one person it exists to stop
  // is the one person who knows to leave the field blank.
  //
  // A refusal that its own schema makes unreachable is worse than no refusal:
  // it reads, to anybody comparing the protocol to the code, as a control that
  // is in place. So the name is required here rather than the rule being
  // softened over there.
  //
  // A name, not a login. `claim_task` already asks for exactly this, and there
  // are no accounts anywhere in this OS to ask for instead.
  if (!String(submitted_by ?? '').trim()) {
    return {
      error: 'name_required',
      message: 'Filing evidence needs the name of whoever did the work — not a login, a name. ' +
               'It is what makes it possible to say that somebody else checked it.',
    };
  }

  const proof = create('proofs', 'proof', task.chapter_id, {
    chapter_id: task.chapter_id,
    quest_id: task.quest_id,
    task_id: taskId,
    before_media_id, after_media_id,
    note: note ? String(note).trim() : null,
    status: 'pending',
    submitted_by: submitted_by ? String(submitted_by).trim() : null,
  }, 'members');

  return {
    ...proof,
    before: getMedia(before_media_id),
    after: getMedia(after_media_id),
    note_to_caller: 'Filed. The task can be closed now; somebody who was not you checks it separately.',
  };
}

/**
 * Check somebody else's work.
 *
 * THE ONE RULE: not your own. A check signed by the person who did the work is
 * not a check, and the point of a before-and-after is that a person who was not
 * there can look. Compared on the trimmed name because names are all this
 * system has — there are no accounts here — and a rule that can be walked
 * around by typing a middle initial is still worth having, because the record
 * shows what was typed and the commons can read it.
 */
export function reviewProof(proofId, { decision, reviewed_by, note = null } = {}) {
  const p = one('SELECT * FROM proofs WHERE id=?', proofId);
  if (!p) return { error: 'not_found', message: `No proof ${proofId}.` };
  if (!['verified', 'rejected'].includes(decision)) {
    return { error: 'unknown_decision', message: 'A check either verifies or rejects.' };
  }
  const by = String(reviewed_by ?? '').trim();
  if (!by) {
    return {
      error: 'reviewer_required',
      message: 'A check needs the name of the person making it. An anonymous verification is a tick in a box.',
    };
  }
  if (p.submitted_by && by.toLowerCase() === String(p.submitted_by).trim().toLowerCase()) {
    return {
      error: 'cannot_check_own_work',
      message: `${by} submitted this. The whole purpose of a before-and-after is that somebody who ` +
               'was not there can look at it — so the person who did the work is not the person who checks it.',
    };
  }
  if (decision === 'rejected' && !String(note ?? '').trim()) {
    return {
      error: 'reason_required',
      message: 'Rejecting needs a reason. The person who did the work has to know what to do about it.',
    };
  }
  run(`UPDATE proofs SET status=?, reviewed_by=?, reviewed_at=datetime('now'), review_note=? WHERE id=?`,
    decision, by, note ? String(note).trim() : null, proofId);
  return { ...one('SELECT * FROM proofs WHERE id=?', proofId), ...hydrate(proofId) };
}

function hydrate(proofId) {
  const p = one('SELECT * FROM proofs WHERE id=?', proofId);
  if (!p) return {};
  return { before: getMedia(p.before_media_id), after: getMedia(p.after_media_id) };
}

export function proofsFor(taskId) {
  return all('SELECT * FROM proofs WHERE task_id=? ORDER BY created_at DESC, rowid DESC', taskId)
    .map((p) => ({ ...p, before: getMedia(p.before_media_id), after: getMedia(p.after_media_id) }));
}

/** What is waiting for somebody to look at it. */
export function pendingProofs(chapterId) {
  const rows = all(
    `SELECT p.*, t.title task_title, q.title project_title
       FROM proofs p JOIN tasks t ON t.id=p.task_id JOIN quests q ON q.id=t.quest_id
      -- rowid breaks the tie. created_at is a datetime('now') to the second,
      -- and a work party files four pairs in the same minute — without this,
      -- "the oldest thing waiting" is whichever row SQLite happened to return
      -- first, and the operator's one-line summary names a different task each
      -- time it is asked. Same reasoning as LATEST_MEASUREMENT in core/db.mjs.
      WHERE p.chapter_id=? AND p.status='pending' ORDER BY p.created_at, p.rowid`, chapterId);
  return rows.map((p) => ({ ...p, before: getMedia(p.before_media_id), after: getMedia(p.after_media_id) }));
}

/**
 * Is the evidence this commons holds still there, and still what it says?
 *
 * Re-reads every stored file and re-hashes it. A proof store nobody ever checks
 * is a promise, and this is the check — it can say "the file is gone", "the
 * bytes changed", or "this row never had a real hash", which are three
 * different problems that look identical in the interface.
 */
export function verifyStore(chapterId) {
  const rows = all('SELECT * FROM media WHERE chapter_id=?', chapterId);
  const out = { checked: 0, intact: 0, missing: [], changed: [], unhashed: [], withdrawn: 0 };
  for (const m of rows) {
    if (m.withdrawn_at) { out.withdrawn++; continue; }
    out.checked++;
    if (m.hash_source !== 'content' || !m.sha256) { out.unhashed.push(m.id); continue; }
    const file = resolveStored(m.stored_name);
    if (!file || !existsSync(file) || !statSync(file).isFile()) { out.missing.push(m.id); continue; }
    const now = createHash('sha256').update(readFileSync(file)).digest('hex');
    if (now === m.sha256) out.intact++; else out.changed.push(m.id);
  }
  out.ok = !out.missing.length && !out.changed.length;
  out.sentence = !out.checked
    ? 'No evidence stored yet.'
    : out.ok
      ? `${out.intact} of ${out.checked} files re-read and still byte-for-byte what they were.` +
        (out.unhashed.length ? ` ${out.unhashed.length} were never hashed.` : '')
      : `${out.missing.length} missing, ${out.changed.length} changed since they were filed.`;
  return out;
}
