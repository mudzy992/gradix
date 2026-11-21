# MOBILE.md — Gradix teren (Expo)

> **Izvor istine za mobilnu aplikaciju.** Provjereno u `mobile/` na commitu `e531ca2`.
> Obim u ovom ciklusu (odluka **D-003**): kvalitet koda + testovi + E2E; **objava** (EAS)
> dolazi kasnije.

**Stack:** Expo SDK ~57, React Native 0.86, React 19.2, expo-router (file-based), expo-sqlite
(offline), expo-secure-store (tokeni), expo-location, expo-image-picker/-manipulator,
Zustand, i18next (bs/en), react-native-reanimated.
**Obim:** 63 fajla, ~1.750 LOC. **Testova: 0. EAS profila: nema.**

---

## 1. Struktura

```
mobile/
  app/                       — rute (expo-router)
    (tabs)/_layout.tsx       — tabovi (unija permisija)
    (tabs)/index.tsx         — početna (dashboard terena)
    (tabs)/tasks.tsx  (tabs)/trips.tsx  (tabs)/diary.tsx  (tabs)/profile.tsx
    login.tsx  change-password.tsx  trip/new.tsx  fuel.tsx  hse.tsx
  components/                — screen, field, primary-button, picker-list, offline-bar, useColorScheme
  lib/                       — api, api-types, auth-store, secure, timer-actions, permissions,
                               errors, compress-image, theme
  db/client.ts               — expo-sqlite klijent (offline baza)
  sync/                      — engine (push/pull), net, queue
  hooks/                     — use-bootstrap, use-online, use-app-scheme
  i18n/                      — bs (default) + en
  constants/theme.ts         — paleta (light/dark)
```

---

## 2. Navigacija i pristup

- Tabovi se prikazuju prema **uniji permisija** korisnika (`lib/permissions.ts`) — nikad prema
  „roli“ kao stringu u UI-u.
- `use-bootstrap` provjerava sesiju (secure store) i `mustChangePassword` ⇒ preusmjerenje na
  `change-password` bez pristupa tabovima.
- Duboki linkovi: scheme `gradix` (`app.json`).

---

## 3. Offline-first model

| Element | Ponašanje |
|---|---|
| Lokalna baza | `expo-sqlite` (`db/client.ts`) — red čekanja + keš kataloga |
| Red čekanja | `sync/queue.ts` — `pendingRows`, `markSynced`, `readMeta` |
| Push | `sync/engine.ts` — šalje red, server je idempotentan: unique `(companyId, userId, deviceId, localId)` |
| Pull | katalog (projekti, zadaci, šifarnici) sa **TTL 24 h** |
| Odbijanja | `DECOMMISSIONED` mašina i `ON_HOLD` projekat se ne primaju iz kataloga |
| Timer offline | klijent šalje `startedAt` uz dozvoljene boundove (server validira) |
| HSE | **online-only** (nema reda) — eksplicitna greška kad nema mreže |
| Indikator | `components/offline-bar.tsx` (⚠️ dug: ne prikazuje broj zapisa ni vrijeme zadnjeg sync-a) |

---

## 4. Sigurnost

- Access/refresh tokeni u `expo-secure-store` (Keychain/Keystore), **ne** u AsyncStorage.
- Fotografije se kompresuju prije uploada (`compress-image`), MIME se provjerava i na serveru.
- Lokacija se traži samo kad je potrebna (`NSLocationWhenInUseDescription`), bez background
  trackinga u v1.
- Nema hardkodovanih tajni; API base URL dolazi iz konfiguracije okruženja.

---

## 5. Testovi (cilj, odluke D-004 i D-005)

| Nivo | Alat | Šta pokriva |
|---|---|---|
| Unit | **Jest** + `jest-expo` | čista logika: `timer-actions`, `permissions`, `errors`, `sync/queue` |
| Component | **React Native Testing Library** | forme (`login`, `hse`, `trip/new`), `offline-bar` |
| E2E | **Maestro** (YAML flow) | onboarding → login → promjena lozinke → timer start/stop → tura offline → sync → logout |

**Maestro — zašto:** deklarativni YAML tokovi, stabilni na Android emulatoru u CI-ju, mali
setup, artefakti (screenshot/video) po koraku. Alternative: Detox (teži setup, dublja
integracija), Appium (najveći overhead). iOS se **ne** pokreće u CI-ju (cijena runnera);
iOS se validira ručno prije objave.

**Stabilnost:** retry samo za infrastrukturu (emulator), nikad za logiku; testovi ne koriste
`sleep`, nego čekaju element/stanje.

---

## 6. Build i objava (kasnije)

- Danas: `npm start` / `expo start` za razvoj; nema build profila.
- Kad se odobri objava: `eas.json` sa `development` / `preview` / `production` profilima,
  `app.json` `version`/`runtimeVersion` strategija, debug/test potpis u CI-ju, produkcijski
  potpis van CI-ja (tajne u sefu).

---

## 7. Poznati dugovi (MOB segmenti)

| # | Dug | Segment |
|---|---|---|
| M1 | Nema nijednog testa | MOB-03 |
| M2 | Nema E2E flow-a ni Maestro konfiguracije | MOB-05 |
| M3 | `offline-bar` ne prikazuje detalje sync-a | MOB-04 |
| M4 | Nema crash reportinga (npr. Sentry) — odluka o zavisnosti u MOB-06 | MOB-06 |
| M5 | Nema build profila (`eas.json`) | MOB-07 |
| M6 | `app.json` verzija (`0.6.0`) nije vezana za release proces | MOB-07 |
