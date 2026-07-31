import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  api,
  type AnalysisRunResponse,
  type CollectionRequest,
  type FindingReviewReasonCode,
  type ReadinessReport,
  type RunEvent
} from "../api";
import { phaseDisplayLabel } from "../phase-labels";

/**
 * Run Inspector: canonical status, readiness, revision actions, reviewer timeline.
 */
export function RunInspector() {
  const { runId = "" } = useParams();
  const navigate = useNavigate();
  const [run, setRun] = useState<AnalysisRunResponse | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [readiness, setReadiness] = useState<ReadinessReport | null>(null);
  const [collections, setCollections] = useState<CollectionRequest[]>([]);
  const [reviews, setReviews] = useState<
    Array<{
      kind: string;
      action: string;
      reasonCode: string | null;
      notes: string | null;
      reviewerId: string;
      createdAt: string;
      statement?: string;
    }>
  >([]);
  const [diffEntries, setDiffEntries] = useState<
    Array<{ analysisArea: string; change: string; priorStatement?: string; newStatement?: string }>
  >([]);
  const [learning, setLearning] = useState<
    Array<{ eventType: string; reasonCode: string | null; createdAt: string }>
  >([]);
  const [experience, setExperience] = useState<{
    experienceId: string;
    runId: string;
    status: string;
    attempt: number;
    operation: string;
    tokenInput: number;
    tokenOutput: number;
    costUsd: number;
    summary?: string;
    completedAt?: string | null;
  } | null>(null);
  const [evaluations, setEvaluations] = useState<
    Array<{
      evaluationId: string;
      evaluatorType: string;
      decision: string;
      sourceSystem: string;
      sourceRecordId: string;
      createdAt: string;
    }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviseNotes, setReviseNotes] = useState("");
  const [reviseReason, setReviseReason] =
    useState<FindingReviewReasonCode>("missing_analysis");

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;

    async function load() {
      try {
        const [runRes, eventsRes] = await Promise.all([
          api.getRun(runId),
          api.listEvents(runId)
        ]);
        if (cancelled) return;
        setRun(runRes);
        setEvents(eventsRes.events);
        setError(null);

        try {
          const ready = await api.getReadiness(runId);
          if (!cancelled) setReadiness(ready);
        } catch {
          if (!cancelled) setReadiness(null);
        }
        try {
          const cols = await api.getCollectionRequests(runId);
          if (!cancelled) setCollections(cols.collectionRequests);
        } catch {
          if (!cancelled) setCollections([]);
        }
        try {
          const timeline = await api.getReviewTimeline(runId);
          if (!cancelled) setReviews(timeline.reviews);
        } catch {
          if (!cancelled) setReviews([]);
        }
        try {
          const learn = await api.getLearningEvents(runId);
          if (!cancelled) setLearning(learn.learningEvents);
        } catch {
          if (!cancelled) setLearning([]);
        }
        try {
          const exp = await api.getRunExperience(runId);
          if (cancelled) return;
          setExperience(exp);
          try {
            const evals = await api.listExperienceEvaluations(exp.experienceId);
            if (!cancelled) setEvaluations(evals.evaluations);
          } catch {
            if (!cancelled) setEvaluations([]);
          }
        } catch {
          if (!cancelled) {
            setExperience(null);
            setEvaluations([]);
          }
        }
        try {
          const diff = await api.getRevisionDiff(runId);
          if (!cancelled) setDiffEntries(diff.entries);
        } catch {
          if (!cancelled) setDiffEntries([]);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }

    void load();
    const timer = setInterval(load, 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [runId]);

  async function onCancel() {
    if (!runId) return;
    setBusy(true);
    try {
      await api.cancelRun(runId);
      const runRes = await api.getRun(runId);
      setRun(runRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onRevise() {
    if (!runId) return;
    setBusy(true);
    try {
      const res = await api.reviseRun(runId, {
        reasonCode: reviseReason,
        notes: reviseNotes || undefined,
        reviewerId: "operator"
      });
      navigate(`/runs/${res.runId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (error && !run) {
    return (
      <div className="card error">
        <h2>Run not available</h2>
        <p>{error}</p>
        <Link to="/">Back to dashboard</Link>
      </div>
    );
  }

  if (!run) {
    return <p>Loading run…</p>;
  }

  const terminal = ["completed", "partial", "evidence_insufficient", "cancelled", "failed"].includes(
    run.status
  );

  return (
    <div className="grid" data-testid="run-inspector">
      <section className="card">
        <h2>Run status</h2>
        <p>
          <span className={`badge ${terminal ? (run.status === "completed" ? "ok" : "warn") : "ok"}`}>
            {phaseDisplayLabel(run.status)}
          </span>{" "}
          <span className="muted">
            phase: {run.currentPhase ? phaseDisplayLabel(run.currentPhase) : "—"} · attempt{" "}
            {run.attemptNumber}
          </span>
        </p>
        <dl>
          <dt>Run ID</dt>
          <dd data-testid="run-id">{run.runId}</dd>
          <dt>Request ID</dt>
          <dd>{run.requestId}</dd>
          <dt>Project</dt>
          <dd>
            <Link to={`/projects/${run.projectId}/memory`}>{run.projectId}</Link>
            {" · "}
            <Link to={`/error-book?projectId=${encodeURIComponent(run.projectId)}`}>
              Error Book
            </Link>
            {" · "}
            <Link
              to={`/memory-governor?projectId=${encodeURIComponent(run.projectId)}`}
            >
              Memory Governor
            </Link>
          </dd>
          <dt>Prior run</dt>
          <dd>
            {run.priorRunId ? (
              <Link to={`/runs/${run.priorRunId}`}>{run.priorRunId}</Link>
            ) : (
              "—"
            )}
          </dd>
          <dt>Affected areas</dt>
          <dd>{run.affectedAreas?.join(", ") || "—"}</dd>
          <dt>Correlation</dt>
          <dd>{run.correlationId ?? "—"}</dd>
          <dt>Completed</dt>
          <dd>{run.completedAt ?? "—"}</dd>
        </dl>
        {!terminal ? (
          <div className="btn-row">
            <button disabled={busy} onClick={() => void onCancel()} data-testid="cancel-run">
              Cancel run
            </button>
          </div>
        ) : null}
        {run.failureMessage ? <p className="error-text">{run.failureMessage}</p> : null}
        {terminal ? (
          <p>
            <Link to={`/runs/${run.runId}/findings`} data-testid="open-finding-review">
              Open Finding Review
            </Link>
          </p>
        ) : null}
      </section>

      {terminal ? (
        <section className="card" data-testid="revise-panel">
          <h2>Request revision</h2>
          <p className="muted">
            Starts a new run linked to this prior output. Prior findings stay immutable.
          </p>
          <div className="form">
            <label>
              Reason
              <select
                value={reviseReason}
                onChange={(e) => setReviseReason(e.target.value as FindingReviewReasonCode)}
                data-testid="revise-reason"
              >
                <option value="unsupported_conclusion">unsupported_conclusion</option>
                <option value="incorrect_evidence_interpretation">
                  incorrect_evidence_interpretation
                </option>
                <option value="missing_analysis">missing_analysis</option>
                <option value="wrong_scope">wrong_scope</option>
                <option value="stale_memory_or_evidence">stale_memory_or_evidence</option>
                <option value="contradiction_ignored">contradiction_ignored</option>
                <option value="confidence_miscalibrated">confidence_miscalibrated</option>
                <option value="other">other</option>
              </select>
            </label>
            <label>
              Notes
              <textarea
                value={reviseNotes}
                onChange={(e) => setReviseNotes(e.target.value)}
                rows={2}
                data-testid="revise-notes"
              />
            </label>
            <div className="btn-row">
              <button disabled={busy} onClick={() => void onRevise()} data-testid="submit-revise">
                Start revision
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <section className="card" data-testid="experience-panel">
        <h2>Experience</h2>
        {experience ? (
          <>
            <p>
              <span className={`badge ${experience.status === "completed" ? "ok" : "warn"}`}>
                {experience.status}
              </span>{" "}
              <span className="muted">
                attempt {experience.attempt} · {experience.operation}
              </span>
            </p>
            <dl>
              <dt>Experience ID</dt>
              <dd data-testid="experience-id">{experience.experienceId}</dd>
              <dt>Tokens</dt>
              <dd>
                in {experience.tokenInput} / out {experience.tokenOutput}
              </dd>
              <dt>Cost (USD)</dt>
              <dd>{experience.costUsd}</dd>
              <dt>Completed</dt>
              <dd>{experience.completedAt ?? "—"}</dd>
              <dt>Summary</dt>
              <dd>{experience.summary ?? "—"}</dd>
            </dl>
            {evaluations.length > 0 ? (
              <>
                <h3>Evaluations</h3>
                <ul className="checks" data-testid="experience-evaluations">
                  {evaluations.map((e) => (
                    <li key={e.evaluationId}>
                      <strong>{e.evaluatorType}</strong> · {e.decision}
                      <div className="muted">
                        {e.sourceSystem} · {e.sourceRecordId}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="muted">No evaluations yet.</p>
            )}
          </>
        ) : (
          <p className="muted">Experience not captured yet.</p>
        )}
      </section>

      <section className="card" data-testid="readiness-drill-in">
        <h2>Evidence readiness</h2>
        {readiness ? (
          <>
            <p>
              <span className={`badge ${readiness.overallStatus === "ready" ? "ok" : "warn"}`}>
                {readiness.overallStatus}
              </span>
            </p>
            <ul className="checks">
              {readiness.areas.map((a) => (
                <li key={a.area}>
                  <span className={`dot ${a.allowedOutputLevel === "none" ? "warn" : "ok"}`} />
                  {a.area}: {a.status} (score {a.score})
                  {a.gaps.length > 0 ? (
                    <div className="muted">{a.gaps.map((g) => g.description).join(" ")}</div>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="muted">Readiness not evaluated yet.</p>
        )}
      </section>

      <section className="card" data-testid="collection-requests">
        <h2>Collection requests</h2>
        {collections.length > 0 ? (
          <ul className="checks">
            {collections.map((c) => (
              <li key={c.collectionRequestId}>
                <strong>{c.priority}</strong> — {c.analysisAreasBlocked.join(", ")}
                <div className="muted">{c.reason}</div>
                <div className="muted">Need: {c.requiredEvidence.join(", ")}</div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No supplemental collection requests.</p>
        )}
      </section>

      {diffEntries.length > 0 ? (
        <section className="card" data-testid="revision-diff">
          <h2>Revision diff</h2>
          <ul className="checks">
            {diffEntries.map((e, i) => (
              <li key={`${e.analysisArea}-${i}`}>
                <strong>{e.change}</strong> · {e.analysisArea}
                {e.priorStatement ? <div className="muted">before: {e.priorStatement}</div> : null}
                {e.newStatement ? <div className="muted">after: {e.newStatement}</div> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="card" data-testid="reviewer-timeline">
        <h2>Reviewer timeline</h2>
        {reviews.length > 0 ? (
          <ol className="timeline">
            {reviews.map((r, i) => (
              <li key={`${r.createdAt}-${i}`}>
                <div className="timeline-time">{new Date(r.createdAt).toLocaleTimeString()}</div>
                <div>
                  <strong>
                    {r.kind}: {r.action}
                  </strong>
                  {r.reasonCode ? <span className="muted"> · {r.reasonCode}</span> : null}
                  {r.statement ? <div className="muted">{r.statement}</div> : null}
                  {r.notes ? <div className="muted">{r.notes}</div> : null}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">No reviews yet.</p>
        )}
        {learning.length > 0 ? (
          <>
            <h3>Learning events</h3>
            <ul className="checks" data-testid="learning-events">
              {learning.map((e, i) => (
                <li key={`${e.createdAt}-${i}`}>
                  {e.eventType}
                  {e.reasonCode ? ` (${e.reasonCode})` : ""}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>

      <section className="card" data-testid="run-timeline">
        <h2>Timeline</h2>
        <ol className="timeline">
          {events.map((e) => (
            <li key={e.eventId}>
              <div className="timeline-time">{new Date(e.createdAt).toLocaleTimeString()}</div>
              <div>
                <strong>{e.eventType}</strong>
                {e.fromStatus || e.toStatus ? (
                  <span className="muted">
                    {" "}
                    {e.fromStatus ?? "—"} → {e.toStatus ?? "—"}
                  </span>
                ) : null}
                {e.phase ? <div className="muted">phase: {e.phase}</div> : null}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
