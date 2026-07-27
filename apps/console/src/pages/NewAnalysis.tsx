import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, type CapabilitySummary } from "../api";

/**
 * Structured New Analysis form only — no free-form prompt box.
 * Product name, goal, and analysis areas come from the operator/upstream;
 * capability coordinates are chosen from registered packs.
 */
export function NewAnalysis() {
  const navigate = useNavigate();
  const [capabilities, setCapabilities] = useState<CapabilitySummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [projectId, setProjectId] = useState("");
  const [productName, setProductName] = useState("");
  const [salesGoal, setSalesGoal] = useState("");
  const [description, setDescription] = useState("");
  const [operation, setOperation] = useState("full_marketplace_analysis");
  const [question, setQuestion] = useState("");
  const [evidencePackageIds, setEvidencePackageIds] = useState("evpkg_placeholder_1");
  const [selectedAreas, setSelectedAreas] = useState<string[]>([
    "market_structure",
    "pricing"
  ]);
  const [capabilityId, setCapabilityId] = useState("");

  useEffect(() => {
    void api.capabilities().then((res) => {
      setCapabilities(res.capabilities);
      if (res.capabilities[0]) setCapabilityId(res.capabilities[0].id);
    });
  }, []);

  const selectedCapability = useMemo(
    () => capabilities.find((c) => c.id === capabilityId) ?? capabilities[0],
    [capabilities, capabilityId]
  );

  function toggleArea(area: string) {
    setSelectedAreas((prev) =>
      prev.includes(area) ? prev.filter((a) => a !== area) : [...prev, area]
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedCapability) {
      setError("No capability pack available.");
      return;
    }
    if (!productName.trim() || !salesGoal.trim()) {
      setError("Product name and sales goal are required (from upstream / operator).");
      return;
    }
    if (selectedAreas.length === 0) {
      setError("Select at least one analysis area.");
      return;
    }
    const ids = evidencePackageIds
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length === 0) {
      setError("Provide at least one evidence package ID.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await api.createAnalysis({
        client: "operator-console",
        projectId: projectId.trim() || `proj_${Date.now().toString(36)}`,
        operation,
        capability: {
          platform: selectedCapability.platform,
          marketplace: selectedCapability.marketplace,
          category: selectedCapability.category,
          productType: selectedCapability.productType
        },
        productContext: {
          name: productName.trim(),
          description: description.trim() || undefined,
          salesGoal: salesGoal.trim(),
          constraints: []
        },
        requestedAnalysis: selectedAreas,
        question: operation === "focused_analysis_question" ? question.trim() : undefined,
        evidencePackageIds: ids
      });
      navigate(`/runs/${result.runId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" data-testid="new-analysis">
      <h2>New Analysis</h2>
      <p className="muted">
        Structured request only. Product, goal, and evidence references must come from upstream /
        the operator — nothing is assumed.
      </p>

      <form className="form" onSubmit={onSubmit}>
        <label>
          Capability pack
          <select
            value={selectedCapability?.id ?? ""}
            onChange={(e) => setCapabilityId(e.target.value)}
          >
            {capabilities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id} (v{c.version})
              </option>
            ))}
          </select>
        </label>

        <label>
          Operation
          <select value={operation} onChange={(e) => setOperation(e.target.value)}>
            {(selectedCapability?.supportedOperations ?? []).map((op) => (
              <option key={op} value={op}>
                {op}
              </option>
            ))}
          </select>
        </label>

        {operation === "focused_analysis_question" ? (
          <label>
            Focused question
            <input value={question} onChange={(e) => setQuestion(e.target.value)} required />
          </label>
        ) : null}

        <label>
          Project ID (optional — generated if empty)
          <input
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            placeholder="proj_..."
          />
        </label>

        <label>
          Product name
          <input
            data-testid="product-name"
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            required
          />
        </label>

        <label>
          Sales goal
          <input
            data-testid="sales-goal"
            value={salesGoal}
            onChange={(e) => setSalesGoal(e.target.value)}
            required
          />
        </label>

        <label>
          Description (optional)
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </label>

        <fieldset>
          <legend>Analysis areas</legend>
          <div className="tags">
            {(selectedCapability?.supportedAnalysisAreas ?? []).map((area) => (
              <label key={area} className="tag check">
                <input
                  type="checkbox"
                  checked={selectedAreas.includes(area)}
                  onChange={() => toggleArea(area)}
                />
                {area}
              </label>
            ))}
          </div>
        </fieldset>

        <label>
          Evidence package IDs (comma-separated)
          <input
            value={evidencePackageIds}
            onChange={(e) => setEvidencePackageIds(e.target.value)}
            required
          />
        </label>

        {error ? (
          <p className="error-text" data-testid="form-error">
            {error}
          </p>
        ) : null}

        <div className="btn-row">
          <button type="submit" disabled={busy} data-testid="submit-analysis">
            {busy ? "Submitting…" : "Submit analysis request"}
          </button>
        </div>
      </form>
    </div>
  );
}
