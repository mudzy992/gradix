> ⚠️ PENZIONISANO (retired) – NIJE RELEVANTNO za implementaciju. Služi samo kao historijska referenca. Datum penzionisanja: 2026-11-02.

# HSE / incident

Status: **locked**. Faza 6.0b / 5.7 lista. **v1 online-only.**

- `Incident`: companyId, projectId?, taskId?, userId, severity LOW|MEDIUM|HIGH, description, lat/lng optional, status OPEN|ACK|CLOSED
- `IncidentPhoto`: path
- Create: svaki auth teren (`hse.write`) — max 3 klika: foto + tekst + pošalji. Max **5** foto.
- Lista/ack/close: SS/PM/ADMIN (`hse.read` + write na close)
- Smije na ON_HOLD i terminalnom projektu (incident poslije posla)
- Ne blokira timer; nije pravni dosije
- **v1 online-only:** Incident nije u offline queue. Bez mreže: UI poruka, nema local insert (`HSE_OFFLINE` na klijentu)

Nije Faza 1.
