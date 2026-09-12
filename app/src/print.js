/**
 * Print one thing, not everything on the page.
 *
 * The card and the field sheet live on the same screen and both used to call
 * `window.print()` on the whole document, so either button produced both — a
 * noticeboard card stapled to a sheet meant for the creek. Two buttons that do
 * the same thing is a worse bug than one that does nothing, because it looks
 * like it worked.
 *
 * A class on <body> narrows what the print stylesheet keeps. Cleared on
 * `afterprint`, and on a timer as well: `afterprint` does not fire in every
 * browser, and a page left permanently hiding half of itself because somebody
 * cancelled a print dialog is the worse failure of the two.
 */
export function printOnly(what) {
  const cls = `printing-${what}`;
  const body = document.body;
  body.classList.add(cls);

  let cleaned = false;
  const clean = () => {
    if (cleaned) return;
    cleaned = true;
    body.classList.remove(cls);
    window.removeEventListener('afterprint', clean);
  };

  window.addEventListener('afterprint', clean);
  setTimeout(clean, 20000);

  try { window.print(); } catch { clean(); }
}
