// ── The one list of file types this commons stores ────────────────────────
// Read by the server that enforces it and by the file pickers that offer it.
//
// It lives in core/ because those two used to be written separately in every
// project that has ever done this: the picker offers `image/*`, which lets a
// browser hand over .bmp, .tiff, .avif or .jfif, and the server then refuses
// them. A rejection a person could not have predicted reads as the upload
// being broken, and they stop trying rather than trying a different file.
//
// Deliberately short. This is a field-evidence store, not a file manager: a
// photograph, a video, a voice note, and a PDF for a permit or a soil report.

export const MIME = Object.freeze({
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  // Every iPhone takes these by default, and a proof store that refuses the
  // format most field photographs arrive in is a proof store nobody fills.
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
});

/**
 * SVG is NOT here, and the omission is the point.
 *
 * It is an image to a person and a script host to a browser, so a stored .svg
 * served inline on the app's own origin is stored cross-site scripting against
 * everybody who later opens the commons — including the steward, whose browser
 * is the one connection this system grants everything to.
 */
export const ALLOWED = Object.freeze(Object.keys(MIME));

/** What an <input type="file"> should offer for each kind of evidence. */
export const ACCEPT_IMAGE = ALLOWED.filter((e) => MIME[e].startsWith('image/')).join(',');
export const ACCEPT_VIDEO = ALLOWED.filter((e) => MIME[e].startsWith('video/')).join(',');
export const ACCEPT_ANY = ALLOWED.join(',');

/** 100 MB. A phone video of a culvert clearing, not a drone survey. */
export const MAX_BYTES = 100 * 1024 * 1024;

export function extensionOf(filename) {
  const m = /\.[^./\\]+$/.exec(String(filename || ''));
  return m ? m[0].toLowerCase() : '';
}

export function isAllowed(filename) {
  return extensionOf(filename) in MIME;
}

/**
 * The Content-Type a stored file is served as.
 *
 * From the STORED EXTENSION only, never from anything the uploader said. A
 * caller-supplied content type on the way back out is how any upload becomes
 * `text/html` on this origin, which is the same hole as allowing SVG by
 * another door.
 */
export function contentTypeOf(filename) {
  return MIME[extensionOf(filename)] || 'application/octet-stream';
}

/**
 * Types a browser may render in place. Everything else is served as a
 * download, so a stored file can never execute here.
 */
export function isInlineSafe(contentType) {
  return /^(image|video|audio)\//.test(String(contentType || ''));
}

/** The shape of a name this OS wrote: <id><ext> and nothing else. */
export const STORED_NAME = /^[a-z]{2,6}_[0-9a-f]{8}(\.[A-Za-z0-9]{1,8})?$/;
