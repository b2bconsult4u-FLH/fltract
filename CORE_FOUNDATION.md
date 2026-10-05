# FLTract Core Foundation Component

Version 0.1 - 2026-10-05

This component defines the persistence contract for the reusable FLTract core. It is designed to be added to the existing Cloudflare D1 schema before higher-level features are activated.

## Tables

### flt_tenants
Company/tenant boundary. Initial deployment can use one tenant; all new reusable-core records carry tenant_id.

Fields: id, tenant_key, name, active, created_at, updated_at.

### flt_objects
Generic object registry for extensible business entities.

Fields: id, tenant_id, object_type, native_table, native_id, display_name, status, created_at, updated_at.
Unique: tenant_id + object_type + native_table + native_id.

### flt_relationships
Relationship graph edges.

Fields: id, tenant_id, from_object_id, to_object_id, relationship_type, source_type, source_reference, confidence, effective_from, effective_to, active, created_at, updated_at.

### flt_sources
Provenance registry for authoritative, user-entered, integration and AI-derived facts.

Fields: id, tenant_id, source_type, source_name, source_reference, retrieved_at, metadata_json, created_at.

### flt_facts
Version-friendly facts associated with any registered object.

Fields: id, tenant_id, object_id, field_key, value_json, source_id, confidence, fact_status, effective_from, effective_to, supersedes_fact_id, created_at.

### flt_events
Normalized business/activity events.

Fields: id, tenant_id, event_type, subject_object_id, actor_type, actor_reference, source_id, summary, payload_json, created_at.

### flt_audit_events
Append-only audit trail.

Fields: id, tenant_id, actor_type, actor_reference, action, object_type, object_reference, trigger_type, trigger_reference, before_json, after_json, source_reference, created_at.

### flt_modules
Module registry/feature flags.

Fields: id, tenant_id, module_key, module_name, enabled, config_json, version, created_at, updated_at.

### flt_workflow_definitions
Versioned workflow definitions.

Fields: id, tenant_id, workflow_key, name, version, status, definition_json, created_by, created_at, activated_at.
Status examples: Draft, Testing, Active, Retired.

### flt_workflow_runs
Execution/dry-run record.

Fields: id, tenant_id, workflow_definition_id, mode, status, subject_object_id, initiated_by, input_json, proposed_effects_json, actual_effects_json, error_text, started_at, completed_at.
Mode: DryRun or Live.

### flt_integrity_findings
Data Integrity review queue.

Fields: id, tenant_id, subject_object_id, finding_type, severity, status, evidence_json, proposed_resolution_json, confidence, detected_by, reviewed_by, review_note, created_at, reviewed_at.

## Initial integration
Existing clients, properties, inquiries, reports and staff tables remain intact. The generic registry references those records rather than replacing them. This permits gradual migration without destabilizing current intake/admin functions.

## Safety rules
1. DryRun never performs external sends or production mutations.
2. Audit events are append-only from application code.
3. AI-generated workflow definitions start in Draft.
4. Conflicting facts create integrity findings rather than silent replacement.
5. Tenant_id is mandatory on all reusable-core records.
6. Authorization is checked before reads as well as writes.
7. Heavy enrichment and report jobs remain asynchronous.
