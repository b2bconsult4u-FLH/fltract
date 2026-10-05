# FLTract Workflow Dry Run

Version 0.1 — 2026-10-05

Dry Run is the safety layer between a workflow definition and production execution. It evaluates a workflow against a selected record, records proposed effects, and performs no production mutations.

## Safety contract

Dry Run does not send external communications, update client/property data, create assignments, change permissions, create production reports, or activate workflows. Each simulation records workflow version, subject, initiator, proposed effects, start and completion time. The interface must clearly identify a completed simulation as NO CHANGES MADE.

## Initial workflow simulation: New Property Intake

1. Read linked property/client context.
2. Check required information.
3. Determine whether authoritative parcel validation would be required.
4. Determine whether a mini-comp/research task would be created or evaluated.
5. Preview staff routing.
6. Preview Data Integrity checks.

## Persistence

`flt_workflow_definitions` stores versioned workflow definitions. AI-generated definitions begin as Draft.

`flt_workflow_runs` stores DryRun and future Live execution records. A DryRun stores proposed effects while its actual production effects remain empty.

## Training extension

Training Mode reuses this simulation engine and adds objectives, expected decisions, scoring, omissions, policy checks and competency records. Training results never grant production permissions automatically.
