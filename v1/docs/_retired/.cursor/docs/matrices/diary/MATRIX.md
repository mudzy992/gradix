> ⚠️ PENZIONISANO (retired) – NIJE RELEVANTNO za implementaciju. Služi samo kao historijska referenca. Datum penzionisanja: 2026-11-02.

# Diary — matrica

Status: **locked**. API Faza 5.6; web 5.6; mobile 6.3; PDF 7.4.

## Identitet

`DiaryEntry` @@unique([companyId, projectId, date])  
`date` = kalendarski dan u `app.timezone` (DATE, ne UTC midnight nagađanje).

Polja: weather, tempMin/Max, workDescription, problemsNoted, workersCount, pdfUrl nullable, isVoiceInput default false, isSynced, localId.

`DiaryPhoto`: path, caption, lat/lng optional. Max **20** po entry (`VALIDATION_FAILED`).

PDF Faza 7.4 = intern izvoz, **nije** pravni obrazac (potpisi nadzora/investitora van v1).

Write na ON_HOLD OK; na COMPLETED/CANCELLED/archived → 409 `PROJECT_TERMINAL`.

## Ko

Write: SS scoped, ADMIN, SUPER_ADMIN (`diary.write`). Read: isti + PM scoped (`diary.read`).

## Konflikt

Dva zapisa isti (firma, projekat, dan) → ne last-write-wins.  
Server: 409 `DIARY_CONFLICT` + `conflictData`. Resolve: `POST /api/sync/resolve-conflict` ili web isti tok (izaberi A/B/merge tekst). Socket `DIARY_CONFLICT` in-app.

## Offline

U sync queue (Faza 6.4). Voice-to-text nije v1 close.

## PDF

Faza 7.4 `POST /api/diary/:id/pdf` → MinIO path u pdfUrl. Nije blocker 5/6.

## Error

`DIARY_CONFLICT` `NOT_FOUND` `FORBIDDEN` `VALIDATION_FAILED`
