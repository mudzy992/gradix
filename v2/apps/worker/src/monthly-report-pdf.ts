/** Mali interni PDF bez biblioteke fontova; brojevi su prethodno izračunati iz izvornog ledgera. */
export function monthlyReportPdf(lines: readonly string[]): Buffer {
  const escape = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d").replace(/Đ/g, "D").replace(/[^\x20-\x7e]/g, "?")
    .replace(/[\\()]/g, "\\$&");
  const stream = `BT /F1 12 Tf 50 790 Td 18 TL ${lines.map(line => `(${escape(line)}) Tj T*`).join("\n")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let output = "%PDF-1.4\n"; const offsets = [0];
  for (const [i, object] of objects.entries()) { offsets.push(Buffer.byteLength(output)); output += `${i + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,"0")} 00000 n \n`).join("")}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output, "ascii");
}
