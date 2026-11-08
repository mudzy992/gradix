// @vitest-environment jsdom
/**
 * Uvoz (R2a): četiri koraka i tri obećanja koja ekran mora da održi.
 *
 *  1. Pregled ne piše ništa — potvrda se šalje tek u koraku 3.
 *  2. Dok postoji blokada (nemapirano obavezno polje) potvrda je onemogućena.
 *  3. Prekinut uvoz kaže „ništa nije uvezeno“ i pokaže red na kojem je stalo.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ImportClient from "./import-client";
import { expectNoSeriousA11yViolations } from "@/test/axe";

const preview = {
  kind: "workers",
  mapping: {
    firstName: "Ime",
    lastName: "Prezime",
    phone: "Telefon",
    email: null,
    jobTitle: null,
    engagement: null,
    hiredAt: "Datum početka",
    endedAt: null,
    team: null,
    supervisor: null,
  },
  ignoredSheets: 1,
  sheetName: "Radnici",
  headers: ["Ime", "Prezime", "Telefon", "Datum početka", "JMBG"],
  fileName: "radnici.xlsx",
  rows: [
    { rowNumber: 2, outcome: "import", summary: "Amina Karić" },
    { rowNumber: 3, outcome: "import", summary: "Mario Perić" },
    { rowNumber: 4, outcome: "skip", reason: "Već postoji radnik sa ovim imenom.", summary: "Amina Karić" },
    { rowNumber: 5, outcome: "error", reason: "Datum početka nije ispravan.", summary: "Bez Datuma" },
  ],
  counts: { import: 2, skip: 1, error: 1, duplicate: 0 },
  blockers: [],
  notices: ["Kolona „JMBG“ nije podržana i nije uvezena: lični podaci se u R2 ne unose."],
};

function file() {
  return new File(["x"], "radnici.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

type Call = { url: string; body: FormData };

function mockApi(responses: { preview?: unknown; apply?: unknown; applyStatus?: number } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body as FormData;
      calls.push({ url: String(url), body });

      const payload = String(url).includes("preview") ? responses.preview ?? preview : responses.apply;
      const status = String(url).includes("preview") ? 200 : (responses.applyStatus ?? 200);

      if (payload === undefined) {
        return {
          ok: false,
          status: 400,
          json: async () => ({ success: false, error: { code: "VALIDATION_FAILED", message: "Nije prošlo." } }),
        } as unknown as Response;
      }
      const success = status < 400;
      return {
        ok: success,
        status,
        json: async () => (success ? { success: true, data: payload } : payload),
      } as unknown as Response;
    }) as unknown as typeof fetch,
  );
  return calls;
}

/** Koraci 1 → 2: izaberi fajl i pusti pregled. */
async function openPreview() {
  render(<ImportClient />);
  await userEvent.upload(screen.getByLabelText("Datoteka"), file());
  await userEvent.click(screen.getByRole("button", { name: "Pregledaj fajl" }));
  await screen.findByRole("table");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uvoz iz Excela", () => {
  it("pregled prikazuje ishode po redu i ne šalje potvrdu", async () => {
    const calls = mockApi();
    await openPreview();

    // Ista osoba je u fajlu dva puta (jednom kao „već postoji“) — oba reda se vide.
    expect(screen.getAllByText("Amina Karić")).toHaveLength(2);
    expect(screen.getByText("Greška")).toBeInTheDocument();
    expect(screen.getByText("Datum početka nije ispravan.")).toBeInTheDocument();
    // Drugi list se prijavljuje, ne uvozi.
    expect(screen.getByText(/1 list\(ova\) nije čitan/)).toBeInTheDocument();
    // Neuvežena kolona sa ličnim podacima: vidi se u napomeni (ne blokira) i u izboru kolona.
    expect(screen.getByText(/Kolona „JMBG“ nije podržana/)).toBeInTheDocument();
    expect(screen.getAllByRole("option", { name: "JMBG" })).not.toHaveLength(0);

    expect(calls.filter((call) => call.url.includes("apply"))).toHaveLength(0);
  });

  it("blokada isključuje dalje — dok se polje ne mapira, nema odluka", async () => {
    mockApi({
      preview: {
        ...preview,
        blockers: ["Polje „Prezime“ nije mapirano."],
        rows: [],
        counts: { import: 0, skip: 0, error: 0, duplicate: 0 },
        notices: [],
      },
    });
    render(<ImportClient />);
    await userEvent.upload(screen.getByLabelText("Datoteka"), file());
    await userEvent.click(screen.getByRole("button", { name: "Pregledaj fajl" }));

    expect(await screen.findByText(/Polje „Prezime“ nije mapirano/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("button", { name: "Dalje na odluke" })).toBeDisabled();
  });

  it("promjena mapiranja ponovo čita fajl sa novim mapiranjem", async () => {
    const calls = mockApi();
    await openPreview();
    await userEvent.selectOptions(screen.getByLabelText("Email"), "Telefon");

    await waitFor(() => expect(calls.filter((call) => call.url.includes("preview"))).toHaveLength(2));
    const sent = JSON.parse(String(calls[1]!.body.get("mapping"))) as Record<string, string | null>;
    expect(sent.email).toBe("Telefon");
    // Sadržaj fajla ide ponovo — mapiranje samo po sebi ne mijenja ništa na serveru.
    expect(calls[1]!.body.get("file")).toBeTruthy();
  });

  it("potvrda šalje isti fajl i odluke po redu; greške se ne mogu izabrati", async () => {
    const calls = mockApi({
      apply: { imported: 2, updated: 0, skipped: 2, failed: 0, errors: [] },
    });
    await openPreview();
    await userEvent.click(screen.getByRole("button", { name: "Dalje na odluke" }));

    // Red sa greškom nema nijednu opciju — ne nudi se ono što servis odbija.
    expect(screen.queryByLabelText("Red 5: Uvezi")).toBeNull();
    // Postojeći red se nudi kao ažuriranje, a ne kao tihi prepis.
    expect(screen.getByLabelText("Ažuriraj postojeće")).toBeInTheDocument();

    // Broj u dugmetu prati izbore: dva nova reda, pa tri kad se doda ažuriranje.
    expect(screen.getByRole("button", { name: "Uvezi 2 reda" })).toBeEnabled();
    await userEvent.click(screen.getByLabelText("Ažuriraj postojeće"));
    await userEvent.click(screen.getByRole("button", { name: "Uvezi 3 reda" }));

    await screen.findByText(/Uvezeno 2, ažurirano 0, preskočeno 2/);
    const apply = calls.find((call) => call.url.includes("apply"))!;
    expect(apply.body.get("kind")).toBe("workers");
    expect(apply.body.get("file")).toBeTruthy();
    const decisions = JSON.parse(String(apply.body.get("decisions"))) as { rowNumber: number; action: string }[];
    expect(decisions).toEqual([
      { rowNumber: 2, action: "import" },
      { rowNumber: 3, action: "import" },
      { rowNumber: 4, action: "update" },
      { rowNumber: 5, action: "skip" },
    ]);
  });

  it("prekinut uvoz: prvo piše da ništa nije uvezeno, pa koji je red pao", async () => {
    mockApi({
      applyStatus: 409,
      apply: {
        success: false,
        error: {
          code: "CONFLICT",
          message: "Uvoz je prekinut na redu 3: registarska oznaka već postoji. Ništa nije uvezeno.",
        },
        data: {
          imported: 0,
          updated: 0,
          skipped: 0,
          failed: 1,
          errors: [{ rowNumber: 3, message: "registarska oznaka već postoji" }],
        },
      },
    });
    await openPreview();
    await userEvent.click(screen.getByRole("button", { name: "Dalje na odluke" }));
    await userEvent.click(screen.getByRole("button", { name: "Uvezi 2 reda" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Ništa nije uvezeno");
    expect(screen.getByText(/Red 3: registarska oznaka već postoji/)).toBeInTheDocument();
    // Nema zelenog sažetka pored crvene greške — to bi bilo dva suprotna stanja.
    expect(screen.queryByText(/Uvezeno 0, ažurirano 0/)).toBeNull();
  });

  it("nema serious/critical a11y nalaza u koracima 1–3", async () => {
    mockApi();
    const { container } = render(<ImportClient />);
    await expectNoSeriousA11yViolations(container);

    await userEvent.upload(screen.getByLabelText("Datoteka"), file());
    await userEvent.click(screen.getByRole("button", { name: "Pregledaj fajl" }));
    await screen.findByRole("table");
    await expectNoSeriousA11yViolations(container);

    await userEvent.click(screen.getByRole("button", { name: "Dalje na odluke" }));
    const decisions = await screen.findByText("3. Odluke po redu");
    expect(within(decisions.closest("section")!).getAllByRole("radio").length).toBeGreaterThan(0);
    await expectNoSeriousA11yViolations(container);
  });
});
