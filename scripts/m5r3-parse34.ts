import {
  extractMenuNumberFromLine,
  extractAloneCommaMenuNumber,
} from "../src/extraction/pdf/menuNumber.js";

const lines = [
  "Klassisk italiensk kødsovs",
  "130,",
  "34.",
  "Pasta Alfredo med Kylling",
  "parmesan og kynng",
  "ret med Penne, flødesovs, 130,",
  "Klassisk",
  "35. Pasta Ai Gamberi",
];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i]!;
  const mn = extractMenuNumberFromLine(line);
  const alone = extractAloneCommaMenuNumber(
    line,
    lines[i + 1],
    i > 0 ? lines[i - 1] : undefined,
  );
  console.log(
    JSON.stringify({
      i,
      line,
      mn,
      alone,
    }),
  );
}

console.log(
  "pipe34",
  extractMenuNumberFromLine("|34. Pasta Alfredo"),
);
