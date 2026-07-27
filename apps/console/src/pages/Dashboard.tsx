import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  type AnalysisRunResponse,
  type CapabilitySummary,
  type HealthResponse,
  type ModelProfileSummary,
  type ReadinessResponse
} from "../api";

interface DashboardState {
  loading: boolean;
  error?: string;
  health?: HealthResponse;
  readiness?: ReadinessResponse;
  capabilities?: CapabilitySummary[];
  profiles?: ModelProfileSummary[];
  runs?: AnalysisRunResponse[];
}

export function Dashboard() {
  const [state, setState] = useState<DashboardState>({ loading: true });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [health, readiness, capabilities, profiles, runs] = await Promise.all([
          api.health(),
          api.ready(),
          api.capabilities(),
          api.modelProfiles(),
          api.listRuns()
        ]);
        if (!cancelled) {
          setState({
            loading: false,
            health,
            readiness,
            capabilities: capabilities.capabilities,
            profiles: profiles.profiles,
            runs: runs.runs
          });
        }
      } catch (err) {
        if (!cancelled) {
          setState({ loading: false, error: err instanceof Error ? err.message : String(err) });
        }
      }
    }
    void load();
    const timer = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (state.loading) {
    return <p data-testid="loading">Loading service status…</p>;
  }

  if (state.error) {
    return (
      <div className="card error" data-testid="service-error">
        <h2>Service unreachable</h2>
        <p>{state.error}</p>
        <p className="muted">Expected API at {api.base}</p>
      </div>
    );
  }

  return (
    <div className="grid">
      <section className="card" data-testid="health-card">
        <h2>Service Health</h2>
        <p>
          <span className={`badge ${state.health?.status === "ok" ? "ok" : "warn"}`}>
            {state.health?.status}
          </span>
        </p>
        <dl>
          <dt>Service</dt>
          <dd>{state.health?.service}</dd>
          <dt>Version</dt>
          <dd>{state.health?.version}</dd>
          <dt>Uptime</dt>
          <dd>{Math.round(state.health?.uptimeSeconds ?? 0)}s</dd>
        </dl>
      </section>

      <section className="card" data-testid="readiness-card">
        <h2>Readiness</h2>
        <p>
          <span className={`badge ${state.readiness?.ready ? "ok" : "warn"}`}>
            {state.readiness?.ready ? "ready" : "not ready"}
          </span>
        </p>
        <ul className="checks">
          {state.readiness?.checks.map((c) => (
            <li key={c.name}>
              <span className={`dot ${c.ok ? "ok" : "warn"}`} /> {c.name}
              {c.detail ? <span className="muted"> — {c.detail}</span> : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="card" data-testid="recent-runs-card">
        <h2>Recent runs</h2>
        {state.runs && state.runs.length > 0 ? (
          <ul className="checks">
            {state.runs.slice(0, 8).map((r) => (
              <li key={r.runId}>
                <Link to={`/runs/${r.runId}`}>{r.runId}</Link>
                <span className="muted">
                  {" "}
                  — {r.status} / {r.currentPhase ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">
            No runs yet.{" "}
            <Link to="/new-analysis">Create an analysis request</Link>
          </p>
        )}
      </section>

      <section className="card" data-testid="capabilities-card">
        <h2>Capabilities</h2>
        {state.capabilities?.map((cap) => (
          <div key={cap.id} className="cap">
            <strong>{cap.id}</strong> <span className="muted">v{cap.version}</span>
            <div className="muted">
              {cap.platform} / {cap.marketplace} / {cap.category} / {cap.productType}
            </div>
            <div className="tags">
              {cap.supportedAnalysisAreas.map((a) => (
                <span key={a} className="tag">
                  {a}
                </span>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="card" data-testid="profiles-card">
        <h2>Model Profiles</h2>
        <ul className="checks">
          {state.profiles?.map((p) => (
            <li key={p.id}>
              <span className={`dot ${p.enabled ? "ok" : "warn"}`} /> {p.id}
              <span className="muted">
                {" "}
                — {p.provider}/{p.model}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
