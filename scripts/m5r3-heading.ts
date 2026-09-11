// Inline copies of the checks from layoutExtract
const SECTION_HEADINGS = [
  { re: /^indbagt.*ufo.*calzone/i, name: "Indbagt, ufo og calzone" },
  { re: /^salatpizza\b/i, name: "Salatpizza" },
  { re: /^vegetarpizza\b/i, name: "Vegetarpizza" },
  { re: /^pasta\b/i, name: "Pasta" },
  { re: /^grill\b/i, name: "GRILL" },
  { re: /^sandwich/i, name: "Sandwich - hjemmelavet inkl. pommes frites" },
  { re: /^nachos\b/i, name: "Nachos" },
  { re: /^indisk\b/i, name: "INDISK" },
  { re: /^forretter\b/i, name: "INDISK / Forretter" },
  { re: /^hovedretter\b/i, name: "INDISK / Hovedretter" },
  { re: /^drikkevarer\b/i, name: "DRIKKEVARER" },
  { re: /^pizza\b/i, name: "PIZZA" },
];

function detectSectionHeading(line: string): string | null {
  const t = line.trim();
  for (const h of SECTION_HEADINGS) {
    if (h.re.test(t)) return h.name;
  }
  return null;
}

console.log("heading?", detectSectionHeading("Pasta Alfredo med Kylling"));
console.log("heading pasta alone?", detectSectionHeading("Pasta"));
