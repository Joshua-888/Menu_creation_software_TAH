import type { ClassifiedPdfPage, IngestedPdfPage, PageClass } from "./types.js";

// Generic cover/contact signals only. Never add merchant-specific tokens
// (restaurant names, street names, city names); a cover page must be
// recognisable from generic vocabulary or structure alone.
const COVER_HINTS =
  /cvr\b|tlf\.?\s*\d|telefon|adresse\b|åbningstider|åbning|facebook|instagram|bestilling|bestil online|order online|buffet|www\.|https?:\/\//i;
const MENU_HINTS =
  /\b(pizza|pasta|grill|menu|dürüm|durum|sandwich|nachos|indisk|sodavand|alm\.?|familie|forretter|hovedretter)\b/i;
const INFO_HINTS =
  /arrangementer|hold din fest|siddende gæster|kuverter|kontakt\s+\d/i;
const MENU_NUMBER_RE = new RegExp(String.raw`\b\d{1,3}[a-zA-Z]?\s*[.,]`, "g");

export function classifyPdfPage(page: IngestedPdfPage): ClassifiedPdfPage {
  const text = page.rawText;
  const numbers = text.match(MENU_NUMBER_RE) ?? [];
  const hasMenuNumbers = numbers.length >= 3;
  const hasMenuWords = MENU_HINTS.test(text);
  const hasCover = COVER_HINTS.test(text) && page.pageNumber === 1;
  const hasInfo = INFO_HINTS.test(text);

  let classification: PageClass = "UNKNOWN";
  let classificationReason = "no strong signals";

  if (hasCover && !hasMenuNumbers) {
    classification = "COVER";
    classificationReason = "cover/contact/hours signals without menu numbers";
  } else if (hasInfo && !hasMenuWords && numbers.length < 5) {
    classification = "INFORMATIONAL";
    classificationReason = "event/advertising text";
  } else if (hasMenuNumbers || hasMenuWords) {
    classification = "MENU_CONTENT";
    classificationReason = `menu signals (numbers=${numbers.length}, words=${hasMenuWords})`;
  } else if (hasInfo) {
    classification = "INFORMATIONAL";
    classificationReason = "informational text";
  }

  if (classification === "UNKNOWN" && /drikkevarer/i.test(text)) {
    classification = "MENU_CONTENT";
    classificationReason = "beverage section";
  }

  return { ...page, classification, classificationReason };
}

export function classifyPdfPages(
  pages: IngestedPdfPage[],
): ClassifiedPdfPage[] {
  return pages.map(classifyPdfPage);
}
