/** F9: prijava opasnosti ostaje na uređaju dok se ne pošalje, i bez mreže. */
import { useCallback, useEffect, useRef, useState } from "react";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { calendarDateFromLocalDate, type HseIncidentKindCode, type HseSeverityCode, type R4HseIncidentPayload } from "@gradix/domain";
import { myProjects, pullHseWorkers } from "../../api/client";
import { getActiveLocalAccount, queueHseIncident, readForemanWorkerRoster, readOutboxEntries, saveForemanWorkerRoster,
  type LocalForemanWorker, type LocalOutboxEntry } from "../../db/r4-outbox";
import { openDb, readProjects, saveProjects, type LocalProject } from "../../db/sqlite";
import { runSqliteR4Sync } from "../../sync/r4-sqlite";
import { countPendingHsePhotos } from "../../sync/hse-photo-sync";
import { sendResultMessage, syncBannerText } from "../../teren/outcome";
import { Banner, Button, CardView, CheckboxRow, ListItem, Screen, Segmented, Text, TextField } from "../../ui";

type IncidentPhoto = R4HseIncidentPayload["photos"][number] & { base64: string };

function photoType(bytes: Uint8Array): IncidentPhoto["contentType"] | null {
  const at = (offset: number, values: number[]) => values.every((value, index) => bytes[offset + index] === value);
  if (at(0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return "image/webp";
  if (at(4, [0x66, 0x74, 0x79, 0x70]) && ["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(String.fromCharCode(...bytes.slice(8, 12)))) return "image/heic";
  return null;
}

export default function HsePrijavaScreen() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<LocalOutboxEntry[]>([]);
  const [projects, setProjects] = useState<LocalProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [workers, setWorkers] = useState<LocalForemanWorker[]>([]);
  const rosterRequest = useRef(0);
  const [kind, setKind] = useState<HseIncidentKindCode>("NEAR_MISS");
  const [severity, setSeverity] = useState<HseSeverityCode>("MINOR");
  const [occurredAt, setOccurredAt] = useState(() => new Date().toISOString());
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [action, setAction] = useState("");
  const [lostDays, setLostDays] = useState("0");
  const [injuredWorkerId, setInjuredWorkerId] = useState("");
  const [involved, setInvolved] = useState<Record<string, boolean>>({});
  const [injured, setInjured] = useState<Record<string, boolean>>({});
  const [photos, setPhotos] = useState<IncidentPhoto[]>([]);
  const [photosPending, setPhotosPending] = useState(0);
  const [reportable, setReportable] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncFailed, setSyncFailed] = useState(false);
  const saving = useRef(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const db = await openDb();
      const account = await getActiveLocalAccount(db);
      if (!account) throw new Error("Nema aktivnog naloga na uređaju. Prijavi se uz vezu.");
      setEntries(await readOutboxEntries(db, account));
      setPhotosPending(await countPendingHsePhotos(db, account));
      setProjects((await readProjects(db)).rows);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Lokalni podaci nisu dostupni.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function refreshProjects() {
    setBusy(true);
    try {
      const db = await openDb();
      const account = await getActiveLocalAccount(db);
      if (!account) throw new Error("Nema aktivnog naloga na uređaju.");
      const response = await myProjects();
      const current = await getActiveLocalAccount(db);
      if (current?.companyId !== account.companyId || current?.userId !== account.userId) throw new Error("Nalog se promijenio.");
      const rows = response.projects.map((p) => ({ id: p.id, code: p.code, name: p.name, status: p.status,
        sitePlace: p.sitePlace, startsOn: p.startsOn, endsOn: p.endsOn }));
      await saveProjects(db, rows, new Date().toISOString());
      setProjects(rows);
      setMessage(rows.length ? "Projekti su osvježeni." : "Nema dodijeljenih projekata.");
    } catch { setMessage("Projekti nisu osvježeni; prikazan je lokalni spisak."); }
    finally { setBusy(false); }
  }

  async function loadRoster(project: string) {
    const request = ++rosterRequest.current;
    setWorkers([]);
    setInjuredWorkerId("");
    setInvolved({}); setInjured({});
    if (!project) return;
    const eventDate = new Date(occurredAt);
    if (Number.isNaN(eventDate.getTime())) return;
    const day = calendarDateFromLocalDate(eventDate);
    try {
      const db = await openDb();
      const account = await getActiveLocalAccount(db);
      if (!account) throw new Error("Nema aktivnog naloga na uređaju.");
      let offline = false;
      try {
        const remote = await pullHseWorkers(account, project, day);
        await saveForemanWorkerRoster(db, account, project, day, remote.workers);
      } catch { offline = true; }
      const cached = await readForemanWorkerRoster(db, account, project, day);
      if (request !== rosterRequest.current) return;
      setWorkers(cached.workers);
      if (offline && cached.workers.length === 0) setMessage("Ekipa nije dostupna za ovaj projekat i datum. ID povrijeđenog se može unijeti ručno.");
      else if (offline) setMessage("Ekipa nije osvježena; prikazan je lokalni spisak za datum događaja.");
    } catch (caught) { if (request === rosterRequest.current) setMessage(caught instanceof Error ? caught.message : "Ekipa nije dostupna."); }
  }

  async function takePhoto(source: "camera" | "library") {
    if (photos.length >= 10) { setMessage("Najviše 10 fotografija po prijavi."); return; }
    setBusy(true);
    try {
      const permission = source === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) { setMessage(source === "camera" ? "Kamera nije dozvoljena." : "Pristup fotografijama nije dozvoljen."); return; }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.6, base64: true };
      const result = source === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled) return;
      const base64 = result.assets[0]?.base64;
      if (!base64) throw new Error("Fotografija nije pročitana.");
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const contentType = photoType(bytes);
      if (!contentType || bytes.length === 0 || bytes.length > 10_485_760) throw new Error("Fotografija mora biti podržana slika do 10 MB.");
      const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
      const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      if (photos.some((photo) => photo.sha256 === sha256)) { setMessage("Ova fotografija je već dodana."); return; }
      const ext = contentType === "image/jpeg" ? "jpg" : contentType.split("/")[1];
      setPhotos((current) => [...current, { fileName: `incident-${sha256.slice(0, 12)}.${ext}`, contentType, sizeBytes: bytes.length, sha256, base64 }]);
      setMessage("Fotografija je spremna za lokalno čuvanje uz prijavu.");
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Fotografija nije pročitana."); }
    finally { setBusy(false); }
  }

  async function save() {
    if (saving.current) return;
    if (description.trim().length < 5) {
      setMessage("Opiši događaj sa najmanje 5 znakova.");
      return;
    }
    if (kind !== "NEAR_MISS" && (!/^\d+$/.test(lostDays) || Number(lostDays) > 3650)) {
      setMessage("Izgubljeni dani moraju biti cijeli broj između 0 i 3650.");
      return;
    }
    saving.current = true;
    setBusy(true);
    try {
      const db = await openDb();
      const account = await getActiveLocalAccount(db);
      if (!account) throw new Error("Nema aktivnog naloga na uređaju.");
      const selected = workers.filter((worker) => involved[worker.id]).map((worker) => ({
        workerId: worker.id, injured: kind !== "NEAR_MISS" && Boolean(injured[worker.id]),
      }));
      if (kind !== "NEAR_MISS" && injuredWorkerId.trim() && !selected.some((p) => p.workerId === injuredWorkerId.trim())) {
        selected.push({ workerId: injuredWorkerId.trim(), injured: true });
      }
      await queueHseIncident(db, account, {
        incidentId: `hsi_${Crypto.randomUUID()}`,
        incident: {
          kind, severity, occurredAt: occurredAt.trim(), projectId: projectId || null,
          locationText: location.trim() || null, lat: null, lng: null,
          description: description.trim(), immediateAction: action.trim() || null,
          injuredWorkerId: selected.find((p) => p.injured)?.workerId ?? null,
          involvedWorkers: selected,
          lostDays: kind === "NEAR_MISS" ? 0 : Number(lostDays), reportableToAuthority: reportable,
          photos: photos.map(({ base64: _base64, ...metadata }) => metadata), updateBody: null,
        },
        photoData: photos.map((photo) => ({ sha256: photo.sha256, base64: photo.base64 })),
      });
      // Nakon trajnog upisa ne prijavljuj grešku kao da upis nije uspio: novi tap bi duplicirao prijavu.
      setDescription("");
      setLocation("");
      setAction("");
      setLostDays("0");
      setInjuredWorkerId("");
      setInvolved({}); setInjured({}); setPhotos([]);
      setReportable(false);
      setOccurredAt(new Date().toISOString());
      setMessage("Prijava je sačuvana na telefonu, još nije poslana.");
      await load();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Prijava nije sačuvana. Pokušaj ponovo.");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  async function send() {
    setBusy(true);
    try {
      const db = await openDb();
      const account = await getActiveLocalAccount(db);
      if (!account) throw new Error("Nema aktivnog naloga na uređaju.");
      const outcome = await runSqliteR4Sync(db, account);
      setSyncFailed(outcome.retry > 0);
      setMessage(outcome.error === "PHOTO_UPLOAD_FAILED"
        ? "Prijava je obrađena, ali barem jedna fotografija još čeka upload. Pokušaj ponovo."
        : `${sendResultMessage(outcome)} Odbijeno: ${outcome.rejected}.`);
      await load();
    } catch {
      setSyncFailed(true);
      setMessage("Slanje nije uspjelo. Zapisi ostaju na telefonu.");
    } finally {
      setBusy(false);
    }
  }

  const pending = entries.filter((entry) => entry.status === "pending" || entry.status === "failed").length;
  const needsReview = entries.filter((entry) => entry.status === "rejected" || entry.status === "conflict").length;
  return (
    <Screen title="Prijava opasnosti" subtitle="Prijavi događaj i bez mreže; slanje je odvojeni korak."
      loading={loading} error={error} empty={null} onRetry={load}>
      <Banner>{syncBannerText({ pending: pending + photosPending, syncFailed, review: needsReview })} {photosPending ? `Fotografije na čekanju: ${photosPending}.` : ""} {pending + photosPending > 0 && needsReview > 0 ? `${needsReview} zahtijeva provjeru.` : ""}</Banner>
      {!error ? <CardView>
        <Segmented label="Vrsta događaja" value={kind} onChange={(value) => {
          setKind(value); if (value === "NEAR_MISS") { setInjured({}); setInjuredWorkerId(""); }
        }} options={[
          { value: "NEAR_MISS", label: "Izbjegnuta nezgoda" }, { value: "ACCIDENT", label: "Nesreća" },
          { value: "PROPERTY_DAMAGE", label: "Materijalna šteta" }, { value: "ENVIRONMENTAL", label: "Okoliš" },
          { value: "OCCUPATIONAL_ILLNESS", label: "Profesionalno oboljenje" },
        ]} />
        <Segmented label="Ozbiljnost" value={severity} onChange={setSeverity} options={[
          { value: "MINOR", label: "Manja" }, { value: "MODERATE", label: "Umjerena" },
          { value: "SEVERE", label: "Teška" }, { value: "FATAL", label: "Smrtna" },
        ]} />
        <TextField label="Vrijeme događaja (ISO, s vremenskom zonom)" value={occurredAt} onChangeText={(value) => {
          setOccurredAt(value); rosterRequest.current += 1; setWorkers([]); setInjuredWorkerId(""); setInvolved({}); setInjured({});
        }} autoCapitalize="none" />
        <Button label="Osvježi projekte" variant="secondary" busy={busy} onPress={() => void refreshProjects()} />
        {projects.length ? <Segmented label="Projekat (opcionalno)" value={projectId} onChange={(value) => {
          setProjectId(value); void loadRoster(value);
        }} options={[{ value: "", label: "Bez projekta" }, ...projects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))]} />
          : <Text variant="muted">Nema lokalnih projekata. Osvježi ih dok imaš mrežu; prijava može i bez projekta.</Text>}
        <TextField label="Šta se dogodilo?" value={description} onChangeText={setDescription} multiline />
        <TextField label="Mjesto događaja (opcionalno)" value={location} onChangeText={setLocation} />
        <TextField label="Šta je odmah poduzeto? (opcionalno)" value={action} onChangeText={setAction} />
        {projectId ? <Button label="Osvježi ekipu za datum događaja" variant="secondary" onPress={() => void loadRoster(projectId)} /> : null}
        <Text variant="label">Uključeni radnici</Text>
        {workers.map((worker) => <Button key={worker.id} variant={involved[worker.id] ? "primary" : "secondary"}
          label={`${involved[worker.id] ? "✓ " : ""}Uključen: ${worker.name}`} onPress={() => {
            setInvolved((previous) => ({ ...previous, [worker.id]: !previous[worker.id] }));
            if (involved[worker.id]) setInjured((previous) => ({ ...previous, [worker.id]: false }));
          }} />)}
        {kind !== "NEAR_MISS" ? <>
          <TextField label="Izgubljeni dani" value={lostDays} onChangeText={setLostDays} keyboardType="number-pad" />
          <Text variant="label">Povrijeđeni radnici</Text>
          {workers.filter((worker) => involved[worker.id]).map((worker) => <Button key={worker.id}
            variant={injured[worker.id] ? "primary" : "secondary"}
            label={`${injured[worker.id] ? "✓ " : ""}Povrijeđen: ${worker.name}`}
            onPress={() => setInjured((previous) => ({ ...previous, [worker.id]: !previous[worker.id] }))} />)}
          {!workers.length ? <TextField label="ID povrijeđenog radnika (opcionalno)" value={injuredWorkerId} onChangeText={setInjuredWorkerId} autoCapitalize="none" /> : null}
        </> : null}
        <CheckboxRow label="Potrebna prijava nadležnom organu" checked={reportable} onToggle={() => setReportable(!reportable)} />
        <Button label="Uslikaj fotografiju" variant="secondary" busy={busy} onPress={() => void takePhoto("camera")} />
        <Button label="Izaberi fotografiju" variant="secondary" busy={busy} onPress={() => void takePhoto("library")} />
        {photos.map((photo) => <Button key={photo.sha256} variant="secondary" label={`Ukloni fotografiju ${photo.fileName}`}
          onPress={() => setPhotos((current) => current.filter((item) => item.sha256 !== photo.sha256))} />)}
        <Text variant="muted">Fotografije ostaju na telefonu do potvrđenog uploada. Provjeri činjenice prije slanja jer se ne prepisuju.</Text>
        <Button label="Sačuvaj na telefon" busy={busy} onPress={() => void save()} />
        <Button label="Pošalji sada" variant="secondary" busy={busy} onPress={() => void send()} />
      </CardView> : null}
      {message ? <Text>{message}</Text> : null}
      <Text variant="label">Zapisi ovog naloga na telefonu</Text>
      {entries.slice(0, 10).map((entry) => <ListItem key={entry.localId}
        title={entry.status === "sent" ? "Poslano" : entry.status === "rejected" ? "Odbijeno — provjeri s uredom" : entry.status === "conflict" ? "Za provjeru" : "Čeka slanje"}
        meta={entry.lastError ?? entry.createdAt} />)}
    </Screen>
  );
}
