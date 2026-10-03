import { key, normalizeProfile, normalizeSale, sourceInfo } from './engine.mjs';

// Private trusted import functions only; intentionally no public upload route.
export async function beginDataset({ db, county, source, expectedProfiles, expectedSales }) {
  const checked = sourceInfo(county,source);
  if (!Number.isInteger(expectedProfiles) || expectedProfiles < 1 || !Number.isInteger(expectedSales) || expectedSales < 0) throw new Error('Expected dataset counts are required.');
  const id = crypto.randomUUID();
  await db.prepare('INSERT INTO mini_comp_sources (id,county,source_json,published_at,expected_profiles,expected_sales,complete) VALUES (?,?,?,?,?,?,0)')
    .bind(id,county,JSON.stringify(checked),checked.published_at,expectedProfiles,expectedSales).run();
  return id;
}
export async function importChunk({ db, sourceId, profiles = [], sales = [] }) {
  if (profiles.length + sales.length < 1 || profiles.length + sales.length > 200) throw new Error('Import 1–200 rows per invocation.');
  const source = await db.prepare('SELECT * FROM mini_comp_sources WHERE id=? AND complete=0').bind(sourceId).first();
  if (!source) throw new Error('An unfinished dataset is required.');
  const normalizedProfiles = profiles.map(normalizeProfile), normalizedSales = sales.map(normalizeSale);
  if (normalizedProfiles.some(row=>row.county!==source.county) || normalizedSales.some(row=>row.profile_at_sale.county!==source.county)) throw new Error('Mixed-county dataset.');
  for (const profile of normalizedProfiles) {
    await db.prepare('INSERT INTO mini_comp_profiles (source_id,county,parcel_key,profile_json) VALUES (?,?,?,?)')
      .bind(sourceId,profile.county,key(profile.parcel_id),JSON.stringify(profile)).run();
  }
  for (const sale of normalizedSales) {
    const profile = sale.profile_at_sale;
    await db.prepare(`INSERT INTO mini_comp_sales
      (source_id,id,county,property_use_code,improvement_type,latitude,longitude,sale_date,sale_json) VALUES (?,?,?,?,?,?,?,?,?)`)
      .bind(sourceId,sale.id,profile.county,profile.property_use_code,profile.improvement_type,profile.latitude,profile.longitude,sale.date,JSON.stringify(sale)).run();
  }
}
export async function finishDataset({ db, sourceId }) {
  const source = await db.prepare('SELECT * FROM mini_comp_sources WHERE id=? AND complete=0').bind(sourceId).first();
  if (!source) throw new Error('An unfinished dataset is required.');
  const profiles = await db.prepare('SELECT COUNT(*) AS n FROM mini_comp_profiles WHERE source_id=?').bind(sourceId).first();
  const sales = await db.prepare('SELECT COUNT(*) AS n FROM mini_comp_sales WHERE source_id=?').bind(sourceId).first();
  if (profiles.n !== source.expected_profiles || sales.n !== source.expected_sales) throw new Error('Dataset counts do not match the manifest.');
  await db.prepare('UPDATE mini_comp_sources SET complete=1 WHERE id=?').bind(sourceId).run();
  return { source_id: sourceId, profiles: profiles.n, sales: sales.n };
}
