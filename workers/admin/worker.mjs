const STATUSES = [
  "New",
  "Reviewing",
  "Researching",
  "Referral Candidate",
  "Referral Prepared",
  "Referred",
  "Closed"
];

const FLORIDA_TIME_ZONE = "America/New_York";


/* ============================================================
   GENERAL HELPERS
   ============================================================ */

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}


function detailField(details, label) {
  const text = String(details || "");
  const prefix = `${label}:`;
  const line = text
    .split(/\r?\n/)
    .find(row => row.trim().toLowerCase().startsWith(prefix.toLowerCase()));

  return line
    ? line.trim().slice(prefix.length).trim()
    : "";
}


function clientDetailsDisplay(details) {
  const metadataPrefixes = [
    "Timeframe:",
    "Owner status:",
    "Best contact time:",
    "Referral source:",
    "Source page:"
  ];

  return String(details || "")
    .split(/\r?\n/)
    .filter(row => {
      const trimmed = row.trim().toLowerCase();
      return !metadataPrefixes.some(prefix =>
        trimmed.startsWith(prefix.toLowerCase())
      );
    })
    .join("\n")
    .trim();
}


function inquiryTypeDisplay(value) {
  return value === "Selling Property I Own"
    ? "Selling Property"
    : String(value || "");
}


function redirect(location) {
  return new Response(null, {
    status: 303,
    headers: {
      Location: location
    }
  });
}


function idFromPath(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  const id = Number(parts[1]);

  return Number.isInteger(id) && id > 0
    ? id
    : null;
}


function sameOriginPost(request) {
  if (request.method !== "POST") {
    return false;
  }

  const target = new URL(request.url);

  const origin = request.headers.get("Origin");

  if (origin) {
    try {
      if (new URL(origin).origin === target.origin) {
        return true;
      }
    } catch {}
  }

  const referer = request.headers.get("Referer");

  if (referer) {
    try {
      if (new URL(referer).origin === target.origin) {
        return true;
      }
    } catch {}
  }

  return request.headers.get("Sec-Fetch-Site") === "same-origin";
}


/* ============================================================
   CLIENT ACCOUNTS
   ============================================================ */

let clientSchemaReady = false;

function normalizeClientEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeClientPhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function clientCode(id) {
  return `FLT-${String(Number(id) || 0).padStart(6, "0")}`;
}

async function ensureClientSchema(env) {
  if (clientSchemaReady) return;

  await env.DB.batch([
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        first_name TEXT NOT NULL DEFAULT '',
        last_name TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        normalized_email TEXT NOT NULL UNIQUE,
        phone TEXT NOT NULL DEFAULT '',
        normalized_phone TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS client_inquiries (
        client_id INTEGER NOT NULL,
        inquiry_id INTEGER NOT NULL UNIQUE,
        linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        link_basis TEXT NOT NULL DEFAULT 'Exact Email',
        PRIMARY KEY (client_id, inquiry_id)
      )
    `),
    env.DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_client_inquiries_client
      ON client_inquiries(client_id)
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS properties (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL,
        primary_inquiry_id INTEGER UNIQUE,
        property_location TEXT NOT NULL DEFAULT '',
        county TEXT NOT NULL DEFAULT '',
        property_type TEXT NOT NULL DEFAULT '',
        acreage TEXT NOT NULL DEFAULT '',
        parcel_id TEXT NOT NULL DEFAULT '',
        legal_description TEXT NOT NULL DEFAULT '',
        owner_name TEXT NOT NULL DEFAULT '',
        owner_mailing_address TEXT NOT NULL DEFAULT '',
        assessed_value TEXT NOT NULL DEFAULT '',
        market_value TEXT NOT NULL DEFAULT '',
        taxable_value TEXT NOT NULL DEFAULT '',
        zoning TEXT NOT NULL DEFAULT '',
        land_use TEXT NOT NULL DEFAULT '',
        improvements TEXT NOT NULL DEFAULT '',
        research_status TEXT NOT NULL DEFAULT 'Not Started',
        data_source TEXT NOT NULL DEFAULT '',
        data_verified_at TEXT,
        notes TEXT NOT NULL DEFAULT '',
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS property_inquiries (
        property_id INTEGER NOT NULL,
        inquiry_id INTEGER NOT NULL UNIQUE,
        linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        link_basis TEXT NOT NULL DEFAULT 'Inquiry Seed',
        PRIMARY KEY (property_id, inquiry_id)
      )
    `),
    env.DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_properties_client
      ON properties(client_id)
    `),
    env.DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_property_inquiries_property
      ON property_inquiries(property_id)
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS mini_comp_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        property_id INTEGER NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'Needs Research',
        executive_summary TEXT NOT NULL DEFAULT '',
        selection_notes TEXT NOT NULL DEFAULT '',
        limitations TEXT NOT NULL DEFAULT '',
        insufficient_data_reason TEXT NOT NULL DEFAULT '',
        prepared_at TEXT,
        approved_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS mini_comp_comparables (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        report_id INTEGER NOT NULL,
        property_location TEXT NOT NULL DEFAULT '',
        county TEXT NOT NULL DEFAULT '',
        parcel_id TEXT NOT NULL DEFAULT '',
        sale_date TEXT NOT NULL DEFAULT '',
        sale_price REAL,
        acreage REAL,
        qualified_sale TEXT NOT NULL DEFAULT 'Unknown',
        improvements TEXT NOT NULL DEFAULT '',
        distance_miles REAL,
        source_name TEXT NOT NULL DEFAULT '',
        source_reference TEXT NOT NULL DEFAULT '',
        source_retrieved_at TEXT,
        selection_reason TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    env.DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_mini_comp_comparables_report
      ON mini_comp_comparables(report_id)
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS mini_comp_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        property_id INTEGER NOT NULL,
        report_id INTEGER NOT NULL,
        task_type TEXT NOT NULL DEFAULT 'Research Mini-Comp',
        status TEXT NOT NULL DEFAULT 'Queued',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT NOT NULL DEFAULT '',
        available_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    env.DB.prepare(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_mini_comp_queue_open
      ON mini_comp_queue(property_id, task_type)
      WHERE status IN ('Queued','Processing','Retry')
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS report_library_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL,
        property_id INTEGER NOT NULL,
        report_type TEXT NOT NULL,
        source_table TEXT NOT NULL,
        source_id INTEGER NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        current_status TEXT NOT NULL DEFAULT 'Draft',
        current_version INTEGER NOT NULL DEFAULT 0,
        current_route TEXT NOT NULL DEFAULT '',
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(source_table, source_id)
      )
    `),
    env.DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_report_library_property
      ON report_library_items(property_id, updated_at)
    `),
    env.DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_report_library_client
      ON report_library_items(client_id, updated_at)
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS report_library_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        library_item_id INTEGER NOT NULL,
        version_number INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'Approved',
        snapshot_json TEXT NOT NULL,
        approved_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(library_item_id, version_number)
      )
    `),
    env.DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_report_versions_item
      ON report_library_versions(library_item_id, version_number)
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS official_research_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        property_id INTEGER NOT NULL,
        county TEXT NOT NULL DEFAULT '',
        adapter_key TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'Queued',
        subject_matches INTEGER NOT NULL DEFAULT 0,
        comparable_candidates INTEGER NOT NULL DEFAULT 0,
        source_name TEXT NOT NULL DEFAULT '',
        result_note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TEXT
      )
    `),
    env.DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_official_research_runs_property
      ON official_research_runs(property_id, created_at)
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS staff_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT 'Employee',
        active INTEGER NOT NULL DEFAULT 1,
        bootstrap_admin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen_at TEXT
      )
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS staff_access_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        staff_user_id INTEGER,
        email TEXT NOT NULL DEFAULT '',
        event_type TEXT NOT NULL,
        route TEXT NOT NULL DEFAULT '',
        method TEXT NOT NULL DEFAULT '',
        result TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    env.DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_staff_access_log_user
      ON staff_access_log(staff_user_id, created_at)
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS client_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL,
        staff_user_id INTEGER NOT NULL,
        assignment_role TEXT NOT NULL DEFAULT 'Primary',
        active INTEGER NOT NULL DEFAULT 1,
        assigned_by_email TEXT NOT NULL DEFAULT '',
        assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ended_at TEXT,
        end_reason TEXT NOT NULL DEFAULT ''
      )
    `),
    env.DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_client_assignments_client
      ON client_assignments(client_id, active)
    `),
    env.DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_client_assignments_staff
      ON client_assignments(staff_user_id, active)
    `),
    env.DB.prepare(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_client_assignment_active_unique
      ON client_assignments(client_id, staff_user_id)
      WHERE active = 1
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS property_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        property_id INTEGER NOT NULL,
        staff_user_id INTEGER NOT NULL,
        assignment_role TEXT NOT NULL DEFAULT 'Primary',
        active INTEGER NOT NULL DEFAULT 1,
        assigned_by_email TEXT NOT NULL DEFAULT '',
        assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ended_at TEXT,
        end_reason TEXT NOT NULL DEFAULT ''
      )
    `),
    env.DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_property_assignments_property
      ON property_assignments(property_id, active)
    `),
    env.DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_property_assignments_staff
      ON property_assignments(staff_user_id, active)
    `),
    env.DB.prepare(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_property_assignment_active_unique
      ON property_assignments(property_id, staff_user_id)
      WHERE active = 1
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS staff_teams (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        manager_staff_user_id INTEGER,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS staff_team_members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        team_id INTEGER NOT NULL,
        staff_user_id INTEGER NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ended_at TEXT,
        UNIQUE(team_id, staff_user_id)
      )
    `)
  ]);

  clientSchemaReady = true;
}

async function ensureClientForInquiry(env, inquiry) {
  await ensureClientSchema(env);

  const existing =
    await env.DB.prepare(`
      SELECT c.*
      FROM clients c
      JOIN client_inquiries ci
        ON ci.client_id = c.id
      WHERE ci.inquiry_id = ?
      LIMIT 1
    `)
    .bind(inquiry.id)
    .first();

  if (existing) {
    return existing;
  }

  const normalizedEmail =
    normalizeClientEmail(inquiry.email);

  if (!normalizedEmail) {
    return null;
  }

  await env.DB.prepare(`
    INSERT OR IGNORE INTO clients (
      first_name,
      last_name,
      email,
      normalized_email,
      phone,
      normalized_phone
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  .bind(
    inquiry.first_name || "",
    inquiry.last_name || "",
    inquiry.email || "",
    normalizedEmail,
    inquiry.phone || "",
    normalizeClientPhone(inquiry.phone)
  )
  .run();

  const client =
    await env.DB.prepare(`
      SELECT *
      FROM clients
      WHERE normalized_email = ?
      LIMIT 1
    `)
    .bind(normalizedEmail)
    .first();

  if (!client) {
    return null;
  }

  await env.DB.prepare(`
    INSERT OR IGNORE INTO client_inquiries (
      client_id,
      inquiry_id,
      link_basis
    )
    VALUES (?, ?, 'Exact Email')
  `)
  .bind(client.id, inquiry.id)
  .run();

  return client;
}

function propertyCode(id) {
  return `FLP-${String(Number(id) || 0).padStart(6, "0")}`;
}

async function ensurePropertyForInquiry(env, inquiry, clientId = null) {
  await ensureClientSchema(env);

  const existing =
    await env.DB.prepare(`
      SELECT p.*
      FROM properties p
      JOIN property_inquiries pi
        ON pi.property_id = p.id
      WHERE pi.inquiry_id = ?
      LIMIT 1
    `)
    .bind(inquiry.id)
    .first();

  if (existing) return existing;

  let resolvedClientId = Number(clientId) || 0;

  if (!resolvedClientId) {
    const client = await ensureClientForInquiry(env, inquiry);
    resolvedClientId = Number(client?.id) || 0;
  }

  if (!resolvedClientId) return null;

  const insert =
    await env.DB.prepare(`
      INSERT INTO properties (
        client_id,
        primary_inquiry_id,
        property_location,
        county,
        property_type,
        acreage,
        improvements,
        research_status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'Not Started')
    `)
    .bind(
      resolvedClientId,
      inquiry.id,
      inquiry.property_location || "",
      inquiry.county || "",
      inquiry.property_type || "",
      inquiry.acreage || "",
      inquiry.improvements || ""
    )
    .run();

  const propertyId = Number(insert?.meta?.last_row_id) || 0;
  if (!propertyId) return null;

  await env.DB.prepare(`
    INSERT OR IGNORE INTO property_inquiries (
      property_id,
      inquiry_id,
      link_basis
    )
    VALUES (?, ?, 'Inquiry Seed')
  `)
  .bind(propertyId, inquiry.id)
  .run();

  await ensureMiniCompForProperty(env, propertyId);

  return await env.DB.prepare(`
    SELECT *
    FROM properties
    WHERE id = ?
    LIMIT 1
  `)
  .bind(propertyId)
  .first();
}


async function ensureMiniCompForProperty(env, propertyId) {
  await ensureClientSchema(env);

  await env.DB.prepare(`
    INSERT OR IGNORE INTO mini_comp_reports (
      property_id,
      status
    )
    VALUES (?, 'Needs Research')
  `)
  .bind(propertyId)
  .run();

  const report = await env.DB.prepare(`
    SELECT *
    FROM mini_comp_reports
    WHERE property_id = ?
    LIMIT 1
  `)
  .bind(propertyId)
  .first();

  if (!report) return null;

  await env.DB.prepare(`
    INSERT OR IGNORE INTO mini_comp_queue (
      property_id,
      report_id,
      task_type,
      status
    )
    VALUES (?, ?, 'Research Mini-Comp', 'Queued')
  `)
  .bind(propertyId, report.id)
  .run();

  await ensureLibraryItemForMiniComp(env, propertyId, report);

  return report;
}

async function ensureLibraryItemForMiniComp(env, propertyId, report) {
  const property = await env.DB.prepare(`
    SELECT client_id
    FROM properties
    WHERE id = ?
    LIMIT 1
  `).bind(propertyId).first();

  if (!property || !report) return null;

  const title = `Mini-Comp — ${propertyCode(propertyId)}`;
  const route = `/property/${propertyId}/mini-comp/report`;

  await env.DB.prepare(`
    INSERT OR IGNORE INTO report_library_items (
      client_id,
      property_id,
      report_type,
      source_table,
      source_id,
      title,
      current_status,
      current_route
    )
    VALUES (?, ?, 'Mini-Comp', 'mini_comp_reports', ?, ?, ?, ?)
  `).bind(
    property.client_id,
    propertyId,
    report.id,
    title,
    report.status || "Needs Research",
    route
  ).run();

  await env.DB.prepare(`
    UPDATE report_library_items
    SET
      client_id = ?,
      property_id = ?,
      title = ?,
      current_status = ?,
      current_route = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE source_table = 'mini_comp_reports'
      AND source_id = ?
  `).bind(
    property.client_id,
    propertyId,
    title,
    report.status || "Needs Research",
    route,
    report.id
  ).run();

  return env.DB.prepare(`
    SELECT *
    FROM report_library_items
    WHERE source_table = 'mini_comp_reports'
      AND source_id = ?
    LIMIT 1
  `).bind(report.id).first();
}

async function syncMiniCompLibraryStatus(env, propertyId, reportId) {
  const report = await env.DB.prepare(`
    SELECT *
    FROM mini_comp_reports
    WHERE id = ?
    LIMIT 1
  `).bind(reportId).first();

  if (!report) return null;
  return ensureLibraryItemForMiniComp(env, propertyId, report);
}

async function snapshotApprovedMiniComp(env, property, report) {
  const item = await ensureLibraryItemForMiniComp(env, property.id, report);
  if (!item) return null;

  const comps = await env.DB.prepare(`
    SELECT *
    FROM mini_comp_comparables
    WHERE report_id = ?
    ORDER BY sale_date DESC, id DESC
  `).bind(report.id).all();

  const nextVersion = Number(item.current_version || 0) + 1;
  const snapshot = JSON.stringify({
    snapshot_type:"FLTract Mini-Comp",
    property,
    report,
    comparables:comps.results,
    captured_at:new Date().toISOString()
  });

  await env.DB.prepare(`
    INSERT INTO report_library_versions (
      library_item_id,
      version_number,
      status,
      snapshot_json,
      approved_at
    )
    VALUES (?, ?, 'Approved', ?, CURRENT_TIMESTAMP)
  `).bind(item.id, nextVersion, snapshot).run();

  await env.DB.prepare(`
    UPDATE report_library_items
    SET
      current_status = 'Approved',
      current_version = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(nextVersion, item.id).run();

  return nextVersion;
}

function numberOrNull(value) {
  const raw = String(value ?? "").replace(/[$,\s]/g, "");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "Not recorded";
  return new Intl.NumberFormat("en-US", {
    style:"currency",
    currency:"USD",
    maximumFractionDigits:0
  }).format(n);
}

function decimal(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    maximumFractionDigits:digits
  });
}

function median(values) {
  const nums = values
    .map(Number)
    .filter(Number.isFinite)
    .sort((a,b) => a-b);

  if (!nums.length) return null;
  const middle = Math.floor(nums.length / 2);
  return nums.length % 2
    ? nums[middle]
    : (nums[middle - 1] + nums[middle]) / 2;
}

function miniCompMetrics(comps) {
  const usable = comps.filter(c =>
    Number.isFinite(Number(c.sale_price)) &&
    Number(c.sale_price) > 0
  );

  const prices = usable.map(c => Number(c.sale_price));
  const perAcre = usable
    .filter(c => Number(c.acreage) > 0)
    .map(c => Number(c.sale_price) / Number(c.acreage));

  const average = values =>
    values.length
      ? values.reduce((a,b) => a + b, 0) / values.length
      : null;

  return {
    total: comps.length,
    usable: usable.length,
    lowPrice: prices.length ? Math.min(...prices) : null,
    highPrice: prices.length ? Math.max(...prices) : null,
    averagePrice: average(prices),
    medianPrice: median(prices),
    averagePerAcre: average(perAcre),
    medianPerAcre: median(perAcre)
  };
}


const COUNTY_RESEARCH_ADAPTERS = {
  "St. Lucie": {
    key:"st_lucie",
    sourceName:"St. Lucie County Property Appraiser",
    mode:"Direct Query",
    status:"First Live Adapter"
  },
  "Indian River": {
    key:"indian_river",
    sourceName:"Indian River County Property Appraiser",
    mode:"Published Dataset",
    status:"Registered"
  },
  "Brevard": {
    key:"brevard",
    sourceName:"Brevard County Property Appraiser",
    mode:"Direct Query / Dataset",
    status:"Registered"
  },
  "Martin": {
    key:"martin",
    sourceName:"Martin County Property Appraiser",
    mode:"Published Dataset",
    status:"Registered"
  },
  "Okeechobee": {
    key:"okeechobee",
    sourceName:"Okeechobee County Property Appraiser",
    mode:"Published Report",
    status:"Registered"
  }
};


const ST_LUCIE_PARCEL_QUERY =
  "https://map.paslc.gov/arcgis/rest/services/GISPublic/TaxMap/MapServer/9/query";

function researchSql(value) {
  return String(value || "").replace(/'/g, "''");
}

async function queryOfficialArcGIS(endpoint, params) {
  const url = new URL(endpoint);
  for (const [key,value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  url.searchParams.set("f","json");

  const response = await fetch(url.toString(), {
    headers:{"accept":"application/json"}
  });

  if (!response.ok) {
    throw new Error(`Official county source HTTP ${response.status}`);
  }

  const data = await response.json();
  if (data?.error) {
    throw new Error(data.error.message || "Official county query failed");
  }
  return data;
}

function stLucieSubjectWhere(property) {
  if (property.parcel_id) {
    return `ParcelID='${researchSql(property.parcel_id)}'`;
  }

  const street = String(property.property_location || "")
    .split(",")[0]
    .trim()
    .toUpperCase();

  if (!street) return "";
  return `UPPER(SiteAddress)='${researchSql(street)}'`;
}


const STAFF_ROLES = [
  "Administrator",
  "CEO",
  "CFO",
  "CFO Administrative Assistant",
  "Manager",
  "Employee"
];

function accessIdentity(request) {
  return String(
    request.headers.get("Cf-Access-Authenticated-User-Email") || ""
  ).trim().toLowerCase();
}

async function staffContext(env, request) {
  const email = accessIdentity(request);
  if (!email) {
    return {authenticated:false, email:"", user:null};
  }

  let user = await env.DB.prepare(`
    SELECT * FROM staff_users WHERE email = ? LIMIT 1
  `).bind(email).first();

  if (!user) {
    const count = await env.DB.prepare(`
      SELECT COUNT(*) AS n FROM staff_users
    `).first();

    if (Number(count?.n || 0) === 0) {
      await env.DB.prepare(`
        INSERT INTO staff_users (
          email, display_name, role, active, bootstrap_admin
        )
        VALUES (?, ?, 'Administrator', 1, 1)
      `).bind(email, email).run();

      user = await env.DB.prepare(`
        SELECT * FROM staff_users WHERE email = ? LIMIT 1
      `).bind(email).first();

      await env.DB.prepare(`
        INSERT INTO staff_access_log (
          staff_user_id, email, event_type, route, method, result, note
        )
        VALUES (?, ?, 'Bootstrap Administrator Created', '', '', 'Allowed',
                'First authenticated Cloudflare Access identity established the initial Administrator account.')
      `).bind(user?.id || null, email).run();
    }
  }

  if (user?.active) {
    await env.DB.prepare(`
      UPDATE staff_users
      SET last_seen_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(user.id).run();
  }

  return {authenticated:true, email, user:user || null};
}

function staffCan(user, capability) {
  if (!user || !user.active) return false;

  const role = String(user.role || "");

  const matrix = {
    "Administrator": new Set([
      "admin_access","manage_staff","manage_assignments","view_clients","edit_clients",
      "research_property","review_reports","approve_reports",
      "prepare_referrals","approve_referrals","manage_followups",
      "view_compliance","export_data","view_audit"
    ]),
    "CEO": new Set([
      "admin_access","manage_staff","manage_assignments","view_clients","edit_clients",
      "research_property","review_reports","approve_reports",
      "prepare_referrals","approve_referrals","manage_followups",
      "view_compliance","export_data","view_audit"
    ]),
    "CFO": new Set([
      "admin_access","view_clients","view_compliance","view_audit"
    ]),
    "CFO Administrative Assistant": new Set([
      "admin_access","view_clients"
    ]),
    "Manager": new Set([
      "admin_access","manage_assignments","view_clients","edit_clients","research_property",
      "review_reports","prepare_referrals","manage_followups"
    ]),
    "Employee": new Set([
      "admin_access","view_clients","research_property","manage_followups"
    ])
  };

  return Boolean(matrix[role]?.has(capability));
}

async function activeStaffUsers(env) {
  const result = await env.DB.prepare(`
    SELECT id, email, display_name, role
    FROM staff_users
    WHERE active = 1
    ORDER BY display_name ASC, email ASC
  `).all();
  return result.results || [];
}

async function assignmentScopeForClient(env, clientId) {
  const result = await env.DB.prepare(`
    SELECT
      ca.id AS assignment_id,
      ca.assignment_role,
      ca.assigned_at,
      su.id AS staff_user_id,
      su.email,
      su.display_name,
      su.role
    FROM client_assignments ca
    JOIN staff_users su ON su.id = ca.staff_user_id
    WHERE ca.client_id = ?
      AND ca.active = 1
      AND su.active = 1
    ORDER BY ca.assigned_at ASC, ca.id ASC
  `).bind(clientId).all();
  return result.results || [];
}

async function assignmentScopeForProperty(env, propertyId) {
  const result = await env.DB.prepare(`
    SELECT
      pa.id AS assignment_id,
      pa.assignment_role,
      pa.assigned_at,
      su.id AS staff_user_id,
      su.email,
      su.display_name,
      su.role
    FROM property_assignments pa
    JOIN staff_users su ON su.id = pa.staff_user_id
    WHERE pa.property_id = ?
      AND pa.active = 1
      AND su.active = 1
    ORDER BY pa.assigned_at ASC, pa.id ASC
  `).bind(propertyId).all();
  return result.results || [];
}

async function staffHasClientScope(env, user, clientId) {
  if (!user || !user.active) return false;
  if (["Administrator","CEO"].includes(user.role)) return true;

  const direct = await env.DB.prepare(`
    SELECT 1 AS ok
    FROM client_assignments
    WHERE client_id = ? AND staff_user_id = ? AND active = 1
    LIMIT 1
  `).bind(clientId, user.id).first();

  if (direct) return true;

  const property = await env.DB.prepare(`
    SELECT 1 AS ok
    FROM property_assignments pa
    JOIN properties p ON p.id = pa.property_id
    WHERE p.client_id = ?
      AND pa.staff_user_id = ?
      AND pa.active = 1
    LIMIT 1
  `).bind(clientId, user.id).first();

  if (property) return true;

  if (user.role === "Manager") {
    const team = await env.DB.prepare(`
      SELECT 1 AS ok
      FROM staff_teams t
      JOIN staff_team_members tm ON tm.team_id = t.id AND tm.active = 1
      JOIN client_assignments ca ON ca.staff_user_id = tm.staff_user_id AND ca.active = 1
      WHERE t.manager_staff_user_id = ?
        AND t.active = 1
        AND ca.client_id = ?
      LIMIT 1
    `).bind(user.id, clientId).first();
    if (team) return true;
  }

  return false;
}

async function staffHasPropertyScope(env, user, propertyId) {
  if (!user || !user.active) return false;
  if (["Administrator","CEO"].includes(user.role)) return true;

  const direct = await env.DB.prepare(`
    SELECT 1 AS ok
    FROM property_assignments
    WHERE property_id = ? AND staff_user_id = ? AND active = 1
    LIMIT 1
  `).bind(propertyId, user.id).first();

  if (direct) return true;

  const property = await env.DB.prepare(`
    SELECT client_id FROM properties WHERE id = ? LIMIT 1
  `).bind(propertyId).first();

  return property
    ? staffHasClientScope(env, user, property.client_id)
    : false;
}


async function logStaffAccess(env, ctx, request, eventType, result, note = "") {
  try {
    await env.DB.prepare(`
      INSERT INTO staff_access_log (
        staff_user_id, email, event_type, route, method, result, note
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      ctx?.user?.id || null,
      ctx?.email || "",
      eventType,
      new URL(request.url).pathname,
      request.method,
      result,
      String(note || "").slice(0,1000)
    ).run();
  } catch {}
}


/* ============================================================
   FLORIDA DATE / TIME
   ============================================================ */

function floridaTime(value) {
  if (!value) return "";

  let raw = String(value).trim();

  if (
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
  ) {
    raw = raw.replace(" ", "T") + "Z";
  }

  const date = new Date(raw);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone: FLORIDA_TIME_ZONE,
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "short"
    }
  ).format(date);
}


function calendarDate(value) {
  if (!value) return "";

  const raw = String(value).trim();

  const match = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})$/
  );

  if (!match) {
    return raw;
  }

  const [, year, month, day] = match;

  const names = [
    "Jan", "Feb", "Mar", "Apr",
    "May", "Jun", "Jul", "Aug",
    "Sep", "Oct", "Nov", "Dec"
  ];

  return `${names[Number(month) - 1]} ${Number(day)}, ${year}`;
}


function floridaToday() {
  const parts =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone: FLORIDA_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }
    )
    .formatToParts(new Date());

  const values = {};

  for (const p of parts) {
    values[p.type] = p.value;
  }

  return `${values.year}-${values.month}-${values.day}`;
}


function addDays(dateString, days) {
  const [y, m, d] =
    dateString.split("-").map(Number);

  const date =
    new Date(
      Date.UTC(y, m - 1, d)
    );

  date.setUTCDate(
    date.getUTCDate() + days
  );

  return date
    .toISOString()
    .slice(0, 10);
}


function daysBetween(a, b) {
  const dateA =
    new Date(`${a}T12:00:00Z`);

  const dateB =
    new Date(`${b}T12:00:00Z`);

  return Math.round(
    (dateB - dateA) /
    86400000
  );
}


/* ============================================================
   CONTACT STATUS
   ============================================================ */

function phoneContactStatus(inquiry, warningDays = 30) {
  if (Number(inquiry.do_not_call) === 1) {
    return {
      text: "DO NOT CALL",
      css: "danger"
    };
  }

  if (!inquiry.phone_contact_expires_at) {
    return {
      text: "NO ACTIVE CLOCK",
      css: "muted"
    };
  }

  const today = floridaToday();

  const expires =
    String(
      inquiry.phone_contact_expires_at
    ).slice(0, 10);

  const remaining =
    daysBetween(today, expires);

  if (remaining < 0) {
    return {
      text: "STALE — DO NOT INITIATE CALL",
      css: "danger"
    };
  }

  if (remaining <= warningDays) {
    return {
      text: `EXPIRING — ${remaining} DAYS`,
      css: "warning"
    };
  }

  return {
    text: `ACTIVE — ${remaining} DAYS`,
    css: "good"
  };
}


function emailContactStatus(inquiry) {
  if (Number(inquiry.do_not_email) === 1) {
    return {
      text: "DO NOT EMAIL",
      css: "danger"
    };
  }

  if (!inquiry.consent_recorded_at && !inquiry.consent_version) {
    return {
      text: "LEGACY — PERMISSION NOT VERIFIED",
      css: "warning"
    };
  }

  if (Number(inquiry.marketing_email_opt_in) === 1) {
    return {
      text: "MARKETING EMAIL OK",
      css: "good"
    };
  }

  if (Number(inquiry.inquiry_email_allowed) === 1) {
    return {
      text: "INQUIRY EMAIL ONLY",
      css: "warning"
    };
  }

  return {
    text: "NO EMAIL PERMISSION",
    css: "muted"
  };
}


function textContactStatus(inquiry) {
  if (Number(inquiry.do_not_text) === 1) {
    return {
      text: "DO NOT TEXT",
      css: "danger"
    };
  }

  if (Number(inquiry.text_opt_in) === 1) {
    return {
      text: "TEXT CONSENT RECORDED",
      css: "good"
    };
  }

  return {
    text: "NO TEXT CONSENT",
    css: "muted"
  };
}


/* ============================================================
   PAGE TEMPLATE
   ============================================================ */

function page(body, title = "FLTract Admin") {
  return `<!doctype html>
<html lang="en">

<head>

<meta charset="utf-8">

<meta
  name="viewport"
  content="width=device-width,initial-scale=1"
>

<title>${esc(title)}</title>

<style>

:root{
  --ink:#17352b;
  --green:#245943;
  --sand:#f4efe4;
  --paper:#fffdf8;
  --gold:#b98b3e;
  --muted:#65736d;
  --danger:#8b1e1e;
  --warning:#8a5a00;
  --good:#1f6b3a;
}

*{
  box-sizing:border-box;
}

body{
  margin:0;
  font-family:Arial,Helvetica,sans-serif;
  background:var(--sand);
  color:#1e2925;
}

header{
  background:var(--ink);
  color:#fff;
  padding:18px 0;
}

.wrap{
  width:min(1180px,94%);
  margin:auto;
}

header .wrap{
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:20px;
}

.brand{
  font-size:1.5rem;
  font-weight:900;
}

.brand span{
  color:#e4c98d;
}

nav a{
  color:#fff;
  text-decoration:none;
  margin-left:16px;
  font-weight:700;
}

main{
  padding:36px 0 60px;
}

h1,
h2,
h3{
  color:var(--ink);
}

.panel{
  background:#fff;
  border:1px solid #d8d8d2;
  padding:24px;
  margin-bottom:22px;
  box-shadow:0 4px 14px #0000000a;
}

.filters,
.action-row{
  display:flex;
  gap:12px;
  flex-wrap:wrap;
  align-items:end;
}

.filters{
  margin-bottom:20px;
}

input,
select,
textarea,
button{
  font:inherit;
}

input,
select,
textarea{
  width:100%;
  padding:10px 12px;
  border:1px solid #adb7b1;
  border-radius:4px;
  background:#fff;
}

textarea{
  resize:vertical;
}

button{
  background:var(--ink);
  color:#fff;
  border:0;
  border-radius:4px;
  padding:11px 16px;
  font-weight:800;
  cursor:pointer;
}

button.secondary{
  background:#65736d;
}

.filters input{
  width:260px;
}

.filters select{
  width:210px;
}

table{
  width:100%;
  border-collapse:collapse;
}

th,
td{
  text-align:left;
  padding:12px;
  border-bottom:1px solid #e3e0d8;
  vertical-align:top;
}

th{
  background:#faf6ec;
  color:var(--ink);
}

a{
  color:var(--green);
}

.badge{
  display:inline-block;
  padding:5px 9px;
  border-radius:20px;
  background:#eef3ef;
  font-size:.82rem;
  font-weight:800;
}

.badge.good{
  background:#e6f4ea;
  color:var(--good);
}

.badge.warning{
  background:#fff2cf;
  color:var(--warning);
}

.badge.danger{
  background:#fde8e8;
  color:var(--danger);
}

.badge.muted{
  background:#ecefed;
  color:#57615d;
}

.compliance-signals{
  display:flex;
  flex-wrap:wrap;
  gap:12px;
  margin:10px 0 22px;
}

.signal{
  display:flex;
  align-items:center;
  gap:8px;
  padding:9px 12px;
  border:1px solid #d8d8d2;
  border-radius:8px;
  background:#fff;
  font-weight:800;
}

.signal-light{
  font-size:1.45rem;
  line-height:1;
}

.signal-light.good{color:var(--good);}
.signal-light.warning{color:var(--gold);}
.signal-light.danger{color:var(--danger);}
.signal-light.muted{color:#7a827e;}

.history-collapse{
  margin-top:24px;
  border:1px solid #d8d8d2;
  background:#fff;
}

.history-collapse summary{
  cursor:pointer;
  padding:18px 20px;
  font-size:1.25rem;
  font-weight:900;
  color:var(--ink);
  list-style-position:inside;
}

.history-collapse[open] summary{
  border-bottom:1px solid #e3e0d8;
}

.history-collapse-body{
  padding:18px;
}

.grid{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:18px;
}

.form-grid{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:16px;
}

.form-grid .full{
  grid-column:1/-1;
}

label{
  display:block;
  font-weight:700;
  color:var(--ink);
}

label span{
  display:block;
  margin-bottom:5px;
}

.label{
  color:var(--muted);
  font-size:.82rem;
  font-weight:800;
  text-transform:uppercase;
  letter-spacing:.04em;
}

.value{
  margin-top:3px;
}

.empty{
  padding:30px;
  text-align:center;
  color:var(--muted);
}

.back{
  display:inline-block;
  margin-bottom:18px;
  font-weight:700;
}

.note{
  white-space:pre-wrap;
}

.small{
  font-size:.88rem;
  color:var(--muted);
}

.section-note{
  font-size:.9rem;
  color:var(--muted);
  line-height:1.5;
}

.followup-overdue{
  border-left:5px solid var(--danger);
}

.followup-today{
  border-left:5px solid var(--gold);
}

.followup-future{
  border-left:5px solid var(--green);
}

.summary-grid{
  display:grid;
  grid-template-columns:repeat(3,1fr);
  gap:16px;
  margin-bottom:22px;
}

.summary-card{
  background:#fff;
  border:1px solid #d8d8d2;
  padding:18px;
}

.summary-number{
  font-size:2rem;
  font-weight:900;
  color:var(--ink);
}

.management-grid{
  display:grid;
  grid-template-columns:repeat(3,1fr);
  gap:14px;
  margin-bottom:22px;
}

.management-card{
  display:block;
  background:#fff;
  border:1px solid #d8d8d2;
  border-left:5px solid var(--green);
  padding:16px 18px;
  text-decoration:none;
  color:inherit;
}

.management-card:hover{
  border-color:var(--ink);
}

.management-card.warning{
  border-left-color:var(--gold);
}

.management-card.danger{
  border-left-color:var(--danger);
}

.management-card.muted{
  border-left-color:#7a827e;
}

.management-card .summary-number{
  margin-top:4px;
}

.management-card .small{
  margin-top:6px;
}

@media(max-width:760px){

  .grid,
  .form-grid,
  .summary-grid,
  .management-grid{
    grid-template-columns:1fr;
  }

  .form-grid .full{
    grid-column:auto;
  }

  table{
    font-size:.88rem;
  }

  th,
  td{
    padding:8px;
  }

  .filters input,
  .filters select{
    width:100%;
  }

}

</style>

</head>

<body>

<header>

<div class="wrap">

<div class="brand">
FL<span>TRACT</span> Admin
</div>

<nav>
<a href="/">Inquiries</a>
<a href="/followups">Follow Ups</a>
<a href="/export.csv">Export CSV</a>
</nav>

</div>

</header>

<main>

<div class="wrap">

${body}

</div>

</main>

<script>
function setFollowupDate(id, days) {
  const input = document.getElementById(id);
  if (!input) return;
  const date = new Date();
  date.setHours(12,0,0,0);
  date.setDate(date.getDate() + Number(days || 0));
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  input.value = y + "-" + m + "-" + d;
}
</script>

</body>

</html>`;
}


/* ============================================================
   DAILY FOLLOW-UP REMINDER
   ============================================================ */

async function sendDailyFollowupReminder(env) {

if (!env.DB || !env.SEND_EMAIL) {
throw new Error(
"Daily follow-up reminder requires DB and SEND_EMAIL bindings."
);
}

const todayParts =
new Intl.DateTimeFormat(
"en-US",
{
timeZone: FLORIDA_TIME_ZONE,
year:"numeric",
month:"2-digit",
day:"2-digit"
}
)
.formatToParts(new Date());

const part =
type =>
todayParts.find(
p => p.type === type
)?.value || "";

const today =
`${part("year")}-${part("month")}-${part("day")}`;

const {results = []} =
await env.DB.prepare(`
SELECT
f.id AS followup_id,
f.inquiry_id,
f.due_date,
f.reason,
i.first_name,
i.last_name,
i.status AS inquiry_status
FROM follow_ups f
JOIN inquiries i
ON i.id = f.inquiry_id
WHERE
f.status = 'Open'
AND i.archived = 0
AND f.due_date <= ?
ORDER BY
f.due_date ASC,
f.inquiry_id ASC
`)
.bind(today)
.all();

if (!results.length) {
return;
}

const lines =
results.map(r => {

const timing =
String(r.due_date) < today
? "OVERDUE"
: "DUE TODAY";

return [
`${timing} — Inquiry #${r.inquiry_id}`,
`Client: ${r.first_name || ""} ${r.last_name || ""}`.trim(),
`Due: ${r.due_date}`,
`Reason: ${r.reason || ""}`,
`Inquiry status: ${r.inquiry_status || ""}`
].join("\n");

});

const subject =
`FLTract Follow-Ups Due — ${results.length} Item${results.length === 1 ? "" : "s"}`;

const body =
`FLTract has open follow-ups requiring attention.

${lines.join("\n\n")}

Open FLTract Admin → Follow Ups to review and complete them.

This is an internal operational reminder.`;

await env.SEND_EMAIL.send({
to:"fltractoffice@gmail.com",
from:"noreply@fltract.com",
subject,
text:body,
html:`<div style="font-family:Arial,sans-serif;white-space:pre-wrap">${esc(body)}</div>`
});

}


/* ============================================================
   WORKER
   ============================================================ */

export default {

async fetch(request, env) {

const url =
new URL(request.url);


if (!env.DB) {

return new Response(
"Database binding DB is missing.",
{
status:500
}
);

}

try {
await ensureClientSchema(env);
}
catch (error) {
console.error("Client account schema initialization failed:", error);
return new Response(
"Client account database initialization failed.",
{status:500}
);
}


const staff = await staffContext(env, request);

/*
  Assignment scope is being populated and verified before global
  record filtering is activated. This prevents an incomplete
  assignment rollout from accidentally hiding existing records.
*/


/* ============================================================
   LOAD COMPLIANCE RULES
   ============================================================ */

let warningDays = 30;
let inquiryCallDays = 90;

try {

const rules =
await env.DB.prepare(`
SELECT
rule_key,
rule_value
FROM compliance_rules
`).all();

for (const r of rules.results) {

if (
r.rule_key ===
"phone_expiration_warning_days"
) {
warningDays =
Number(r.rule_value) || 30;
}

if (
r.rule_key ===
"website_inquiry_live_call_days"
) {
inquiryCallDays =
Number(r.rule_value) || 90;
}

}

} catch {}


/* ============================================================
   CSV EXPORT
   ============================================================ */

if (
request.method === "GET" &&
url.pathname === "/export.csv"
) {

const { results } =
await env.DB.prepare(`
SELECT *
FROM inquiries
ORDER BY created_at DESC
`).all();


const headers = [

"ID",
"Created UTC",
"Created Florida Time",
"Inquiry Type",
"First Name",
"Last Name",
"Email",
"Phone",
"Preferred Contact",
"County",
"Property Type",
"Acreage",
"Timeframe",
"Owner Status",
"Best Contact Time",
"How Heard About FLTract",
"Source Page",
"Improvements",
"Property Location",
"Details",
"Status",
"Marketing Email Opt In",
"Live Call Opt In",
"Text Opt In",
"Do Not Email",
"Do Not Call",
"Do Not Text",
"Phone Contact Expires",
"Next Follow Up",
"Follow Up Reason"

];


const rows =
results.map(r => [

r.id,
r.created_at,
floridaTime(r.created_at),
r.inquiry_type,
r.first_name,
r.last_name,
r.email,
r.phone,
r.preferred_contact,
r.county,
r.property_type,
r.acreage,
r.timeframe,
r.owner_status,
r.best_contact_time,
r.referral_source,
r.source_page,
r.improvements,
r.property_location,
r.details,
r.status,
r.marketing_email_opt_in,
r.live_call_opt_in,
r.text_opt_in,
r.do_not_email,
r.do_not_call,
r.do_not_text,
r.phone_contact_expires_at,
r.next_follow_up_date,
r.next_follow_up_reason

].map(csvCell).join(","));


const csv =
[
headers.map(csvCell).join(","),
...rows
].join("\r\n");


return new Response(
csv,
{
headers:{
"content-type":
"text/csv; charset=utf-8",

"content-disposition":
'attachment; filename="fltract-inquiries.csv"',

"cache-control":
"no-store"
}
}
);

}


/* ============================================================
   STATUS CHANGE
   ============================================================ */

if (
request.method === "POST" &&
/^\/inquiry\/\d+\/status$/.test(
url.pathname
)
) {

if (!sameOriginPost(request)) {
return new Response(
"Invalid request origin.",
{status:403}
);
}


const id =
idFromPath(url.pathname);


const form =
await request.formData();


const status =
String(
form.get("status") || ""
);


if (
!id ||
!STATUSES.includes(status)
) {

return new Response(
"Invalid status update.",
{status:400}
);

}


const existing =
await env.DB.prepare(`
SELECT status
FROM inquiries
WHERE id = ?
`)
.bind(id)
.first();


if (!existing) {

return new Response(
"Inquiry not found.",
{status:404}
);

}


await env.DB.prepare(`
UPDATE inquiries

SET
status = ?,
updated_at = CURRENT_TIMESTAMP

WHERE id = ?
`)
.bind(
status,
id
)
.run();


if (
existing.status !== status
) {

await env.DB.prepare(`
INSERT INTO activity_log (
inquiry_id,
activity_type,
activity_note
)

VALUES (
?,
'Status Change',
?
)
`)
.bind(
id,
`Status changed from ${existing.status} to ${status}.`
)
.run();

}


return redirect(
`/inquiry/${id}`
);

}


/* ============================================================
   INTERNAL NOTE
   ============================================================ */

if (
request.method === "POST" &&
/^\/inquiry\/\d+\/note$/.test(
url.pathname
)
) {

if (!sameOriginPost(request)) {
return new Response(
"Invalid request origin.",
{status:403}
);
}


const id =
idFromPath(url.pathname);


const form =
await request.formData();


const note =
String(
form.get("note") || ""
).trim();


if (
!id ||
!note ||
note.length > 4000
) {

return new Response(
"Invalid note.",
{status:400}
);

}

await env.DB.prepare(`
INSERT INTO activity_log (
inquiry_id,
activity_type,
activity_note
)

VALUES (
?,
'Internal Note',
?
)
`)
.bind(
id,
note
)
.run();


await env.DB.prepare(`
UPDATE inquiries
SET updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`)
.bind(id)
.run();


return redirect(
`/inquiry/${id}`
);

}


/* ============================================================
   REFERRAL WORKFLOW — PREPARE
   ============================================================ */

if (
request.method === "POST" &&
/^\/inquiry\/\d+\/referral$/.test(
url.pathname
)
) {

if (!sameOriginPost(request)) {
return new Response(
"Invalid request origin.",
{status:403}
);
}

const id = idFromPath(url.pathname);
const form = await request.formData();

const name = String(form.get("referred_to_name") || "").trim().slice(0,200);
const company = String(form.get("referred_to_company") || "").trim().slice(0,200);
const email = String(form.get("referred_to_email") || "").trim().toLowerCase().slice(0,254);
const phone = String(form.get("referred_to_phone") || "").trim().slice(0,100);
const referralNote = String(form.get("referral_note") || "").trim().slice(0,4000);

if (!id || (!name && !company) || !email || !referralNote) {
return new Response(
"Referral preparation requires a name or company, email address, and referral message.",
{status:400}
);
}

await env.DB.prepare(`
INSERT INTO referral_history (
inquiry_id,
referred_to_name,
referred_to_company,
referred_to_email,
referred_to_phone,
referral_status,
referral_date,
referral_note
)
VALUES (?,?,?,?,?,'Prepared',NULL,?)
`)
.bind(
id,
name,
company,
email,
phone,
referralNote
)
.run();

const who = company || name;

await env.DB.prepare(`
UPDATE inquiries
SET
status = 'Referral Prepared',
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`)
.bind(id)
.run();

await env.DB.prepare(`
INSERT INTO activity_log (
inquiry_id,
activity_type,
activity_note
)
VALUES (
?,
'Referral Prepared',
?
)
`)
.bind(
id,
`Referral communication prepared for ${who}; human approval required before sending.`
)
.run();

return redirect(`/inquiry/${id}`);

}


/* ============================================================
   REFERRAL WORKFLOW — APPROVE & SEND
   ============================================================ */

if (
request.method === "POST" &&
/^\/inquiry\/\d+\/referral-send$/.test(
url.pathname
)
) {

if (!sameOriginPost(request)) {
return new Response(
"Invalid request origin.",
{status:403}
);
}

if (!env.SEND_EMAIL) {
return new Response(
"Email binding SEND_EMAIL is missing.",
{status:500}
);
}

const id = idFromPath(url.pathname);
const form = await request.formData();
const referralId = Number(form.get("referral_id"));
const followupDate = String(form.get("followup_date") || "").trim();

if (
!id ||
!Number.isInteger(referralId) ||
referralId < 1 ||
!/^\d{4}-\d{2}-\d{2}$/.test(followupDate)
) {
return new Response(
"A valid prepared referral and follow-up date are required.",
{status:400}
);
}

const referral = await env.DB.prepare(`
SELECT *
FROM referral_history
WHERE
id = ?
AND inquiry_id = ?
AND referral_status = 'Prepared'
LIMIT 1
`)
.bind(referralId,id)
.first();

if (!referral) {
return new Response(
"Prepared referral not found or already sent.",
{status:409}
);
}

const inquiry = await env.DB.prepare(`
SELECT *
FROM inquiries
WHERE id = ?
LIMIT 1
`)
.bind(id)
.first();

if (!inquiry) {
return new Response(
"Inquiry not found.",
{status:404}
);
}

const recipient = String(referral.referred_to_email || "").trim().toLowerCase();
const subject = `FLTract Referral — Inquiry #${id}`;
const message = String(referral.referral_note || "").trim();

if (!recipient || !message) {
return new Response(
"Prepared referral is missing its recipient or message.",
{status:400}
);
}

let emailLogId = null;

try {

const logResult = await env.DB.prepare(`
INSERT INTO email_log (
inquiry_id,
email_type,
recipient,
subject,
status
)
VALUES (
?,
'Referral Communication',
?,
?,
'Prepared'
)
`)
.bind(id,recipient,subject)
.run();

emailLogId = Number(logResult?.meta?.last_row_id) || null;

const sendResult = await env.SEND_EMAIL.send({
to: recipient,
from: "noreply@fltract.com",
subject,
text: message,
html: `<div style="font-family:Arial,sans-serif;white-space:pre-wrap">${esc(message)}</div>`
});

if (emailLogId) {
await env.DB.prepare(`
UPDATE email_log
SET
status = 'Sent',
provider_message_id = ?,
sent_at = CURRENT_TIMESTAMP,
failure_reason = NULL
WHERE id = ?
`)
.bind(sendResult?.messageId ?? null,emailLogId)
.run();
}

await env.DB.prepare(`
UPDATE referral_history
SET
referral_status = 'Referred',
referral_date = DATE('now')
WHERE
id = ?
AND inquiry_id = ?
`)
.bind(referralId,id)
.run();

await env.DB.prepare(`
UPDATE inquiries
SET
status = 'Referred',
next_follow_up_date = ?,
next_follow_up_reason = 'Confirm referral professional contacted client',
follow_up_status = 'Open',
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`)
.bind(followupDate,id)
.run();

await env.DB.prepare(`
INSERT INTO follow_ups (
inquiry_id,
due_date,
reason,
status
)
VALUES (
?,
?,
'Confirm referral professional contacted client',
'Open'
)
`)
.bind(id,followupDate)
.run();

await env.DB.prepare(`
INSERT INTO activity_log (
inquiry_id,
activity_type,
activity_note
)
VALUES (
?,
'Referral Sent',
?
)
`)
.bind(
id,
`Referral #${referralId} approved and sent to ${recipient}. Follow-up scheduled for ${followupDate}.`
)
.run();

}
catch (error) {

if (emailLogId) {
try {
await env.DB.prepare(`
UPDATE email_log
SET
status = 'Failed',
failure_reason = ?
WHERE id = ?
`)
.bind(
String(error?.message || error || "Unknown referral email error"),
emailLogId
)
.run();
} catch {}
}

console.error("Referral send failed:", error);

return new Response(
"Referral email was not sent. The referral remains prepared for review.",
{status:502}
);
}

return redirect(`/inquiry/${id}`);

}


/* ============================================================
   CONTACT PERMISSION CHANGE
   ============================================================ */

if (
request.method === "POST" &&
/^\/inquiry\/\d+\/permission$/.test(
url.pathname
)
) {

if (!sameOriginPost(request)) {

return new Response(
"Invalid request origin.",
{status:403}
);

}


const id =
idFromPath(url.pathname);

const form =
await request.formData();


const channel =
String(
form.get("channel") || ""
);


const action =
String(
form.get("permission_action") || ""
);


const note =
String(
form.get("permission_note") || ""
).trim().slice(0,4000);


if (
!id ||
!["Email","Phone","Text"].includes(channel) ||
!["Allow","Withdraw"].includes(action)
) {

return new Response(
"Invalid permission change.",
{status:400}
);

}


const inquiry =
await env.DB.prepare(`
SELECT *
FROM inquiries
WHERE id = ?
`)
.bind(id)
.first();


if (!inquiry) {

return new Response(
"Inquiry not found.",
{status:404}
);

}


const granted =
action === "Allow"
? 1
: 0;


let contactValue = "";

let purpose = "";

let eventType =
granted
? "Permission Granted"
: "Permission Withdrawn";


/* ---------- EMAIL ---------- */

if (channel === "Email") {

contactValue =
inquiry.email || "";

purpose =
"Future email communications";


if (granted) {

await env.DB.prepare(`
UPDATE inquiries

SET
marketing_email_opt_in = 1,
do_not_email = 0,
updated_at = CURRENT_TIMESTAMP

WHERE id = ?
`)
.bind(id)
.run();


await env.DB.prepare(`
UPDATE suppression_list

SET active = 0

WHERE
channel = 'Email'
AND contact_value = ?
`)
.bind(contactValue)
.run();

}
else {

await env.DB.prepare(`
UPDATE inquiries

SET
marketing_email_opt_in = 0,
do_not_email = 1,
updated_at = CURRENT_TIMESTAMP

WHERE id = ?
`)
.bind(id)
.run();


if (contactValue) {

await env.DB.prepare(`
INSERT INTO suppression_list (
channel,
contact_value,
reason,
inquiry_id,
source,
active
)

VALUES (
'Email',
?,
?,
?,
'Client Preference Change',
1
)

ON CONFLICT(channel, contact_value)
DO UPDATE SET
reason = excluded.reason,
inquiry_id = excluded.inquiry_id,
source = excluded.source,
active = 1
`)
.bind(
contactValue,
"Client withdrew email permission.",
id
)
.run();

}

}

}


/* ---------- PHONE ---------- */

if (channel === "Phone") {

contactValue =
inquiry.phone || "";

purpose =
"Live telephone follow-up";


if (granted) {

const today =
floridaToday();

const expires =
addDays(
today,
inquiryCallDays
);


await env.DB.prepare(`
UPDATE inquiries

SET
live_call_opt_in = 1,
do_not_call = 0,
contact_authority_basis = 'Client Reauthorization',
contact_authority_started_at = CURRENT_TIMESTAMP,
phone_contact_expires_at = ?,
updated_at = CURRENT_TIMESTAMP

WHERE id = ?
`)
.bind(
expires,
id
)
.run();


await env.DB.prepare(`
UPDATE suppression_list

SET active = 0

WHERE
channel = 'Phone'
AND contact_value = ?
`)
.bind(contactValue)
.run();

}
else {

await env.DB.prepare(`
UPDATE inquiries

SET
live_call_opt_in = 0,
do_not_call = 1,
updated_at = CURRENT_TIMESTAMP

WHERE id = ?
`)
.bind(id)
.run();


if (contactValue) {

await env.DB.prepare(`
INSERT INTO suppression_list (
channel,
contact_value,
reason,
inquiry_id,
source,
active
)

VALUES (
'Phone',
?,
?,
?,
'Client Preference Change',
1
)

ON CONFLICT(channel, contact_value)
DO UPDATE SET
reason = excluded.reason,
inquiry_id = excluded.inquiry_id,
source = excluded.source,
active = 1
`)
.bind(
contactValue,
"Client requested no further telephone contact.",
id
)
.run();

}

}

}


/* ---------- TEXT ---------- */

if (channel === "Text") {

contactValue =
inquiry.phone || "";

purpose =
"Text communications";


if (granted) {

await env.DB.prepare(`
UPDATE inquiries

SET
text_opt_in = 1,
do_not_text = 0,
updated_at = CURRENT_TIMESTAMP

WHERE id = ?
`)
.bind(id)
.run();


await env.DB.prepare(`
UPDATE suppression_list

SET active = 0

WHERE
channel = 'Text'
AND contact_value = ?
`)
.bind(contactValue)
.run();

}
else {

await env.DB.prepare(`
UPDATE inquiries

SET
text_opt_in = 0,
do_not_text = 1,
updated_at = CURRENT_TIMESTAMP

WHERE id = ?
`)
.bind(id)
.run();


if (contactValue) {

await env.DB.prepare(`
INSERT INTO suppression_list (
channel,
contact_value,
reason,
inquiry_id,
source,
active
)

VALUES (
'Text',
?,
?,
?,
'Client Preference Change',
1
)

ON CONFLICT(channel, contact_value)
DO UPDATE SET
reason = excluded.reason,
inquiry_id = excluded.inquiry_id,
source = excluded.source,
active = 1
`)
.bind(
contactValue,
"Client withdrew text permission.",
id
)
.run();

}

}

}


/* ---------- AUDIT HISTORY ---------- */

await env.DB.prepare(`
INSERT INTO consent_history (
inquiry_id,
event_type,
channel,
purpose,
permission_granted,
consent_version,
contact_value,
source,
event_note
)

VALUES (
?,?,?,?,?,?,?,?,?
)
`)
.bind(
id,
eventType,
channel,
purpose,
granted,
"ADMIN-PREFERENCE-CHANGE-001",
contactValue,
"FLTract Admin",
note || `${channel} permission ${action.toLowerCase()}.`
)
.run();


await env.DB.prepare(`
INSERT INTO activity_log (
inquiry_id,
activity_type,
activity_note
)

VALUES (
?,
'Contact Permission',
?
)
`)
.bind(
id,
`${channel} permission ${action.toLowerCase()}. ${note}`
)
.run();


return redirect(
`/inquiry/${id}`
);

}


/* ============================================================
   CREATE FOLLOW UP
   ============================================================ */

if (
request.method === "POST" &&
/^\/inquiry\/\d+\/followup$/.test(
url.pathname
)
) {

if (!sameOriginPost(request)) {

return new Response(
"Invalid request origin.",
{status:403}
);

}


const id =
idFromPath(url.pathname);

const form =
await request.formData();


const dueDate =
String(
form.get("due_date") || ""
).trim();


const reason =
String(
form.get("reason") || ""
).trim().slice(0,1000);


if (
!id ||
!dueDate ||
!reason
) {

return new Response(
"Follow-up date and reason are required.",
{status:400}
);

}


await env.DB.prepare(`
INSERT INTO follow_ups (
inquiry_id,
due_date,
reason,
status
)

VALUES (
?,
?,
?,
'Open'
)
`)
.bind(
id,
dueDate,
reason
)
.run();


await env.DB.prepare(`
UPDATE inquiries

SET
next_follow_up_date = ?,
next_follow_up_reason = ?,
follow_up_status = 'Open',
updated_at = CURRENT_TIMESTAMP

WHERE id = ?
`)
.bind(
dueDate,
reason,
id
)
.run();


await env.DB.prepare(`
INSERT INTO activity_log (
inquiry_id,
activity_type,
activity_note
)

VALUES (
?,
'Follow Up Scheduled',
?
)
`)
.bind(
id,
`Follow up scheduled for ${dueDate}: ${reason}`
)
.run();


return redirect(
`/inquiry/${id}`
);

}


/* ============================================================
   COMPLETE FOLLOW UP
   ============================================================ */

if (
request.method === "POST" &&
/^\/inquiry\/\d+\/followup-complete$/.test(
url.pathname
)
) {

if (!sameOriginPost(request)) {

return new Response(
"Invalid request origin.",
{status:403}
);

}


const id =
idFromPath(url.pathname);

const form =
await request.formData();


const followupId =
Number(
form.get("followup_id")
);


const completedNote =
String(
form.get("completed_note") || ""
).trim().slice(0,4000);


const nextDueDate =
String(
form.get("next_due_date") || ""
).trim();


const nextReason =
String(
form.get("next_reason") || ""
).trim().slice(0,1000);


if (
!id ||
!Number.isInteger(followupId)
) {

return new Response(
"Invalid follow-up.",
{status:400}
);

}


await env.DB.prepare(`
UPDATE follow_ups

SET
status = 'Completed',
completed_at = CURRENT_TIMESTAMP,
completed_note = ?

WHERE
id = ?
AND inquiry_id = ?
`)
.bind(
completedNote,
followupId,
id
)
.run();


if (nextDueDate || nextReason) {

if (
!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(nextDueDate) ||
!nextReason
) {
return new Response(
"To schedule the next follow-up, both a valid date and reason are required.",
{status:400}
);
}

await env.DB.prepare(`
INSERT INTO follow_ups (
inquiry_id,
due_date,
reason,
status
)
VALUES (
?,
?,
?,
'Open'
)
`)
.bind(
id,
nextDueDate,
nextReason
)
.run();

await env.DB.prepare(`
INSERT INTO activity_log (
inquiry_id,
activity_type,
activity_note
)
VALUES (
?,
'Follow Up Scheduled',
?
)
`)
.bind(
id,
`Next follow up scheduled for ${nextDueDate}: ${nextReason}`
)
.run();

}


const nextOpen =
await env.DB.prepare(`
SELECT
id,
due_date,
reason

FROM follow_ups

WHERE
inquiry_id = ?
AND status = 'Open'

ORDER BY due_date ASC
LIMIT 1
`)
.bind(id)
.first();


if (nextOpen) {

await env.DB.prepare(`
UPDATE inquiries

SET
next_follow_up_date = ?,
next_follow_up_reason = ?,
follow_up_status = 'Open',
updated_at = CURRENT_TIMESTAMP

WHERE id = ?
`)
.bind(
nextOpen.due_date,
nextOpen.reason,
id
)
.run();

}
else {

await env.DB.prepare(`
UPDATE inquiries

SET
next_follow_up_date = NULL,
next_follow_up_reason = NULL,
follow_up_status = 'None',
updated_at = CURRENT_TIMESTAMP

WHERE id = ?
`)
.bind(id)
.run();

}


await env.DB.prepare(`
INSERT INTO activity_log (
inquiry_id,
activity_type,
activity_note
)

VALUES (
?,
'Follow Up Completed',
?
)
`)
.bind(
id,
completedNote
? `Follow up completed: ${completedNote}`
: "Follow up completed."
)
.run();


return redirect(
`/inquiry/${id}`
);

}


/* ============================================================
   ARCHIVE / RESTORE INQUIRY
   ============================================================ */

if (
request.method === "POST" &&
/^\/inquiry\/\d+\/archive$/.test(url.pathname)
) {

if (!sameOriginPost(request)) {
return new Response(
"Invalid request origin.",
{status:403}
);
}

const id = idFromPath(url.pathname);
const form = await request.formData();
const reason =
String(form.get("archive_reason") || "")
.trim()
.slice(0,2000);

if (!id || !reason) {
return new Response(
"An archive reason is required.",
{status:400}
);
}

const inquiry =
await env.DB.prepare(`
SELECT id, archived
FROM inquiries
WHERE id = ?
LIMIT 1
`)
.bind(id)
.first();

if (!inquiry) {
return new Response(
"Inquiry not found.",
{status:404}
);
}

if (Number(inquiry.archived) !== 1) {

await env.DB.prepare(`
UPDATE inquiries
SET
archived = 1,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`)
.bind(id)
.run();

await env.DB.prepare(`
INSERT INTO activity_log (
inquiry_id,
activity_type,
activity_note
)
VALUES (
?,
'Inquiry Archived',
?
)
`)
.bind(
id,
`Inquiry removed from the active work queue. Reason: ${reason}`
)
.run();

}

return redirect(`/inquiry/${id}`);

}


if (
request.method === "POST" &&
/^\/inquiry\/\d+\/restore$/.test(url.pathname)
) {

if (!sameOriginPost(request)) {
return new Response(
"Invalid request origin.",
{status:403}
);
}

const id = idFromPath(url.pathname);
const form = await request.formData();
const reason =
String(form.get("restore_reason") || "")
.trim()
.slice(0,2000);

if (!id) {
return new Response(
"Inquiry not found.",
{status:404}
);
}

const inquiry =
await env.DB.prepare(`
SELECT id, archived
FROM inquiries
WHERE id = ?
LIMIT 1
`)
.bind(id)
.first();

if (!inquiry) {
return new Response(
"Inquiry not found.",
{status:404}
);
}

if (Number(inquiry.archived) === 1) {

await env.DB.prepare(`
UPDATE inquiries
SET
archived = 0,
updated_at = CURRENT_TIMESTAMP
WHERE id = ?
`)
.bind(id)
.run();

await env.DB.prepare(`
INSERT INTO activity_log (
inquiry_id,
activity_type,
activity_note
)
VALUES (
?,
'Inquiry Restored',
?
)
`)
.bind(
id,
reason
? `Inquiry restored to the active work queue. Reason: ${reason}`
: "Inquiry restored to the active work queue."
)
.run();

}

return redirect(`/inquiry/${id}`);

}


/* ============================================================
   FOLLOW UP DASHBOARD
   ============================================================ */

if (
request.method === "GET" &&
url.pathname === "/followups"
) {

const today =
floridaToday();


const open =
await env.DB.prepare(`
SELECT
f.id AS followup_id,
f.inquiry_id,
f.due_date,
f.reason,
i.first_name,
i.last_name,
i.county,
i.status AS inquiry_status

FROM follow_ups f

JOIN inquiries i
ON i.id = f.inquiry_id

WHERE
f.status = 'Open'
AND i.archived = 0

ORDER BY f.due_date ASC
`).all();


let overdue = 0;
let dueToday = 0;
let future = 0;


const rows =
open.results.length
?
open.results.map(r => {

let cls =
"followup-future";

let dueLabel =
calendarDate(r.due_date);


if (r.due_date < today) {
overdue++;
cls =
"followup-overdue";
dueLabel +=
" — OVERDUE";
}
else if (r.due_date === today) {
dueToday++;cls =
"followup-today";
dueLabel +=
" — DUE TODAY";
}
else {
future++;
}


return `

<div class="panel ${cls}">

<div class="grid">

<div>
<div class="label">
Client
</div>

<div class="value">
<a href="/inquiry/${r.inquiry_id}">
#${r.inquiry_id}
${esc(r.first_name)}
${esc(r.last_name)}
</a>
</div>
</div>


<div>
<div class="label">
Due
</div>

<div class="value">
${esc(dueLabel)}
</div>
</div>


<div>
<div class="label">
County
</div>

<div class="value">
${esc(r.county)}
</div>
</div>


<div>
<div class="label">
Inquiry Status
</div>

<div class="value">
${esc(r.inquiry_status)}
</div>
</div>

</div>


<div style="margin-top:15px">

<div class="label">
Reason
</div>

<div class="value">
${esc(r.reason)}
</div>

</div>

</div>

`;

}).join("")
:
`
<div class="panel empty">
No open follow-ups.
</div>
`;


return new Response(
page(`

<h1>
Follow Ups
</h1>


<div class="summary-grid">

<div class="summary-card">

<div class="label">
Overdue
</div>

<div class="summary-number">
${overdue}
</div>

</div>


<div class="summary-card">

<div class="label">
Due Today
</div>

<div class="summary-number">
${dueToday}
</div>

</div>


<div class="summary-card">

<div class="label">
Upcoming
</div>

<div class="summary-number">
${future}
</div>

</div>

</div>


${rows}

`),
{
headers:{
"content-type":
"text/html; charset=utf-8",

"cache-control":
"no-store"
}
}
);

}


/* ============================================================
   CLIENT / PROPERTY ASSIGNMENTS
   ============================================================ */

if (
request.method === "POST" &&
/^\/client\/\d+\/assign$/.test(url.pathname)
) {
  if (!sameOriginPost(request)) return new Response("Invalid request origin.", {status:403});
  if (!staff.authenticated || !staffCan(staff.user, "manage_assignments")) {
    await logStaffAccess(env, staff, request, "Client Assignment", "Denied");
    return new Response("You do not have permission to assign client records.", {status:403});
  }

  const clientId = Number(url.pathname.split("/").filter(Boolean)[1]);
  const form = await request.formData();
  const staffUserId = Number(form.get("staff_user_id"));
  const assignmentRole = String(form.get("assignment_role") || "Primary");
  const allowed = ["Primary","Support","Research"];

  const target = await env.DB.prepare(`
    SELECT id, email FROM staff_users WHERE id = ? AND active = 1 LIMIT 1
  `).bind(staffUserId).first();

  const client = await env.DB.prepare(`
    SELECT id FROM clients WHERE id = ? LIMIT 1
  `).bind(clientId).first();

  if (!client || !target || !allowed.includes(assignmentRole)) {
    return new Response("Invalid client assignment.", {status:400});
  }

  await env.DB.prepare(`
    INSERT OR IGNORE INTO client_assignments (
      client_id, staff_user_id, assignment_role, active, assigned_by_email
    )
    VALUES (?, ?, ?, 1, ?)
  `).bind(clientId, staffUserId, assignmentRole, staff.email || "").run();

  await env.DB.prepare(`
    UPDATE client_assignments
    SET assignment_role = ?, assigned_by_email = ?
    WHERE client_id = ? AND staff_user_id = ? AND active = 1
  `).bind(assignmentRole, staff.email || "", clientId, staffUserId).run();

  await logStaffAccess(
    env, staff, request, "Client Assigned", "Allowed",
    `${clientCode(clientId)} -> ${target.email} (${assignmentRole})`
  );

  return redirect(`/client/${clientId}`);
}


if (
request.method === "POST" &&
/^\/client\/\d+\/assignment\/\d+\/end$/.test(url.pathname)
) {
  if (!sameOriginPost(request)) return new Response("Invalid request origin.", {status:403});
  if (!staff.authenticated || !staffCan(staff.user, "manage_assignments")) {
    return new Response("You do not have permission to change client assignments.", {status:403});
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const clientId = Number(parts[1]);
  const assignmentId = Number(parts[3]);
  const form = await request.formData();
  const reason = String(form.get("reason") || "Reassigned / unassigned").trim().slice(0,500);

  const assignment = await env.DB.prepare(`
    SELECT ca.*, su.email
    FROM client_assignments ca
    JOIN staff_users su ON su.id = ca.staff_user_id
    WHERE ca.id = ? AND ca.client_id = ? AND ca.active = 1
    LIMIT 1
  `).bind(assignmentId, clientId).first();

  if (!assignment) return new Response("Active client assignment not found.", {status:404});

  await env.DB.prepare(`
    UPDATE client_assignments
    SET active = 0, ended_at = CURRENT_TIMESTAMP, end_reason = ?
    WHERE id = ?
  `).bind(reason, assignmentId).run();

  await logStaffAccess(
    env, staff, request, "Client Assignment Ended", "Allowed",
    `${clientCode(clientId)} -> ${assignment.email}; ${reason}`
  );

  return redirect(`/client/${clientId}`);
}


if (
request.method === "POST" &&
/^\/property\/\d+\/assign$/.test(url.pathname)
) {
  if (!sameOriginPost(request)) return new Response("Invalid request origin.", {status:403});
  if (!staff.authenticated || !staffCan(staff.user, "manage_assignments")) {
    await logStaffAccess(env, staff, request, "Property Assignment", "Denied");
    return new Response("You do not have permission to assign property records.", {status:403});
  }

  const propertyId = Number(url.pathname.split("/").filter(Boolean)[1]);
  const form = await request.formData();
  const staffUserId = Number(form.get("staff_user_id"));
  const assignmentRole = String(form.get("assignment_role") || "Primary");
  const allowed = ["Primary","Support","Research"];

  const target = await env.DB.prepare(`
    SELECT id, email FROM staff_users WHERE id = ? AND active = 1 LIMIT 1
  `).bind(staffUserId).first();

  const property = await env.DB.prepare(`
    SELECT id FROM properties WHERE id = ? LIMIT 1
  `).bind(propertyId).first();

  if (!property || !target || !allowed.includes(assignmentRole)) {
    return new Response("Invalid property assignment.", {status:400});
  }

  await env.DB.prepare(`
    INSERT OR IGNORE INTO property_assignments (
      property_id, staff_user_id, assignment_role, active, assigned_by_email
    )
    VALUES (?, ?, ?, 1, ?)
  `).bind(propertyId, staffUserId, assignmentRole, staff.email || "").run();

  await env.DB.prepare(`
    UPDATE property_assignments
    SET assignment_role = ?, assigned_by_email = ?
    WHERE property_id = ? AND staff_user_id = ? AND active = 1
  `).bind(assignmentRole, staff.email || "", propertyId, staffUserId).run();

  await logStaffAccess(
    env, staff, request, "Property Assigned", "Allowed",
    `${propertyCode(propertyId)} -> ${target.email} (${assignmentRole})`
  );

  return redirect(`/property/${propertyId}`);
}


if (
request.method === "POST" &&
/^\/property\/\d+\/assignment\/\d+\/end$/.test(url.pathname)
) {
  if (!sameOriginPost(request)) return new Response("Invalid request origin.", {status:403});
  if (!staff.authenticated || !staffCan(staff.user, "manage_assignments")) {
    return new Response("You do not have permission to change property assignments.", {status:403});
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const propertyId = Number(parts[1]);
  const assignmentId = Number(parts[3]);
  const form = await request.formData();
  const reason = String(form.get("reason") || "Reassigned / unassigned").trim().slice(0,500);

  const assignment = await env.DB.prepare(`
    SELECT pa.*, su.email
    FROM property_assignments pa
    JOIN staff_users su ON su.id = pa.staff_user_id
    WHERE pa.id = ? AND pa.property_id = ? AND pa.active = 1
    LIMIT 1
  `).bind(assignmentId, propertyId).first();

  if (!assignment) return new Response("Active property assignment not found.", {status:404});

  await env.DB.prepare(`
    UPDATE property_assignments
    SET active = 0, ended_at = CURRENT_TIMESTAMP, end_reason = ?
    WHERE id = ?
  `).bind(reason, assignmentId).run();

  await logStaffAccess(
    env, staff, request, "Property Assignment Ended", "Allowed",
    `${propertyCode(propertyId)} -> ${assignment.email}; ${reason}`
  );

  return redirect(`/property/${propertyId}`);
}


/* ============================================================
   CLIENT ACCOUNT DIRECTORY
   ============================================================ */

if (
request.method === "GET" &&
url.pathname === "/clients"
) {

/*
  Backfill legacy inquiries in small batches.
  This lets the new Client Account system adopt existing records
  without a destructive migration or a long blocking database job.
*/
const unlinked =
await env.DB.prepare(`
SELECT i.*
FROM inquiries i
LEFT JOIN client_inquiries ci
  ON ci.inquiry_id = i.id
WHERE
  ci.inquiry_id IS NULL
  AND TRIM(COALESCE(i.email,'')) <> ''
ORDER BY i.created_at DESC, i.id DESC
LIMIT 100
`).all();

for (const inquiry of unlinked.results) {
  try {
    const client = await ensureClientForInquiry(env, inquiry);
    await ensurePropertyForInquiry(env, inquiry, client?.id);
  }
  catch (error) {
    console.error(
      "Legacy client backfill failed for inquiry",
      inquiry.id,
      error
    );
  }
}

const {results = []} =
await env.DB.prepare(`
SELECT
c.*,
COUNT(ci.inquiry_id) AS inquiry_count,
SUM(
  CASE
    WHEN i.archived = 0
    THEN 1 ELSE 0
  END
) AS active_inquiry_count
FROM clients c
LEFT JOIN client_inquiries ci
  ON ci.client_id = c.id
LEFT JOIN inquiries i
  ON i.id = ci.inquiry_id
GROUP BY c.id
ORDER BY c.updated_at DESC, c.id DESC
`).all();

const rows =
results.length
?
results.map(client => `
<tr>
<td>
<a href="/client/${client.id}">
<strong>${esc(clientCode(client.id))}</strong>
</a>
</td>
<td>
${esc(client.first_name)} ${esc(client.last_name)}
</td>
<td>
${esc(client.email)}
</td>
<td>
${esc(client.phone)}
</td>
<td>
${esc(client.inquiry_count || 0)}
</td>
<td>
${esc(client.active_inquiry_count || 0)}
</td>
</tr>
`).join("")
:
`
<tr>
<td colspan="6" class="empty">
No client accounts have been created yet.
</td>
</tr>
`;

return new Response(
page(`

<a class="back" href="/">
← Back to inquiries
</a>

<div class="panel">

<h1>
Client Accounts
</h1>

<p class="section-note">
A Client Account groups the same person's FLTract inquiries and properties under one permanent Client ID. New intake submissions are automatically linked only when the normalized email address exactly matches an existing client. FLTract does not use fuzzy name matching to merge people automatically.
</p>

<p class="section-note">
Use this directory to review a client's complete relationship with FLTract. Archiving one inquiry does not archive the client or the client's other properties.
</p>

<table>
<thead>
<tr>
<th>Client ID</th>
<th>Client</th>
<th>Email</th>
<th>Phone</th>
<th>Total Inquiries</th>
<th>Active</th>
</tr>
</thead>
<tbody>
${rows}
</tbody>
</table>

</div>
`)
,
{
headers:{
"content-type":"text/html; charset=utf-8",
"cache-control":"no-store"
}
}
);

}


/* ============================================================
   CLIENT ACCOUNT DETAIL
   ============================================================ */

if (
request.method === "GET" &&
/^\/client\/\d+$/.test(url.pathname)
) {

const clientId =
Number(url.pathname.split("/").filter(Boolean)[1]);

const client =
await env.DB.prepare(`
SELECT *
FROM clients
WHERE id = ?
LIMIT 1
`)
.bind(clientId)
.first();

if (!client) {
return new Response(
"Client account not found.",
{status:404}
);
}

const inquiries =
await env.DB.prepare(`
SELECT
i.*,
ci.linked_at,
ci.link_basis
FROM client_inquiries ci
JOIN inquiries i
  ON i.id = ci.inquiry_id
WHERE ci.client_id = ?
ORDER BY i.created_at DESC, i.id DESC
`)
.bind(clientId)
.all();

const latestInquiry =
inquiries.results[0] || null;

const properties =
await env.DB.prepare(`
SELECT
p.*,
COUNT(pi.inquiry_id) AS inquiry_count
FROM properties p
LEFT JOIN property_inquiries pi
  ON pi.property_id = p.id
WHERE p.client_id = ?
GROUP BY p.id
ORDER BY p.created_at DESC, p.id DESC
`)
.bind(clientId)
.all();

const referrals =
await env.DB.prepare(`
SELECT
r.*,
i.property_location,
i.county
FROM referral_history r
JOIN client_inquiries ci
  ON ci.inquiry_id = r.inquiry_id
JOIN inquiries i
  ON i.id = r.inquiry_id
WHERE ci.client_id = ?
ORDER BY r.created_at DESC, r.id DESC
`)
.bind(clientId)
.all();

const followups =
await env.DB.prepare(`
SELECT
f.*,
i.property_location
FROM follow_ups f
JOIN client_inquiries ci
  ON ci.inquiry_id = f.inquiry_id
JOIN inquiries i
  ON i.id = f.inquiry_id
WHERE ci.client_id = ?
ORDER BY f.due_date DESC, f.id DESC
`)
.bind(clientId)
.all();

const activities =
await env.DB.prepare(`
SELECT
a.*,
i.property_location
FROM activity_log a
JOIN client_inquiries ci
  ON ci.inquiry_id = a.inquiry_id
JOIN inquiries i
  ON i.id = a.inquiry_id
WHERE ci.client_id = ?
ORDER BY a.created_at DESC, a.id DESC
LIMIT 100
`)
.bind(clientId)
.all();

const clientAssignments = await assignmentScopeForClient(env, clientId);
const assignableStaff = await activeStaffUsers(env);

const assignmentRows = clientAssignments.length
? clientAssignments.map(a => `
  <tr>
    <td><strong>${esc(a.display_name || a.email)}</strong><br><span class="small">${esc(a.email)}</span></td>
    <td>${esc(a.role)}</td>
    <td>${esc(a.assignment_role)}</td>
    <td>${esc(floridaTime(a.assigned_at))}</td>
    <td>
      ${staff.authenticated && staffCan(staff.user, "manage_assignments") ? `
      <form method="post" action="/client/${clientId}/assignment/${a.assignment_id}/end">
        <input name="reason" maxlength="500" placeholder="Reason for reassignment / unassignment" required>
        <button type="submit">End Assignment</button>
      </form>` : ""}
    </td>
  </tr>
`).join("")
: '<tr><td colspan="5" class="empty">No staff member is currently assigned to this client.</td></tr>';

const staffOptions = assignableStaff.map(u =>
  `<option value="${u.id}">${esc(u.display_name || u.email)} — ${esc(u.role)}</option>`
).join("");

const phoneStatus =
latestInquiry
? phoneContactStatus(latestInquiry, warningDays)
: {text:"NO ACTIVE PERMISSION",css:"muted"};

const emailStatus =
latestInquiry
? emailContactStatus(latestInquiry)
: {text:"NO EMAIL PERMISSION",css:"muted"};

const textStatus =
latestInquiry
? textContactStatus(latestInquiry)
: {text:"NO TEXT CONSENT",css:"muted"};

const propertyRows =
properties.results.length
?
properties.results.map(p => `
<tr>
<td><a href="/property/${p.id}"><strong>${esc(propertyCode(p.id))}</strong></a></td>
<td>${esc(p.property_location || "Not recorded")}</td>
<td>${esc(p.county || "")}</td>
<td>${esc(p.property_type || "")}</td>
<td>${esc(p.parcel_id || "Not researched")}</td>
<td>${esc(p.research_status || "Not Started")}</td>
</tr>
`).join("")
:
`<tr><td colspan="6" class="empty">No property records yet.</td></tr>`;

const inquiryRows =
inquiries.results.length
?
inquiries.results.map(i => `
<tr>
<td>
<a href="/inquiry/${i.id}">
#${esc(i.id)}
</a>
</td>
<td>
${esc(inquiryTypeDisplay(i.inquiry_type))}
</td>
<td>
${esc(i.property_location || "Not recorded")}
</td>
<td>
${esc(i.county || "")}
</td>
<td>
${esc(i.property_type || "")}
</td>
<td>
${esc(i.status || "")}
${Number(i.archived) === 1 ? ' <span class="badge muted">Archived</span>' : ""}
</td>
</tr>
`).join("")
:
`<tr><td colspan="6" class="empty">No linked inquiries.</td></tr>`;

const referralRows =
referrals.results.length
?
referrals.results.map(r => `
<tr>
<td>#${esc(r.inquiry_id)}</td>
<td>${esc(r.referred_to_name || "")}</td>
<td>${esc(r.referred_to_company || "")}</td>
<td>${esc(r.status || "")}</td>
<td>${esc(r.referral_date ? floridaTime(r.referral_date) : "Prepared / not sent")}</td>
</tr>
`).join("")
:
`<tr><td colspan="5" class="empty">No referrals recorded.</td></tr>`;

const followupRows =
followups.results.length
?
followups.results.map(f => `
<tr>
<td>#${esc(f.inquiry_id)}</td>
<td>${esc(calendarDate(f.due_date))}</td>
<td>${esc(f.reason || "")}</td>
<td>${esc(f.status || "")}</td>
</tr>
`).join("")
:
`<tr><td colspan="4" class="empty">No follow-ups recorded.</td></tr>`;

const activityRows =
activities.results.length
?
activities.results.map(a => `
<div class="panel">
<div class="label">
${esc(a.activity_type)} — Inquiry #${esc(a.inquiry_id)}
</div>
<div class="value note">
${esc(a.activity_note || "")}
</div>
<div class="small" style="margin-top:10px">
${esc(floridaTime(a.created_at))}
</div>
</div>
`).join("")
:
`<div class="panel empty">No activity recorded.</div>`;

return new Response(
page(`

<a class="back" href="/clients">
← Back to Client Accounts
</a>

<div class="panel">

<h1>
Client ${esc(clientCode(client.id))}
</h1>

<p class="section-note">
This is the client's permanent FLTract account. It groups multiple property inquiries, referrals, follow-ups, and activity without combining the underlying inquiry records. Each property/inquiry keeps its own workflow and audit history.
</p>

<div class="grid">

<div>
<div class="label">Client</div>
<div class="value">${esc(client.first_name)} ${esc(client.last_name)}</div>
</div>

<div>
<div class="label">Client ID</div>
<div class="value"><strong>${esc(clientCode(client.id))}</strong></div>
</div>

<div>
<div class="label">Email</div>
<div class="value">${esc(client.email)}</div>
</div>

<div>
<div class="label">Phone</div>
<div class="value">${esc(client.phone || "Not recorded")}</div>
</div>

<div>
<div class="label">Created</div>
<div class="value">${esc(floridaTime(client.created_at))}</div>
</div>

<div>
<div class="label">Linked Inquiries</div>
<div class="value">${esc(inquiries.results.length)}</div>
</div>

</div>

</div>

<div class="panel">
<h2>Staff Responsibility</h2>
<p class="section-note">
Client assignment controls who is responsible for this relationship. A property may also have its own more-specific assignment. Ending an assignment preserves the historical record; FLTract does not delete assignment history.
</p>

<table>
<thead><tr><th>Staff</th><th>System Role</th><th>Assignment</th><th>Assigned</th><th></th></tr></thead>
<tbody>${assignmentRows}</tbody>
</table>

${staff.authenticated && staffCan(staff.user, "manage_assignments") ? `
<form method="post" action="/client/${clientId}/assign" style="margin-top:16px">
<div class="form-grid">
<label><span>Assign Staff</span><select name="staff_user_id" required>
<option value="">Choose staff member</option>
${staffOptions}
</select></label>
<label><span>Responsibility</span><select name="assignment_role">
<option>Primary</option>
<option>Support</option>
<option>Research</option>
</select></label>
</div>
<div style="margin-top:14px"><button type="submit">Assign Client</button></div>
</form>
` : '<p class="section-note">Assignment changes require an authorized FLTract manager, CEO, or Administrator.</p>'}
</div>


<div class="panel">

<h2>
Current Contact Compliance
</h2>

<p class="section-note">
These traffic lights reflect the client's most recent linked inquiry. Always open the specific inquiry before making a consequential contact decision because permissions are recorded by channel and preserved with each inquiry.
</p>

<div class="compliance-signals">

<div class="signal">
<span class="signal-light ${phoneStatus.css}" aria-hidden="true">●</span>
<span>Phone — ${esc(phoneStatus.text)}</span>
</div>

<div class="signal">
<span class="signal-light ${emailStatus.css}" aria-hidden="true">●</span>
<span>Email — ${esc(emailStatus.text)}</span>
</div>

<div class="signal">
<span class="signal-light ${textStatus.css}" aria-hidden="true">●</span>
<span>Text — ${esc(textStatus.text)}</span>
</div>

</div>

</div>


<div class="panel">

<h2>
Property Records
</h2>

<p class="section-note">
A Property Record is the durable research file for a parcel or tract. It is separate from the client's inquiry so parcel ID, legal description, values, zoning, ownership, and research can be maintained without rewriting the original intake record.
</p>

<table>
<thead>
<tr>
<th>Property ID</th>
<th>Location</th>
<th>County</th>
<th>Type</th>
<th>Parcel ID</th>
<th>Research</th>
</tr>
</thead>
<tbody>
${propertyRows}
</tbody>
</table>

</div>

<div class="panel">

<h2>
Inquiry History
</h2>

<p class="section-note">
These are the client's original inquiry records. They remain separate for consent, referral, follow-up, and audit history even when linked to a Property Record.
</p>

<table>
<thead>
<tr>
<th>Inquiry</th>
<th>Type</th>
<th>Property Location</th>
<th>County</th>
<th>Property Type</th>
<th>Status</th>
</tr>
</thead>
<tbody>
${inquiryRows}
</tbody>
</table>

</div>


<div class="panel">

<h2>
Referral History
</h2>

<p class="section-note">
This panel shows referrals across all inquiries linked to this client. Sending and approval controls remain on the individual inquiry so the correct property record is always used.
</p>

<table>
<thead>
<tr>
<th>Inquiry</th>
<th>Recipient</th>
<th>Company</th>
<th>Status</th>
<th>Referral Date</th>
</tr>
</thead>
<tbody>
${referralRows}
</tbody>
</table>

</div>


<div class="panel">

<h2>
Follow-Ups
</h2>

<p class="section-note">
This is a client-wide view of scheduled and completed follow-ups. Complete or reschedule work from the individual inquiry so its audit trail remains precise.
</p>

<table>
<thead>
<tr>
<th>Inquiry</th>
<th>Due</th>
<th>Reason</th>
<th>Status</th>
</tr>
</thead>
<tbody>
${followupRows}
</tbody>
</table>

</div>


<details class="history-collapse">

<summary>
Client Activity History — ${activities.results.length} Recent Record${activities.results.length === 1 ? "" : "s"}
</summary>

<div class="history-collapse-body">

<p class="section-note">
This combined history is for reference and training. It brings together notes and workflow events from the client's linked inquiries while preserving the original inquiry-level records.
</p>

${activityRows}

</div>

</details>

`)
,
{
headers:{
"content-type":"text/html; charset=utf-8",
"cache-control":"no-store"
}
}
);

}


/* ============================================================
   OFFICIAL COUNTY RESEARCH — ST. LUCIE FIRST ADAPTER
   ============================================================ */

if (
request.method === "POST" &&
/^\/property\/\d+\/official-research$/.test(url.pathname)
) {
  if (!sameOriginPost(request)) {
    return new Response("Invalid request origin.", {status:403});
  }

  const propertyId = Number(url.pathname.split("/").filter(Boolean)[1]);
  const property = await env.DB.prepare(`
    SELECT * FROM properties WHERE id = ? LIMIT 1
  `).bind(propertyId).first();

  if (!property) {
    return new Response("Property record not found.", {status:404});
  }

  const adapter = COUNTY_RESEARCH_ADAPTERS[property.county];

  if (!adapter) {
    return new Response("No official county adapter is registered for this county.", {status:400});
  }

  const run = await env.DB.prepare(`
    INSERT INTO official_research_runs (
      property_id, county, adapter_key, status, source_name
    )
    VALUES (?, ?, ?, 'Processing', ?)
  `).bind(propertyId, property.county || "", adapter.key, adapter.sourceName).run();

  const runId = Number(run?.meta?.last_row_id) || 0;

  if (property.county !== "St. Lucie") {
    const note = `${adapter.sourceName} is registered; automatic parsing is not live for this county yet.`;
    await env.DB.prepare(`
      UPDATE official_research_runs
      SET status = 'Adapter Pending', result_note = ?, completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(note, runId).run();

    return redirect(`/property/${propertyId}`);
  }

  try {
    const where = stLucieSubjectWhere(property);
    if (!where) {
      throw new Error("Enter a parcel ID or complete property location before running official research.");
    }

    const subjectData = await queryOfficialArcGIS(ST_LUCIE_PARCEL_QUERY, {
      where,
      outFields:"ParcelID,PropertyID,LandUseCode,LandUseCodeDescription,ImprovedStatus,TotalArea,Zoning,SiteAddress,SiteCity,SiteZIP,Owner1,Owner2,MailAddress1,MailAddress2,MailCity,MailState,MailZipCode,TotalAppraisedValue,TotalAssessedValue,TotalTaxableValue,LegalDescription",
      returnGeometry:"true",
      outSR:"3857",
      resultRecordCount:"5"
    });

    const matches = subjectData.features || [];

    if (matches.length !== 1) {
      const note = matches.length
        ? `${matches.length} possible parcels matched. FLTract stopped for parcel verification instead of guessing.`
        : "No exact official parcel match was found. Verify the address or enter the official parcel ID.";

      await env.DB.prepare(`
        UPDATE official_research_runs
        SET status = 'Needs Verification',
            subject_matches = ?,
            result_note = ?,
            completed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(matches.length, note, runId).run();

      await env.DB.prepare(`
        UPDATE properties
        SET research_status = 'Needs Verification', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(propertyId).run();

      return redirect(`/property/${propertyId}`);
    }

    const feature = matches[0];
    const a = feature.attributes || {};
    const mailing = [
      a.MailAddress1,
      a.MailAddress2,
      [a.MailCity,a.MailState,a.MailZipCode].filter(Boolean).join(" ")
    ].filter(Boolean).join(", ");

    await env.DB.prepare(`
      UPDATE properties
      SET
        parcel_id = ?,
        legal_description = ?,
        owner_name = ?,
        owner_mailing_address = ?,
        assessed_value = ?,
        market_value = ?,
        taxable_value = ?,
        zoning = ?,
        land_use = ?,
        data_source = 'St. Lucie County Property Appraiser — Public Parcel Layer',
        data_verified_at = CURRENT_TIMESTAMP,
        research_status = 'Researching',
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      a.ParcelID || "",
      a.LegalDescription || "",
      [a.Owner1,a.Owner2].filter(Boolean).join(" / "),
      mailing,
      a.TotalAssessedValue == null ? "" : String(a.TotalAssessedValue),
      a.TotalAppraisedValue == null ? "" : String(a.TotalAppraisedValue),
      a.TotalTaxableValue == null ? "" : String(a.TotalTaxableValue),
      a.Zoning || "",
      a.LandUseCodeDescription || a.LandUseCode || "",
      propertyId
    ).run();

    const report = await ensureMiniCompForProperty(env, propertyId);
    let imported = 0;

    if (feature.geometry && report?.id) {
      const salesData = await queryOfficialArcGIS(ST_LUCIE_PARCEL_QUERY, {
        where:`SalePrice > 0 AND ParcelID <> '${researchSql(a.ParcelID || "")}'`,
        geometry:JSON.stringify(feature.geometry),
        geometryType:"esriGeometryPolygon",
        inSR:"3857",
        spatialRel:"esriSpatialRelIntersects",
        distance:"20",
        units:"esriSRUnit_StatuteMile",
        outFields:"ParcelID,PropertyID,LandUseCodeDescription,ImprovedStatus,TotalArea,Zoning,SiteAddress,SiteCity,SalePrice,SaleDate,NALCode",
        returnGeometry:"false",
        orderByFields:"SaleDate DESC",
        resultRecordCount:"25"
      });

      for (const candidate of (salesData.features || []).slice(0,10)) {
        const s = candidate.attributes || {};
        const saleDate = Number.isFinite(Number(s.SaleDate))
          ? new Date(Number(s.SaleDate)).toISOString().slice(0,10)
          : "";

        const exists = await env.DB.prepare(`
          SELECT id FROM mini_comp_comparables
          WHERE report_id = ? AND parcel_id = ? AND sale_date = ? AND sale_price = ?
          LIMIT 1
        `).bind(report.id, s.ParcelID || "", saleDate, Number(s.SalePrice) || 0).first();

        if (exists) continue;

        await env.DB.prepare(`
          INSERT INTO mini_comp_comparables (
            report_id, property_location, county, parcel_id,
            sale_date, sale_price, qualified_sale, improvements,
            source_name, source_reference, source_retrieved_at,
            selection_reason, notes
          )
          VALUES (?, ?, 'St. Lucie', ?, ?, ?, 'Unknown', ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)
        `).bind(
          report.id,
          [s.SiteAddress,s.SiteCity].filter(Boolean).join(", ") || `Parcel ${s.ParcelID || ""}`,
          s.ParcelID || "",
          saleDate,
          Number(s.SalePrice) || null,
          [
            s.LandUseCodeDescription,
            s.ImprovedStatus ? `Improved: ${s.ImprovedStatus}` : "",
            s.Zoning ? `Zoning: ${s.Zoning}` : ""
          ].filter(Boolean).join(" · "),
          "St. Lucie County Property Appraiser",
          `Public Parcel Layer — PropertyID ${s.PropertyID || ""}; Parcel ${s.ParcelID || ""}`,
          "Automated nearby-sale candidate within the configured 20-mile research radius.",
          `Human review required. County NAL code: ${s.NALCode || "not recorded"}. County TotalArea: ${s.TotalArea ?? "not recorded"}; FLTract has not assumed this field is acreage.`
        ).run();

        imported++;
      }

      await env.DB.prepare(`
        UPDATE mini_comp_reports
        SET status = CASE WHEN ? > 0 THEN 'Draft' ELSE status END,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(imported, report.id).run();

      await syncMiniCompLibraryStatus(env, propertyId, report.id);
    }

    const note =
      `Official subject parcel verified. Imported ${imported} nearby sale candidate(s) for human comparability review.`;

    await env.DB.prepare(`
      UPDATE official_research_runs
      SET status = 'Completed',
          subject_matches = 1,
          comparable_candidates = ?,
          result_note = ?,
          completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(imported, note, runId).run();

    if (property.primary_inquiry_id) {
      await env.DB.prepare(`
        INSERT INTO activity_log (inquiry_id, activity_type, activity_note)
        VALUES (?, 'Official Property Research', ?)
      `).bind(property.primary_inquiry_id, `${propertyCode(propertyId)} — ${note}`).run();
    }

    return redirect(`/property/${propertyId}`);
  }
  catch (error) {
    const note = `Official research stopped safely: ${String(error.message || error).slice(0,1200)}`;

    await env.DB.prepare(`
      UPDATE official_research_runs
      SET status = 'Failed', result_note = ?, completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(note, runId).run();

    return redirect(`/property/${propertyId}`);
  }
}


/* ============================================================
   MINI-COMP REPORT ENGINE
   ============================================================ */

if (
request.method === "POST" &&
/^\/property\/\d+\/mini-comp\/comparable$/.test(url.pathname)
) {
  if (!sameOriginPost(request)) {
    return new Response("Invalid request origin.", {status:403});
  }

  const propertyId = Number(url.pathname.split("/").filter(Boolean)[1]);
  const property = await env.DB.prepare(`
    SELECT * FROM properties WHERE id = ? LIMIT 1
  `).bind(propertyId).first();

  if (!property) return new Response("Property record not found.", {status:404});

  const report = await ensureMiniCompForProperty(env, propertyId);
  const form = await request.formData();
  const field = (name, max = 4000) =>
    String(form.get(name) || "").trim().slice(0, max);

  const qualifiedSale = field("qualified_sale", 50);
  if (!["Yes","No","Unknown"].includes(qualifiedSale)) {
    return new Response("Invalid qualified-sale value.", {status:400});
  }

  const sourceName = field("source_name", 500);
  const sourceReference = field("source_reference", 2000);
  if (!sourceName || !sourceReference) {
    return new Response("Source name and source reference are required.", {status:400});
  }

  await env.DB.prepare(`
    INSERT INTO mini_comp_comparables (
      report_id,
      property_location,
      county,
      parcel_id,
      sale_date,
      sale_price,
      acreage,
      qualified_sale,
      improvements,
      distance_miles,
      source_name,
      source_reference,
      source_retrieved_at,
      selection_reason,
      notes
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)
  `).bind(
    report.id,
    field("property_location", 1000),
    field("county", 200),
    field("parcel_id", 300),
    field("sale_date", 50),
    numberOrNull(form.get("sale_price")),
    numberOrNull(form.get("acreage")),
    qualifiedSale,
    field("improvements", 1000),
    numberOrNull(form.get("distance_miles")),
    sourceName,
    sourceReference,
    field("selection_reason", 2000),
    field("notes", 4000)
  ).run();

  await env.DB.prepare(`
    UPDATE mini_comp_reports
    SET status = CASE
      WHEN status = 'Approved' THEN 'Ready for Review'
      ELSE 'Draft'
    END,
    approved_at = NULL,
    updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(report.id).run();

  await syncMiniCompLibraryStatus(env, propertyId, report.id);

  if (property.primary_inquiry_id) {
    await env.DB.prepare(`
      INSERT INTO activity_log (inquiry_id, activity_type, activity_note)
      VALUES (?, 'Mini-Comp Comparable Added', ?)
    `).bind(
      property.primary_inquiry_id,
      `Comparable added to ${propertyCode(propertyId)} mini-comp from ${sourceName}.`
    ).run();
  }

  return redirect(`/property/${propertyId}/mini-comp`);
}


if (
request.method === "POST" &&
/^\/property\/\d+\/mini-comp\/comparable\/\d+\/delete$/.test(url.pathname)
) {
  if (!sameOriginPost(request)) {
    return new Response("Invalid request origin.", {status:403});
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const propertyId = Number(parts[1]);
  const compId = Number(parts[4]);
  const report = await ensureMiniCompForProperty(env, propertyId);

  await env.DB.prepare(`
    DELETE FROM mini_comp_comparables
    WHERE id = ? AND report_id = ?
  `).bind(compId, report.id).run();

  await env.DB.prepare(`
    UPDATE mini_comp_reports
    SET status = 'Draft', approved_at = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(report.id).run();

  await syncMiniCompLibraryStatus(env, propertyId, report.id);

  return redirect(`/property/${propertyId}/mini-comp`);
}


if (
request.method === "POST" &&
/^\/property\/\d+\/mini-comp\/save$/.test(url.pathname)
) {
  if (!sameOriginPost(request)) {
    return new Response("Invalid request origin.", {status:403});
  }

  const propertyId = Number(url.pathname.split("/").filter(Boolean)[1]);
  const report = await ensureMiniCompForProperty(env, propertyId);
  const form = await request.formData();
  const field = (name, max = 8000) =>
    String(form.get(name) || "").trim().slice(0, max);

  const status = field("status", 100);
  if (!["Needs Research","Draft","Ready for Review","Insufficient Data"].includes(status)) {
    return new Response("Invalid mini-comp status.", {status:400});
  }

  const insufficientReason = field("insufficient_data_reason", 4000);
  if (status === "Insufficient Data" && !insufficientReason) {
    return new Response("Explain why the data is insufficient.", {status:400});
  }

  await env.DB.prepare(`
    UPDATE mini_comp_reports
    SET
      status = ?,
      executive_summary = ?,
      selection_notes = ?,
      limitations = ?,
      insufficient_data_reason = ?,
      prepared_at = CASE
        WHEN ? IN ('Ready for Review','Insufficient Data')
        THEN CURRENT_TIMESTAMP
        ELSE prepared_at
      END,
      approved_at = NULL,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    status,
    field("executive_summary"),
    field("selection_notes"),
    field("limitations"),
    insufficientReason,
    status,
    report.id
  ).run();

  await env.DB.prepare(`
    UPDATE mini_comp_queue
    SET
      status = CASE
        WHEN ? IN ('Ready for Review','Insufficient Data') THEN 'Completed'
        ELSE status
      END,
      updated_at = CURRENT_TIMESTAMP
    WHERE report_id = ?
      AND status IN ('Queued','Processing','Retry')
  `).bind(status, report.id).run();

  await syncMiniCompLibraryStatus(env, propertyId, report.id);

  return redirect(`/property/${propertyId}/mini-comp`);
}


if (
request.method === "POST" &&
/^\/property\/\d+\/mini-comp\/approve$/.test(url.pathname)
) {
  if (!sameOriginPost(request)) {
    return new Response("Invalid request origin.", {status:403});
  }

  const propertyId = Number(url.pathname.split("/").filter(Boolean)[1]);
  const property = await env.DB.prepare(`
    SELECT * FROM properties WHERE id = ? LIMIT 1
  `).bind(propertyId).first();

  if (!property) return new Response("Property record not found.", {status:404});

  const report = await ensureMiniCompForProperty(env, propertyId);
  const comps = await env.DB.prepare(`
    SELECT * FROM mini_comp_comparables
    WHERE report_id = ?
    ORDER BY sale_date DESC, id DESC
  `).bind(report.id).all();

  const qualified = comps.results.filter(c =>
    c.qualified_sale === "Yes" &&
    Number(c.sale_price) > 0 &&
    Number(c.acreage) > 0 &&
    c.source_name &&
    c.source_reference
  );

  if (qualified.length < 3) {
    return new Response(
      "Approval requires at least three qualified comparable sales with price, acreage, and source evidence.",
      {status:400}
    );
  }

  if (!property.parcel_id || !property.data_source || !property.data_verified_at) {
    return new Response(
      "Approval requires a verified subject parcel ID and published-data source in the Property Research Workspace.",
      {status:400}
    );
  }

  await env.DB.prepare(`
    UPDATE mini_comp_reports
    SET
      status = 'Approved',
      approved_at = CURRENT_TIMESTAMP,
      prepared_at = COALESCE(prepared_at, CURRENT_TIMESTAMP),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(report.id).run();

  const approvedReport = await env.DB.prepare(`
    SELECT *
    FROM mini_comp_reports
    WHERE id = ?
    LIMIT 1
  `).bind(report.id).first();

  const approvedVersion =
    await snapshotApprovedMiniComp(env, property, approvedReport);

  if (property.primary_inquiry_id) {
    await env.DB.prepare(`
      INSERT INTO activity_log (inquiry_id, activity_type, activity_note)
      VALUES (?, 'Mini-Comp Approved', ?)
    `).bind(
      property.primary_inquiry_id,
      `Mini-comp for ${propertyCode(propertyId)} approved as library version ${approvedVersion || "recorded"}. No client communication was sent.`
    ).run();
  }

  return redirect(`/property/${propertyId}/mini-comp`);
}


if (
request.method === "GET" &&
/^\/property\/\d+\/mini-comp\/report$/.test(url.pathname)
) {
  const propertyId = Number(url.pathname.split("/").filter(Boolean)[1]);

  const property = await env.DB.prepare(`
    SELECT p.*, c.first_name, c.last_name
    FROM properties p
    JOIN clients c ON c.id = p.client_id
    WHERE p.id = ?
    LIMIT 1
  `).bind(propertyId).first();

  if (!property) return new Response("Property record not found.", {status:404});

  const report = await ensureMiniCompForProperty(env, propertyId);
  const comps = await env.DB.prepare(`
    SELECT * FROM mini_comp_comparables
    WHERE report_id = ?
    ORDER BY
      CASE qualified_sale WHEN 'Yes' THEN 0 WHEN 'Unknown' THEN 1 ELSE 2 END,
      sale_date DESC,
      id DESC
  `).bind(report.id).all();

  const metrics = miniCompMetrics(comps.results);
  const isApproved = report.status === "Approved";

  const rows = comps.results.length
    ? comps.results.map((comp, index) => {
        const ppa = Number(comp.sale_price) > 0 && Number(comp.acreage) > 0
          ? Number(comp.sale_price) / Number(comp.acreage)
          : null;
        return `
<tr>
<td>${index + 1}</td>
<td>${esc(comp.property_location || "Not recorded")}<br><span class="small">${esc(comp.parcel_id || "")}</span></td>
<td>${esc(comp.sale_date || "")}</td>
<td>${esc(money(comp.sale_price))}</td>
<td>${esc(decimal(comp.acreage))}</td>
<td>${esc(money(ppa))}</td>
<td>${esc(comp.qualified_sale)}</td>
<td>${esc(comp.selection_reason || "")}</td>
</tr>`;
      }).join("")
    : '<tr><td colspan="8" class="empty">No comparable sales recorded.</td></tr>';

  const sources = comps.results.length
    ? comps.results.map((comp, index) => `
<div class="panel">
<div class="label">Comparable ${index + 1} Source</div>
<div class="value"><strong>${esc(comp.source_name || "Not recorded")}</strong></div>
<div class="value note">${esc(comp.source_reference || "")}</div>
<div class="small">Retrieved: ${esc(floridaTime(comp.source_retrieved_at))}</div>
</div>`).join("")
    : '<div class="empty">No source evidence recorded.</div>';

  const reportTitle = `FLTract Mini-Comp — ${propertyCode(propertyId)}`;

  return new Response(
    page(`

<style>
@media print{
  header, .no-print{display:none !important;}
  body{background:#fff;}
  main{padding:0;}
  .wrap{width:100%;}
  .panel{box-shadow:none;break-inside:avoid;}
  a{color:inherit;text-decoration:none;}
}
</style>

<div class="no-print">
<a class="back" href="/property/${propertyId}/mini-comp">← Back to Mini-Comp Workspace</a>
<button type="button" onclick="window.print()">Print / Save as PDF</button>
</div>

<div class="panel">
<h1>${esc(reportTitle)}</h1>
<div class="grid">
<div><div class="label">Report Status</div><div class="value"><span class="badge ${isApproved ? "good" : "warning"}">${esc(report.status)}</span></div></div>
<div><div class="label">Property ID</div><div class="value">${esc(propertyCode(property.id))}</div></div>
<div><div class="label">Client</div><div class="value">${esc(property.first_name)} ${esc(property.last_name)}</div></div>
<div><div class="label">Prepared</div><div class="value">${esc(report.prepared_at ? floridaTime(report.prepared_at) : "Draft")}</div></div>
<div><div class="label">Approved</div><div class="value">${esc(report.approved_at ? floridaTime(report.approved_at) : "Not approved")}</div></div>
<div><div class="label">Subject Parcel</div><div class="value">${esc(property.parcel_id || "Not recorded")}</div></div>
</div>
${!isApproved ? '<p class="section-note"><strong>DRAFT — INTERNAL REVIEW ONLY.</strong> This report has not been approved for client sharing.</p>' : ""}
</div>

<div class="panel">
<h2>Subject Property</h2>
<div class="grid">
<div><div class="label">Location</div><div class="value">${esc(property.property_location || "Not recorded")}</div></div>
<div><div class="label">County</div><div class="value">${esc(property.county || "")}</div></div>
<div><div class="label">Property Type</div><div class="value">${esc(property.property_type || "")}</div></div>
<div><div class="label">Acreage</div><div class="value">${esc(property.acreage || "")}</div></div>
<div><div class="label">Owner</div><div class="value">${esc(property.owner_name || "Not recorded")}</div></div>
<div><div class="label">Published Source</div><div class="value">${esc(property.data_source || "Not recorded")}</div></div>
<div><div class="label">Market / Just Value</div><div class="value">${esc(property.market_value || "Not recorded")}</div></div>
<div><div class="label">Assessed Value</div><div class="value">${esc(property.assessed_value || "Not recorded")}</div></div>
<div><div class="label">Zoning</div><div class="value">${esc(property.zoning || "Not recorded")}</div></div>
<div><div class="label">Land Use</div><div class="value">${esc(property.land_use || "Not recorded")}</div></div>
</div>
<div style="margin-top:18px"><div class="label">Legal Description</div><div class="value note">${esc(property.legal_description || "Not recorded")}</div></div>
</div>

<div class="panel">
<h2>Executive Summary</h2>
<div class="value note">${esc(report.executive_summary || "No executive summary has been prepared.")}</div>
</div>

<div class="panel">
<h2>Comparable Sale Summary</h2>
<div class="summary-grid">
<div class="summary-card"><div class="label">Sales Reviewed</div><div class="summary-number">${metrics.total}</div></div>
<div class="summary-card"><div class="label">Median Sale Price</div><div class="summary-number">${esc(money(metrics.medianPrice))}</div></div>
<div class="summary-card"><div class="label">Median Price / Acre</div><div class="summary-number">${esc(money(metrics.medianPerAcre))}</div></div>
</div>
<table>
<thead><tr><th>#</th><th>Comparable</th><th>Sale Date</th><th>Sale Price</th><th>Acres</th><th>Price/Acre</th><th>Qualified</th><th>Selection Reason</th></tr></thead>
<tbody>${rows}</tbody>
</table>
</div>

<div class="panel">
<h2>Selection &amp; Limitations</h2>
<div class="label">Comparable Selection Notes</div>
<div class="value note">${esc(report.selection_notes || "Not recorded")}</div>
<div class="label" style="margin-top:18px">Limitations / Important Differences</div>
<div class="value note">${esc(report.limitations || "Not recorded")}</div>
${report.insufficient_data_reason ? `
<div class="label" style="margin-top:18px">Insufficient Data</div>
<div class="value note">${esc(report.insufficient_data_reason)}</div>` : ""}
</div>

<details class="history-collapse" open>
<summary>Source Evidence</summary>
<div class="history-collapse-body">${sources}</div>
</details>

<div class="panel">
<h2>Important Notice</h2>
<p class="section-note">
This FLTract Mini-Comp is an informational comparison of documented property and sale data. It is not an appraisal, survey, title opinion, environmental report, or guarantee of market value. Public-record information may change and should be independently verified for a transaction. Material differences in access, road type, HOA restrictions, improvements, zoning, land use, utilities, location, and market pocket can affect comparability.
</p>
</div>

`, reportTitle),
    {
      headers:{
        "content-type":"text/html; charset=utf-8",
        "cache-control":"no-store"
      }
    }
  );
}


if (
request.method === "GET" &&
/^\/property\/\d+\/mini-comp$/.test(url.pathname)
) {
  const propertyId = Number(url.pathname.split("/").filter(Boolean)[1]);

  const property = await env.DB.prepare(`
    SELECT p.*, c.first_name, c.last_name
    FROM properties p
    JOIN clients c ON c.id = p.client_id
    WHERE p.id = ?
    LIMIT 1
  `).bind(propertyId).first();

  if (!property) return new Response("Property record not found.", {status:404});

  const report = await ensureMiniCompForProperty(env, propertyId);
  const comps = await env.DB.prepare(`
    SELECT * FROM mini_comp_comparables
    WHERE report_id = ?
    ORDER BY sale_date DESC, id DESC
  `).bind(report.id).all();

  const metrics = miniCompMetrics(comps.results);
  const qualifiedCount = comps.results.filter(c => c.qualified_sale === "Yes").length;

  const compRows = comps.results.length
    ? comps.results.map(comp => {
        const ppa = Number(comp.sale_price) > 0 && Number(comp.acreage) > 0
          ? Number(comp.sale_price) / Number(comp.acreage)
          : null;
        return `
<tr>
<td>${esc(comp.property_location || "Not recorded")}</td>
<td>${esc(comp.sale_date || "")}</td>
<td>${esc(money(comp.sale_price))}</td>
<td>${esc(decimal(comp.acreage))}</td>
<td>${esc(money(ppa))}</td>
<td>${esc(comp.qualified_sale)}</td>
<td>
<strong>${esc(comp.source_name)}</strong><br>
<span class="small">${esc(comp.source_reference)}</span><br>
<span class="small">Retrieved: ${esc(floridaTime(comp.source_retrieved_at))}</span>
</td>
<td>${esc(comp.selection_reason || "")}</td>
<td>
<form method="post" action="/property/${propertyId}/mini-comp/comparable/${comp.id}/delete" onsubmit="return confirm('Remove this comparable from the mini-comp?');">
<button type="submit" class="secondary">Remove</button>
</form>
</td>
</tr>`;
      }).join("")
    : '<tr><td colspan="9" class="empty">No comparable sales recorded yet.</td></tr>';

  const statusOptions = [
    "Needs Research",
    "Draft",
    "Ready for Review",
    "Insufficient Data"
  ].map(s => `<option value="${esc(s)}" ${report.status === s ? "selected" : ""}>${esc(s)}</option>`).join("");

  const approvalReady =
    qualifiedCount >= 3 &&
    property.parcel_id &&
    property.data_source &&
    property.data_verified_at;

  return new Response(
    page(`

<a class="back" href="/property/${propertyId}">
← Back to Property ${esc(propertyCode(propertyId))}
</a>

<div class="panel">
<h1>Mini-Comp — ${esc(propertyCode(propertyId))}</h1>

<p class="section-note">
This private report workspace compares the subject property with documented public-record sales. FLTract retains the source trail and retrieval date for each comparable. The report stays inside the private account until it has been reviewed; nothing on this page is automatically emailed to a client.
</p>

<div class="grid">
<div><div class="label">Client</div><div class="value">${esc(property.first_name)} ${esc(property.last_name)}</div></div>
<div><div class="label">Report Status</div><div class="value"><span class="badge ${report.status === "Approved" ? "good" : report.status === "Insufficient Data" ? "danger" : "warning"}">${esc(report.status)}</span></div></div>
<div><div class="label">Subject</div><div class="value">${esc(property.property_location || "Not recorded")}</div></div>
<div><div class="label">Parcel ID</div><div class="value">${esc(property.parcel_id || "Not researched")}</div></div>
<div><div class="label">Published Source</div><div class="value">${esc(property.data_source || "Not verified")}</div></div>
<div><div class="label">Verified</div><div class="value">${esc(property.data_verified_at ? floridaTime(property.data_verified_at) : "Not verified")}</div></div>
</div>
</div>

<div class="panel">
<h2>Comparable Summary</h2>
<p class="section-note">
These figures are descriptive calculations from the recorded comparable sales. They are not an appraisal and are not, by themselves, a valuation conclusion.
</p>
<div class="summary-grid">
<div class="summary-card"><div class="label">Comparables</div><div class="summary-number">${metrics.total}</div><div class="small">${qualifiedCount} marked qualified</div></div>
<div class="summary-card"><div class="label">Median Sale Price</div><div class="summary-number">${esc(money(metrics.medianPrice))}</div><div class="small">Low ${esc(money(metrics.lowPrice))} · High ${esc(money(metrics.highPrice))}</div></div>
<div class="summary-card"><div class="label">Median Price / Acre</div><div class="summary-number">${esc(money(metrics.medianPerAcre))}</div><div class="small">Average ${esc(money(metrics.averagePerAcre))}</div></div>
</div>
</div>

<div class="panel">
<h2>Comparable Sales</h2>
<p class="section-note">
Use public or otherwise authorized source data. Record the source reference and why the sale is comparable. Mark a sale Qualified only after its transaction and property characteristics have been checked. The working target is 10 researched candidates, with the strongest 3–5 selected for the final mini-comp.
</p>
<table>
<thead>
<tr>
<th>Property</th><th>Sale Date</th><th>Sale Price</th><th>Acres</th><th>Price/Acre</th><th>Qualified</th><th>Source Evidence</th><th>Selection Reason</th><th></th>
</tr>
</thead>
<tbody>${compRows}</tbody>
</table>
</div>

<div class="panel">
<h2>Add Comparable Sale</h2>
<p class="section-note">
Capture the evidence as you research it. County Property Appraiser, Clerk/deed records, GIS, and other authorized public records should remain attributable. Nearby properties are not automatically comparable; access, road type, HOA, improvements, zoning, land use, and market pocket can materially affect selection.
</p>
<form method="post" action="/property/${propertyId}/mini-comp/comparable">
<div class="form-grid">
<label><span>Property Location *</span><input name="property_location" maxlength="1000" required></label>
<label><span>County</span><input name="county" maxlength="200" value="${esc(property.county)}"></label>
<label><span>Parcel ID / Account</span><input name="parcel_id" maxlength="300"></label>
<label><span>Sale Date</span><input type="date" name="sale_date"></label>
<label><span>Sale Price</span><input name="sale_price" inputmode="decimal" placeholder="425000"></label>
<label><span>Acreage</span><input name="acreage" inputmode="decimal" placeholder="10"></label>
<label><span>Qualified Sale *</span><select name="qualified_sale" required><option>Unknown</option><option>Yes</option><option>No</option></select></label>
<label><span>Distance from Subject (miles)</span><input name="distance_miles" inputmode="decimal"></label>
<label class="full"><span>Improvements / Characteristics</span><textarea name="improvements" rows="3" maxlength="1000"></textarea></label>
<label><span>Source Name *</span><input name="source_name" maxlength="500" required placeholder="County Property Appraiser / Clerk"></label>
<label><span>Source Reference *</span><input name="source_reference" maxlength="2000" required placeholder="Record URL, instrument number, parcel record, or citation"></label>
<label class="full"><span>Why This Sale Is Comparable</span><textarea name="selection_reason" rows="3" maxlength="2000"></textarea></label>
<label class="full"><span>Research Notes</span><textarea name="notes" rows="3" maxlength="4000"></textarea></label>
</div>
<div style="margin-top:14px"><button type="submit">Add Comparable</button></div>
</form>
</div>

<div class="panel">
<h2>Report Draft &amp; Review</h2>
<p class="section-note">
AI or staff may prepare the research and draft language, but the report remains private and unapproved until human review. Use Insufficient Data when the evidence does not support a useful comparison rather than forcing a result.
</p>
<form method="post" action="/property/${propertyId}/mini-comp/save">
<div class="form-grid">
<label><span>Status</span><select name="status" required>${statusOptions}</select></label>
<label class="full"><span>Executive Summary</span><textarea name="executive_summary" rows="5" maxlength="8000">${esc(report.executive_summary)}</textarea></label>
<label class="full"><span>Comparable Selection Notes</span><textarea name="selection_notes" rows="5" maxlength="8000">${esc(report.selection_notes)}</textarea></label>
<label class="full"><span>Limitations / Important Differences</span><textarea name="limitations" rows="5" maxlength="8000">${esc(report.limitations)}</textarea></label>
<label class="full"><span>Insufficient Data Reason</span><textarea name="insufficient_data_reason" rows="4" maxlength="4000">${esc(report.insufficient_data_reason)}</textarea></label>
</div>
<div style="margin-top:14px"><button type="submit">Save Mini-Comp Draft</button></div>
</form>
</div>

<div class="panel">
<h2>Report Preview</h2>
<p class="section-note">
Preview the assembled report at any time. Drafts are clearly marked INTERNAL REVIEW ONLY. After approval, the same private report can be printed or saved as PDF for deliberate client sharing; FLTract does not send it automatically.
</p>
<a class="back" href="/property/${propertyId}/mini-comp/report">Open Report Preview →</a>
</div>

<div class="panel ${approvalReady ? "followup-future" : "followup-today"}">
<h2>Human Approval</h2>
<p class="section-note">
Approval requires a verified subject parcel/source and at least three comparable sales marked Qualified with sale price, acreage, and source evidence. Approval records the decision in Activity History. It does not send or publish the report.
</p>
<div class="value">
${approvalReady
  ? "Minimum approval checks are satisfied."
  : "Not ready: complete subject verification and at least three qualified comparable sales."}
</div>
<form method="post" action="/property/${propertyId}/mini-comp/approve" style="margin-top:14px">
<button type="submit" ${approvalReady ? "" : "disabled"}>Approve Mini-Comp</button>
</form>
</div>

`),
    {
      headers:{
        "content-type":"text/html; charset=utf-8",
        "cache-control":"no-store"
      }
    }
  );
}


/* ============================================================
   RESEARCH & REPORT LIBRARY
   ============================================================ */

if (
request.method === "GET" &&
/^\/property\/\d+\/library$/.test(url.pathname)
) {
  const propertyId = Number(url.pathname.split("/").filter(Boolean)[1]);

  const property = await env.DB.prepare(`
    SELECT p.*, c.first_name, c.last_name
    FROM properties p
    JOIN clients c ON c.id = p.client_id
    WHERE p.id = ?
    LIMIT 1
  `).bind(propertyId).first();

  if (!property) return new Response("Property record not found.", {status:404});

  const miniComp = await ensureMiniCompForProperty(env, propertyId);
  if (miniComp) await ensureLibraryItemForMiniComp(env, propertyId, miniComp);

  const items = await env.DB.prepare(`
    SELECT *
    FROM report_library_items
    WHERE property_id = ?
      AND archived = 0
    ORDER BY updated_at DESC, id DESC
  `).bind(propertyId).all();

  const itemRows = items.results.length
    ? items.results.map(item => `
<tr>
<td><strong>${esc(item.title)}</strong><br><span class="small">${esc(item.report_type)}</span></td>
<td><span class="badge ${item.current_status === "Approved" ? "good" : item.current_status === "Insufficient Data" ? "danger" : "warning"}">${esc(item.current_status)}</span></td>
<td>${item.current_version ? `v${esc(item.current_version)}` : "No approved version"}</td>
<td>${esc(floridaTime(item.updated_at))}</td>
<td><a href="/library/item/${item.id}">Open Library Record →</a></td>
</tr>`).join("")
    : '<tr><td colspan="5" class="empty">No report records yet.</td></tr>';

  return new Response(
    page(`
<a class="back" href="/property/${propertyId}">← Back to Property ${esc(propertyCode(propertyId))}</a>

<div class="panel">
<h1>Research &amp; Report Library</h1>
<p class="section-note">
This is the permanent private record of structured FLTract research products for this property. Approved versions are preserved as immutable snapshots instead of being overwritten by later research. This library is not a public file-upload area and nothing here is automatically sent to the client.
</p>
<div class="grid">
<div><div class="label">Client</div><div class="value">${esc(property.first_name)} ${esc(property.last_name)}</div></div>
<div><div class="label">Property</div><div class="value">${esc(propertyCode(propertyId))}</div></div>
<div><div class="label">Location</div><div class="value">${esc(property.property_location || "Not recorded")}</div></div>
<div><div class="label">Parcel ID</div><div class="value">${esc(property.parcel_id || "Not recorded")}</div></div>
</div>
</div>

<div class="panel">
<h2>Library Records</h2>
<table>
<thead><tr><th>Report</th><th>Current Status</th><th>Approved Version</th><th>Updated</th><th></th></tr></thead>
<tbody>${itemRows}</tbody>
</table>
</div>
`, `FLTract Library — ${propertyCode(propertyId)}`),
    {headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store"}}
  );
}


if (
request.method === "GET" &&
/^\/library\/item\/\d+$/.test(url.pathname)
) {
  const itemId = Number(url.pathname.split("/").filter(Boolean)[2]);

  const item = await env.DB.prepare(`
    SELECT rli.*, p.property_location
    FROM report_library_items rli
    JOIN properties p ON p.id = rli.property_id
    WHERE rli.id = ?
    LIMIT 1
  `).bind(itemId).first();

  if (!item) return new Response("Library record not found.", {status:404});

  const versions = await env.DB.prepare(`
    SELECT id, version_number, status, approved_at, created_at
    FROM report_library_versions
    WHERE library_item_id = ?
    ORDER BY version_number DESC
  `).bind(itemId).all();

  const versionRows = versions.results.length
    ? versions.results.map(v => `
<tr>
<td>v${esc(v.version_number)}</td>
<td><span class="badge good">${esc(v.status)}</span></td>
<td>${esc(floridaTime(v.approved_at || v.created_at))}</td>
<td><a href="/library/version/${v.id}">Open Preserved Version →</a></td>
</tr>`).join("")
    : '<tr><td colspan="4" class="empty">No approved versions have been preserved yet.</td></tr>';

  return new Response(
    page(`
<a class="back" href="/property/${item.property_id}/library">← Back to Research &amp; Report Library</a>

<div class="panel">
<h1>${esc(item.title)}</h1>
<p class="section-note">
The current working report may continue to change during research. Every approved version below is a preserved snapshot and remains available even after later revisions.
</p>
<div class="grid">
<div><div class="label">Type</div><div class="value">${esc(item.report_type)}</div></div>
<div><div class="label">Current Status</div><div class="value">${esc(item.current_status)}</div></div>
<div><div class="label">Latest Approved Version</div><div class="value">${item.current_version ? `v${esc(item.current_version)}` : "None"}</div></div>
<div><div class="label">Property</div><div class="value">${esc(propertyCode(item.property_id))} — ${esc(item.property_location || "")}</div></div>
</div>
<div style="margin-top:16px"><a href="${esc(item.current_route)}">Open Current Structured Report →</a></div>
</div>

<div class="panel">
<h2>Approved Version History</h2>
<table>
<thead><tr><th>Version</th><th>Status</th><th>Approved</th><th></th></tr></thead>
<tbody>${versionRows}</tbody>
</table>
</div>
`, item.title),
    {headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store"}}
  );
}


if (
request.method === "GET" &&
/^\/library\/version\/\d+$/.test(url.pathname)
) {
  const versionId = Number(url.pathname.split("/").filter(Boolean)[2]);

  const version = await env.DB.prepare(`
    SELECT rlv.*, rli.title, rli.property_id
    FROM report_library_versions rlv
    JOIN report_library_items rli ON rli.id = rlv.library_item_id
    WHERE rlv.id = ?
    LIMIT 1
  `).bind(versionId).first();

  if (!version) return new Response("Preserved report version not found.", {status:404});

  let snapshot = {};
  try { snapshot = JSON.parse(version.snapshot_json || "{}"); } catch {}

  const property = snapshot.property || {};
  const report = snapshot.report || {};
  const comps = Array.isArray(snapshot.comparables) ? snapshot.comparables : [];
  const metrics = miniCompMetrics(comps);

  const rows = comps.length
    ? comps.map((comp,index) => {
        const ppa = Number(comp.sale_price) > 0 && Number(comp.acreage) > 0
          ? Number(comp.sale_price) / Number(comp.acreage)
          : null;
        return `
<tr>
<td>${index + 1}</td>
<td>${esc(comp.property_location || "Not recorded")}</td>
<td>${esc(comp.sale_date || "")}</td>
<td>${esc(money(comp.sale_price))}</td>
<td>${esc(decimal(comp.acreage))}</td>
<td>${esc(money(ppa))}</td>
<td>${esc(comp.qualified_sale || "")}</td>
<td>${esc(comp.source_name || "")}</td>
</tr>`;
      }).join("")
    : '<tr><td colspan="8" class="empty">No comparable records in this preserved version.</td></tr>';

  return new Response(
    page(`
<style>
@media print{
  header,.no-print{display:none !important;}
  body{background:#fff;}
  main{padding:0;}
  .wrap{width:100%;}
  .panel{box-shadow:none;break-inside:avoid;}
}
</style>

<div class="no-print">
<a class="back" href="/library/item/${version.library_item_id}">← Back to Library Record</a>
<button type="button" onclick="window.print()">Print / Save as PDF</button>
</div>

<div class="panel">
<h1>${esc(version.title)} — v${esc(version.version_number)}</h1>
<p class="section-note">
PRESERVED APPROVED VERSION. This snapshot is retained for audit and report history and is not altered when the current working report changes.
</p>
<div class="grid">
<div><div class="label">Approved</div><div class="value">${esc(floridaTime(version.approved_at || version.created_at))}</div></div>
<div><div class="label">Property ID</div><div class="value">${esc(propertyCode(version.property_id))}</div></div>
<div><div class="label">Location</div><div class="value">${esc(property.property_location || "")}</div></div>
<div><div class="label">Parcel</div><div class="value">${esc(property.parcel_id || "")}</div></div>
</div>
</div>

<div class="panel">
<h2>Executive Summary</h2>
<div class="value note">${esc(report.executive_summary || "No executive summary recorded.")}</div>
</div>

<div class="panel">
<h2>Comparable Summary</h2>
<div class="summary-grid">
<div class="summary-card"><div class="label">Sales</div><div class="summary-number">${metrics.total}</div></div>
<div class="summary-card"><div class="label">Median Sale Price</div><div class="summary-number">${esc(money(metrics.medianPrice))}</div></div>
<div class="summary-card"><div class="label">Median Price / Acre</div><div class="summary-number">${esc(money(metrics.medianPerAcre))}</div></div>
</div>
<table>
<thead><tr><th>#</th><th>Comparable</th><th>Sale Date</th><th>Sale Price</th><th>Acres</th><th>Price/Acre</th><th>Qualified</th><th>Source</th></tr></thead>
<tbody>${rows}</tbody>
</table>
</div>

<div class="panel">
<h2>Selection &amp; Limitations</h2>
<div class="label">Selection Notes</div><div class="value note">${esc(report.selection_notes || "Not recorded")}</div>
<div class="label" style="margin-top:18px">Limitations</div><div class="value note">${esc(report.limitations || "Not recorded")}</div>
</div>
`, `${version.title} v${version.version_number}`),
    {headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store"}}
  );
}


/* ============================================================
   PROPERTY RECORD
   ============================================================ */

if (
request.method === "POST" &&
/^\/property\/\d+\/update$/.test(url.pathname)
) {
  if (!sameOriginPost(request)) {
    return new Response("Invalid request origin.", {status:403});
  }

  const propertyId = Number(url.pathname.split("/").filter(Boolean)[1]);
  const form = await request.formData();

  const field = (name, max = 4000) =>
    String(form.get(name) || "").trim().slice(0, max);

  const researchStatus = field("research_status", 100);
  const allowedResearch = [
    "Not Started",
    "Researching",
    "Needs Verification",
    "Ready for Mini-Comp",
    "Research Complete"
  ];

  if (!allowedResearch.includes(researchStatus)) {
    return new Response("Invalid research status.", {status:400});
  }

  const property = await env.DB.prepare(`
    SELECT * FROM properties WHERE id = ? LIMIT 1
  `).bind(propertyId).first();

  if (!property) {
    return new Response("Property record not found.", {status:404});
  }

  await env.DB.prepare(`
    UPDATE properties
    SET
      property_location = ?,
      county = ?,
      property_type = ?,
      acreage = ?,
      parcel_id = ?,
      legal_description = ?,
      owner_name = ?,
      owner_mailing_address = ?,
      assessed_value = ?,
      market_value = ?,
      taxable_value = ?,
      zoning = ?,
      land_use = ?,
      improvements = ?,
      research_status = ?,
      data_source = ?,
      data_verified_at = CASE
        WHEN ? <> '' THEN CURRENT_TIMESTAMP
        ELSE data_verified_at
      END,
      notes = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    field("property_location", 1000),
    field("county", 200),
    field("property_type", 300),
    field("acreage", 200),
    field("parcel_id", 300),
    field("legal_description", 8000),
    field("owner_name", 500),
    field("owner_mailing_address", 1000),
    field("assessed_value", 200),
    field("market_value", 200),
    field("taxable_value", 200),
    field("zoning", 300),
    field("land_use", 500),
    field("improvements", 1000),
    researchStatus,
    field("data_source", 1000),
    field("mark_verified", 10),
    field("notes", 8000),
    propertyId
  ).run();

  if (property.primary_inquiry_id) {
    await env.DB.prepare(`
      INSERT INTO activity_log (
        inquiry_id,
        activity_type,
        activity_note
      )
      VALUES (?, 'Property Research Updated', ?)
    `).bind(
      property.primary_inquiry_id,
      `Property ${propertyCode(propertyId)} research record updated. Status: ${researchStatus}.`
    ).run();
  }

  return redirect(`/property/${propertyId}`);
}


if (
request.method === "GET" &&
/^\/property\/\d+$/.test(url.pathname)
) {
  const propertyId = Number(url.pathname.split("/").filter(Boolean)[1]);

  const property = await env.DB.prepare(`
    SELECT
      p.*,
      c.first_name,
      c.last_name,
      c.email,
      c.phone
    FROM properties p
    JOIN clients c ON c.id = p.client_id
    WHERE p.id = ?
    LIMIT 1
  `).bind(propertyId).first();

  if (!property) {
    return new Response("Property record not found.", {status:404});
  }

  const linkedInquiries = await env.DB.prepare(`
    SELECT i.*
    FROM property_inquiries pi
    JOIN inquiries i ON i.id = pi.inquiry_id
    WHERE pi.property_id = ?
    ORDER BY i.created_at DESC, i.id DESC
  `).bind(propertyId).all();

  const propertyAssignments = await assignmentScopeForProperty(env, propertyId);
  const propertyAssignableStaff = await activeStaffUsers(env);

  const propertyAssignmentRows = propertyAssignments.length
    ? propertyAssignments.map(a => `
      <tr>
        <td><strong>${esc(a.display_name || a.email)}</strong><br><span class="small">${esc(a.email)}</span></td>
        <td>${esc(a.role)}</td>
        <td>${esc(a.assignment_role)}</td>
        <td>${esc(floridaTime(a.assigned_at))}</td>
        <td>
          ${staff.authenticated && staffCan(staff.user, "manage_assignments") ? `
          <form method="post" action="/property/${propertyId}/assignment/${a.assignment_id}/end">
            <input name="reason" maxlength="500" placeholder="Reason for reassignment / unassignment" required>
            <button type="submit">End Assignment</button>
          </form>` : ""}
        </td>
      </tr>
    `).join("")
    : '<tr><td colspan="5" class="empty">No staff member is specifically assigned to this property.</td></tr>';

  const propertyStaffOptions = propertyAssignableStaff.map(u =>
    `<option value="${u.id}">${esc(u.display_name || u.email)} — ${esc(u.role)}</option>`
  ).join("");

  const miniCompForLibrary = await ensureMiniCompForProperty(env, propertyId);

  const researchRuns = await env.DB.prepare(`
    SELECT *
    FROM official_research_runs
    WHERE property_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 5
  `).bind(propertyId).all();

  const countyAdapter = COUNTY_RESEARCH_ADAPTERS[property.county] || null;

  const researchRunRows = researchRuns.results.length
    ? researchRuns.results.map(run => `
      <tr>
        <td>${esc(floridaTime(run.created_at))}</td>
        <td><span class="badge ${run.status === "Completed" ? "good" : run.status === "Failed" ? "danger" : "warning"}">${esc(run.status)}</span></td>
        <td>${esc(run.source_name)}</td>
        <td>${esc(run.subject_matches)}</td>
        <td>${esc(run.comparable_candidates)}</td>
        <td>${esc(run.result_note)}</td>
      </tr>
    `).join("")
    : '<tr><td colspan="6" class="empty">No official county research runs yet.</td></tr>';

  const libraryItems = await env.DB.prepare(`
    SELECT *
    FROM report_library_items
    WHERE property_id = ?
      AND archived = 0
    ORDER BY updated_at DESC, id DESC
  `).bind(propertyId).all();

  const librarySummary = libraryItems.results.length
    ? libraryItems.results.map(item => `
      <div class="value">
        <a href="/library/item/${item.id}">${esc(item.title)}</a>
        — ${esc(item.current_status)}
        — ${item.current_version ? `v${esc(item.current_version)} approved` : "no approved version"}
      </div>
    `).join("")
    : '<div class="empty">No reports recorded yet.</div>';

  const researchOptions = [
    "Not Started",
    "Researching",
    "Needs Verification",
    "Ready for Mini-Comp",
    "Research Complete"
  ].map(s => `
    <option value="${esc(s)}" ${property.research_status === s ? "selected" : ""}>
      ${esc(s)}
    </option>
  `).join("");

  const inquiryLinks = linkedInquiries.results.length
    ? linkedInquiries.results.map(i => `
      <div class="value">
        <a href="/inquiry/${i.id}">Inquiry #${esc(i.id)}</a>
        — ${esc(inquiryTypeDisplay(i.inquiry_type))}
        — ${esc(i.status || "")}
      </div>
    `).join("")
    : '<div class="empty">No linked inquiries.</div>';

  return new Response(
    page(`

<a class="back" href="/client/${property.client_id}">
← Back to Client ${esc(clientCode(property.client_id))}
</a>

<div class="panel">
<h1>Property ${esc(propertyCode(property.id))}</h1>

<p class="section-note">
This is the durable FLTract property research record. Client-submitted intake information seeds the record, but research fields should be verified against the appropriate Florida county Property Appraiser or other authoritative published source before they are used in a report.
</p>

<div class="grid">
<div><div class="label">Client</div><div class="value"><a href="/client/${property.client_id}">${esc(clientCode(property.client_id))} — ${esc(property.first_name)} ${esc(property.last_name)}</a></div></div>
<div><div class="label">Property ID</div><div class="value"><strong>${esc(propertyCode(property.id))}</strong></div></div>
<div><div class="label">Research Status</div><div class="value">${esc(property.research_status || "Not Started")}</div></div>
<div><div class="label">Last Updated</div><div class="value">${esc(floridaTime(property.updated_at))}</div></div>
</div>
</div>

<div class="panel">
<h2>Property Responsibility</h2>
<p class="section-note">
A property assignment is more specific than the client-level assignment and is useful when a researcher, manager, or specialist is responsible for this tract. Assignment history is retained when responsibility changes.
</p>
<table>
<thead><tr><th>Staff</th><th>System Role</th><th>Assignment</th><th>Assigned</th><th></th></tr></thead>
<tbody>${propertyAssignmentRows}</tbody>
</table>

${staff.authenticated && staffCan(staff.user, "manage_assignments") ? `
<form method="post" action="/property/${propertyId}/assign" style="margin-top:16px">
<div class="form-grid">
<label><span>Assign Staff</span><select name="staff_user_id" required>
<option value="">Choose staff member</option>
${propertyStaffOptions}
</select></label>
<label><span>Responsibility</span><select name="assignment_role">
<option>Primary</option>
<option>Support</option>
<option>Research</option>
</select></label>
</div>
<div style="margin-top:14px"><button type="submit">Assign Property</button></div>
</form>
` : '<p class="section-note">Assignment changes require an authorized FLTract manager, CEO, or Administrator.</p>'}
</div>

<div class="panel">
<h2>Official County Research</h2>
<p class="section-note">
This adapter checks authoritative county-published property data before it enters the FLTract research record. It stops for review when the subject parcel is ambiguous. Sale records imported by automation are candidates only and remain unqualified until human review.
</p>

<div class="grid">
<div><div class="label">County</div><div class="value">${esc(property.county || "Not recorded")}</div></div>
<div><div class="label">Adapter</div><div class="value">${esc(countyAdapter ? countyAdapter.status : "Not configured")}</div></div>
<div><div class="label">Mode</div><div class="value">${esc(countyAdapter ? countyAdapter.mode : "—")}</div></div>
<div><div class="label">Official Source</div><div class="value">${esc(countyAdapter ? countyAdapter.sourceName : "—")}</div></div>
</div>

${countyAdapter ? `
<form method="post" action="/property/${property.id}/official-research" style="margin-top:14px">
<button type="submit">${property.county === "St. Lucie" ? "Run Official County Research" : "Check County Adapter"}</button>
</form>
<p class="section-note">
${property.county === "St. Lucie"
  ? "St. Lucie is the first live direct-query adapter. It verifies an exact subject parcel and may add nearby public sale records to the Mini-Comp as candidates for human review."
  : "This county source is registered. Its automatic parser is not live yet; the check records that status without changing property research."}
</p>
` : '<div class="empty">No official-data adapter is registered for this county.</div>'}

<table>
<thead><tr><th>Run</th><th>Status</th><th>Source</th><th>Subject Matches</th><th>Sale Candidates</th><th>Result</th></tr></thead>
<tbody>${researchRunRows}</tbody>
</table>
</div>

<div class="panel">
<h2>Research &amp; Report Library</h2>
<p class="section-note">
Permanent private report history for this property. Working reports remain structured in FLTract; each human-approved version is preserved rather than overwritten. Nothing in the library is automatically emailed to the client.
</p>
${librarySummary}
<div style="margin-top:14px"><a href="/property/${property.id}/library">Open Full Library →</a></div>
</div>

<div class="panel">
<h2>Mini-Comp Report</h2>
<p class="section-note">
FLTract's Mini-Comp keeps comparable-sale research, source evidence, calculations, limitations, and human approval with this property. The report is private by default and is never automatically emailed to the client.
</p>
<a class="back" href="/property/${property.id}/mini-comp">Open Mini-Comp Workspace →</a>
</div>

<div class="panel">
<h2>Property Research Workspace</h2>

<p class="section-note">
Use this panel to validate the property and record published research. Keep the original inquiry unchanged. Enter the parcel ID and source exactly as published; legal description, ownership, values, zoning, and land use should remain attributable to their source.
</p>

<form method="post" action="/property/${property.id}/update">

<div class="form-grid">
<label><span>Property Location</span><input name="property_location" maxlength="1000" value="${esc(property.property_location)}"></label>
<label><span>County</span><input name="county" maxlength="200" value="${esc(property.county)}"></label>
<label><span>Property Type</span><input name="property_type" maxlength="300" value="${esc(property.property_type)}"></label>
<label><span>Acreage</span><input name="acreage" maxlength="200" value="${esc(property.acreage)}"></label>
<label><span>Parcel ID / Account Number</span><input name="parcel_id" maxlength="300" value="${esc(property.parcel_id)}"></label>
<label><span>Owner Name</span><input name="owner_name" maxlength="500" value="${esc(property.owner_name)}"></label>
<label class="full"><span>Owner Mailing Address</span><input name="owner_mailing_address" maxlength="1000" value="${esc(property.owner_mailing_address)}"></label>
<label class="full"><span>Legal Description</span><textarea name="legal_description" rows="5" maxlength="8000">${esc(property.legal_description)}</textarea></label>
<label><span>Assessed Value</span><input name="assessed_value" maxlength="200" value="${esc(property.assessed_value)}"></label>
<label><span>Market / Just Value</span><input name="market_value" maxlength="200" value="${esc(property.market_value)}"></label>
<label><span>Taxable Value</span><input name="taxable_value" maxlength="200" value="${esc(property.taxable_value)}"></label>
<label><span>Zoning</span><input name="zoning" maxlength="300" value="${esc(property.zoning)}"></label>
<label class="full"><span>Land Use / Classification</span><input name="land_use" maxlength="500" value="${esc(property.land_use)}"></label>
<label class="full"><span>Improvements</span><textarea name="improvements" rows="3" maxlength="1000">${esc(property.improvements)}</textarea></label>
<label><span>Research Status</span><select name="research_status" required>${researchOptions}</select></label>
<label><span>Published Data Source</span><input name="data_source" maxlength="1000" value="${esc(property.data_source)}" placeholder="Example: Indian River County Property Appraiser"></label>
<label class="full"><span>Research Notes</span><textarea name="notes" rows="5" maxlength="8000">${esc(property.notes)}</textarea></label>
<label class="full"><span><input type="checkbox" name="mark_verified" value="yes"> Mark published data verified now</span></label>
</div>

<div style="margin-top:14px">
<button type="submit">Save Property Research</button>
</div>
</form>

<p class="section-note">
Saving updates the Property Record and writes a Property Research Updated event to the original inquiry's Activity History. It does not send anything to the client and does not create a valuation or mini-comp.
</p>
</div>

<div class="panel">
<h2>Linked Inquiry Records</h2>
<p class="section-note">
Inquiry records preserve what the client originally submitted, plus consent, referral, follow-up, and audit history. Property research does not overwrite them.
</p>
${inquiryLinks}
</div>

`),
    {
      headers:{
        "content-type":"text/html; charset=utf-8",
        "cache-control":"no-store"
      }
    }
  );
}


/* ============================================================
   INQUIRY DETAIL
   ============================================================ */

if (
request.method === "GET" &&
/^\/inquiry\/\d+$/.test(
url.pathname
)
) {

const id =
idFromPath(url.pathname);


const inquiry =
await env.DB.prepare(`
SELECT *
FROM inquiries
WHERE id = ?
`)
.bind(id)
.first();


if (!inquiry) {

return new Response(
"Inquiry not found.",
{status:404}
);

}


let clientAccount = null;
let propertyRecord = null;

try {
clientAccount =
await ensureClientForInquiry(
env,
inquiry
);

propertyRecord =
await ensurePropertyForInquiry(
env,
inquiry,
clientAccount?.id
);
}
catch (error) {
console.error(
"Client/property account link failed for inquiry",
id,
error
);
}


const activities =
await env.DB.prepare(`
SELECT *
FROM activity_log
WHERE inquiry_id = ?
ORDER BY
created_at DESC,
id DESC
`)
.bind(id)
.all();


const referrals =
await env.DB.prepare(`
SELECT *
FROM referral_history
WHERE inquiry_id = ?
ORDER BY
created_at DESC,
id DESC
`)
.bind(id)
.all();


const consents =
await env.DB.prepare(`
SELECT *
FROM consent_history
WHERE inquiry_id = ?
ORDER BY
created_at DESC,
id DESC
`)
.bind(id)
.all();


const followups =
await env.DB.prepare(`
SELECT *
FROM follow_ups
WHERE inquiry_id = ?
ORDER BY
due_date DESC,
id DESC
`)
.bind(id)
.all();


const phoneStatus =
phoneContactStatus(
inquiry,
warningDays
);


const emailStatus =
emailContactStatus(
inquiry
);


const textStatus =
textContactStatus(
inquiry
);


const statusOptions =
STATUSES
.map(s => `
<option
value="${esc(s)}"
${inquiry.status === s
? "selected"
: ""}
>
${esc(s)}
</option>
`)
.join("");


const activityHtml =
activities.results.length
?
activities.results
.map(a => `

<div class="panel">

<div class="label">
${esc(a.activity_type)}
</div>

<div class="value note">
${esc(a.activity_note)}
</div>

<div class="small"
style="margin-top:10px">
${esc(
floridaTime(
a.created_at
)
)}
</div>

</div>

`)
.join("")
:
`
<div class="panel empty">
No activity recorded yet.
</div>
`;


const referralHtml =
referrals.results.length
?
referrals.results
.map(r => `

<div class="panel">

<div class="grid">

<div>
<div class="label">
Name
</div>
<div class="value">
${esc(r.referred_to_name)}
</div>
</div>


<div>
<div class="label">
Company
</div>
<div class="value">
${esc(r.referred_to_company)}
</div>
</div>


<div>
<div class="label">
Email
</div>
<div class="value">
${esc(r.referred_to_email)}
</div>
</div>


<div>
<div class="label">
Phone
</div>
<div class="value">
${esc(r.referred_to_phone)}
</div>
</div>


<div>
<div class="label">
Status
</div>
<div class="value">
${esc(r.referral_status)}
</div>
</div>


<div>
<div class="label">
Referral Date
</div>
<div class="value">
${esc(
calendarDate(
r.referral_date
)
)}
</div>
</div>

</div>


${r.referral_note
?
`
<div style="margin-top:18px">

<div class="label">
Referral Note
</div>

<div class="value note">
${esc(r.referral_note)}
</div>

</div>
`
:
""}


<div
class="small"
style="margin-top:14px"
>

Record created:
${esc(
floridaTime(
r.created_at
)
)}

</div>

${r.referral_status === "Prepared" && r.referred_to_email
?
`
<form
method="post"
action="/inquiry/${id}/referral-send"
style="margin-top:16px"
>
<input type="hidden" name="referral_id" value="${esc(r.id)}">

<div class="form-grid">
<label>
<span>Follow-Up Date After Referral *</span>
<input type="date" name="followup_date" required>
</label>
</div>

<div style="margin-top:12px">
<button type="submit">
Approve & Send Referral
</button>
</div>

<p class="section-note">
This button sends the exact prepared referral message above, records the email result, changes the inquiry to Referred, and schedules the follow-up date you select.
</p>
</form>
`
:
""}

</div>

`)
.join("")
:
`
<div class="panel empty">
No referrals recorded yet.
</div>
`;


const consentHtml =
consents.results.length
?
consents.results
.map(c => `

<div class="panel">

<div class="grid">

<div>
<div class="label">
Event
</div>
<div class="value">
${esc(c.event_type)}
</div>
</div>


<div>
<div class="label">
Channel
</div>
<div class="value">
${esc(c.channel)}
</div>
</div>


<div>
<div class="label">
Permission
</div>
<div class="value">
${Number(c.permission_granted) === 1
? "Granted"
: "Withdrawn"}
</div>
</div>


<div>
<div class="label">
Contact Value
</div>
<div class="value">
${esc(c.contact_value)}
</div>
</div>


<div>
<div class="label">
Source
</div>
<div class="value">
${esc(c.source)}
</div>
</div>


<div>
<div class="label">
Recorded
</div>
<div class="value">
${esc(
floridaTime(
c.created_at
)
)}
</div>
</div>

</div>


${c.event_note
?
`
<div style="margin-top:14px">

<div class="label">
Note
</div>

<div class="value note">
${esc(c.event_note)}
</div>

</div>
`
:
""}

</div>

`)
.join("")
:
`
<div class="panel empty">
No consent-history events recorded yet.
</div>
`;


const followupHtml =
followups.results.length
?
followups.results
.map(f => `

<div class="panel">

<div class="grid">

<div>
<div class="label">
Due
</div>
<div class="value">
${esc(
calendarDate(
f.due_date
)
)}
</div>
</div>


<div>
<div class="label">
Status
</div>
<div class="value">
${esc(f.status)}
</div>
</div>

</div>


<div style="margin-top:14px">

<div class="label">
Reason
</div>

<div class="value">
${esc(f.reason)}
</div>

</div>


${f.completed_note
?
`
<div style="margin-top:14px">

<div class="label">
Completion Note
</div>

<div class="value note">
${esc(f.completed_note)}
</div>

</div>
`
:
""}


${f.status === "Open"
?
`
<form
method="post"
action="/inquiry/${id}/followup-complete"
style="margin-top:18px"
>

<input
type="hidden"
name="followup_id"
value="${f.id}"
>

<label>

<span>
Completion Note
</span>

<textarea
name="completed_note"
rows="3"
maxlength="4000"
placeholder="What happened on this follow-up?"
></textarea>

</label>

<div class="form-grid" style="margin-top:14px">

<label>
<span>Next Follow-Up Date (optional)</span>
<input
type="date"
name="next_due_date"
id="next-followup-${f.id}"
>
</label>

<label>
<span>Next Follow-Up Reason (optional)</span>
<input
name="next_reason"
maxlength="1000"
placeholder="Example: Check whether broker reached client"
>
</label>

</div>

<div style="margin-top:10px">
<span class="small">Quick next date:</span>
<button type="button" onclick="setFollowupDate('next-followup-${f.id}',1)">Tomorrow</button>
<button type="button" onclick="setFollowupDate('next-followup-${f.id}',3)">3 Days</button>
<button type="button" onclick="setFollowupDate('next-followup-${f.id}',7)">7 Days</button>
<button type="button" onclick="setFollowupDate('next-followup-${f.id}',14)">14 Days</button>
<button type="button" onclick="setFollowupDate('next-followup-${f.id}',30)">30 Days</button>
</div>

<div style="margin-top:12px">

<button type="submit">
Complete Follow Up
</button>

</div>

</form>
`
:
""}

</div>

`)
.join("")
:
`
<div class="panel empty">
No follow-ups recorded yet.
</div>
`;


const html =
page(`

<a
class="back"
href="/"
>
← Back to inquiries
</a>


<div class="panel">

<h1>
Inquiry #${esc(inquiry.id)}
</h1>

${Number(inquiry.archived) === 1
? `
<div class="panel followup-overdue">
<div class="label">ARCHIVED RECORD</div>
<div class="value">
This inquiry is preserved for audit/history but is not part of the active FLTract work queue or automatic follow-up reminders.
</div>
</div>
`
: ""}


<div class="grid">

<div>
<div class="label">
Received
</div>
<div class="value">
${esc(
floridaTime(
inquiry.created_at
)
)}
</div>
</div>


<div>
<div class="label">
Status
</div>
<div class="value">
<span class="badge">
${esc(inquiry.status)}
</span>
</div>
</div>


<div>
<div class="label">
Name
</div>
<div class="value">
${esc(inquiry.first_name)}
${esc(inquiry.last_name)}
</div>
</div>


<div>
<div class="label">
Preferred Contact
</div>
<div class="value">
${esc(inquiry.preferred_contact)}
</div>
</div>


<div>
<div class="label">
Email
</div>
<div class="value">
${esc(inquiry.email)}
</div>
</div>


<div>
<div class="label">
Phone
</div>
<div class="value">
${esc(inquiry.phone)}
</div>
</div>


<div>
<div class="label">
Inquiry Type
</div>
<div class="value">
${esc(inquiryTypeDisplay(inquiry.inquiry_type))}
</div>
</div>


<div>
<div class="label">
County
</div>
<div class="value">
${esc(inquiry.county)}
</div>
</div>


<div>
<div class="label">
Property Type
</div>
<div class="value">
${esc(inquiry.property_type)}
</div>
</div>


<div>
<div class="label">
Approx. Acreage
</div>
<div class="value">
${esc(inquiry.acreage)}
</div>
</div>


<div>
<div class="label">
Timeframe
</div>
<div class="value">
${esc(inquiry.timeframe || detailField(inquiry.details,"Timeframe") || "Not recorded")}
</div>
</div>

<div>
<div class="label">
Owner Status
</div>
<div class="value">
${esc(inquiry.owner_status || detailField(inquiry.details,"Owner status") || "Not recorded")}
</div>
</div>

<div>
<div class="label">
Best Contact Time
</div>
<div class="value">
${esc(inquiry.best_contact_time || detailField(inquiry.details,"Best contact time") || "Not recorded")}
</div>
</div>

<div>
<div class="label">
How Heard About FLTract
</div>
<div class="value">
${esc(inquiry.referral_source || detailField(inquiry.details,"Referral source") || "Not recorded")}
</div>
</div>

<div>
<div class="label">
Source Page
</div>
<div class="value">
${esc(inquiry.source_page || detailField(inquiry.details,"Source page") || "Not recorded")}
</div>
</div>

<div>
<div class="label">
Improvements
</div>
<div class="value">
${esc(inquiry.improvements)}
</div>
</div>


<div>
<div class="label">
Property Location
</div>
<div class="value">
${esc(inquiry.property_location)}
</div>
</div>

</div>


<div style="margin-top:20px">

<div class="label">
Client Details
</div>

<div class="value note">
${esc(clientDetailsDisplay(inquiry.details) || "No additional client details.")}
</div>

</div>

</div>


<div class="panel">

<h2>
Client Account
</h2>

<p class="section-note">
The Client Account groups this person's FLTract property inquiries under one permanent Client ID. Exact normalized email is the automatic match key; FLTract does not automatically merge similar names or other ambiguous matches.
</p>

${clientAccount
? `
<div class="action-row">
<div>
<div class="label">Client ID</div>
<div class="value">
<strong>${esc(clientCode(clientAccount.id))}</strong>
</div>
</div>

<a class="back" href="/client/${clientAccount.id}">
Open Client Account →
</a>
</div>
`
: `
<div class="empty">
No client account could be linked automatically. Review this record manually before linking it to another person.
</div>
`}

</div>


<div class="panel">

<h2>
Property Record
</h2>

<p class="section-note">
The Property Record is the research workspace for this tract. It keeps parcel, ownership, legal-description, value, zoning, land-use, and research information separate from the client's original inquiry.
</p>

${propertyRecord
? `
<div class="action-row">
<div>
<div class="label">Property ID</div>
<div class="value"><strong>${esc(propertyCode(propertyRecord.id))}</strong></div>
</div>
<div>
<div class="label">Research Status</div>
<div class="value">${esc(propertyRecord.research_status || "Not Started")}</div>
</div>
<a class="back" href="/property/${propertyRecord.id}">
Open Property Record →
</a>
</div>
`
: `
<div class="empty">
No Property Record could be created automatically. Review the Client Account link before creating property research.
</div>
`}

</div>


<!-- ======================================================
     CONTACT COMPLIANCE
     ====================================================== -->

<div class="panel">

<h2>
Contact Compliance
</h2>

<div class="compliance-signals">

<div class="signal">
<span class="signal-light ${phoneStatus.css}" aria-hidden="true">●</span>
<span>Phone — ${esc(phoneStatus.text)}</span>
</div>

<div class="signal">
<span class="signal-light ${emailStatus.css}" aria-hidden="true">●</span>
<span>Email — ${esc(emailStatus.text)}</span>
</div>

<div class="signal">
<span class="signal-light ${textStatus.css}" aria-hidden="true">●</span>
<span>Text — ${esc(textStatus.text)}</span>
</div>

</div>

<p class="section-note">
Traffic-light status is channel-specific. Phone turns yellow when the configured contact window reaches ${esc(warningDays)} days remaining and red when it expires or a do-not-call instruction applies. Gray means no active permission is recorded for that channel.
</p>


<div class="grid">

<div>

<div class="label">
Phone
</div>

<div class="value">
<span class="badge ${phoneStatus.css}">
${esc(phoneStatus.text)}
</span>
</div>

</div>


<div>

<div class="label">
Email
</div>

<div class="value">
<span class="badge ${emailStatus.css}">
${esc(emailStatus.text)}
</span>
</div>

</div>


<div>

<div class="label">
Text
</div>

<div class="value">
<span class="badge ${textStatus.css}">
${esc(textStatus.text)}
</span>
</div>

</div>


<div>

<div class="label">
Contact Authority Basis
</div>

<div class="value">
${esc(
inquiry.contact_authority_basis ||
"Not yet recorded"
)}
</div>

</div>


<div>

<div class="label">
Phone Contact Through
</div>

<div class="value">
${inquiry.phone_contact_expires_at
? esc(
calendarDate(
String(
inquiry.phone_contact_expires_at
).slice(0,10)
)
)
: "Not established"}
</div>

</div>


<div>

<div class="label">
Consent Version
</div>

<div class="value">
${esc(
inquiry.consent_version ||
"Legacy / Not recorded"
)}
</div>

</div>

</div>


<p class="section-note">

Contact permissions are channel-specific.
A withdrawal does not delete the inquiry.
It creates a compliance history record and,
when appropriate, a suppression-list entry.

</p>

</div>


<div class="panel">

<h2>
Record Client Contact Preference Change
</h2>


<form
method="post"
action="/inquiry/${id}/permission"
>

<div class="form-grid">

<label>

<span>
Channel
</span>

<select
name="channel"
required
>

<option value="">
Select
</option>

<option>
Email
</option>

<option>
Phone
</option>

<option>
Text
</option>

</select>
</label>


<label>

<span>
Action
</span>

<select
name="permission_action"
required
>

<option value="">
Select
</option>

<option>
Allow
</option>

<option>
Withdraw
</option>

</select>

</label>


<label class="full">

<span>
Reason / Client Request
</span>

<textarea
name="permission_note"
rows="3"
maxlength="4000"
placeholder="Example: Client requested no further telephone contact."
></textarea>

</label>

</div>


<div style="margin-top:14px">

<button type="submit">
Record Preference Change
</button>

</div>

</form>

</div>


<!-- ======================================================
     STATUS
     ====================================================== -->

<div class="panel">

<h2>
Change Status
</h2>

<p class="section-note">
Use this panel to record where the inquiry is in the FLTract workflow. Saving a status changes the inquiry's operational stage; it does not by itself send an email, change contact permission, or create a follow-up.
</p>


<form
method="post"
action="/inquiry/${id}/status"
>

<div class="action-row">

<label>

<span>
Status
</span>

<select name="status">
${statusOptions}
</select>

</label>


<button type="submit">
Save Status
</button>

</div>

</form>

</div>


<!-- ======================================================
     ARCHIVE / RESTORE
     ====================================================== -->

<div class="panel">

<h2>
${Number(inquiry.archived) === 1 ? "Reopen / Restore Inquiry" : "Archive Inquiry"}
</h2>

${Number(inquiry.archived) === 1
?
`
<p class="section-note">
This inquiry is archived. Archived records remain in FLTract with their full activity, consent, referral, and follow-up history, but they are removed from the active dashboard and automatic follow-up reminders. Use Reopen / Restore when the inquiry should return to active work. The original record and its full history remain intact.
</p>

<form
method="post"
action="/inquiry/${id}/restore"
>

<label>
<span>Reopen / Restore Reason (optional)</span>
<textarea
name="restore_reason"
rows="3"
maxlength="2000"
placeholder="Example: Archived in error; inquiry is still active."
></textarea>
</label>

<div style="margin-top:14px">
<button type="submit">
Reopen Inquiry
</button>
</div>

</form>
`
:
`
<p class="section-note">
Use Archive for test, duplicate, invalid, withdrawn, or otherwise inactive inquiries that should leave the daily work queue without being deleted. Archiving preserves the complete record and audit history. Open follow-ups are retained but will not appear in reminders while the inquiry is archived.
</p>

<form
method="post"
action="/inquiry/${id}/archive"
>

<label>
<span>Archive Reason *</span>
<textarea
name="archive_reason"
rows="3"
maxlength="2000"
required
placeholder="Example: Development test record — no client action required."
></textarea>
</label>

<div style="margin-top:14px">
<button type="submit">
Archive Inquiry
</button>
</div>

</form>
`}

</div>


<!-- ======================================================
     INTERNAL NOTE
     ====================================================== -->

<div class="panel">

<h2>
Add Internal Note
</h2>

<p class="section-note">
Use this panel as the internal case notebook. Record useful client, property, conversation, research, or handling information that should remain with the inquiry. Adding a note documents the record only; it does not change status, contact permission, follow-ups, or send anything.
</p>


<form
method="post"
action="/inquiry/${id}/note"
>

<label>

<span>
Note
</span>

<textarea
name="note"
rows="5"
maxlength="4000"
required
></textarea>

</label>


<div style="margin-top:12px">

<button type="submit">
Add Note
</button>

</div>

</form>

</div>


<!-- ======================================================
     FOLLOW UP
     ====================================================== -->

<div class="panel">

<h2>
Schedule Follow Up
</h2>


<form
method="post"
action="/inquiry/${id}/followup"
>

<div class="form-grid">

<label>

<span>
Follow-Up Date
</span>

<input
type="date"
name="due_date"
id="new-followup-date"
required
>

<div style="margin-top:8px">
<span class="small">Quick date:</span>
<button type="button" onclick="setFollowupDate('new-followup-date',1)">Tomorrow</button>
<button type="button" onclick="setFollowupDate('new-followup-date',3)">3 Days</button>
<button type="button" onclick="setFollowupDate('new-followup-date',7)">7 Days</button>
<button type="button" onclick="setFollowupDate('new-followup-date',14)">14 Days</button>
<button type="button" onclick="setFollowupDate('new-followup-date',30)">30 Days</button>
</div>

</label>


<label>

<span>
Reason
</span>

<input
name="reason"
maxlength="1000"
placeholder="Example: Confirm broker contacted client"
required
>

</label>

</div>


<div style="margin-top:14px">

<button type="submit">
Schedule Follow Up
</button>

</div>

</form>

</div>


<h2>
Follow-Up History
</h2>

${followupHtml}


<!-- ======================================================
     ACTIVITY
     ====================================================== -->

<h2>
Activity History
</h2>

${activityHtml}


<!-- ======================================================
     REFERRAL
     ====================================================== -->

<div class="panel">

<h2>
Prepare Referral
</h2>

<p class="section-note">
Prepare and review the referral here. Nothing is sent until you use the separate Approve &amp; Send Referral button in Referral History.
</p>

<form
method="post"
action="/inquiry/${id}/referral"
>

<div class="form-grid">

<label>
<span>Broker / Agent Name</span>
<input name="referred_to_name" maxlength="200">
</label>

<label>
<span>Company / Brokerage</span>
<input name="referred_to_company" maxlength="200">
</label>

<label>
<span>Email *</span>
<input type="email" name="referred_to_email" maxlength="254" required>
</label>

<label>
<span>Phone</span>
<input name="referred_to_phone" maxlength="100">
</label>

<label class="full">
<span>Referral Message *</span>
<textarea
name="referral_note"
rows="16"
maxlength="4000"
required
>Hello,

FLTract is referring the following property inquiry for your review.

Client: ${esc(inquiry.first_name)} ${esc(inquiry.last_name)}
Preferred contact: ${esc(inquiry.preferred_contact)}
Email: ${esc(inquiry.email)}
Phone: ${esc(inquiry.phone)}
County: ${esc(inquiry.county)}
Property type: ${esc(inquiry.property_type)}
Approx. acreage: ${esc(inquiry.acreage)}
Property location: ${esc(inquiry.property_location)}

Client inquiry:
${esc(clientDetailsDisplay(inquiry.details) || "No additional client details provided.")}

Please review the inquiry and contact the client directly as appropriate.

FLTract
Florida Land & Property Information and Referral Resource</textarea>
</label>

</div>

<div style="margin-top:14px">
<button type="submit">
Prepare Referral for Review
</button>
</div>

</form>

</div>


<h2>
Referral History
</h2>

${referralHtml}


<!-- ======================================================
     CONSENT HISTORY
     ====================================================== -->

<details class="history-collapse">

<summary>
Consent &amp; Contact Preference History — ${consents.results.length} Record${consents.results.length === 1 ? "" : "s"}
</summary>

<div class="history-collapse-body">
${consentHtml}
</div>

</details>

`,
`Inquiry #${inquiry.id} | FLTract Admin`
);


return new Response(
html,
{
headers:{
"content-type":
"text/html; charset=utf-8",

"cache-control":
"no-store",

"x-content-type-options":
"nosniff",

"referrer-policy":
"no-referrer"
}
}
);

}


/* ============================================================
   MAIN INQUIRY LIST
   ============================================================ */

const status =
url.searchParams.get("status") || "";

const county =
url.searchParams.get("county") || "";

const search =
url.searchParams.get("q") || "";


const showArchived =
url.searchParams.get("archived") === "1";


const today =
floridaToday();


const management =
await env.DB.prepare(`
SELECT
SUM(CASE WHEN status = 'New' THEN 1 ELSE 0 END) AS new_count,
SUM(CASE WHEN status = 'Referral Prepared' THEN 1 ELSE 0 END) AS prepared_count,
SUM(CASE WHEN status = 'Referred' THEN 1 ELSE 0 END) AS referred_count,
SUM(CASE WHEN status = 'Closed' THEN 1 ELSE 0 END) AS closed_count,
SUM(
  CASE
    WHEN follow_up_status = 'Open'
      AND next_follow_up_date = ?
    THEN 1 ELSE 0
  END
) AS due_today_count,
SUM(
  CASE
    WHEN follow_up_status = 'Open'
      AND next_follow_up_date < ?
    THEN 1 ELSE 0
  END
) AS overdue_count
FROM inquiries
WHERE archived = 0
`)
.bind(today,today)
.first();


const archivedSummary =
await env.DB.prepare(`
SELECT COUNT(*) AS archived_count
FROM inquiries
WHERE archived = 1
`)
.first();


let sql = `
SELECT *
FROM inquiries
WHERE archived = ${showArchived ? 1 : 0}
`;


const params = [];


if (status) {

sql += `
AND status = ?
`;

params.push(status);

}


if (county) {

sql += `
AND county = ?
`;

params.push(county);

}


if (search) {

sql += `
AND (
first_name LIKE ?
OR last_name LIKE ?
OR property_location LIKE ?
)
`;

const term =
`%${search}%`;

params.push(
term,
term,
term
);

}


sql += `
ORDER BY created_at DESC
LIMIT 250
`;


const stmt =
env.DB.prepare(sql);


const { results } =
params.length
?
await stmt.bind(...params).all()
:
await stmt.all();


let dueTodayCount = 0;
let overdueCount = 0;


for (const r of results) {

if (
r.follow_up_status === "Open" &&
r.next_follow_up_date
) {

if (
r.next_follow_up_date < today
) {
overdueCount++;
}
else if (
r.next_follow_up_date === today
) {
dueTodayCount++;
}

}

}


const rows =
results.length
?
results.map(r => {

const phone =
phoneContactStatus(
r,
warningDays
);


let followup = "";

if (
r.follow_up_status === "Open" &&
r.next_follow_up_date
) {

if (
r.next_follow_up_date < today
) {

followup =
`<span class="badge danger">OVERDUE</span>`;

}
else if (
r.next_follow_up_date === today
) {

followup =
`<span class="badge warning">DUE TODAY</span>`;

}
else {

followup =
esc(
calendarDate(
r.next_follow_up_date
)
);

}

}


return `

<tr>

<td>
<a href="/inquiry/${r.id}">
#${esc(r.id)}
</a>
</td>


<td>
${esc(
floridaTime(
r.created_at
)
)}
</td>


<td>
${esc(r.first_name)}
${esc(r.last_name)}
</td>


<td>
${esc(r.inquiry_type)}
</td>


<td>
${esc(r.county)}
</td>


<td>
${esc(r.property_type)}
</td>


<td>
<span class="badge">
${esc(r.status)}
</span>
</td>


<td>
<span class="badge ${phone.css}">
${esc(phone.text)}
</span>
</td>


<td>
${followup}
</td>

</tr>

`;

}).join("")
:
`
<tr>
<td
colspan="9"
class="empty"
>
No inquiries found.
</td>
</tr>
`;


const statusOptions =
STATUSES
.map(s => `

<option
value="${esc(s)}"
${status === s
? "selected"
: ""}
>
${esc(s)}
</option>

`)
.join("");


const html =
page(`

<h1>
${showArchived ? "Archived Inquiries" : "Property Inquiries"}
</h1>

${showArchived
? `
<div class="panel">
<h2>Archived Records</h2>
<p class="section-note">
These inquiries are retained for audit, training, and historical reference but are excluded from the active management dashboard and automatic follow-up reminders. Open a record and use Reopen / Restore Inquiry if it needs to return to active work.
</p>
<a class="back" href="/">← Return to active inquiries</a>
</div>
`
: ""}


${showArchived ? "" : `
<div class="panel">

<h2>
Management Dashboard
</h2>

<p class="section-note">
Use these cards as the daily FLTract work queue. The numbers cover all active, non-archived inquiries, regardless of the filters below. Click a status card to show those inquiries; click Due Today or Overdue to open the Follow Ups work list. Red requires attention, yellow is due now, and green or gray is informational.
</p>

<p class="section-note">
The automatic follow-up reminder checks each morning and emails the FLTract office only when a follow-up is due or overdue. The dashboard remains the authoritative on-screen work list.
</p>

<div class="management-grid">

<a class="management-card" href="/?status=New">
<div class="label">New</div>
<div class="summary-number">${Number(management?.new_count || 0)}</div>
<div class="small">New inquiries awaiting initial review.</div>
</a>

<a class="management-card warning" href="/followups">
<div class="label">Due Today</div>
<div class="summary-number">${Number(management?.due_today_count || 0)}</div>
<div class="small">Open follow-ups that should be handled today.</div>
</a>

<a class="management-card danger" href="/followups">
<div class="label">Overdue</div>
<div class="summary-number">${Number(management?.overdue_count || 0)}</div>
<div class="small">Open follow-ups past their scheduled date.</div>
</a>

<a class="management-card warning" href="/?status=Referral%20Prepared">
<div class="label">Referral Prepared</div>
<div class="summary-number">${Number(management?.prepared_count || 0)}</div>
<div class="small">Prepared referrals waiting for human review and approval.</div>
</a>

<a class="management-card" href="/?status=Referred">
<div class="label">Referred</div>
<div class="summary-number">${Number(management?.referred_count || 0)}</div>
<div class="small">Inquiries already sent to a referral professional.</div>
</a>

<a class="management-card muted" href="/?status=Closed">
<div class="label">Closed</div>
<div class="summary-number">${Number(management?.closed_count || 0)}</div>
<div class="small">Completed inquiries retained in the operational record.</div>
</a>

</div>

</div>
`}


<div class="panel">

<div class="action-row" style="margin-bottom:16px">
<div>
<strong>${showArchived ? "Archived Records" : "Active Records"}</strong>
<div class="small">
${showArchived
? "Search and review records removed from the active work queue."
: "Filter the active work queue or open the archive when historical/test records are needed."}
</div>
</div>

<div class="action-row">
<a class="back" href="/clients">
Client Accounts
</a>

<a class="back" href="${showArchived ? "/" : "/?archived=1"}">
${showArchived
? "← Active Inquiries"
: `View Archived Records (${Number(archivedSummary?.archived_count || 0)})`}
</a>
</div>
</div>

<form
class="filters"
method="get"
>

${showArchived ? '<input type="hidden" name="archived" value="1">' : ""}

<input
name="q"
value="${esc(search)}"
placeholder="Search name or property location"
>


<select name="status">

<option value="">
All statuses
</option>

${statusOptions}

</select>


<select name="county">

<option value="">
All counties
</option>

<option
${county === "Brevard"
? "selected"
: ""}
>
Brevard
</option>

<option
${county === "Indian River"
? "selected"
: ""}
>
Indian River
</option>

<option
${county === "St. Lucie"
? "selected"
: ""}
>
St. Lucie
</option>

<option
${county === "Martin"
? "selected"
: ""}
>
Martin
</option>

<option
${county === "Okeechobee"
? "selected"
: ""}
>
Okeechobee
</option>

</select>


<button type="submit">
Filter
</button>

</form>


<table>

<thead>

<tr>

<th>
ID
</th>

<th>
Received
</th>

<th>
Contact
</th>

<th>
Inquiry
</th>

<th>
County
</th>

<th>
Property
</th>

<th>
Status
</th>

<th>
Phone Contact
</th>

<th>
Follow Up
</th>

</tr>

</thead>


<tbody>

${rows}

</tbody>

</table>

</div>

`);


return new Response(
html,
{
headers:{
"content-type":
"text/html; charset=utf-8",

"cache-control":
"no-store",

"x-content-type-options":
"nosniff",

"referrer-policy":
"no-referrer"
}
}
);

},

async scheduled(controller, env, ctx) {

ctx.waitUntil(
sendDailyFollowupReminder(env)
.catch(error => {
console.error(
"Daily FLTract follow-up reminder failed:",
error
);
})
);

}

};