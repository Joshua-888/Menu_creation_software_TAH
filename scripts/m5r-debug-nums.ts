import {
  extractAloneCommaMenuNumber,
  extractMenuNumberFromLine,
} from "../src/extraction/pdf/menuNumber.js";
import { ingestPdf } from "../src/extraction/pdf/ingest.js";

console.log("I2.", extractMenuNumberFromLine("I2.  Two   in   one   110,   210,"));
console.log("II.", extractMenuNumberFromLine("II. Patricia   120,"));
console.log("2.2", extractMenuNumberFromLine("2.2..  Calzone -"));
console.log("51", extractAloneCommaMenuNumber("51,", "Tun   Sandwich"));
console.log("40", extractAloneCommaMenuNumber("40,", "frites"));

const pdf = await ingestPdf("fixtures/veroni/Scanner-2026-08-11-14_33_58.pdf");
const p2 = pdf.pages[1]!;
for (const l of p2.lines) {
  if (/I2|II\.|Two|Patricia|12\./i.test(l.text)) {
    console.log("P2", JSON.stringify(l.text), "=>", extractMenuNumberFromLine(l.text));
  }
}
const p5 = pdf.pages[4]!;
for (const l of p5.lines) {
  if (/51|Tun|Lille|Stor|48\.|Pommes|40,/i.test(l.text)) {
    console.log("P5", JSON.stringify(l.text));
  }
}
