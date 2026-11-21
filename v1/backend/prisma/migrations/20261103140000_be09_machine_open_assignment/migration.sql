-- BE-09 (F-03): mašina može biti na samo jednom projektu u datom trenutku.
-- `MachineAssignment` nije imao nikakvo unique ograničenje, pa je aplikacijska provjera
-- (TOCTOU) bila jedina barijera, a P2002 grana u `MachinesService.assign` mrtva.
-- Parcijalni indeks se ne može izraziti u Prisma šemi → živi samo ovdje (vidi BE-08 §6.4).

CREATE UNIQUE INDEX "MachineAssignment_open_machine_key"
  ON "MachineAssignment" ("machineId")
  WHERE "endedAt" IS NULL;
