# FLTract canonical article catalog

The article library is **one collection**, not separate copies for each county and region. Each article has one stable ID, one canonical URL, and zero or more county, regional, and topic classifications. An article may appear in multiple indexes without duplicating content.

## Workflow

1. Draft and fact-check the article; cite original authoritative sources for material claims.
2. Assign a unique ID, title, slug, canonical URL, content type, geographic scope, county names, region names, and topic tags.
3. Add the rendered article page and its catalog record in the same pull request.
4. Validate unique IDs/URLs, source page existence, valid classification values, and internal links in CI before publication.
5. Build county, region, topic, and statewide listings **from the catalog** rather than hand-editing links on each page.
6. Review preview, approve, then deploy. Mark the record published only after live verification.

## Geography

Use `scope: statewide` for Florida-wide issues. Use `scope: regional` or `scope: county` for geographically narrower coverage; multiple counties and regions are allowed. A Florida-wide article may also be tagged for specific affected counties where justified. Counties must use canonical Florida county names. Regions require a controlled vocabulary maintained alongside the catalog, not ad-hoc free text.

## Publication and integrity rules

- Statuses: draft, review, published-in-preview, published, archived.
- Use ISO 8601 UTC timestamps only after the corresponding event occurs; do not fabricate publication dates.
- Slugs and canonical URLs are permanent once published; use redirects for any later URL change.
- Content is informational and must preserve the approved FLTract referral-only brokerage disclosure and a relevant inquiry CTA.
- Do not put client inquiries, personal information, or unpublished lead records in this public catalog.
- The catalog is a foundation. **Automated generation of public category pages and deployment verification are not implemented by this change.**
