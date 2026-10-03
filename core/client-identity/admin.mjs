// Host CRM authorization is required. Display/reference numbers are never credentials.
export async function clientAccount({ clientId, env, authorize }) {
  if(!Number.isSafeInteger(clientId)||clientId<1) throw new Error('Invalid client ID.');
  if(typeof authorize!=='function'||await authorize(clientId)!==true) throw new Error('Client account access denied.');
  const client=await env.DB.prepare('SELECT * FROM clients WHERE id=?').bind(clientId).first();
  if(!client) return null;
  const inquiries=await env.DB.prepare(`SELECT i.*,l.link_basis,l.review_required,l.linked_at FROM inquiry_client_links l
    JOIN inquiries i ON i.id=l.inquiry_id WHERE l.client_id=? ORDER BY i.id DESC`).bind(clientId).all();
  // Reports remain attached to their existing inquiry IDs in the separate optional modules.
  return {client,inquiries:inquiries.results||[]};
}
