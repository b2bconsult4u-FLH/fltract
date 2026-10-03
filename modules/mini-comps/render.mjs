import { approvedSource } from '../../industry/florida/county-sources.mjs';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => value == null ? 'Not published' : new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(value);
const label = value => esc(String(value || '').replaceAll('_',' '));
const link = (county, source, title = 'County source') => approvedSource(county,source?.url) ? `<a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(title)}</a>` : 'Source unavailable';

// Private admin card only. The caller authenticates/authorizes access to the inquiry.
export function renderReport(report) {
  const subject = report.subject;
  const subjectHtml = subject ? `<h4>Subject property</h4><p>${esc(subject.parcel_id)} · ${esc(subject.county)} County · ${esc(subject.situs_address)}</p>
    <p>${esc(subject.acreage ?? 'Unknown')} acres; improvement class: ${label(subject.improvement_type || 'not established')}.</p>
    <p>Property Appraiser values — assessment year ${esc(subject.assessment_year ?? 'not published')}:
    Just/market ${money(subject.appraiser_values?.just)}; assessed ${money(subject.appraiser_values?.assessed)}; taxable ${money(subject.appraiser_values?.taxable)}.</p>
    <p>${link(subject.county,subject.appraiser_source || subject.source,'Appraiser value source')} · ${link(subject.county,subject.source,'Property characteristics source')}
    · characteristics publication ${esc(subject.source?.published_at || 'unknown')}.</p>` : '<p>The subject property has not yet been verified.</p>';
  const rows = (report.comparables || []).map(sale => {
    const p = sale.profile_at_sale;
    return `<tr><td>${esc(p.parcel_id)}<br>${esc(p.situs_address)}</td><td>${esc(sale.date)}</td><td>${money(sale.price)}</td>
      <td>${esc(p.acreage)}</td><td>${esc(p.building_sqft ?? '—')}</td><td>${money(sale.unit_price)} / ${sale.unit === 'acre' ? 'acre' : 'building sq ft'}</td>
      <td>${esc(sale.distance_miles)} mi</td><td>${link(p.county,sale.source)}<br>${esc(sale.deed_reference)}<br>Published ${esc(sale.source.published_at)}</td></tr>`;
  }).join('');
  const reasons = (report.comparables || []).map(sale=>`<li><strong>${esc(sale.profile_at_sale.parcel_id)}</strong>: ${(sale.selection_reasons || []).map(esc).join(' ')}</li>`).join('');
  const summary = report.observed_sales_summary;
  const summaryHtml = summary ? `<p><strong>Observed comparable sales only:</strong> ${summary.count} properties; sale prices ${money(summary.sale_price_min)}–${money(summary.sale_price_max)}.
    Median ${money(summary.unit_price_median)} per ${summary.unit === 'acre' ? 'acre' : 'building sq ft'}; observed unit prices ${money(summary.unit_price_min)}–${money(summary.unit_price_max)}.</p>` : '<p><strong>Insufficient data—review needed.</strong> No subject value range has been calculated.</p>';
  return `<section class="mini-comp-report" aria-label="Property mini comparison report"><h3>Property Mini Comp Report</h3>
    <p><strong>${label(report.status)}</strong> · ${label(report.reason)} · generated ${esc(report.generated_at)}</p>${subjectHtml}${summaryHtml}
    ${rows ? `<div style="overflow-x:auto"><table><caption>Selected sales — unadjusted published prices</caption><thead><tr><th>Property</th><th>Sale date</th><th>Price</th><th>Acres</th><th>Building sq ft</th><th>Unit price</th><th>Distance</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table></div><h4>Why these sales</h4><ul>${reasons}</ul>` : ''}
    <h4>Review limits</h4><ul>${(report.limitations || []).map(item=>`<li>${esc(item)}</li>`).join('')}</ul>
    <p>${(report.excluded || []).length} candidate sales excluded; reasons are retained in the report history.</p></section>`;
}
