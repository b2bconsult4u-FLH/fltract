# FLTract Architecture

Version 1.1 - 2026-10-05

FLTract is a modular business operating system. The reusable core supports industry modules, beginning with real-estate and property intelligence.

## Core capabilities

- Business Memory: canonical records with provenance, history and permissions.
- Relationship Graph: extensible links among clients, people, companies, properties, parcels, opportunities, transactions, documents, communications and staff.
- Workflow Engine: triggers, conditions, branches, approvals, routing, retries, versions and activation controls.
- AI Workflow Builder: natural-language workflow proposals followed by human review, Dry Run and authorized activation.
- Simulation: Dry Run shows proposed effects without production side effects. Training Mode provides isolated role-specific scenarios and competency records.
- Data Integrity Engine: detects duplicates, stale data and conflicting facts; evidence is retained and material data is not silently overwritten.
- Procedures/SOP Engine: versioned company rules, checklists, templates and approval requirements connected to roles, workflows and training.
- Activity Intelligence: converts important forms, notes, connected communications, uploads, research, field activity and system actions into business events and proposed next actions.
- Intelligent Documents: documents retain business relationships, source, dates, version/supersession, searchable metadata and access policy.
- Universal Work Routing: assignment by qualification, workload, geography, priority, deadline and authorization, with auditable overrides.
- Ask FLTract: permission-aware natural-language query layer over authorized business records, distinguishing facts from inference.
- External Intelligence: removable source adapters with retrieval timestamps and provenance.
- Audit, Versioning and Rollback: material changes record actor, action, time, trigger, before/after and source; critical workflows, procedures, configuration and documents are versioned.
- Command Center: role-aware views of waiting work, exceptions, approvals, failures, pipeline, training, integrity review and system health.

## Property module

The first specialized module includes client intake, repeat-client property intake, property-appraiser validation, parcel identification, legal description and owner/value data, property relationships, mini-comp generation/review, client IDs, research/reports and referral/opportunity tracking.

Property-specific logic remains outside the reusable core whenever practical.

## Guardrails

- Performance is a product requirement: indexed queries, asynchronous heavy jobs, queues, caching and bounded AI context.
- Private functions require authenticated role-based access.
- Privileged support access remains authenticated, scoped and audited.
- AI-generated workflows remain inactive until authorized.
- Consequential actions follow configured approval rules.
- External facts retain provenance and conflicts are surfaced.
- Training and Dry Run cannot create production side effects.
- Every module declares its objects, permissions, workflows, events and dependencies.
- Core services do not depend on real-estate-specific fields.
- Company/tenant data boundaries are designed from the beginning.
- Important schema, workflow and configuration changes are versioned and reversible where safe.

## Implementation order

Foundation: access boundaries, audit-event schema, generic object/relationship model, provenance model, workflow/version model, module registry, document metadata and activity-event model.

Next: Data Integrity review queue, Dry Run, universal work routing, SOP records and a read-only Ask FLTract layer.

Expansion: Training Mode, natural-language Workflow Builder, richer Activity Intelligence, additional industry modules, advanced rollback and command center.

## Acceptance rule

A feature belongs in the reusable core only when it can serve multiple industries without property-specific assumptions. Otherwise it belongs in an industry module.
