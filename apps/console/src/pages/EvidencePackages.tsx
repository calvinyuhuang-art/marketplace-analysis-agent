import { useEffect, useState } from "react";
import { api, type EvidencePackageSummary } from "../api";

/** Evidence package inspector — browse registered packages and coverage. */
export function EvidencePackages() {
  const [packages, setPackages] = useState<EvidencePackageSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<EvidencePackageSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await api.listEvidencePackages();
        if (!cancelled) {
          setPackages(res.packages);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }
    void load();
    const timer = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <div className="grid" data-testid="evidence-packages">
      <section className="card">
        <h2>Evidence packages</h2>
        <p className="muted">
          Packages are registered by the Research Orchestrator. Product and topic always come from
          upstream — this view only inspects evidence coverage.
        </p>
        {error ? <p className="error-text">{error}</p> : null}
        {packages.length === 0 ? (
          <p className="muted">No evidence packages registered yet.</p>
        ) : (
          <ul className="checks">
            {packages.map((p) => (
              <li key={p.packageId}>
                <button
                  type="button"
                  className="linkish"
                  onClick={() => setSelected(p)}
                  data-testid={`pkg-${p.packageId}`}
                >
                  {p.packageId}
                </button>
                <span className="muted">
                  {" "}
                  — {p.itemCount} items · {p.platform}/{p.marketplace}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selected ? (
        <section className="card" data-testid="evidence-package-detail">
          <h2>{selected.packageId}</h2>
          <dl>
            <dt>Items</dt>
            <dd>{selected.itemCount}</dd>
            <dt>Status</dt>
            <dd>{selected.status}</dd>
            <dt>Created</dt>
            <dd>{selected.createdAt}</dd>
          </dl>
          <pre className="output">{JSON.stringify(selected.coverageSummary, null, 2)}</pre>
        </section>
      ) : null}
    </div>
  );
}
