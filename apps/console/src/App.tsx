import { NavLink, Outlet } from "react-router-dom";

export function App() {
  return (
    <div className="layout">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">MAA</span>
          <span className="brand-title">Marketplace Analysis Agent — Operator Console</span>
        </div>
        <nav className="nav">
          <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>
            Dashboard
          </NavLink>
          <NavLink
            to="/new-analysis"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            New Analysis
          </NavLink>
          <NavLink
            to="/evidence"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            Evidence
          </NavLink>
          <NavLink
            to="/error-book"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            Error Book
          </NavLink>
          <NavLink
            to="/outcomes"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            Outcomes
          </NavLink>
          <NavLink
            to="/memory-governor"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            Memory Governor
          </NavLink>
          <NavLink to="/wiki" className={({ isActive }) => (isActive ? "active" : "")}>
            Wiki
          </NavLink>
          <NavLink
            to="/learning-plane"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            Learning Plane
          </NavLink>
          <NavLink
            to="/test-console"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            Test Console
          </NavLink>
        </nav>
      </header>
      <main className="content">
        <Outlet />
      </main>
      <footer className="footer">Local-first · V1 · constrained analysis service</footer>
    </div>
  );
}
