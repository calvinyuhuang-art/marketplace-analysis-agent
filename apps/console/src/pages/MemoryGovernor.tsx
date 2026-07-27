import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type MemoryProposal, type ReusableMemoryItem } from "../api";

export function MemoryGovernor() {
  const [params] = useSearchParams();
  const projectId = params.get("projectId") ?? undefined;
  const [proposals, setProposals] = useState<MemoryProposal[]>([]);
  const [reusable, setReusable] = useState<ReusableMemoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [p, r] = await Promise.all([
        api.getMemoryProposals(projectId),
        api.getReusableMemory({
          platform: "amazon",
          marketplace: "US",
          category: "books",
          productType: "adult_coloring_book"
        })
      ]);
      setProposals(p.proposals);
      setReusable(r.memory);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function review(proposalId: string, action: "approve" | "reject") {
    setBusy(proposalId);
    try {
      await api.reviewMemoryProposal(proposalId, { action });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack">
      <div className="page-header">
        <h1>Memory Governor</h1>
        <p>
          Approve reusable category memory. Analysis acceptance never promotes
          knowledge here.
          {projectId ? (
            <>
              {" "}
              Filter: <code>{projectId}</code>
            </>
          ) : null}
        </p>
        <p>
          <Link to="/">Dashboard</Link>
          {" · "}
          <Link to="/error-book">Error Book</Link>
        </p>
      </div>

      {error ? <div className="card error">{error}</div> : null}

      <section className="card">
        <h2>Proposals</h2>
        {proposals.length === 0 ? <p className="muted">No proposals yet.</p> : null}
        <ul className="plain-list">
          {proposals.map((p) => (
            <li key={p.proposalId}>
              <strong>{p.title}</strong>{" "}
              <span className="muted">
                {p.status} · conf {p.confidence.toFixed(2)}
              </span>
              <div>{p.statement}</div>
              <div className="muted">reason: {p.reason}</div>
              {p.conflicts.length > 0 ? (
                <div className="muted">
                  conflicts:{" "}
                  {p.conflicts
                    .map((c) => `${c.relation}(${c.score}) → ${c.memoryId}`)
                    .join("; ")}
                </div>
              ) : (
                <div className="muted">conflicts: none</div>
              )}
              <div className="muted">
                scopes:{" "}
                {p.scopes.map((s) => `${s.dimension}=${s.value}`).join(", ") || "—"}
              </div>
              {p.status === "proposed" ? (
                <div className="row-actions">
                  <button
                    type="button"
                    disabled={busy === p.proposalId}
                    onClick={() => void review(p.proposalId, "approve")}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={busy === p.proposalId}
                    onClick={() => void review(p.proposalId, "reject")}
                  >
                    Reject
                  </button>
                </div>
              ) : null}
              {p.resultingMemoryId ? (
                <div className="muted">memory: {p.resultingMemoryId}</div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Active reusable memory</h2>
        {reusable.length === 0 ? (
          <p className="muted">No approved reusable category memory.</p>
        ) : null}
        <ul className="plain-list">
          {reusable.map((m) => (
            <li key={m.memoryId}>
              <strong>{m.title}</strong>{" "}
              <span className="muted">
                support×{m.supportCount} · contradict×{m.contradictionCount}
              </span>
              <div>{m.statement}</div>
              <div className="muted">
                {m.scopes.map((s) => `${s.dimension}=${s.value}`).join(", ")}
                {m.validUntil ? ` · until ${m.validUntil}` : ""}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
