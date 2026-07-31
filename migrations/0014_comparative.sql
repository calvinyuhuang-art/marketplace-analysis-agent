-- Migration 0014: Comparative analysis baseline package ids (N6).

ALTER TABLE analysis_requests ADD COLUMN baseline_evidence_package_ids_json TEXT NOT NULL DEFAULT '[]';
