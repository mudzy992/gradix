/** Parse the active tender status table. Source: .cursor/docs/matrices/tenders/MATRIX.md */

const STATUSES = ["DRAFT", "SUBMITTED", "WON", "LOST", "WITHDRAWN"];

export function parseTenderMatrix(markdown) {
  const statusBlock = sectionBody(markdown, "Statusi");
  const allowed = [];
  const terminal = [];
  for (const line of statusBlock.split("\n")) {
    if (!line.startsWith("|") || line.includes("From") || line.includes("---")) continue;
    const cells = line.split("|").map((cell) => cell.trim()).filter(Boolean);
    if (cells.length < 2) continue;
    if (cells[0].includes("/")) {
      for (const from of cells[0].split("/").map((item) => item.trim())) {
        terminal.push(`${from}>terminal`);
      }
      continue;
    }
    for (const to of cells[1].split(",").map((item) => item.trim())) {
      allowed.push(`${cells[0]}>${to}`);
    }
  }
  const allowSet = new Set(allowed);
  const denied = [];
  for (const from of STATUSES) {
    for (const to of STATUSES) {
      if (from === to) continue;
      const key = `${from}>${to}`;
      if (!allowSet.has(key)) denied.push(key);
    }
  }
  return {
    allowed,
    terminal,
    denied,
    edges: [...allowed, ...terminal, ...denied],
    sections: [
      "Polja",
      "Prilozi",
      "Obligations × TENDER",
      "Convert WON",
      "Dozvole",
      "Partneri (R7.1)",
    ],
  };
}

function sectionBody(markdown, heading) {
  const parts = markdown.split(/^## /m);
  const block = parts.find((part) => part.startsWith(heading));
  if (!block) throw new Error(`Tender matrix is missing section ${heading}`);
  return block;
}
