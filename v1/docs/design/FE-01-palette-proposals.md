# FE-01 — dva predloga palete (odluka vlasnika)

> **Status:** **primijenjen predlog C (kombinacija A + B)** — vlasnik je 2026-11-03. odabrao
> „kombinacija“; tokeni su u `frontend/src/index.css`, odluka **D-040**. A i B ostaju u ovom
> dokumentu kao alternative (zamjena = izmjena ~20 vrijednosti tokena, bez diranja komponenti).
>
> Pregled: [`palette-preview.html`](./palette-preview.html) (A / B / C jedan pored drugog, iste
> komponente) · statične slike [`palette-A.png`](./palette-A.png), [`palette-B.png`](./palette-B.png),
> [`palette-comparison.png`](./palette-comparison.png).

## 1. Zašto dva predloga

Odluka P8 („nova paleta, WCAG 2.2 AA“) traži novi vizuelni identitet, ali ne kaže kakav. Dvije
opcije pokrivaju dvije realne strategije brenda:

| | **A — „Gradix Green“** | **B — „Slate / Teal“** |
|---|---|---|
| Ideja | Građevina = zelena (sigurnost, „ide se dalje“), topla neutralna podloga | Neutralan, „instrument tabla“ izgled; boja samo kao signal akcije |
| Primarna | duboka šuma `#0F5132` | skoro crna slate `#0F172A` |
| Akcenat | sigurnosna amber `#B45309` | teal `#0F766E` |
| Podloga | topla off-white `#F7F8F6` | hladna `#F8FAFC` |
| Karakter | prepoznatljiv, „terenski“, topao | miran, korporativan, neutralan |
| Rizik | zelena se često čita kao „success“ pa statusi moraju biti jasno odvojeni oblikom/tekstom | manje prepoznatljivo; akcenat nosi svu „ličnost“ |

## 2. Tokeni — predlog A („Gradix Green“)

### 2.1 Svjetla tema (`:root`)

| Token | Vrijednost | Namjena |
|---|---|---|
| `--background` | `#F7F8F6` | podloga stranice |
| `--foreground` | `#14201A` | glavni tekst |
| `--card` / `--popover` | `#FFFFFF` | kartice, meniji, modali |
| `--primary` | `#0F5132` | primarno dugme, aktivna navigacija, link |
| `--primary-foreground` | `#FFFFFF` | tekst na primary |
| `--secondary` | `#E7EFE9` | sekundarno dugme, tiha dugmad |
| `--secondary-foreground` | `#0F5132` | tekst na secondary |
| `--muted` | `#EFF2EE` | zaglavlja tabela, „zebra“ redovi |
| `--muted-foreground` | `#5A6B60` | sekundarni tekst, labele |
| `--accent` | `#B45309` | akcenat (upozorenje/HSE, isticanje) |
| `--accent-foreground` | `#FFFFFF` | tekst na accent |
| `--destructive` | `#B42318` | brisanje, greške, „kasni“ |
| `--success` | `#15803D` | potvrde, „u toku/završeno“ |
| `--border` / `--input` | `#D8E0D9` | ivice, polja |
| `--ring` | `#0F5132` | fokus prsten |
| `--radius` | `0.75rem` | osnovni radijus (mijenja samo `lg/xl` izvedene) |

### 2.2 Tamna tema (`.dark`)

| Token | Vrijednost |
|---|---|
| `--background` | `#0B120E` |
| `--foreground` | `#E8EFE9` |
| `--card` / `--popover` | `#121A15` |
| `--primary` | `#34D399` |
| `--primary-foreground` | `#062A1E` |
| `--secondary` | `#17211B` |
| `--secondary-foreground` | `#CFE3D6` |
| `--muted` | `#17211B` |
| `--muted-foreground` | `#9AAF9F` |
| `--accent` | `#F59E0B` |
| `--accent-foreground` | `#231603` |
| `--destructive` | `#F87171` |
| `--success` | `#4ADE80` |
| `--border` / `--input` | `#22312A` |
| `--ring` | `#34D399` |

## 3. Tokeni — predlog B („Slate / Teal“)

### 3.1 Svjetla tema (`:root`)

| Token | Vrijednost | Namjena |
|---|---|---|
| `--background` | `#F8FAFC` | podloga |
| `--foreground` | `#0F172A` | glavni tekst |
| `--card` / `--popover` | `#FFFFFF` | kartice, meniji, modali |
| `--primary` | `#0F172A` | primarno dugme, aktivna navigacija |
| `--primary-foreground` | `#FFFFFF` | tekst na primary |
| `--secondary` | `#E8EEF3` | sekundarno dugme |
| `--secondary-foreground` | `#0F172A` | tekst na secondary |
| `--muted` | `#F1F5F9` | zaglavlja tabela, „zebra“ |
| `--muted-foreground` | `#52627A` | sekundarni tekst |
| `--accent` | `#0F766E` | teal akcenat (link, isticanje, „završeno“) |
| `--accent-foreground` | `#FFFFFF` | tekst na accent |
| `--destructive` | `#B42318` | brisanje, greške, „kasni“ |
| `--success` | `#15803D` | potvrde |
| `--border` / `--input` | `#DDE5ED` | ivice, polja |
| `--ring` | `#0F766E` | fokus prsten |
| `--radius` | `0.75rem` | isto kao A |

### 3.2 Tamna tema (`.dark`)

| Token | Vrijednost |
|---|---|
| `--background` | `#0B1220` |
| `--foreground` | `#E2E8F0` |
| `--card` / `--popover` | `#111A2B` |
| `--primary` | `#E2E8F0` |
| `--primary-foreground` | `#0B1220` |
| `--secondary` | `#16233A` |
| `--secondary-foreground` | `#E2E8F0` |
| `--muted` | `#16233A` |
| `--muted-foreground` | `#94A3B8` |
| `--accent` | `#2DD4BF` |
| `--accent-foreground` | `#04211F` |
| `--destructive` | `#F87171` |
| `--success` | `#4ADE80` |
| `--border` / `--input` | `#1E2C44` |
| `--ring` | `#2DD4BF` |

## 4. Kontrast (WCAG 2.2 AA — prag 4.5:1 za tekst)

| Par | A svjetla | B svjetla | A tamna | B tamna |
|---|---|---|---|---|
| `foreground` na `background` | 15.75:1 | 17.06:1 | 16.22:1 | 15.19:1 |
| `muted-foreground` na `background` | 5.32:1 | 5.93:1 | 8.14:1 | 7.30:1 |
| `primary-foreground` na `primary` | 9.36:1 | 17.85:1 | 8.05:1 | 15.19:1 |
| `accent-foreground` na `accent` | 5.02:1 | 5.47:1 | 8.23:1 | 9.08:1 |
| `destructive` na `card` | 6.57:1 | 6.57:1 | 6.41:1 | 6.29:1 |
| `success` na `card` | 5.02:1 | 5.02:1 | 10.18:1 | 9.99:1 |

Svi parovi prolaze AA za normalan tekst; `destructive`/`success` se koriste i kao tekst (statusi),
pa su namjerno tamniji od „tailwind 500“ nijansi. Fokus prsten (`--ring`) ima ≥ 3:1 prema susjednim
bojama (AA za ne-tekst), a fokus je uvijek i **vidljiv oblik**, ne samo boja.

## 5. Predlog C — „Gradix Green + teal signal“ (kombinacija, **primijenjeno**)

Spaja A i B: **podloga, neutrali i brend zelena iz A** (topao, „terenski“ karakter, prepoznatljivost)
+ **teal iz B kao akcenat/informacija**, dok amber iz A postaje **zaseban `--warning` token** — tako
se upozorenje (HSE, istekao liječnički, registracija vozila) nikad ne čita kao „akcija“.

### 5.1 Svjetla tema (`:root`)

| Token | Vrijednost | Porijeklo / namjena |
|---|---|---|
| `--background` | `#F7F8F6` | A — topla off-white podloga |
| `--foreground` | `#14201A` | A — glavni tekst |
| `--card` / `--popover` | `#FFFFFF` | A/B |
| `--primary` | `#0F5132` | **A** — brend zelena (dugmad, aktivna navigacija, link) |
| `--primary-foreground` | `#FFFFFF` | A |
| `--secondary` | `#E7EFE9` | A |
| `--secondary-foreground` | `#0F5132` | A |
| `--muted` | `#EFF2EE` | A — zaglavlja tabela, zebra |
| `--muted-foreground` | `#5A6B60` | A |
| `--accent` | `#0F766E` | **B** — teal: akcenat, informacija, „u toku“ isticanje |
| `--accent-foreground` | `#FFFFFF` | B |
| `--warning` | `#B45309` | **A** (amber) — upozorenja/HSE, odvojeno od akcenta |
| `--warning-foreground` | `#FFFFFF` | — |
| `--destructive` | `#B42318` | A/B |
| `--success` | `#15803D` | A/B |
| `--border` / `--input` | `#D8E0D9` | A |
| `--ring` | `#0F5132` | A — fokus prsten |
| `--radius` | `0.75rem` | A |

### 5.2 Tamna tema (`.dark`, inertna dok se ne uključi)

| Token | Vrijednost |
|---|---|
| `--background` | `#0B120E` |
| `--foreground` | `#E8EFE9` |
| `--card` / `--popover` | `#121A15` |
| `--primary` | `#34D399` |
| `--primary-foreground` | `#062A1E` |
| `--secondary` | `#17211B` |
| `--secondary-foreground` | `#CFE3D6` |
| `--muted` | `#17211B` |
| `--muted-foreground` | `#9AAF9F` |
| `--accent` | `#2DD4BF` |
| `--accent-foreground` | `#062A1E` |
| `--warning` | `#F5A524` |
| `--warning-foreground` | `#1A1206` |
| `--destructive` | `#F97066` |
| `--success` | `#34D399` |
| `--border` / `--input` | `#22302A` |
| `--ring` | `#34D399` |

### 5.3 Kontrast (WCAG 2.2 AA — prag 4.5:1 za tekst)

| Par | C svjetla | C tamna |
|---|---|---|
| `foreground` na `background` | **15.75:1** | **16.22:1** |
| `muted-foreground` na `background` | 5.32:1 | 8.14:1 |
| `primary-foreground` na `primary` | 9.36:1 | 8.05:1 |
| `accent-foreground` na `accent` | 5.47:1 | 8.31:1 |
| `warning-foreground` na `warning` | 5.02:1 | 9.08:1 |
| `destructive` na `card` | 6.57:1 | — |
| `success` na `card` | 5.02:1 | — |

Svi parovi prolaze AA. Statusi se **nikad** ne razlikuju samo bojom — uvijek i tekstom/ikonom
(zeleno „U toku“ vs teal „Planirano“ vs amber „Kasni“ nisu dovoljni sami po sebi).

## 6. Šta se mijenja pri primjeni (obim)

| Fajl | Promjena |
|---|---|
| `frontend/src/index.css` | samo vrijednosti tokena u `:root` + novi `.dark` blok |
| komponente (`frontend/src/components/ui/*`) | **nijedna** — rade preko tokena (`bg-primary`, `text-muted-foreground`, …) |
| grafike/mape | boje se čitaju iz tokena gdje postoje; inače ostaje kako jeste (FE-05) |

Zato je odluka jeftina sada, a skupa poslije (kad se na paletu nasloni desetine ekrana).

## 7. Preporuka (prije odluke)

**Predlog A („Gradix Green“)** — građevinski kontekst, prepoznatljivost i topla podloga daju
ozbiljniji „alat za teren“ utisak; amber akcenat prirodno pokriva HSE/upozorenja. Uslov: statusi
(NEU toku / kasni / planirano) nikad ne smiju biti samo zeleni/crveni — uvijek i tekst/ikona
(već je tako u tabelama). Ako vlasnik želi neutralniji, korporativni ton, **B** je jednako
ispravan po pristupačnosti i jeftin za primjenu.

## 8. Odluka vlasnika

- [ ] **A — „Gradix Green“**
- [ ] **B — „Slate / Teal“**
- [x] **kombinacija → predlog C** (zelena brend + teal signal + amber za upozorenja) — *vlasnik,
  2026-11-03: „Kombinacija, nastavi dalje“*

**Primijenjeno:** tokeni su u `frontend/src/index.css` (`:root` + `.dark`), `--warning` je dodat u
`@theme inline`. Ako vlasnik ipak izabere A ili B, mijenja se samo tabela vrijednosti u `:root` —
komponente, testovi i ekrani ostaju netaknuti. Zapis: `AUDIT/segments/FE-01.md`, D-040.
