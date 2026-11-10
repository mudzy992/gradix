"use client";

/**
 * U5 — katalog komponenti: SVE što sistem ima i što ekranima realno može zatrebati,
 * u svim stanjima, na jednom mjestu (/katalog). Isti dijelovi i redoslijed postoje i u
 * mobilnom katalogu (apps/mobile/src/app/katalog.tsx) — jedan katalog, dvije platforme.
 *
 * Pravilo: ako ovdje nešto fali, nedostaje i u sistemu — dodaj komponentu ovdje i u
 * mobilni katalog, ne kopiju po ekranu. Nova vrsta komponente traži vlasnikovo
 * odobrenje (AGENTS pravilo 11).
 */
import { useState, type ReactNode } from "react";
import {
  Accordion, ActionCard, Alert, Avatar, Badge, Breadcrumbs, Button, Card, Checkbox, Chip,
  ConfirmDialog, DataTable, DescriptionList, Dialog, EmptyState, FigureImage, FileUpload,
  FilterBar, FormGrid, FormSection, Icon, IconButton, Inline, Input, Mono, PageHeader,
  Pagination, QuantityStepper, Radio, RowActions, SectionTitle, Segmented, Select, Skeleton,
  SpeedDial, Stack, Stat, StatusDot, Stepper, Switch, Tabs, TextLink, Textarea, ToastStack,
  useToasts,
} from "./index";

const TOKENS = ["--bg", "--panel", "--raise", "--sunken", "--text", "--muted", "--line", "--field", "--primary", "--accent", "--tint", "--danger"];

const rows = [
  { id: "1", name: "Amina Karić", role: "Zidar", days: 12, active: true },
  { id: "2", name: "Mujo Softić", role: "Rukovalac", days: 9, active: false },
  { id: "3", name: "Amar Hodžić", role: "Vozač", days: 15, active: true },
];

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section>
      <SectionTitle hint={hint}>{title}</SectionTitle>
      {children}
    </section>
  );
}

export function ComponentCatalog() {
  const [tab, setTab] = useState("preklopi");
  const [confirm, setConfirm] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [longDialog, setLongDialog] = useState(false);
  const [page, setPage] = useState(false);
  const [tableState, setTableState] = useState<"ready" | "loading" | "error" | "empty">("ready");
  const [seg, setSeg] = useState("svi");
  const [qty, setQty] = useState(8);
  const { toasts, push, dismiss } = useToasts();
  return (
    <Stack>
      <PageHeader title="Katalog komponenti" subtitle="UI sistem (Dio U) — sve komponente i stanja, web i mobilni isti inventar. Obje teme: prekidač u zaglavlju. Ispod 640 px tabela postaje kartice — suzi prozor i provjeri." />

      <Section title="Tokeni i tipografija" hint="Šest boja palete + semantički tokeni; nijansa van palete je color-mix.">
        <Card>
          <Inline>
            {TOKENS.map((token) => (
              <span key={token} className="gx-chip">
                <span aria-hidden="true" style={{ width: 14, height: 14, borderRadius: 4, background: `var(${token})`, border: "1px solid var(--line)", display: "inline-block" }} />
                <Mono>{token}</Mono>
              </span>
            ))}
          </Inline>
          <p className="gx-page-title">Naslov stranice (page)</p>
          <h2>Podnaslov sekcije (title)</h2>
          <p>Tijelo teksta (body) — rečenice, opisi i sadržaj. <Mono>Mono 061 111 222 · 2026-11-07</Mono> za brojeve, šifre i datume.</p>
          <p className="gx-page-sub">Pomoćni/tihi tekst (muted) za objašnjenja i meta podatke.</p>
        </Card>
      </Section>

      <Section title="Kontrole" hint="Labela, pomoć i greška idu kroz Field — uvijek povezani (htmlFor/aria).">
        <Card>
          <FormGrid>
            <Input label="Tekst" id="cat-text" placeholder="Placeholder" hint="Pomoćni tekst ispod polja." />
            <Input label="Obavezno (greška)" id="cat-err" error="Obavezno polje." defaultValue="" />
            <Input label="Email" id="cat-email" type="email" placeholder="ime@firma.test" />
            <Input label="Lozinka" id="cat-pass" type="password" defaultValue="tajna" />
            <Input label="Pretraga" id="cat-search" type="search" placeholder="Traži…" />
            <Input label="Broj" id="cat-num" type="number" defaultValue={8} hint="Sati, količine, brojila." />
            <Input label="Datum" id="cat-date" type="date" />
            <Input label="Vrijeme" id="cat-time" type="time" />
            <Input label="Onemogućeno" id="cat-dis" disabled defaultValue="Ne može se mijenjati" />
            <Select label="Select (lista se vidi u obje teme)" id="cat-sel" hint="Opcije nose boje ploče — i u tamnoj temi lista je čitljiva." defaultValue="druga">
              <option value="prva">Prva opcija</option>
              <option value="druga">Druga opcija</option>
              <option value="treca">Treća opcija</option>
              <option value="cetvrta">Četvrta opcija — duži naziv opcije</option>
              <option value="peta">Peta opcija</option>
            </Select>
            <Select label="Select onemogućen" id="cat-sel-dis" disabled>
              <option>Zaključano</option>
            </Select>
          </FormGrid>
          <Textarea label="Napomena (textarea)" id="cat-note" placeholder="Duži tekst…" hint="Više redova; raste po potrebi." />
          <FormGrid>
            <div>
              <Checkbox label="Checkbox označen" id="cat-chk1" defaultChecked />
              <Checkbox label="Checkbox prazan" id="cat-chk2" />
              <Checkbox label="Checkbox onemogućen" id="cat-chk3" disabled />
            </div>
            <div role="radiogroup" aria-label="Radio primjer">
              <Radio label="Radio — prva" name="cat-radio" id="cat-r1" defaultChecked />
              <Radio label="Radio — druga" name="cat-radio" id="cat-r2" />
              <Radio label="Radio — onemogućena" name="cat-radio" id="cat-r3" disabled />
            </div>
            <div>
              <Switch label="Prekidač uključen (Switch)" id="cat-sw1" defaultChecked />
              <Switch label="Prekidač isključen" id="cat-sw2" />
            </div>
          </FormGrid>
          <p>Segmented (izbor jedne od malo opcija):</p>
          <Segmented options={[{ value: "svi", label: "Svi" }, { value: "aktivni", label: "Aktivni" }, { value: "neaktivni", label: "Neaktivni" }]} value={seg} onChange={setSeg} label="Segmented primjer" />
        </Card>
      </Section>

      <Section title="Dugmad i akcije" hint="primary je jedina jasna akcija na ekranu.">
        <Card>
          <Inline>
            <Button variant="primary">Primarno</Button>
            <Button>Standardno</Button>
            <Button variant="quiet">Tiho</Button>
            <Button variant="danger">Opasno</Button>
            <Button disabled>Onemogućeno</Button>
            <Button variant="primary" icon="users">S ikonom</Button>
            <IconButton icon="sun" label="IconButton — svijetla tema" />
            <IconButton icon="search" label="IconButton — pretraga" />
            <IconButton icon="close" label="IconButton — zatvori" />
          </Inline>
          <Inline>
            <RowActions label="RowActions primjer" actions={[{ key: "e", label: "Izmijeni", onSelect: () => undefined }, { key: "c", label: "Kopiraj email", onSelect: () => undefined }, { key: "t", label: "Deaktiviraj", danger: true, onSelect: () => undefined }]} />
            <span>← RowActions: jedna vidljiva akcija + meni „⋯“</span>
          </Inline>
        </Card>
      </Section>

      <Section title="Poruke i stanja" hint="Stanje nikad nije samo boja — uvijek ikona i tekst.">
        <Stack>
          <Alert tone="success">Uspjeh (success): izmjene su sačuvane.</Alert>
          <Alert tone="error">Greška (error): zapis se nije mogao sačuvati.</Alert>
          <Alert tone="warning">Upozorenje (warning): rok ističe za 3 dana.</Alert>
          <Alert tone="info">Info: radnik ne mora imati nalog u aplikaciji.</Alert>
          <Card>
            <Inline>
              <Chip tone="full">Chip Aktivan</Chip>
              <Chip tone="hot">Chip Zastoj</Chip>
              <Chip tone="hollow">Chip Neaktivan</Chip>
              <StatusDot tone="ok" label="StatusDot ok" />
              <StatusDot tone="warn" label="StatusDot upozorenje" />
              <StatusDot tone="danger" label="StatusDot greška" />
              <StatusDot tone="muted" label="StatusDot mirno" />
            </Inline>
          </Card>
          <Skeleton rows={3} />
          <EmptyState title="Prazno stanje (EmptyState)" description="Kad nema zapisa, ekran pokazuje ovo — s akcijom kad ona postoji." action={<Button variant="primary">+ Dodaj prvi zapis</Button>} />
        </Stack>
      </Section>

      <Section title="Tabela, sortiranje i paginacija" hint="Klik na zaglavlje sortira; ispod 640 px redovi su kartice s data-label oznakama.">
        <Card>
          <FilterBar>
            <Input label="Filter (FilterBar)" id="cat-filter" placeholder="Traži…" />
            <Inline>
              {(["ready", "loading", "error", "empty"] as const).map((state) => (
                <Button key={state} variant={tableState === state ? "primary" : "quiet"} onClick={() => setTableState(state)}>
                  {state}
                </Button>
              ))}
            </Inline>
          </FilterBar>
          <DataTable
            caption="Primjer tabele iz kataloga"
            rows={tableState === "empty" ? [] : rows}
            rowKey={(row) => row.id}
            loading={tableState === "loading"}
            error={tableState === "error" ? "Podaci se nisu mogli učitati (primjer greške)." : null}
            onRetry={() => setTableState("ready")}
            emptyText="Nema zapisa za prikaz (primjer praznog stanja tabele)."
            rowActionLabel={(row) => `Više radnji za ${row.name}`}
            columns={[
              { key: "name", header: "Ime", sortValue: (row) => row.name, cell: (row) => row.name },
              { key: "role", header: "Uloga", sortValue: (row) => row.role, cell: (row) => row.role },
              { key: "days", header: "Dani", numeric: true, sortValue: (row) => row.days, cell: (row) => <Mono>{row.days}</Mono> },
              { key: "st", header: "Status", cell: (row) => <Chip tone={row.active ? "full" : "hollow"}>{row.active ? "Aktivan" : "Neaktivan"}</Chip> },
            ]}
            actions={(row) => [
              { key: "edit", label: "Izmijeni", onSelect: () => undefined },
              { key: "toggle", label: row.active ? "Deaktiviraj" : "Aktiviraj", danger: true, onSelect: () => undefined },
            ]}
          />
          <Pagination hasPrev={page} hasMore onPrev={() => setPage(false)} onNext={() => setPage(true)} />
        </Card>
      </Section>

      <Section title="Forma (cijeli primjer)" hint="FormSection + FormGrid + footer akcije u dijalogu dijele isti obrazac.">
        <Card>
          <FormSection title="Osnovni podaci">
            <FormGrid>
              <Input label="Ime" id="cat-f1" defaultValue="Amina" />
              <Input label="Prezime" id="cat-f2" defaultValue="Karić" />
            </FormGrid>
          </FormSection>
          <FormSection title="Angažman">
            <FormGrid>
              <Select label="Vrsta" id="cat-f3">
                <option>Stalno</option>
                <option>Određeno</option>
              </Select>
              <Input label="Datum početka" id="cat-f4" type="date" />
            </FormGrid>
            <DescriptionList items={[{ term: "Radnik", value: "Amina Karić" }, { term: "Status", value: "Aktivan" }, { term: "Nalog", value: "Bez naloga (normalno stanje)" }]} />
          </FormSection>
          <Inline>
            <Stat label="Otvoreni dani" value="3" hint="Čekaju unos" />
            <Stat label="Sukobi" value="1" hint="Čeka razrješenje" />
            <Stat label="Unosi danas" value="12" />
          </Inline>
        </Card>
      </Section>

      <Section title="Preklopi: modali, potvrde, kartice (tabs)" hint="Modal: X u zaglavlju, akcije u podnožju, tijelo skrola bez vidljivog scrollbar-a.">
        <Card>
          <Tabs
            label="Primjer kartica"
            active={tab}
            onChange={setTab}
            tabs={[{ key: "preklopi", label: "Preklopi" }, { key: "druga", label: "Druga kartica" }]}
          />
          {tab === "preklopi" ? (
            <Inline>
              <Button onClick={() => setDialog(true)}>Obični modal</Button>
              <Button onClick={() => setLongDialog(true)}>Dugi modal (skrol bez scrollbar-a)</Button>
              <Button variant="danger" onClick={() => setConfirm(true)}>Potvrda (ConfirmDialog)</Button>
            </Inline>
          ) : (
            <p>Sadržaj druge kartice — Tabs drže stanje, ekran samo mijenja sadržaj.</p>
          )}
          {dialog ? (
            <Dialog title="Obični modal" hint="X gore desno zatvara; Escape takođe." onClose={() => setDialog(false)} footer={<div className="gx-dialog__actions"><Button variant="quiet" onClick={() => setDialog(false)}>Otkaži</Button><Button variant="primary" onClick={() => setDialog(false)}>Sačuvaj</Button></div>}>
              <p>Sadržaj modala. Akcije su u podnožju i ne miču se.</p>
            </Dialog>
          ) : null}
          {longDialog ? (
            <Dialog title="Dugi modal" hint="Skrolaj: scrollbar se ne vidi, akcije ostaju u podnožju." onClose={() => setLongDialog(false)} footer={<div className="gx-dialog__actions"><Button variant="quiet" onClick={() => setLongDialog(false)}>Otkaži</Button><Button variant="primary" onClick={() => setLongDialog(false)}>U redu</Button></div>}>
              <Stack>
                {Array.from({ length: 18 }, (_, i) => (
                  <p key={i}>Red sadržaja {i + 1} — dugi sadržaj u modalu mora biti čitljiv do kraja, a podnožje s akcijama uvijek dostupno.</p>
                ))}
              </Stack>
            </Dialog>
          ) : null}
          <ConfirmDialog
            open={confirm}
            title="Deaktivirati zapis?"
            text="Zapis i istorija ostaju; više se ne nudi za nove unose."
            confirmLabel="Deaktiviraj"
            danger
            onConfirm={() => setConfirm(false)}
            onCancel={() => setConfirm(false)}
          />
        </Card>
      </Section>


      <Section title="Layout i shell" hint="Okvir aplikacije: bočna navigacija 232 px, gornja traka 66 px, sadržaj do 1240 px. Ispod — živi okvir u malom.">
        <Card>
          <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", border: "1px solid var(--line)", borderRadius: "var(--radius-card)", overflow: "hidden", minHeight: 220 }}>
            <div style={{ borderRight: "1px solid var(--line)", padding: "var(--space-3)", background: "var(--panel)" }}>
              <p className="gx-nav__group">Pregled</p>
              <a className="gx-nav-item" aria-current="page" href="#katalog-layout"><span className="gx-nav-item__icon"><Icon name="home" /></span>Pregled</a>
              <a className="gx-nav-item" href="#katalog-layout"><span className="gx-nav-item__icon"><Icon name="users" /></span>Radnici</a>
              <a className="gx-nav-item" href="#katalog-layout"><span className="gx-nav-item__icon"><Icon name="truck" /></span>Mašine</a>
              <p className="gx-nav__group">Ured</p>
              <a className="gx-nav-item" href="#katalog-layout"><span className="gx-nav-item__icon"><Icon name="calendar" /></span>Radni dani <Badge>2</Badge></a>
            </div>
            <div>
              <div className="gx-topbar" style={{ borderBottom: "1px solid var(--line)" }}>
                <strong>Topbar (shell)</strong>
                <span className="gx-topbar__spacer" />
                <IconButton icon="search" label="Pretraga (shell primjer)" />
                <IconButton icon="sun" label="Tema (shell primjer)" />
                <Avatar name="Amina Karić" size="sm" />
              </div>
              <div style={{ padding: "var(--space-4)" }}>
                <Breadcrumbs items={[{ label: "Pregled", href: "#katalog-layout" }, { label: "Radnici", href: "#katalog-layout" }, { label: "Amina Karić" }]} />
                <p className="gx-page-sub" style={{ marginTop: "var(--space-3)" }}>Sadržaj ide u gx-main: naslov stranice, filteri, kartice i tabele — uvijek istim redom.</p>
              </div>
            </div>
          </div>
          <p style={{ marginTop: "var(--space-3)" }}>Layout primitivi: <Mono>Stack</Mono> (vertikalno), <Mono>Inline</Mono> (vodoravno), <Mono>FormGrid</Mono> (2 kolone → 1 na mobilnom), <Mono>PageHeader</Mono>, <Mono>FilterBar</Mono>.</p>
        </Card>
      </Section>

      <Section title="Razmaci (spacing) i tipografija" hint="Mreža 4 px: --space-1 … --space-7. Tipografija: page 30 / section 16 / body 14 / small 13 / label 12.">
        <Card>
          <Stack>
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <div key={n} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                <Mono>--space-{n}</Mono>
                <span aria-hidden="true" style={{ height: 12, width: `var(--space-${n})`, background: "var(--primary)", borderRadius: 2, display: "inline-block" }} />
                <span className="gx-page-sub">{n * 4} px</span>
              </div>
            ))}
          </Stack>
          <p style={{ fontSize: "var(--text-page)", fontWeight: 800 }}>Page 30 — naslov stranice</p>
          <p style={{ fontSize: "var(--text-section)", fontWeight: 700 }}>Section 16 — naslov sekcije</p>
          <p style={{ fontSize: "var(--text-body)" }}>Body 14 — osnovni tekst interfejsa.</p>
          <p style={{ fontSize: "var(--text-small)" }}>Small 13 — meta i pomoćni tekst.</p>
          <p style={{ fontSize: "var(--text-label)", fontWeight: 600 }}>Label 12 — oznake polja i chipovi.</p>
        </Card>
      </Section>

      <Section title="Navigacija, breadcrumbs, link" hint="Stavka navigacije ima ikonu + tekst; trenutna stranica je aria-current.">
        <Card>
          <Stack>
            <Breadcrumbs items={[{ label: "Ured", href: "#nav" }, { label: "Radnici", href: "#nav" }, { label: "Novi radnik" }]} />
            <p>Ovo je <TextLink href="#nav">TextLink u tekstu</TextLink> — podvučen, boja --link, vidljiv i bez boje (podvlačenje).</p>
            <Stepper steps={["Podaci", "Angažman", "Potvrda"]} current={1} />
            <p className="gx-page-sub">Stepper (koraci): završeni ✓, trenutni pun, sljedeći prazni — stanje nije samo boja.</p>
          </Stack>
        </Card>
      </Section>

      <Section title="Kartice, avatar, badge" hint="Card je jedina ploča; ActionCard je cijela klikabilna; Stat je brojčana kartica.">
        <Stack>
          <Inline>
            <Avatar name="Amina Karić" />
            <Avatar name="Mujo Softić" size="lg" />
            <Avatar name="Amar Hodžić" size="sm" />
            <span>Amina Karić <Badge>3</Badge></span>
            <span>Obavijesti <Badge tone="danger">5</Badge></span>
            <span>Arhiva <Badge tone="quiet">12</Badge></span>
          </Inline>
          <Inline>
            <ActionCard title="ActionCard: Dodaj radnika" hint="Cijela kartica je jedna akcija (meta ≥48 px)." onClick={() => push("info", "ActionCard kliknut")} />
            <ActionCard title="ActionCard: Uvezi iz Excela" hint="Isti obrazac za ulaze u procese." onClick={() => push("info", "Uvoz iz kataloga — demo")} />
          </Inline>
          <Inline>
            <Stat label="Stat: Otvoreni dani" value="3" hint="Čekaju unos" />
            <Stat label="Stat: Sukobi" value="1" hint="Čeka razrješenje" />
          </Inline>
        </Stack>
      </Section>

      <Section title="Upload i slika" hint="Upload: klik ili prevlačenje; slika uvijek s opisom (alt) i omjerom.">
        <Card>
          <FormGrid>
            <FileUpload label="Dodaj dokument ili fotografiju" hint="Klikni ili prevuci fajl ovdje (demo — fajl se ne šalje)." accept="image/*,.pdf" onFiles={() => push("success", "Fajl izabran (demo)")} />
            <FigureImage src="https://placehold.co/640x360/png" alt="Primjer fotografije gradilišta (placeholder)" caption="FigureImage: slika + potpis, omjer 16/9." />
          </FormGrid>
        </Card>
      </Section>

      <Section title="Accordion, količina, speed dial, toast" hint="Sve što se otvara/zatvara ima aria stanje; toast nestaje sam za 5 s ili na X.">
        <Stack>
          <Accordion title="Accordion — detalji koji ne moraju uvijek biti otvoreni" defaultOpen>
            <p>Sadržaj akordeona: sekundarne informacije, napredne opcije, istorija. Naslov je dugme (aria-expanded), sadržaj se ne gubi iz DOM-a bez razloga.</p>
          </Accordion>
          <Accordion title="Accordion — zatvoreni primjer">
            <p>Drugi sadržaj.</p>
          </Accordion>
          <Card>
            <Inline>
              <span>Sati rada:</span>
              <QuantityStepper label="Sati rada" value={qty} onChange={setQty} />
              <Button onClick={() => push("success", "Toast: sačuvano", "Primjer uspješne poruke.")}>Toast uspjeh</Button>
              <Button variant="danger" onClick={() => push("error", "Toast: greška", "Primjer poruke o grešci.")}>Toast greška</Button>
              <SpeedDial label="Brze akcije (speed dial)" actions={[{ key: "a", label: "Novi unos", onSelect: () => push("info", "Speed dial: novi unos") }, { key: "b", label: "Nova fotografija", onSelect: () => push("info", "Speed dial: fotografija") }]} />
            </Inline>
          </Card>
        </Stack>
      </Section>

      <ToastStack toasts={toasts} onDismiss={dismiss} />

      <Section title="Mobilni katalog (isti inventar)" hint="Mobilne komponente žive u apps/mobile/src/ui; ekran „katalog“ u aplikaciji (dev prekidač) prikazuje ih uživo.">
        <Card>
          <p>
            <Icon name="info" /> Screen, Text, Button, BigActionButton, TextField, Segmented, ListItem, StatusChip, Banner,
            EmptyState, Skeleton, Tile, CardView — iste uloge kao web komponente iznad, mete dodira ≥56 dp, kontrast
            iz tokena u obje teme. Razlika je samo platforma, ne sistem.
          </p>
        </Card>
      </Section>
    </Stack>
  );
}
