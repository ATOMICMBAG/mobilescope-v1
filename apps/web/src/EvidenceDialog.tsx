import { useEffect, useRef } from "react";
import type { ProcessedObservation } from "@mobilescope/core";

const ALERT_LABEL = {
  NORMAL: "Normal",
  INFORMATIONAL: "Informativ",
  WATCH: "Watch",
  WARNING: "Warnung",
  CRITICAL: "Kritisch",
} as const;

export function EvidenceDialog({ item, onClose }: { item: ProcessedObservation; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { observation: o, classification: c, rules, alertLevel } = item;

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  return (
    <dialog ref={ref} className="dialog" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      <div className="dialog-body">
        <header>
          <h2>Warum diese Einstufung?</h2>
          <button className="btn small" onClick={onClose} aria-label="Schließen">✕</button>
        </header>

        <p className="mono">{o.name ?? "(ohne Name)"} · {o.identifier}</p>

        <dl className="diag">
          <dt>Identitätszustand</dt><dd>{c.identityState}</dd>
          <dt>Vertrauensniveau</dt><dd>{c.confidence}</dd>
          <dt>Adresstyp</dt><dd>{c.addressType}</dd>
          <dt>Hersteller</dt><dd>{c.manufacturer ?? "—"}</dd>
          <dt>Kategorie</dt><dd>{c.category}{c.family ? ` · ${c.family}` : ""}</dd>
          <dt>Alarmstufe</dt><dd>{ALERT_LABEL[alertLevel]}</dd>
          <dt>Scan-Herkunft</dt>
          <dd>{o.scanOrigin === "OS_INITIATED" ? "Vom Betriebssystem ausgelöster Scan" : o.scanOrigin}</dd>
        </dl>

        <h3>Evidenz</h3>
        {c.evidence.map((e, i) => (
          <article key={i} className="evidence">
            <div className="ev-head">
              <strong>{e.matchType}</strong>
              <span className="muted">{e.source.name} · {e.source.version}</span>
            </div>
            <p>{e.reason}</p>
            <p className="small">
              Zustand: {e.identityState} · Vertrauen: {e.confidence} · Alarmberechtigt: {e.alertEligible ? "ja" : "nein"}
            </p>
            <ul className="limits">
              {e.limitations.map((l, j) => <li key={j}>{l}</li>)}
            </ul>
          </article>
        ))}

        <h3>Regeln</h3>
        {rules.matched.length === 0 ? (
          <p className="muted">Keine Regel trifft zu.</p>
        ) : (
          <ul>
            {rules.matched.map((r) => <li key={r.id}><strong>{r.type}</strong> · {r.name}</li>)}
          </ul>
        )}
        {rules.conflict && (
          <p className="note">Konflikt: Watch und Mute treffen zu. Hervorhebung bleibt, Benachrichtigung ist unterdrückt.</p>
        )}
      </div>
    </dialog>
  );
}
