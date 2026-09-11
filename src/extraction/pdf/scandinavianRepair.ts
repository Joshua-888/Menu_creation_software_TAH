/**
 * Generic Scandinavian OCR text repairs (shared; no PDF/OCR imports).
 */

export function repairScandinavianOcrName(raw: string): string {
  return (
    raw
      .replace(/\bPA,l/gi, "Pøl")
      .replace(/\bPA,lsemix/gi, "Pølsemix")
      // Øl variants — avoid \\b before non-ASCII (JS \\w is ASCII-only without /u)
      .replace(/\bA,l\b/gi, "Øl")
      .replace(/\bA[~˜～\u02DC]\s*l\b/gi, "Øl")
      // Mojibake / OCR: Ã + optional tilde + l  (bytes often C3 83 CB 9C 6C)
      .replace(/\u00C3[\u02DC~～]?\s*l/gi, "Øl")
      .replace(/Ã[~˜～\u02DC]?\s*l/gi, "Øl")
      .replace(/Ã˜l/gi, "Øl")
      .replace(/(^|[^A-Za-zÆØÅæøå])ol(?=[^A-Za-zÆØÅæøå]|$)/gi, "$1Øl")
      .replace(/\s+/g, " ")
      .trim()
  );
}
