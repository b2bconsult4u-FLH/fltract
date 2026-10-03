import { buildReport, DEFAULT_POLICY, emptyReport, key } from './engine.mjs';

export function createRepository(db, policy = DEFAULT_POLICY, clock = () => new Date()) {
  return {
    async job(inquiryId, propertyKey = 'primary') {
      await db.prepare('INSERT OR IGNORE INTO mini_comp_jobs (id,inquiry_id,property_key,created_at) VALUES (?,?,?,?)')
        .bind(crypto.randomUUID(), inquiryId, propertyKey, new Date().toISOString()).run();
      return db.prepare('SELECT * FROM mini_comp_jobs WHERE inquiry_id=? AND property_key=?').bind(inquiryId,propertyKey).first();
    },
    async append(jobId, report) {
      await db.prepare('INSERT INTO mini_comp_reports (job_id,status,reason,report_json,created_at) VALUES (?,?,?,?,?)')
        .bind(jobId,report.status,report.reason,JSON.stringify(report),new Date().toISOString()).run();
    },
    async generate(propertyRecord) {
      const now = clock();
      const source = await db.prepare("SELECT * FROM mini_comp_sources WHERE county=? AND complete=1 ORDER BY published_at DESC,json_extract(source_json,'$.retrieved_at') DESC,id DESC LIMIT 1")
        .bind(propertyRecord.county).first();
      if (!source) return emptyReport('county_sales_data_not_loaded', { propertyRecord });
      const row = await db.prepare('SELECT profile_json FROM mini_comp_profiles WHERE source_id=? AND county=? AND parcel_key=?')
        .bind(source.id, propertyRecord.county, key(propertyRecord.parcel_id)).first();
      if (!row) return emptyReport('subject_characteristics_missing', { propertyRecord });
      const subject = JSON.parse(row.profile_json);
      const angular = policy.radius_miles / 3958.7613;
      const latitudeDelta = angular * 180 / Math.PI;
      const cosine = Math.cos(subject.latitude * Math.PI / 180);
      const longitudeDelta = Math.abs(cosine) <= Math.sin(angular) ? 180 : Math.asin(Math.sin(angular) / cosine) * 180 / Math.PI;
      const date = new Date(now.getTime() - policy.lookback_days * 86400000).toISOString().slice(0,10);
      const response = await db.prepare(`SELECT sale_json FROM mini_comp_sales WHERE source_id=? AND county=?
        AND property_use_code=? AND improvement_type=? AND sale_date>=?
        AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?
        ORDER BY sale_date DESC,id LIMIT 501`)
        .bind(source.id,subject.county,subject.property_use_code,subject.improvement_type,date,
          subject.latitude-latitudeDelta,subject.latitude+latitudeDelta,subject.longitude-longitudeDelta,subject.longitude+longitudeDelta).all();
      const rows = response.results || [];
      return buildReport({ propertyRecord, subjectProfile: subject, sales: rows.slice(0,500).map(row=>JSON.parse(row.sale_json)), now, policy, truncated: rows.length > 500 });
    },
    async history(inquiryId) {
      return db.prepare(`SELECT j.inquiry_id,j.property_key,r.* FROM mini_comp_jobs j JOIN mini_comp_reports r ON r.job_id=j.id
        WHERE j.inquiry_id=? ORDER BY r.id`).bind(inquiryId).all();
    },
    async latest(inquiryId, propertyKey = 'primary') {
      return db.prepare(`SELECT r.* FROM mini_comp_jobs j JOIN mini_comp_reports r ON r.job_id=j.id
        WHERE j.inquiry_id=? AND j.property_key=? ORDER BY r.id DESC LIMIT 1`).bind(inquiryId,propertyKey).first();
    }
  };
}
