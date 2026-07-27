import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  api,
  type Finding,
  type FindingReviewAction,
  type FindingReviewReasonCode,
  type QualityReport
} from "../api";

const ACTIONS: FindingReviewAction[] = [
  "accept",
  "reject",
  "request_revision",
  "mark_contested"
];

const REASONS: FindingReviewReasonCode[] = [
  "unsupported_conclusion",
  "incorrect_evidence_interpretation",
  "missing_analysis",
  "wrong_scope",
  "stale_memory_or_evidence",
  "contradiction_ignored",
  "confidence_miscalibrated",
  "other"
];

/**
 * Finding Review: one finding at a time with evidence refs and review actions.
 */
export function FindingReview() {
  const { runId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [findings, setFindings] = useState<Finding[]>([]);
  const [quality, setQuality] = useState<QualityReport | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [action, setAction] = useState<FindingReviewAction>("accept");
  const [reasonCode, setReasonCode] = useState<FindingReviewReasonCode | "">("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    async function load() {
      try {
        const [findingsRes, outputRes] = await Promise.all([
          api.getFindings(runId),
          api.getOutput(runId).catch(() => null)
        ]);
        if (cancelled) return;
        setFindings(findingsRes.findings);
        if (outputRes) {
          setSummary(outputRes.output?.summary ?? outputRes.summary ?? null);
          setQuality(outputRes.quality ?? null);
        }
        const q = searchParams.get("i");
        const parsed = q ? Number(q) : 0;
        setIndex(
          Number.isFinite(parsed)
            ? Math.min(Math.max(0, parsed), Math.max(0, findingsRes.findings.length - 1))
            : 0
        );
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [runId, searchParams]);

  const finding = findings[index];

  function go(next: number) {
    const clamped = Math.min(Math.max(0, next), Math.max(0, findings.length - 1));
    setIndex(clamped);
    setSearchParams({ i: String(clamped) });
    setMessage(null);
  }

  async function submitReview() {
    if (!finding) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await api.reviewFinding(finding.findingId, {
        action,
        reasonCode: reasonCode || undefined,
        notes: notes || undefined,
        reviewerId: "operator"
      });
      setFindings((prev) =>
        prev.map((f) =>
          f.findingId === finding.findingId
            ? { ...f, validationStatus: res.validationStatus }
            : f
        )
      );
      setMessage(`Review saved: ${res.action} → ${res.validationStatus}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (error && findings.length === 0) {
    return (
      <div className="card error">
        <h2>Findings unavailable</h2>
        <p>{error}</p>
        <Link to={`/runs/${runId}`}>Back to run</Link>
      </div>
    );
  }

  return (
    <div className="grid" data-testid="finding-review">
      <section className="card">
        <h2>Finding Review</h2>
        <p className="muted">
          Run <Link to={`/runs/${runId}`}>{runId}</Link>
          {summary ? <> — {summary}</> : null}
        </p>
        {quality ? (
          <p>
            Quality:{" "}
            <span className={`badge ${quality.passed ? "ok" : "warn"}`}>
              {quality.passed ? "passed" : "failed"} ({quality.score})
            </span>
          </p>
        ) : null}
        {findings.length === 0 ? (
          <p className="muted">No accepted findings for this run yet.</p>
        ) : (
          <p>
            Finding {index + 1} of {findings.length}
          </p>
        )}
        <div className="btn-row">
          <button disabled={!finding || index <= 0} onClick={() => go(index - 1)}>
            Previous
          </button>
          <button
            disabled={!finding || index >= findings.length - 1}
            onClick={() => go(index + 1)}
          >
            Next
          </button>
        </div>
      </section>

      {finding ? (
        <>
          <section className="card" data-testid="finding-card">
            <h2>{finding.analysisArea}</h2>
            <p>
              <span className="badge ok">{finding.classification}</span>{" "}
              <span className="badge">{finding.validationStatus}</span>{" "}
              <span className="muted">confidence {finding.confidence}</span>
            </p>
            <p data-testid="finding-statement">{finding.statement}</p>
            <h3>Evidence refs</h3>
            <ul className="checks">
              {finding.evidenceRefs.map((ref) => (
                <li key={ref}>{ref}</li>
              ))}
            </ul>
            {finding.downstreamImplications.length > 0 ? (
              <>
                <h3>Implications</h3>
                <ul className="checks">
                  {finding.downstreamImplications.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>

          <section className="card">
            <h2>Review action</h2>
            <div className="form">
            <label>
              Action
              <select
                value={action}
                onChange={(e) => setAction(e.target.value as FindingReviewAction)}
                data-testid="review-action"
              >
                {ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Reason code
              <select
                value={reasonCode}
                onChange={(e) =>
                  setReasonCode(e.target.value as FindingReviewReasonCode | "")
                }
                data-testid="review-reason"
              >
                <option value="">(optional)</option>
                {REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Notes
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                data-testid="review-notes"
              />
            </label>
            <div className="btn-row">
              <button
                disabled={busy}
                onClick={() => void submitReview()}
                data-testid="submit-review"
              >
                Save review
              </button>
            </div>
            </div>
            {message ? <p className="ok-text">{message}</p> : null}
            {error ? <p className="error-text">{error}</p> : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
