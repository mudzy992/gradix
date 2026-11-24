"use client";

/**
 * QR kod za 2FA uparivanje (Korak 0, Faza 4).
 *
 * Zašto QR: `otpauth://` URI je jedini put da tajna postoji van baze, a ručno prepisivanje
 * 32-znakovne base32 tajne je najčešće mjesto gdje korisnik pogriješi i onda „2FA ne radi“.
 * Skeniranje istog URI-ja uklanja tu grešku.
 *
 * Zašto se generiše u BRZERU, a ne na serveru: tajna ne smije napustiti stranicu. `qrcode`
 * paket radi lokalno u pregledniku (nema poziva ka vanjskom servisu, nema slanja na server),
 * pa `otpauth://` URI nikad ne ide u log, u keš ni u treću stranu.
 *
 * Pristupačnost: QR je `role="img"` sa `aria-label` koji kaže ŠTA je i ŠTA korisnik da uradi —
 * slika bez imena je za čitač ekrana prazna kutija, a za korisnika koji ne vidi QR jedini put
 * ostaje ručni ključ, pa on mora biti dostupan odmah pored.
 *
 * Tema: QR nosi SVOJU bijelu podlogu, uvijek. Skener telefona traži tamne module na svijetloj
 * podlozi; inverzija u tamnoj temi je česta greška zbog koje kod „neće da se očita“.
 */
import { useEffect, useState } from "react";

export function TotpQrCode({ uri, label }: { uri: string; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setSrc(null);
    setFailed(false);
    /*
     * Dinamički uvoz: QR biblioteka je potrebna samo na ovom ekranu i samo dok je uparivanje
     * otvoreno. Statički uvoz bi je stavio u zajednički bundle prijave.
     */
    void import("qrcode")
      .then((mod) =>
        mod.toDataURL(uri, {
          errorCorrectionLevel: "M",
          margin: 2,
          width: 232,
          // Eksplicitno, ne iz teme: `#ffffff` podloga i `#000000` moduli su ono što skener traži.
          color: { dark: "#000000", light: "#ffffff" },
        }),
      )
      .then((dataUrl) => {
        if (alive) setSrc(dataUrl);
      })
      .catch(() => {
        /*
         * Ako QR ne može da se napravi, ekran NE smije ostati bez puta dalje: ručni ključ je
         * već prikazan pored, a ovdje se kaže šta je pošlo naopako. Tiha prazna kutija bi
         * izgledala kao da uparivanje ne radi.
         */
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [uri]);

  if (failed) {
    return (
      <p className="gx-muted" role="status">
        QR kod nije mogao da se prikaže. Upišite ključ ispod ručno — radi isto.
      </p>
    );
  }

  return (
    <div className="gx-qr">
      {src ? (
        /* `img` je namjerno: izvor je `data:` URL koji `next/image` ne optimizuje, a QR mora biti
         * tačan piksel-po-piksel — svaka obrada kvari čitljivost koda.
         * Okvir (`.gx-qr`) nosi bijelu podlogu u OBJE teme, pa kod ostaje čitljiv i u mraku. */
        <img
          src={src}
          alt={`QR kod za uparivanje autentikatora: ${label}. Skenirajte ga aplikacijom, ili upišite ključ ispod ručno.`}
          width={232}
          height={232}
          className="gx-qr__img"
        />
      ) : (
        /*
         * Rezervisan prostor iste visine: bez njega se forma „skače“ kad QR stigne, a korisnik
         * koji već kuca ključ izgubi polje iz vida.
         */
        <div className="gx-qr__placeholder" aria-hidden="true" />
      )}
    </div>
  );
}
