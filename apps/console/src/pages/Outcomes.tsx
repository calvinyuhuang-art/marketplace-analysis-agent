import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type OutcomeEvent } from "../api";

export function OutcomesPage() {
  const [params] = useSearchParams();
  const projectId = params.get("projectId") ?? "proj_n5_outcomes";
  const [outcomes, setOutcomes] = useState<OutcomeEvent[]>([]);
  const [selected, setSelected] = useState<OutcomeEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await api.listOutcomes(projectId);
      setOutcomes(res.outcomes);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function openOutcome(outcomeId: string) {
    try {
      const detail = await api.getOutcome(outcomeId);
      setSelected(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function reassess(outcomeId: string) {
    setBusy(true);
    try {
      await api.reassessOutcome(outcomeId, { client: "console" });
      await openOutcome(outcomeId);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="page-header">
        <h1>Outcomes</h1>
        <p>
          Real-world outcome events and responsibility-filtered reassessments for project{" "}
          <code>{projectId}</code>.
        </p>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <p className="muted">
        Pass <code>?projectId=…</code> in the URL. Legacy human{" "}
        <Link to="/error-book">outcome reviews</Link> remain separate.
      </p>
      <div className="stack">
        <section>
          <h2>Events</h2>
          {outcomes.length === 0 ? <p className="muted">No outcomes yet.</p> : null}
          <ul>
            {outcomes.map((o) => (
              <li key={o.outcomeId}>
                <button type="button" className="linkish" onClick={() => void openOutcome(o.outcomeId)}>
                  {o.eventType}
                </button>{" "}
                <code>{o.outcomeId}</code>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2>Detail</h2>
          {!selected ? <p className="muted">Select an outcome.</p> : null}
          {selected ? (
            <div className="stack">
              <p>
                <strong>{selected.eventType}</strong> · source {selected.source}
              </p>
              <pre>{JSON.stringify(selected.metrics, null, 2)}</pre>
              <button
                type="button"
                disabled={busy}
                onClick={() => void reassess(selected.outcomeId)}
              >
                {busy ? "Reassessing…" : "Reassess"}
              </button>
              <h3>Reassessments</h3>
              {(selected.reassessments ?? []).length === 0 ? (
                <p className="muted">None yet.</p>
              ) : (
                <ul>
                  {(selected.reassessments ?? []).map((r) => (
                    <li key={r.reassessmentId}>
                      {r.judgments.map((j, i) => (
                        <div key={i}>
                          <code>{j.judgment}</code> — {j.rationale}
                        </div>
                      ))}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
