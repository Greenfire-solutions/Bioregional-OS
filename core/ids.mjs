// Reference Identifiers (RIDs) — KOI-net inspired.
// A RID names an object so a label can travel between chapters while the
// material itself stays where it was created. See docs/INTEROP.md.
import { randomUUID } from 'node:crypto';

export const NAMESPACE = 'orn:bros';

export function newId(prefix = 'obj') {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}

/** orn:bros.signal:barton-creek/sig_1a2b3c4d */
export function makeRid(objectType, chapterId, localId) {
  return `${NAMESPACE}.${objectType}:${chapterId}/${localId}`;
}

export function parseRid(rid) {
  const m = /^orn:bros\.([a-z_]+):([^/]+)\/(.+)$/.exec(rid || '');
  if (!m) return null;
  return { objectType: m[1], chapterId: m[2], localId: m[3] };
}

export const SENSITIVITY = ['public', 'members', 'council', 'restricted', 'sacred'];

/** Sensitivity is a ladder. Nothing above the caller's clearance is ever returned. */
export function visibleAt(clearance, sensitivity) {
  return SENSITIVITY.indexOf(sensitivity) <= SENSITIVITY.indexOf(clearance);
}
