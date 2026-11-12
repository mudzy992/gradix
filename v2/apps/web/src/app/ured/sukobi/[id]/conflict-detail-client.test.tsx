// @vitest-environment jsdom
/**
 * R4a-2/B: zasebna stranica detalja sukoba — axe (bez serious/critical),
 * akcije ugašene kod razriješenog, neispravno HH:MM daje jasan ishod bez
 * otvaranja dijaloga i bez poziva serveru.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { WorkdayConflictDetail } from "@gradix/contracts";
import { expectNoSeriousA11yViolations } from "@/test/axe";
import { ConflictDetailClient } from "./conflict-detail-client";

const times = {
  startedAt: "2026-11-05T07:30:00+01:00",
  endedAt: "2026-11-05T15:30:00+01:00",
  endState: "KNOWN_END" as const,
};

const openDetail: WorkdayConflictDetail = {
  id: "cnf_1",
  status: "OPEN",
  createdAt: "2026-11-06T16:02:00+01:00",
  ageDays: 1,
  workerName: "Amar Hadžić",
  projectId: "prj_1",
  projectCode: "P-24/2026",
  projectName: "Dionica Visoko–Kiseljak",
  workDate: "2026-11-05",
  serverTimes: times,
  receivedTimes: { ...times, startedAt: "2026-11-05T08:00:00+01:00", endedAt: "2026-11-05T16:00:00+01:00" },
  resolutionKind: null,
  resolvedByName: null,
  resolvedAt: null,
  resolvedByParty: false,
  reason: null,
  internalNote: null,
  clockSkewMinutes: 6,
  server: {
    authorName: "Mario Perić", source: "server", receivedAt: "2026-11-06T16:02:00+01:00",
    kind: "WORK", projectId: "prj_1", machineLabel: "BAG-01 · Bager CAT 320", times,
  },
  received: {
    authorName: "Amar Hadžić", source: "telefon", receivedAt: "2026-11-07T17:41:00+01:00",
    kind: "WORK", projectId: "prj_1", machineId: "mch_1",
    times: { ...times, startedAt: "2026-11-05T08:00:00+01:00", endedAt: "2026-11-05T16:00:00+01:00" },
  },
};

describe("detalj sukoba (R4a-2/B)", () => {
  it("otvoren sukob: oba unosa, akcije aktivne, bez serious/critical a11y nalaza", async () => {
    const { container } = render(<ConflictDetailClient initial={openDetail} />);
    expect(screen.getByRole("heading", { name: "Unos sa servera" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Unos s telefona" })).toBeVisible();
    for (const button of screen.getAllByRole("button", { name: "Prihvati ovaj unos" })) {
      expect(button).toBeEnabled();
    }
    expect(screen.getByRole("button", { name: "Ispravi vremena" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Odbaci uz razlog" })).toBeEnabled();
    await expectNoSeriousA11yViolations(container);
  });

  it("razriješen sukob: ko/kada/šta vidljivo, akcije ugašene, bez a11y nalaza", async () => {
    const resolved: WorkdayConflictDetail = {
      ...openDetail,
      status: "RESOLVED",
      resolutionKind: "ACCEPT_SERVER",
      resolvedByName: "Amina Karić",
      resolvedAt: "2026-11-07T09:15:00+01:00",
      reason: "Server unos je potvrđen s terena.",
    };
    const { container } = render(<ConflictDetailClient initial={resolved} />);
    expect(screen.getByText(/Razriješio\/la Amina Karić/)).toBeVisible();
    for (const button of screen.getAllByRole("button", { name: "Prihvati ovaj unos" })) {
      expect(button).toBeDisabled();
    }
    expect(screen.getByRole("button", { name: "Odbaci uz razlog" })).toBeDisabled();
    await expectNoSeriousA11yViolations(container);
  });

  it("neispravno vrijeme (25:70): jasan ishod, dijalog se ne otvara", async () => {
    const user = userEvent.setup();
    render(<ConflictDetailClient initial={openDetail} />);
    await user.clear(screen.getByLabelText(/Početak/));
    await user.type(screen.getByLabelText(/Početak/), "25:70");
    await user.click(screen.getByRole("button", { name: "Ispravi vremena" }));
    expect(screen.getByText(/Neispravno vrijeme/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Sačuvaj ispravku" })).not.toBeInTheDocument();
  });
});
