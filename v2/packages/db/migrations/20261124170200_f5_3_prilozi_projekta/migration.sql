/**
 * F5.3 — dvije korekcije koje je prvi prolaz posla `budget.thresholds` pokazao.
 *
 * 1) Prilog na PROJEKAT (fotografija računa sa gradilišta).
 *    Zašto novi tip priloga, a ne vezivanje za trošak: red u `cost_entries` nastaje TEK knjiženjem,
 *    a fotografija nastaje prije njega — na gradilištu se prvo slika račun, pa se unosi iznos.
 *    Prilog zato visi o projektu (koji postoji), a `cost_entries.rate_snapshot->>'attachment_id'`
 *    pokazuje na njega. Servis pri knjiženju provjerava da prilog pripada ISTOM projektu.
 *
 * 2) `budget_alert_events.resolved_by` smije ostati NULL kad upozorenje zatvori SISTEM.
 *    Prvobitni CHECK je tražio da `resolved_at` i `resolved_by` budu zajedno postavljeni, što je
 *    tačno za čovjeka koji ručno zatvori upozorenje — ali pogrešno za slučaj kad potrošnja padne
 *    ispod praga (storno troška) ili dođe nova revizija. Tada upozorenje zatvara posao, a izmišljati
 *    „korisnika“ koji ga je zatvorio značilo bi lagati u auditu.
 */
ALTER TABLE public.attachments
  DROP CONSTRAINT attachments_entity_type_check;

ALTER TABLE public.attachments
  ADD CONSTRAINT attachments_entity_type_check
    CHECK (entity_type IN ('OBLIGATION', 'TENDER', 'MACHINE_DAILY_CHECK', 'PROJECT'));

ALTER TABLE public.budget_alert_events
  DROP CONSTRAINT budget_alert_events_resolved_check;

ALTER TABLE public.budget_alert_events
  ADD CONSTRAINT budget_alert_events_resolved_check
    CHECK (
      (resolved_at IS NULL AND resolved_by IS NULL)
      OR (resolved_at IS NOT NULL)
    );
