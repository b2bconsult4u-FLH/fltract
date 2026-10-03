import { createRepository } from './repository.mjs';
import { renderReport } from './render.mjs';
import { emptyReport } from './engine.mjs';

// Host private CRM supplies its real inquiry authorization check, never a public header.
export async function miniCompCard({ inquiryId, propertyKey = 'primary', env, authorize, repository }) {
  if (env.MINI_COMPS_ENABLED !== 'true') return '';
  if (!Number.isInteger(inquiryId) || inquiryId < 1) throw new Error('A valid inquiry ID is required.');
  if (typeof authorize !== 'function' || await authorize(inquiryId) !== true) throw new Error('Inquiry access denied.');
  try {
    const repo = repository || createRepository(env.MINI_COMP_DB);
    const latest = await repo.latest(inquiryId,propertyKey);
    return renderReport(latest ? JSON.parse(latest.report_json) : emptyReport('report_not_generated'));
  } catch { return renderReport(emptyReport('report_temporarily_unavailable')); }
}
