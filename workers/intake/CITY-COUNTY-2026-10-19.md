# City and county intake

The live Vero Beach test exposed a missing city field. The form now accepts a city or nearby city, fills a single directory county match, and offers county-filtered city suggestions. Multiple counties and unknown names remain unresolved. Explicit county choices are preserved because a nearby city can be across a county line. Changing an automatically matched city clears its stale county suggestion.

Directory: Florida Department of State, Division of Library and Information Services, City County List, retrieved 2026-10-19:
https://dos.fl.gov/library-archives/research/florida-information/government/local-resources/citycounty-list/

The bundled snapshot contains 935 place/county rows, including cities, towns, villages and census designated places. County spelling is normalized to the existing form options. This is a suggestion directory, not a parcel boundary determination or a promise of research-adapter coverage. Refresh the snapshot when the state directory changes; do not infer missing entries or fuzzy matches.

The backend independently resolves a city when county is empty or Not Sure. It records city, supplied county and any backend suggestion in inquiry details, visible in CRM and notifications; downstream research receives the resolved county and city. No schema migration or change to historical inquiries is made. Source Not Configured and insufficient parcel identifiers remain valid research outcomes.

Validation: 134 automated tests passed, including real intake-handler persistence, exact/unknown/multiple-county matches, manual county preservation, stale suggestion clearing and native form reset. Sixteen public source preflight checks passed. Intake and static Workers pass Wrangler dry-run bundling. Two new public JavaScript files are explicitly allowed by both asset boundaries; all other denied paths remain denied. Owner-only Access remains in place.

Rollback baseline: static 1f165a09-1035-411a-bc97-684338f8994f; intake 6fab93b0-385d-4f6d-8d30-d2fdcb519cce; boundary 7e9ecc8d-ff26-4922-8009-937f2fbb0181.
