import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { App } from "./App";
import { Dashboard } from "./pages/Dashboard";
import { ErrorBookPage } from "./pages/ErrorBook";
import { EvidencePackages } from "./pages/EvidencePackages";
import { FindingReview } from "./pages/FindingReview";
import { WikiBrowser } from "./pages/WikiBrowser";
import { MemoryGovernor } from "./pages/MemoryGovernor";
import { NewAnalysis } from "./pages/NewAnalysis";
import { ProjectMemory } from "./pages/ProjectMemory";
import { RunInspector } from "./pages/RunInspector";
import { TestConsole } from "./pages/TestConsole";
import "./styles.css";

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: "new-analysis", element: <NewAnalysis /> },
      { path: "evidence", element: <EvidencePackages /> },
      { path: "runs/:runId", element: <RunInspector /> },
      { path: "runs/:runId/findings", element: <FindingReview /> },
      { path: "projects/:projectId/memory", element: <ProjectMemory /> },
      { path: "error-book", element: <ErrorBookPage /> },
      { path: "memory-governor", element: <MemoryGovernor /> },
      { path: "wiki", element: <WikiBrowser /> },
      { path: "wiki/pages/:pageId", element: <WikiBrowser /> },
      { path: "test-console", element: <TestConsole /> }
    ]
  }
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
