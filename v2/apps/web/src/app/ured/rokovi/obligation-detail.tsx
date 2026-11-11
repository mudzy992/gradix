"use client";

/** Detalj obaveze: verzije i prilozi (upload po sadržaju fajla). */
import { useEffect, useState } from "react";
import type { Obligation } from "@gradix/contracts";
import { apiCall, jsonBody } from "@/api-client";
import { formatDate } from "@/format";
import {
  Alert, Button, DataTable, DescriptionList, Dialog, FileUpload, Mono, SectionTitle, Skeleton,
} from "@/components/ui/index";
import { STATE_LABEL, daysLabel, targetLabel } from "./obligations-client";

export function DetailDialog({
  obligation,
  canManage,
  returnFocusTo,
  onChanged,
  onClose,
}: {
  obligation: Obligation;
  canManage: boolean;
  returnFocusTo: HTMLElement | null;
  onChanged: (text: string) => Promise<void>;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<
    { version: number; expiresAt: string | null; number: string | null; issuer: string | null; createdAt: string }[] | null
  >(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const result = await apiCall<{
        versions: { version: number; expiresAt: string | null; number: string | null; issuer: string | null; createdAt: string }[];
      }>(`/api/obligations/${obligation.id}`);
      if (result.ok) setVersions(result.data.versions);
    })();
  }, [obligation.id]);

  async function upload(file: File) {
    setBusy(true);
    setMessage(null);
    try {
      const buffer = new Uint8Array(await file.arrayBuffer());
      // `sha256` i prvih 32 bajta: server po sadržaju odlučuje da li je PDF ili slika.
      const digest = await crypto.subtle.digest("SHA-256", buffer);
      const sha256 = Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      const head = Array.from(buffer.slice(0, 32));

      const registered = await apiCall<{ attachment: { id: string }; uploadUrl: string }>(
        `/api/obligations/${obligation.id}/attachments`,
        jsonBody({
          fileName: file.name,
          sizeBytes: file.size,
          sha256,
          headBase64: btoa(String.fromCharCode(...head)),
        }),
      );
      if (!registered.ok) {
        setMessage({ tone: "error", text: registered.message });
        return;
      }

      const put = await fetch(registered.data.uploadUrl, {
        method: "PUT",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: buffer,
      });
      if (!put.ok) {
        setMessage({ tone: "error", text: "Upload nije prošao. Pokušajte ponovo." });
        return;
      }

      const confirmed = await apiCall<{ attachment: { status: string } }>(
        `/api/obligations/${obligation.id}/attachments/${registered.data.attachment.id}/confirm`,
        { method: "POST" },
      );
      if (!confirmed.ok) {
        setMessage({ tone: "error", text: confirmed.message });
        return;
      }
      setMessage({ tone: "success", text: "Prilog je dodan." });
      await onChanged("Prilog je dodan uz obavezu.");
    } catch {
      setMessage({ tone: "error", text: "Upload nije prošao. Provjerite vezu i pokušajte ponovo." });
    } finally {
      setBusy(false);
    }
  }

  async function open(attachmentId: string) {
    const result = await apiCall<{ url: string }>(
      `/api/obligations/${obligation.id}/attachments/${attachmentId}/url`,
    );
    if (!result.ok) {
      setMessage({ tone: "error", text: result.message });
      return;
    }
    window.open(result.data.url, "_blank", "noopener,noreferrer");
  }

  return (
    <Dialog
      title={obligation.typeLabel}
      hint={`${targetLabel(obligation)} · rok ${formatDate(obligation.expiresAt)} · ${STATE_LABEL[obligation.state]}`}
      returnFocusTo={returnFocusTo}
      onClose={onClose}
      wide
    >
      <div className="gx-stack gx-stack--5 gx-mt-5">
        {message ? (
          <Alert tone={message.tone} role={message.tone === "error" ? "alert" : "status"}>
            {message.text}
          </Alert>
        ) : null}

        <DescriptionList
          items={[
            { term: "Izdavalac", value: obligation.issuer ?? "—" },
            { term: "Broj", value: <Mono>{obligation.number ?? "—"}</Mono> },
            { term: "Izdato", value: <span className="gx-mono">{formatDate(obligation.issuedAt)}</span> },
            { term: "Rok", value: <span className="gx-mono">{formatDate(obligation.expiresAt)} ({daysLabel(obligation)})</span> },
            { term: "Odgovoran", value: obligation.responsibleName ?? "—" },
            { term: "Podsjetnici", value: obligation.reminderDays.length > 0 ? `${obligation.reminderDays.join(" / ")} dana prije roka` : "nema" },
          ]}
        />

        <section>
          <SectionTitle hint="Stara verzija ostaje — istorija je dokaz.">Verzije</SectionTitle>
          {versions === null ? (
            <Skeleton rows={2} />
          ) : (
            <DataTable
              caption="Verzije obaveze"
              rows={versions}
              rowKey={(entry) => String(entry.version)}
              emptyText="Nema verzija."
              columns={[
                { key: "version", header: "Verzija", cell: (entry) => <Mono>v{entry.version}</Mono> },
                { key: "expires", header: "Rok", cell: (entry) => formatDate(entry.expiresAt) },
                { key: "number", header: "Broj", cell: (entry) => entry.number ?? "—" },
              ]}
            />
          )}
        </section>

        <section>
          <SectionTitle hint="PDF ili slika, do 10 MB. Tip se provjerava po sadržaju.">Prilozi</SectionTitle>
          {obligation.attachments.length === 0 ? (
            <p className="gx-page-sub">Još nema priloga.</p>
          ) : (
            <ul className="gx-stack gx-stack--2 gx-mt-2">
              {obligation.attachments.map((attachment) => (
                <li key={attachment.id} className="gx-inline-flex">
                  <span>{attachment.fileName}</span>
                  <span className="gx-page-sub">
                    {(attachment.sizeBytes / 1024).toFixed(0)} kB
                  </span>
                  <Button onClick={() => void open(attachment.id)}>Otvori</Button>
                </li>
              ))}
            </ul>
          )}
          {canManage ? (
            <div className="gx-mt-3">
              <FileUpload
                label="Dodaj prilog"
                hint="PDF ili slika, do 10 MB."
                accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
                onFiles={(files) => { const file = files[0]; if (file) void upload(file); }}
              />
            </div>
          ) : null}
        </section>

        <div className="gx-dialog__actions">
          <Button variant="quiet" onClick={onClose}>
            Zatvori
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
