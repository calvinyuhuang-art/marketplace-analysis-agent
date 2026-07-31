import { useCallback, useEffect, useState } from "react";
import { api, type LearningPlaneStatus } from "../api";

export function LearningPlaneStatusPage() {
  const [status, setStatus] = useState<LearningPlaneStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const next = await api.learningPlaneStatus();
      setStatus(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [load]);

  if (loading) {
    return <p data-testid="lp-loading">Loading Learning Plane adapter status…</p>;
  }

  if (error) {
    return (
      <div className="card error" data-testid="lp-error">
        <h2>Learning Plane status unavailable</h2>
        <p>{error}</p>
      </div>
    );
  }

  if (!status) return null;

  return (
    <div className="grid" data-testid="learning-plane-status">
      <section className="card" aria-labelledby="lp-status-heading">
        <h2 id="lp-status-heading">Learning Plane Adapter</h2>
        <p className="muted">
          Milestone {status.implementationMilestone}. Learning Plane is a side channel and is not
          required for MAA operational availability.
        </p>
        <dl className="kv">
          <div>
            <dt>Adapter enabled</dt>
            <dd>{String(status.enabled)}</dd>
          </div>
          <div>
            <dt>Adapter state</dt>
            <dd>
              <span
                className={`badge ${
                  status.adapterState === "enabled"
                    ? "ok"
                    : status.adapterState === "disabled"
                      ? "warn"
                      : "warn"
                }`}
              >
                {status.adapterState}
              </span>
            </dd>
          </div>
          <div>
            <dt>Agent ID</dt>
            <dd>{status.agentId}</dd>
          </div>
          <div>
            <dt>Registration</dt>
            <dd>{status.registrationStatus}</dd>
          </div>
          <div>
            <dt>Credential ID</dt>
            <dd>{status.credentialId ?? "—"}</dd>
          </div>
          <div>
            <dt>Callback-key ID</dt>
            <dd>{status.callbackKeyId ?? "—"}</dd>
          </div>
          <div>
            <dt>Declared capabilities</dt>
            <dd>{status.declaredCapabilities.join(", ") || "none"}</dd>
          </div>
          <div>
            <dt>Learning Plane base URL</dt>
            <dd>{status.learningPlaneBaseUrl}</dd>
          </div>
          <div>
            <dt>LP API compatibility</dt>
            <dd>
              {status.learningPlaneApiCompatibility ?? "unknown"} (required{" "}
              {status.requiredLearningPlaneApiCompatibility})
            </dd>
          </div>
          <div>
            <dt>Last health report</dt>
            <dd>{status.lastHealthReportAt ?? "—"}</dd>
          </div>
          <div>
            <dt>Last successful connection</dt>
            <dd>{status.lastSuccessfulConnectionAt ?? "—"}</dd>
          </div>
          <div>
            <dt>Publish flag</dt>
            <dd>
              {String(status.publishEnabled)} ({status.publishMode})
            </dd>
          </div>
          <div>
            <dt>Receive flag</dt>
            <dd>
              {String(status.receiveEnabled)} ({status.receiveMode})
            </dd>
          </div>
          <div>
            <dt>Outbox counts</dt>
            <dd>{JSON.stringify(status.outboxCounts)}</dd>
          </div>
          <div>
            <dt>Inbox counts</dt>
            <dd>{JSON.stringify(status.inboxCounts)}</dd>
          </div>
          <div>
            <dt>Ack counts</dt>
            <dd data-testid="lp-ack-counts">
              {JSON.stringify(status.acknowledgementCounts ?? {})}
            </dd>
          </div>
          <div>
            <dt>Waiting for causation</dt>
            <dd data-testid="lp-waiting-causation">
              {status.waitingForCausationCount ?? 0}
            </dd>
          </div>
          <div>
            <dt>Awaiting local reconciliation</dt>
            <dd data-testid="lp-awaiting-local">
              {status.awaitingLocalReconciliationCount ?? 0}
            </dd>
          </div>
          <div>
            <dt>Semantic conflicts</dt>
            <dd data-testid="lp-semantic-conflicts">
              {status.semanticConflictCount ?? 0}
            </dd>
          </div>
          <div>
            <dt>Oldest pending age (s)</dt>
            <dd>{status.oldestPendingAgeSeconds ?? "—"}</dd>
          </div>
          <div>
            <dt>Last successful publish</dt>
            <dd>{status.lastSuccessfulPublishAt ?? "—"}</dd>
          </div>
          <div>
            <dt>Last successful receive</dt>
            <dd>{status.lastSuccessfulReceiveAt ?? "—"}</dd>
          </div>
          <div>
            <dt>Last successful acknowledgement</dt>
            <dd>{status.lastSuccessfulAcknowledgementAt ?? "—"}</dd>
          </div>
          <div>
            <dt>Last bounded error</dt>
            <dd>{status.boundedDiagnostic ?? status.lastErrorCode ?? "—"}</dd>
          </div>
          <div>
            <dt>Secrets present</dt>
            <dd>{String(status.secretsPresent)}</dd>
          </div>
          <div>
            <dt>LP client package</dt>
            <dd>
              {status.packageIdentity
                ? `${status.packageIdentity.clientVersion} / contracts ${status.packageIdentity.contractsVersion} / api ${status.packageIdentity.apiCompat}`
                : "—"}
            </dd>
          </div>
          <div>
            <dt>Released WF payloads</dt>
            <dd>
              {status.packageIdentity?.releasedWorkflowFeedbackPayloadVersions
                ? JSON.stringify(status.packageIdentity.releasedWorkflowFeedbackPayloadVersions)
                : "—"}
            </dd>
          </div>
          <div>
            <dt>LP package checksum (client)</dt>
            <dd>{status.packageIdentity?.packageChecksum.client ?? "—"}</dd>
          </div>
          <div>
            <dt>Governance bridge flags</dt>
            <dd data-testid="lp-bridge-flags">
              {status.bridgeFlags
                ? JSON.stringify(status.bridgeFlags)
                : "unavailable (defaults off)"}
            </dd>
          </div>
          <div>
            <dt>Approval semantics</dt>
            <dd>Approval does not activate. Replay eligibility does not activate.</dd>
          </div>
          <div>
            <dt>Published-knowledge notices</dt>
            <dd data-testid="lp-pk-notices">
              Discovery does not mean adoption. Local reference is not MAA memory.
              External text is untrusted. Publication never activates rules.
            </dd>
          </div>
          <div>
            <dt>Published-knowledge bridge</dt>
            <dd data-testid="lp-pk-status">
              {status.publishedKnowledge
                ? JSON.stringify(status.publishedKnowledge)
                : status.bridgeFlags?.publicationBridgeEnabled != null
                  ? `enabled=${String(status.bridgeFlags.publicationBridgeEnabled)}`
                  : "defaults off"}
            </dd>
          </div>
        </dl>
      </section>
      <section className="card" data-testid="lp-notes">
        <h2>Learning Plane notes</h2>
        <ul>
          {status.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </section>
      <div>
        <button type="button" onClick={() => void load()}>
          Refresh status
        </button>
      </div>
    </div>
  );
}
