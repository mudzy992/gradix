# Upload — matrica

Status: **locked** (Faza 1.7). PublicAsset stream je Faza 8.

- Auth obavezan (osim Faza 8 public file preko `PublicAsset` id, ne raw path)
- Max 10 MB; magic-byte provjera (ne samo Content-Type)
- MIME: jpeg, png, webp, pdf, docx, xlsx
- Path: `{companyId}/{yyyy}/{mm}/{uuid}.ext`
- `GET /api/files?path=`: normalize, reject `..` i apsolutne puteve; path **mora** početi sa `{companyId}/` iz DB usera
- Attach: entitet.companyId === user.companyId
- Company logo i diary/HSE foto isti path guard
- Mobile compress: max 1920px JPEG 80%
