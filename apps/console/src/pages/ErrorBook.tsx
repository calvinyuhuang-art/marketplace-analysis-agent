import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  api,
  type ErrorBookEntry,
  type LessonCandidate,
  type ProceduralRule
} from "../api";

export function ErrorBookPage() {
  const [params] = useSearchParams();
  const projectId = params.get("projectId") ?? undefined;
  const [entries, setEntries] = useState<ErrorBookEntry[]>([]);
  const [lessons, setLessons] = useState<LessonCandidate[]>([]);
  const [rules, setRules] = useState<ProceduralRule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [book, ruleRes] = await Promise.all([
        api.getErrorBook(projectId),
        api.getProceduralRules(projectId)
      ]);
      setEntries(book.entries);
      setRules(ruleRes.rules);
      if (projectId) {
        const lessonRes = await api.getLessons(projectId);
        setLessons(lessonRes.lessons);
      } else {
        setLessons([]);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function approveLesson(lessonId: string) {
    setBusy(lessonId);
    try {
      await api.reviewLesson(lessonId, { action: "approve" });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function approveRule(ruleId: string) {
    setBusy(ruleId);
    try {
      await api.reviewProceduralRule(ruleId, { action: "approve" });
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
        <h1>Error Book</h1>
        <p>
          Governed failure lessons and procedural rules
          {projectId ? (
            <>
              {" "}
              for project <code>{projectId}</code>
            </>
          ) : null}
          .
        </p>
        <p>
          <Link to="/">Dashboard</Link>
          {projectId ? (
            <>
              {" · "}
              <Link to={`/projects/${projectId}/memory`}>Project memory</Link>
            </>
          ) : null}
        </p>
      </div>

      {error ? <div className="card error">{error}</div> : null}

      <section className="card">
        <h2>Entries</h2>
        {entries.length === 0 ? <p className="muted">No Error Book entries yet.</p> : null}
        <ul className="plain-list">
          {entries.map((e) => (
            <li key={e.errorBookEntryId}>
              <strong>{e.title}</strong>{" "}
              <span className="muted">
                {e.errorClass} · {e.recurrenceStatus} · ×{e.occurrenceCount}
              </span>
              <div>{e.correction}</div>
              <div className="muted">
                regression: {e.regressionTestIds.join(", ") || "—"} · rules:{" "}
                {e.linkedProceduralRuleIds.join(", ") || "—"}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {projectId ? (
        <section className="card">
          <h2>Lesson candidates</h2>
          {lessons.length === 0 ? <p className="muted">No lessons for this project.</p> : null}
          <ul className="plain-list">
            {lessons.map((l) => (
              <li key={l.lessonCandidateId}>
                <strong>{l.status}</strong> — {l.proposedRootCause}
                <div>{l.correctiveAction}</div>
                {l.status === "proposed" ? (
                  <button
                    type="button"
                    disabled={busy === l.lessonCandidateId}
                    onClick={() => void approveLesson(l.lessonCandidateId)}
                  >
                    Approve lesson (+ activate rule)
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="card">
        <h2>Procedural rules</h2>
        {rules.length === 0 ? <p className="muted">No procedural rules yet.</p> : null}
        <ul className="plain-list">
          {rules.map((r) => (
            <li key={r.proceduralRuleId}>
              <strong>{r.title}</strong>{" "}
              <span className="muted">
                {r.status}/{r.authority}
              </span>
              <div>{r.statement}</div>
              {r.status === "proposed" ? (
                <button
                  type="button"
                  disabled={busy === r.proceduralRuleId}
                  onClick={() => void approveRule(r.proceduralRuleId)}
                >
                  Approve rule
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
