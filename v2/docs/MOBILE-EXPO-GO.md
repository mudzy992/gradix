# Mobilni u Expo Go — tačno šta pokrenuti

**Cilj:** telefon otvori `gradix-teren`, prijavi se na testnu domenu i prođe korake 5–9 iz `docs/DEMO-G1.md`.

**Stanje:** native bundle se pravi i servira (dokazano u sandboxu: `expo export -p android` ✅ 2,6 MB; Metro manifest `runtimeVersion: exposdk:58.0.0`; dev bundle 6,0 MB). **Veza telefon → tvoj Metro nije provjerena odavde** — to je jedini korak koji moraš ti.

---

## 1. Šta mora biti tačno

| Stvar | Vrijednost | Zašto |
|---|---|---|
| Node | 22.13+ (najbolje 24) | SDK 58 ne radi na starijem |
| Expo Go na telefonu | verzija za **SDK 58** | novi Expo Go pušta samo SDK 58 |
| Telefon i računar | **ista Wi-Fi mreža** | Metro se ne vidi preko interneta bez tunela |
| `apps/mobile/.env` | `EXPO_PUBLIC_API_URL=https://gradix.ba101.top` | bez ovoga app ide na `127.0.0.1:3000` = sam telefon |

Ako je Expo Go iz prodavnice stariji, neće otvoriti projekat. Tada uzmi SDK 58 build direktno: **https://expo.dev/go** → SDK **58 (latest)** → Android/iOS.

---

## 2. Komande

```bash
cd v2
pnpm install
cd apps/mobile
cp .env.example .env      # jednom; unutra je EXPO_PUBLIC_API_URL za testnu domenu
pnpm start
```

U terminalu se pojavi QR kod. **Ne treba `--clear`** prvi put; treba **svaki put kad promijeniš `.env`** (`pnpm start -- --clear`), jer se `EXPO_PUBLIC_*` ubacuje u bundle pri bundlovanju, ne čita se u toku rada.

**Otvaranje:**
- **Android:** Expo Go → *Scan QR code*.
- **iOS:** obična kamera → link vodi u Expo Go.
- Ako QR ne prođe, u Expo Go prepiši adresu koju terminal ispiše, oblik `exp://192.168.x.x:8081`.

Mijenjaj kod → telefon se sam osvježi (Fast Refresh). `Ctrl+C` gasi Metro.

> `pnpm android` / `pnpm ios` **nisu** za telefon — to traži emulator/simulator. Telefon ide preko QR-a iz `pnpm start`.

---

## 3. Provjera prije nego uđeš u app

```bash
curl -s https://gradix.ba101.top/api/ready
```

Mora vratiti `"status":"ok"` i `"migrations":{"applied":5}`. Ako ne — problem je na serveru, ne u telefonu; vidi `docs/COOLIFY.md` §7.

Prijava u app ide seed nalozima (isti kao web): `ured@demo.ba`, `vlasnik@demo.ba`, `vlasnik@druga.test`, lozinka iz `SEED_PASSWORD`.

---

## 4. Šta prolaziš (koraci 5–9 iz DEMO-G1)

1. Prijavi se → vidiš ime firme i „sve poslano“.
2. Upiši zapis → **Sačuvaj na uređaju** → „Zapis je sačuvan na uređaju.“ (zapis je u SQLite na telefonu, mreža nije trebala).
3. Avio režim → **Pošalji sve** → „Nema veze. N zapisa čeka slanje.“
4. Vrati mrežu → **Pošalji sve** → „Poslano: 1. Čeka: 0.“
5. Ponovi → „Poslano: 0“ (idempotentno, nema duplikata).
6. Na webu osvježi `/pregled` → broj offline zapisa se povećao.

---

## 5. Ako pukne

| Simptom | Uzrok | Rješenje |
|---|---|---|
| „Project is incompatible with this version of Expo Go“ | Expo Go nije za SDK 58 | ažuriraj Expo Go ili instaliraj SDK 58 sa `expo.dev/go` |
| `Unable to resolve "react-native/setup-env"` | `react-native` nije 0.88.1 | `pnpm --filter @gradix/mobile check-expo` pa uskladi verzije |
| Telefon ne otvara projekat, QR stoji | druga mreža / firewall na 8081 | isti Wi-Fi; dozvoli Node kroz firewall; ili `pnpm start -- --tunnel` (traži `@expo/ngrok`, sporije) |
| U app piše „Nema veze“ i kad ima interneta | bundle ima pogrešan API URL | provjeri `apps/mobile/.env`, pa `pnpm start -- --clear` |
| Bijel ekran, bez greške | keš Metrosa | `pnpm start -- --clear` |

Za provjeru verzija bez mreže (radi i u CI): `pnpm --filter @gradix/mobile check-expo`.

---

## 6. Šta u Expo Go neće raditi

Expo Go pušta samo module koje ima u sebi. Trenutni mobilni koristi `expo-router`, `expo-sqlite`, `expo-secure-store`, `expo-constants`, `expo-status-bar`, `react-native-screens`, `safe-area-context` — **svi su u Expo Go**, pa je demo pokriven.

Prvi native modul koji Expo Go nema (kamera sa custom configom, Bluetooth, štampač, background lokacija…) znači **development build**: `npx expo run:android` ili EAS Build. To je odluka za taj rez, ne za sada — i tada se Expo Go prestaje koristiti.
