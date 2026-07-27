import { useCallback, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, type WikiPage, type WikiProposal, type WikiVersion } from "../api";

export function WikiBrowser() {
  const { pageId } = useParams();
  const [params] = useSearchParams();
  const showProposals = params.get("tab") === "proposals";
  const [pages, setPages] = useState<WikiPage[]>([]);
  const [detail, setDetail] = useState<{
    page: WikiPage;
    version?: WikiVersion;
    sourceMemoryIds: string[];
  } | null>(null);
  const [versions, setVersions] = useState<WikiVersion[]>([]);
  const [proposals, setProposals] = useState<WikiProposal[]>([]);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const list = await api.getWikiPages();
      setPages(list.pages);
      if (pageId) {
        const [d, v] = await Promise.all([
          api.getWikiPage(pageId),
          api.getWikiVersions(pageId)
        ]);
        setDetail(d);
        setVersions(v.versions);
      } else {
        setDetail(null);
        setVersions([]);
      }
      if (showProposals) {
        const p = await api.getWikiProposals("proposed");
        setProposals(p.proposals);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [pageId, showProposals]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function approve(id: string) {
    setBusy(true);
    try {
      await api.approveWikiProposal(id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function runLint() {
    setBusy(true);
    try {
      const res = await api.lintWiki(pageId);
      setError(
        res.issues.length
          ? `Lint: ${res.issues.length} issue(s) — ${res.issues[0]?.message}`
          : "Lint clean."
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const compare = compareId ? versions.find((v) => v.versionId === compareId) : null;

  return (
    <div className="stack">
      <div className="page-header">
        <h1>Wiki</h1>
        <p>Governed marketplace knowledge projected from approved memory.</p>
        <p>
          <Link to="/">Dashboard</Link>
          {" · "}
          <Link to="/wiki">All pages</Link>
          {" · "}
          <Link to="/wiki?tab=proposals">Proposals</Link>
          {" · "}
          <Link to="/memory-governor">Memory Governor</Link>
        </p>
        <button type="button" disabled={busy} onClick={() => void runLint()}>
          Run lint
        </button>
      </div>

      {error ? <div className="card error">{error}</div> : null}

      {showProposals ? (
        <section className="card">
          <h2>Update proposals</h2>
          {proposals.length === 0 ? <p className="muted">No open proposals.</p> : null}
          <ul className="plain-list">
            {proposals.map((p) => (
              <li key={p.proposalId}>
                <strong>{p.title}</strong> <span className="muted">{p.status}</span>
                <div className="muted">{p.changeReason}</div>
                <pre className="code-block">{p.proposedContentMarkdown.slice(0, 600)}</pre>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void approve(p.proposalId)}
                >
                  Approve & publish
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!pageId && !showProposals ? (
        <section className="card">
          <h2>Pages</h2>
          <ul className="plain-list">
            {pages.map((p) => (
              <li key={p.pageId}>
                <Link to={`/wiki/pages/${p.pageId}`}>
                  {p.path} — {p.title}
                </Link>{" "}
                <span className="muted">
                  v{p.currentVersionNo ?? "—"} · {p.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {detail ? (
        <>
          <section className="card">
            <h2>{detail.page.title}</h2>
            <p className="muted">
              {detail.page.path} · version {detail.version?.versionNo ?? "—"}
            </p>
            <pre className="code-block">{detail.version?.contentMarkdown ?? "(empty)"}</pre>
            <div className="muted">
              sources: {(detail.sourceMemoryIds ?? []).join(", ") || "—"}
            </div>
          </section>

          <section className="card">
            <h2>Versions</h2>
            <ul className="plain-list">
              {versions.map((v) => (
                <li key={v.versionId}>
                  v{v.versionNo} · {v.createdAt} · {v.changeReason ?? "—"}
                  <button type="button" onClick={() => setCompareId(v.versionId)}>
                    Compare
                  </button>
                </li>
              ))}
            </ul>
            {compare ? (
              <div>
                <h3>Compare v{compare.versionNo}</h3>
                <pre className="code-block">{compare.contentMarkdown}</pre>
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
