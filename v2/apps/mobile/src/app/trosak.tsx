/**
 * Brzi unos troška sa gradilišta (F5, spec 06 §4 „mobilno (šef)“).
 *
 * Redoslijed je redoslijed radnje na terenu: **uslikaj račun → iznos → kategorija → pošalji**.
 * Fotografija je prva jer bez nje nema knjiženja (`formProblem`), a kamera se otvara jednim
 * dodirom na metu ≥ 56 dp.
 *
 * Zašto se slika prije iznosa, a ne poslije: čovjek drži račun u ruci. Ako se prvo traži iznos,
 * račun se odloži i slika se „poslije“ — a poslije ne dođe.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import {
  bookSiteCost,
  confirmAttachment,
  costCategories,
  myProjects,
  registerProjectAttachment,
  type CostCategoriesResponse,
} from "../api/client";
import type { ProjectsResponse } from "@gradix/contracts";
import {
  EMPTY_COST_FORM,
  bytesToBase64,
  formProblem,
  headBytes,
  photoFileName,
  toManualCostPayload,
  type SiteCostForm,
} from "../teren/trosak-model";
import { AlertBox, Button, CardView, Screen, Text, TextField, UploadTile } from "../ui";

type ProjectItem = ProjectsResponse["projects"][number];

export default function TrosakScreen() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [categories, setCategories] = useState<CostCategoriesResponse["categories"]>([]);
  const [form, setForm] = useState<SiteCostForm>({ ...EMPTY_COST_FORM });
  const [photo, setPhoto] = useState<{ uri: string; base64: string; sizeBytes: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const [projectList, categoryList] = await Promise.all([myProjects(), costCategories()]);
      setProjects(projectList.projects);
      setCategories(categoryList.categories.filter((category) => category.is_active));
      // Dan troška dolazi sa servera (poslovna zona firme), ne iz telefona: telefon u drugoj zoni
      // bi upisao jučerašnji datum.
      const today = new Date().toISOString().slice(0, 10);
      setForm((current) => ({
        ...current,
        occurredOn: current.occurredOn || today,
        projectId: current.projectId || (projectList.projects[0]?.id ?? ""),
        categoryId: current.categoryId || (categoryList.categories[0]?.id ?? ""),
      }));
    } catch {
      setError("Podaci nisu učitani. Provjerite vezu i pokušajte ponovo.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const problem = useMemo(() => formProblem(form), [form]);

  async function takePhoto() {
    setMessage(null);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setMessage("Kamera nije dozvoljena. Uključite je u postavkama uređaja ili izaberite sliku.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.6,
      // Base64 odmah: telefon šalje SADRŽAJ, a ne putanju koju server ne vidi.
      base64: true,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset?.base64) {
      setMessage("Slika nije pročitana. Pokušajte ponovo.");
      return;
    }
    setPhoto({
      uri: asset.uri,
      base64: asset.base64,
      sizeBytes: asset.fileSize ?? Math.ceil((asset.base64.length * 3) / 4),
    });
    setMessage("Račun je uslikan. Provjerite iznos i pošaljite.");
  }

  async function submit() {
    const payload = toManualCostPayload(form);
    if (!payload || !photo) {
      setMessage(problem ?? "Uslikajte račun prije slanja.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      /*
       * Red je: registruj prilog → PUT bajtova na potpisani link → potvrdi → knjiži trošak.
       * Trošak se knjiži TEK poslije potvrde: neuspio upload bi ostavio knjižen iznos bez dokaza.
       */
      const bytes = Uint8Array.from(atob(photo.base64), (char) => char.charCodeAt(0));
      const sha256 = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, photo.base64);
      const registered = await registerProjectAttachment({
        projectId: String(payload.projectId),
        fileName: photoFileName(new Date()),
        sizeBytes: photo.sizeBytes,
        sha256,
        headBase64: bytesToBase64(headBytes(bytes)),
      });

      const put = await fetch(registered.uploadUrl, {
        method: "PUT",
        headers: { "content-type": "image/jpeg" },
        body: bytes,
      });
      if (!put.ok) {
        setMessage("Slika nije poslana na server. Pokušajte ponovo — trošak još nije knjižen.");
        return;
      }

      await confirmAttachment(registered.attachment.id);
      await bookSiteCost({
        projectId: String(payload.projectId),
        categoryId: String(payload.categoryId),
        occurredOn: String(payload.occurredOn),
        amount: String(payload.amount),
        attachmentId: registered.attachment.id,
        note: typeof payload.note === "string" ? payload.note : null,
      });

      setForm({ ...EMPTY_COST_FORM, occurredOn: form.occurredOn, projectId: form.projectId, categoryId: form.categoryId });
      setPhoto(null);
      setMessage("Trošak je knjižen sa fotografijom računa.");
    } catch {
      setMessage("Slanje nije prošlo. Trošak nije knjižen — pokušajte ponovo kad imate vezu.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title="Trošak sa gradilišta"
      subtitle="Račun, iznos i kategorija — knjiži se odmah, bez čekanja ureda."
      loading={loading}
      error={error}
      empty={null}
      onRetry={() => void load()}
    >
      {message ? <AlertBox>{message}</AlertBox> : null}

      <CardView>
        <UploadTile
          label={photo ? "Račun je uslikan — ponovi" : "Uslikaj račun"}
          hint="Fotografija je obavezna: bez nje trošak ne ulazi u knjigu."
          onPress={() => void takePhoto()}
        />
        {photo ? <Text variant="muted">Slika spremna ({Math.round(photo.sizeBytes / 1024)} KB)</Text> : null}
      </CardView>

      <CardView>
        <TextField
          label="Iznos (npr. 120.00)"
          value={form.amount}
          onChangeText={(amount) => setForm((current) => ({ ...current, amount }))}
          keyboardType="decimal-pad"
          placeholder="0.00"
          accessibilityLabel="Iznos troška"
        />
        <TextField
          label="Datum (YYYY-MM-DD)"
          value={form.occurredOn}
          onChangeText={(occurredOn) => setForm((current) => ({ ...current, occurredOn }))}
          placeholder="2026-11-23"
          accessibilityLabel="Datum troška"
        />
        <TextField
          label="Napomena (opciono)"
          value={form.note}
          onChangeText={(note) => setForm((current) => ({ ...current, note }))}
          accessibilityLabel="Napomena uz trošak"
        />
      </CardView>

      {/*
       * Izbor je DUGME po stavci, ne padajuća lista: padajuća lista na telefonu u rukavici traži
       * precizan pogodak, a ovdje svaka stavka ima metu ≥ 56 dp. Izabrana stavka je primarna —
       * stanje se vidi bez čitanja, a i dalje piše „izabran“ za čitač ekrana.
       */}
      <CardView>
        <Text variant="label">Projekat</Text>
        {projects.map((project) => {
          const selected = form.projectId === project.id;
          return (
            <Button
              key={project.id}
              label={`${selected ? "✓ " : ""}${project.code} · ${project.name}`}
              variant={selected ? "primary" : "secondary"}
              accessibilityLabel={`Projekat ${project.code} ${project.name}${selected ? ", izabran" : ""}`}
              onPress={() => setForm((current) => ({ ...current, projectId: project.id }))}
            />
          );
        })}
      </CardView>

      <CardView>
        <Text variant="label">Kategorija</Text>
        <View>
          {categories.map((category) => {
            const selected = form.categoryId === category.id;
            return (
              <Button
                key={category.id}
                label={`${selected ? "✓ " : ""}${category.name}`}
                variant={selected ? "primary" : "secondary"}
                accessibilityLabel={`Kategorija ${category.name}${selected ? ", izabrana" : ""}`}
                onPress={() => setForm((current) => ({ ...current, categoryId: category.id }))}
              />
            );
          })}
        </View>
      </CardView>

      <Button
        label={busy ? "Šaljem…" : "Knjiži trošak"}
        onPress={() => void submit()}
        disabled={busy || problem !== null || !photo}
      />
      {problem ? <Text variant="muted">{problem}</Text> : null}
    </Screen>
  );
}
