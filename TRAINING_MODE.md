# FLTract Training Mode

Version 0.1 — 2026-10-05

Training Mode reuses FLTract's safe simulation layer to teach staff without changing production records. Training actions cannot update production clients, properties, inquiries, reports, assignments, permissions, communications, or workflows.

## Core records

Training Scenario: scenario key, name, module, target role, difficulty, version, status, learning objectives, starting state, expected actions, prohibited actions, passing score, author and publication metadata.

Training Session: scenario/version, trainee, simulated state, actions, status, score, explainable feedback, timestamps and manager review.

Training Competency: staff member, competency, module, scenario/version, result, score, demonstrated date and reviewer. Competency can recommend readiness but never grants production permissions automatically.

## Evaluation

Scenarios evaluate required steps, correct sequence where material, required approvals, omissions, prohibited actions, conflict handling, escalation and documentation quality.

## Initial Real Estate scenarios

### RE-001 — New Property Intake
Verify client linkage; inspect property information; recognize missing parcel ID; request authoritative validation; confirm mini-comp/research queue; route for review; never invent missing data.

### RE-002 — Conflicting Parcel Information
Recognize conflicting submitted and authoritative data; preserve both values and provenance; use Data Integrity review; document resolution. Never silently overwrite a conflict.

### RE-003 — Possible Duplicate Client
Recognize duplicate signals, compare records and escalate a possible merge. Never automatically merge or delete either record.

### RE-004 — Referral Approval
Manager reviews recipient, message and contact/compliance status before approval. Sending without required approval is prohibited.

### RE-005 — Mini-Comp Quality Review
Review sources, comparable selection and limitations; approve, reject or return for research. Insufficient data cannot be represented as a supported valuation.

## Management view

Show assigned/in-progress scenarios, completed scenarios, scores, demonstrated competencies, repeated errors, scenarios requiring review and recommended readiness. Training records are management information and are not used for public employee ranking.

## Versioning

Published scenario versions are immutable. Revisions create a new version so historical training results remain interpretable.

## Relationship to Dry Run

Dry Run answers: What would this workflow do?
Training Mode answers: Does this employee know what to do and can they demonstrate it safely?

Both use the same no-side-effect simulation principles.

## Modular expansion

Training scenarios belong to modules. Other industries can substitute their own scenarios while retaining the same Training Core.

## Acceptance criteria

- No training action mutates production business data.
- Every session records the scenario version.
- Evaluation produces explainable feedback.
- Competency never grants permissions automatically.
- Published scenarios are versioned.
- Managers can review/override an evaluation with an audit note.
- Training respects company/tenant boundaries.
