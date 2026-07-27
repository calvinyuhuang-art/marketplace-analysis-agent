import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type MemoryItem } from "../api";

export function ProjectMemory() {
  const { projectId = "" } = useParams();
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    async function load() {
      try {
        const res = await api.getProjectMemory(projectId);
        if (!cancelled) {
          setItems(res.memory);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (error) {
    return (
      <div className="card error">
        <h2>Memory unavailable</h2>
        <p>{error}</p>
        <Link to="/">Dashboard</Link>
      </div>
    );
  }

  return (
    <div className="grid" data-testid="project-memory">
      <section className="card">
        <h2>Project memory</h2>
        <p className="muted">Project {projectId}</p>
        <p className="muted">
          Active knowledge = reviewed_project / project_working. Rejected items are
          stored but not used as facts.
        </p>
      </section>
      {items.length === 0 ? (
        <section className="card">
          <p className="muted">No memory items yet. Accept findings to promote reviewed knowledge.</p>
        </section>
      ) : (
        items.map((m) => (
          <section className="card" key={m.memoryId} data-testid="memory-item">
            <h3>{m.title}</h3>
            <p>
              <span className="badge">{m.authorityStatus}</span>{" "}
              <span className="badge">{m.memoryType}</span>{" "}
              <span className="muted">confidence {m.confidence}</span>
            </p>
            <p>{m.statement}</p>
            <ul className="checks">
              {m.scopes.map((s) => (
                <li key={`${s.dimension}:${s.value}`}>
                  {s.dimension}={s.value}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
