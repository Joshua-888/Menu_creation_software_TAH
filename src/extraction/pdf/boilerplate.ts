/**
 * Structural PDF boilerplate detection (footer / navigation / web-artifact text).
 *
 * Menus are commonly exported from web-to-PDF tools and carry a repeated page
 * footer: the print URL, the embedded source PDF path, and an all-caps
 * "MENU PDF RING OG BESTIL" call-to-action banner. This text is navigation, not
 * menu content, and must never leak into product ingredients/descriptions.
 *
 * Detection is intentionally structural and merchant-agnostic:
 *  - web/contact artifacts (URL, e-mail, embedded `.pdf` path, wp-content)
 *  - universally navigational tokens (facebook/instagram/opening hours)
 *  - an ALL-CAPS call-to-action banner containing a web CTA token
 *
 * It never keys on a merchant name or a specific dish phrase.
 */

/** Web/contact artifacts that cannot occur inside a dish title. */
const BOILERPLATE_ARTIFACT_RE =
  /(https?:\s*\/|www\.|\.pdf\b|\bwp-(?:content|uploads|json)\b|\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b|(?:facebook|instagram|opening hours|åbningstider))/i;

/** Generic call-to-action vocabulary used by exported web menus. */
const BOILERPLATE_CTA_RE =
  /\b(?:pdf|ring og bestil|bestil online|bestil nu|se mere|find os|hjemmeside|kontakt os|menu kort)\b/i;

/**
 * True when a line is page-level boilerplate (footer/navigation/web artifact)
 * rather than menu content.
 */
export function isBoilerplateFooterLine(line: string): boolean {
  const t = line.replace(/\s+/g, " ").trim();
  if (!t) return false;
  if (BOILERPLATE_ARTIFACT_RE.test(t)) return true;
  // An ALL-CAPS banner carrying a call-to-action token is a navigation strip,
  // never a dish title.
  const letters = t.replace(/[^A-Za-zÆØÅæøå]/g, "");
  return (
    letters.length >= 4 &&
    t === t.toUpperCase() &&
    BOILERPLATE_CTA_RE.test(t)
  );
}
