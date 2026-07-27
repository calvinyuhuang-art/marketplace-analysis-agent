import { useState } from "react";
import { api } from "../api";

/**
 * Test Console shell (M0). In later milestones this runs predefined fake-provider
 * fixtures. For now it exercises the read-only diagnostic endpoints only — there
 * is deliberately no free-form prompt box.
 */
export function TestConsole() {
  const [output, setOutput] = useState<string>("");
  const [busy, setBusy] = useState(false);

  async function probe(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      const result = await fn();
      setOutput(JSON.stringify(result, null, 2));
    } catch (err) {
      setOutput(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" data-testid="test-console">
      <h2>Test Console</h2>
      <p className="muted">
        Predefined diagnostic probes only. Fixture-driven analysis scenarios arrive in later
        milestones. No arbitrary prompt execution.
      </p>
      <div className="btn-row">
        <button disabled={busy} onClick={() => probe(api.health)}>
          Probe /health
        </button>
        <button disabled={busy} onClick={() => probe(api.ready)}>
          Probe /ready
        </button>
        <button disabled={busy} onClick={() => probe(api.capabilities)}>
          Probe /v1/capabilities
        </button>
      </div>
      <pre className="output" data-testid="test-output">
        {output || "No probe run yet."}
      </pre>
    </div>
  );
}
