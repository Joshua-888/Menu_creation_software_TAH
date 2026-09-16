/**
 * Build a realistic rich Thai takeaway text PDF for third-merchant certification.
 * ASCII-only (WinAnsi-safe Helvetica) so pdfjs extracts clean product/price lines.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const lines = [
  "THAI HOUSE TAKEAWAY",
  "",
  "Forretter",
  "1. Foraarsruller 45 kr",
  "kylling, groentsager",
  "2. Tom Yam Gung 65 kr",
  "rejer, lemongrass, chili",
  "3. Satay Kylling 59 kr",
  "kylling, peanut sauce",
  "",
  "Hovedretter",
  "10. Pad Thai Kylling 95 kr",
  "risnudler, aeg, bonnespirer, jordnodder",
  "11. Pad Thai Rejer 105 kr",
  "risnudler, aeg, bonnespirer, jordnodder",
  "12. Gron Curry Kylling 99 kr",
  "kokosmaelk, basilikum, groentsager",
  "13. Rod Curry Oksekoed 109 kr",
  "kokosmaelk, bamboo, basilikum",
  "14. Massaman Curry 105 kr",
  "kartofler, peanut, kokosmaelk",
  "15. Basilicum Wok Kylling 95 kr",
  "chili, hvidloeg, basilikum",
  "16. Sweet and Sour Kylling 95 kr",
  "ananas, peber, loeg",
  "17. Cashew Wok Kylling 99 kr",
  "cashewnodder, groentsager",
  "",
  "Nudler og Ris",
  "20. Stegte Ris Kylling 85 kr",
  "ris, aeg, gulerod, aerter",
  "21. Stegte Ris Rejer 95 kr",
  "ris, aeg, gulerod, aerter",
  "22. Stegte Nudler Kylling 89 kr",
  "nudler, groentsager, sojasauce",
  "",
  "Vegetar",
  "30. Pad Thai Vegetar 89 kr",
  "tofu, aeg, bonnespirer",
  "31. Gron Curry Tofu 95 kr",
  "kokosmaelk, basilikum, tofu",
  "",
  "Tilbehor",
  "Ekstra Ris 20 kr",
  "Ekstra Nudler 20 kr",
  "Peanut Sauce 15 kr",
  "",
  "Drikkevarer",
  "Cola 25 kr",
  "Fanta 25 kr",
  "Thai Iste 30 kr",
  "Vand 15 kr",
];

function escapePdfText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

const contentOps: string[] = ["BT", "/F1 10 Tf", "40 800 Td", "12 TL"];
for (let i = 0; i < lines.length; i++) {
  const t = escapePdfText(lines[i] ?? "");
  if (i === 0) {
    contentOps.push(`(${t}) Tj`);
  } else {
    contentOps.push(`T* (${t}) Tj`);
  }
}
contentOps.push("ET");
const stream = contentOps.join("\n");
const streamLen = Buffer.byteLength(stream, "latin1");

const objects: string[] = [];
objects.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
objects.push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
objects.push(
  "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
);
objects.push(
  `4 0 obj\n<< /Length ${streamLen} >>\nstream\n${stream}\nendstream\nendobj\n`,
);
objects.push(
  "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
);

let pdf = "%PDF-1.4\n";
const offsets: number[] = [0];
for (const obj of objects) {
  offsets.push(Buffer.byteLength(pdf, "latin1"));
  pdf += obj;
}
const xrefPos = Buffer.byteLength(pdf, "latin1");
pdf += `xref\n0 ${objects.length + 1}\n`;
pdf += "0000000000 65535 f \n";
for (let i = 1; i <= objects.length; i++) {
  pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
}
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;

const out = resolve(
  process.cwd(),
  "fixtures/golden/third-merchant/raw-source.pdf",
);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.from(pdf, "latin1"));
console.log(JSON.stringify({ out, bytes: Buffer.byteLength(pdf, "latin1"), lines: lines.length }));
