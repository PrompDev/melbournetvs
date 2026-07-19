const MAX_BATCH_ROWS = 500;
const MAX_COLUMNS = 100;
const RUN_HEADER_ROW = 6;
const RUN_HEADERS = ['Run time', 'Status', 'Leads seen', 'New leads', 'Duration', 'Details'];
const RUN_DATA_ROW = RUN_HEADER_ROW + 1;
const RUN_RETENTION_DAYS = 31;
const RUN_NOTE_PREFIX = 'MELBOURNE_TVS_RUN_V1:';
const RUN_RANGE_SEPARATOR = String.fromCharCode(8211);
const RUN_COLORS = {
  raw: '#eeeeee',
  halfHour: '#fce8b2',
  hour: '#e4d7f5',
  day: '#d2e3fc',
  error: '#f4c7c3',
};
const PORTAL_LEADS_SHEET = 'Leads';
const PORTAL_RUNS_SHEET = 'Runs';
const PORTAL_TIME_ZONE = 'Australia/Melbourne';
const PORTAL_MAX_LEAD_ROWS = 5000;
const PORTAL_MAX_RUN_ROWS = 200;
const PORTAL_HEALTH_WINDOW_MS = 20 * 60 * 1000;
const CALENDAR_CALLS_SHEET = 'Calendar Calls';
const CALENDAR_CALL_HEADERS = [
  'Lead ID',
  'Status',
  'Queued at',
  'Call time',
  'Event ID',
  'Attempts',
  'Last error',
  'Updated',
];
const CALENDAR_LEAD_TAG = 'melbourne_tvs_lead_id';
const CALENDAR_MAX_ATTEMPTS = 12;
const CALENDAR_MAX_PER_RUN = 10;

function doGet() {
  return jsonResponse_({ ok: true, service: 'melbourne-tvs-lead-ingest' });
}

function doPost(event) {
  let request;
  try {
    request = JSON.parse(event && event.postData ? event.postData.contents : '');
  } catch (error) {
    return jsonResponse_({ ok: false, error: 'Invalid JSON request' });
  }
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    return jsonResponse_({ ok: false, error: 'Invalid JSON request' });
  }

  // The portal is intentionally a separate, aggregate-only read path. It
  // uses its own secret and does not accept a caller-supplied sheet name.
  if (request.type === 'portal_summary') {
    return portalSummary_(request);
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return jsonResponse_({ ok: false, error: 'The sheet is busy; retry shortly' });
  }

  try {
    const expectedSecret = PropertiesService.getScriptProperties().getProperty('INGEST_SECRET');
    if (!expectedSecret) {
      return jsonResponse_({ ok: false, error: 'INGEST_SECRET is not configured' });
    }

    if (request.secret !== expectedSecret) {
      return jsonResponse_({ ok: false, error: 'Unauthorized' });
    }
    if (request.type === 'run') {
      return logRun_(request);
    }

    const headers = Array.isArray(request.headers) ? request.headers.map(String) : [];
    const rows = Array.isArray(request.rows) ? request.rows : [];
    if (!headers.length || headers.length > MAX_COLUMNS || !headers.includes('id')) {
      return jsonResponse_({ ok: false, error: 'Invalid or missing lead headers' });
    }
    if (rows.length > MAX_BATCH_ROWS) {
      return jsonResponse_({ ok: false, error: 'Batch exceeds 500 rows' });
    }
    if (rows.some(function (row) { return !Array.isArray(row) || row.length !== headers.length; })) {
      return jsonResponse_({ ok: false, error: 'Row width does not match headers' });
    }

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const requestedName = String(request.sheetName || 'Leads').slice(0, 80);
    const sheet = spreadsheet.getSheetByName(requestedName) || spreadsheet.insertSheet(requestedName);
    const storedHeaders = headers.concat(['synced_at']);

    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, storedHeaders.length).setValues([storedHeaders]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, storedHeaders.length).setFontWeight('bold');
    } else {
      const existingHeaders = sheet
        .getRange(1, 1, 1, storedHeaders.length)
        .getDisplayValues()[0];
      if (JSON.stringify(existingHeaders) !== JSON.stringify(storedHeaders)) {
        return jsonResponse_({ ok: false, error: 'Existing sheet headers do not match' });
      }
    }

    const idColumn = headers.indexOf('id');
    const existingIds = new Set();
    if (sheet.getLastRow() > 1) {
      sheet
        .getRange(2, idColumn + 1, sheet.getLastRow() - 1, 1)
        .getDisplayValues()
        .forEach(function (row) { if (row[0]) existingIds.add(String(row[0])); });
    }

    const now = new Date().toISOString();
    const newRows = [];
    const newLeadIds = [];
    let duplicateCount = 0;
    rows.forEach(function (row) {
      const id = String(row[idColumn] || '').trim();
      if (!id) throw new Error('A submitted row has no lead ID');
      if (existingIds.has(id)) {
        duplicateCount += 1;
        return;
      }
      existingIds.add(id);
      newRows.push(row.map(safeCell_).concat([now]));
      newLeadIds.push(id);
    });

    if (newRows.length) {
      const target = sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, storedHeaders.length);
      target.setNumberFormat('@');
      target.setValues(newRows);
    }

    let calendarResult = {
      enabled: false,
      queuedCount: 0,
      scheduledCount: 0,
      errorCount: 0,
    };
    if (newLeadIds.length) {
      calendarResult = queueAndScheduleLeadCalls_(spreadsheet, sheet, newLeadIds, new Date(now));
    }

    return jsonResponse_({
      ok: true,
      processedCount: rows.length,
      insertedCount: newRows.length,
      duplicateCount: duplicateCount,
      calendarEnabled: calendarResult.enabled,
      calendarQueuedCount: calendarResult.queuedCount,
      calendarScheduledCount: calendarResult.scheduledCount,
      calendarErrorCount: calendarResult.errorCount,
    });
  } catch (error) {
    return jsonResponse_({ ok: false, error: String(error.message || error).slice(0, 300) });
  } finally {
    lock.releaseLock();
  }
}

function portalSummary_(request) {
  const expectedSecret = PropertiesService.getScriptProperties().getProperty('PORTAL_READ_SECRET');
  if (!expectedSecret) {
    return jsonResponse_({ ok: false, error: 'Portal summary is not configured' });
  }
  if (request.secret !== expectedSecret) {
    return jsonResponse_({ ok: false, error: 'Unauthorized' });
  }

  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const leadsSheet = spreadsheet.getSheetByName(PORTAL_LEADS_SHEET);
    const runsSheet = spreadsheet.getSheetByName(PORTAL_RUNS_SHEET);
    return jsonResponse_(portalSummaryData_(leadsSheet, runsSheet, new Date(), PORTAL_TIME_ZONE));
  } catch (error) {
    return jsonResponse_({ ok: false, error: 'Portal summary is unavailable' });
  }
}

function portalSummaryData_(leadsSheet, runsSheet, now, timeZone) {
  const leads = portalLeadSummary_(leadsSheet, now, timeZone);
  const runs = portalRunSummary_(runsSheet, now, timeZone);
  return {
    ok: true,
    totalLeads: leads.totalLeads,
    leadsToday: leads.leadsToday,
    leadsLast7Days: leads.leadsLast7Days,
    latestLeadRecency: leads.latestLeadRecency,
    syncHealth: runs.syncHealth,
    lastRunRecency: runs.lastRunRecency,
    byPlatform: leads.byPlatform,
    byTvSize: leads.byTvSize,
  };
}

function portalLeadSummary_(sheet, now, timeZone) {
  const empty = {
    totalLeads: 0,
    leadsToday: 0,
    leadsLast7Days: 0,
    latestLeadRecency: 'none',
    byPlatform: [],
    byTvSize: [],
  };
  if (!sheet || sheet.getLastRow() < 2 || sheet.getLastColumn() < 1) return empty;

  const lastRow = sheet.getLastRow();
  const columnCount = Math.min(sheet.getLastColumn(), MAX_COLUMNS);
  const headers = sheet.getRange(1, 1, 1, columnCount).getDisplayValues()[0].map(normalizePortalHeader_);
  const syncedAtColumn = portalHeaderIndex_(headers, ['synced_at']);
  const createdAtColumn = portalHeaderIndex_(headers, ['created_time', 'created_at']);
  const dateColumn = syncedAtColumn >= 0 ? syncedAtColumn : createdAtColumn;
  const platformColumn = portalHeaderIndex_(headers, ['platform']);
  const tvSizeColumn = portalHeaderIndex_(headers, ['what_size_is_your_tv', 'tv_size'], function (header) {
    return header.indexOf('tv') >= 0 && header.indexOf('size') >= 0;
  });
  const rowCount = Math.min(lastRow - 1, PORTAL_MAX_LEAD_ROWS);
  const firstRow = lastRow - rowCount + 1;
  const rows = sheet.getRange(firstRow, 1, rowCount, columnCount).getValues();
  const today = dayKey_(now, timeZone);
  const weekStart = dayKey_(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000), timeZone);
  const platformCounts = { Facebook: 0, Instagram: 0, Website: 0, Other: 0 };
  const sizeCounts = { 'Under 55"': 0, '55-64"': 0, '65-74"': 0, '75"+': 0, Unknown: 0 };
  let leadsToday = 0;
  let leadsLast7Days = 0;
  let latestLeadAt = null;

  rows.forEach(function (row) {
    if (dateColumn >= 0) {
      const date = portalDate_(row[dateColumn]);
      if (date) {
        const key = dayKey_(date, timeZone);
        if (key === today) leadsToday += 1;
        if (key >= weekStart && key <= today) leadsLast7Days += 1;
        if (!latestLeadAt || date > latestLeadAt) latestLeadAt = date;
      }
    }

    if (platformColumn >= 0) {
      platformCounts[portalPlatformBucket_(row[platformColumn])] += 1;
    }
    if (tvSizeColumn >= 0) {
      sizeCounts[portalTvSizeBucket_(row[tvSizeColumn])] += 1;
    }
  });

  return {
    totalLeads: lastRow - 1,
    leadsToday: leadsToday,
    leadsLast7Days: leadsLast7Days,
    latestLeadRecency: latestLeadAt
      ? portalRecency_(latestLeadAt, now, timeZone)
      : (lastRow > 1 ? 'unknown' : 'none'),
    byPlatform: portalBuckets_(platformCounts, ['Facebook', 'Instagram', 'Website', 'Other']),
    byTvSize: portalBuckets_(sizeCounts, ['Under 55"', '55-64"', '65-74"', '75"+', 'Unknown']),
  };
}

function portalRunSummary_(sheet, now, timeZone) {
  const empty = { syncHealth: 'never', lastRunRecency: 'none' };
  if (!sheet || sheet.getLastRow() < RUN_DATA_ROW) return empty;

  const lastRow = sheet.getLastRow();
  const rowCount = Math.min(lastRow - RUN_HEADER_ROW, PORTAL_MAX_RUN_ROWS);
  const firstRow = lastRow - rowCount + 1;
  const rows = sheet.getRange(firstRow, 1, rowCount, 2).getValues();

  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const date = portalDate_(rows[index][0]);
    const status = String(rows[index][1] || '').toUpperCase();
    if (!date || !['OK', 'ERROR'].includes(status)) continue;

    const recency = portalRecency_(date, now, timeZone);
    return {
      syncHealth: status === 'OK' && now.getTime() - date.getTime() <= PORTAL_HEALTH_WINDOW_MS
        ? 'healthy'
        : 'attention',
      lastRunRecency: recency,
    };
  }

  return empty;
}

function normalizePortalHeader_(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function portalHeaderIndex_(headers, exactMatches, fallback) {
  for (let index = 0; index < headers.length; index += 1) {
    if (exactMatches.includes(headers[index])) return index;
  }
  if (typeof fallback !== 'function') return -1;
  for (let index = 0; index < headers.length; index += 1) {
    if (fallback(headers[index])) return index;
  }
  return -1;
}

function portalDate_(value) {
  if (value && typeof value.getTime === 'function' && !isNaN(value.getTime())) {
    return new Date(value.getTime());
  }
  const parsed = new Date(String(value || ''));
  return isNaN(parsed.getTime()) ? null : parsed;
}

function portalRecency_(date, now, timeZone) {
  const key = dayKey_(date, timeZone);
  if (key === dayKey_(now, timeZone)) return 'today';
  if (key === dayKey_(new Date(now.getTime() - 24 * 60 * 60 * 1000), timeZone)) return 'yesterday';
  return 'older';
}

function portalPlatformBucket_(value) {
  const text = String(value || '').toLowerCase();
  if (text.indexOf('instagram') >= 0) return 'Instagram';
  if (text.indexOf('facebook') >= 0 || text.indexOf('meta') >= 0) return 'Facebook';
  if (text.indexOf('website') >= 0 || text.indexOf('web') >= 0) return 'Website';
  return 'Other';
}

function portalTvSizeBucket_(value) {
  const match = String(value || '').match(/\b(\d{2,3})\b/);
  if (!match) return 'Unknown';
  const size = Number(match[1]);
  if (size < 55) return 'Under 55"';
  if (size < 65) return '55-64"';
  if (size < 75) return '65-74"';
  return '75"+';
}

function portalBuckets_(counts, labels) {
  return labels
    .filter(function (label) { return counts[label] > 0; })
    .map(function (label) { return { label: label, count: counts[label] }; });
}

function calendarConfig_() {
  const properties = PropertiesService.getScriptProperties();
  const enabled = String(properties.getProperty('CALENDAR_ENABLED') || '').toLowerCase() === 'true';
  return {
    enabled: enabled,
    attendee: String(properties.getProperty('CALENDAR_ATTENDEE') || '').trim(),
    calendarId: String(properties.getProperty('CALENDAR_ID') || '').trim(),
    delayMinutes: boundedInteger_(properties.getProperty('CALENDAR_DELAY_MINUTES'), 30, 5, 55),
    durationMinutes: boundedInteger_(properties.getProperty('CALENDAR_DURATION_MINUTES'), 15, 5, 60),
  };
}

function verifyCalendarAccess() {
  const calendar = CalendarApp.getDefaultCalendar();
  if (!calendar) throw new Error('The default Google Calendar was not found');
  return calendar.getName();
}

function boundedInteger_(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(parsed)));
}

function queueAndScheduleLeadCalls_(spreadsheet, leadsSheet, leadIds, now) {
  const config = calendarConfig_();
  if (!config.enabled) {
    return { enabled: false, queuedCount: 0, scheduledCount: 0, errorCount: 0 };
  }

  const queue = calendarCallsSheet_(spreadsheet);
  const queuedCount = queueCalendarLeadIds_(queue, leadIds, now);
  const result = processPendingLeadCalls_(spreadsheet, leadsSheet, leadIds, now, config);
  result.queuedCount = queuedCount;
  return result;
}

function calendarCallsSheet_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(CALENDAR_CALLS_SHEET) ||
    spreadsheet.insertSheet(CALENDAR_CALLS_SHEET);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, CALENDAR_CALL_HEADERS.length).setValues([CALENDAR_CALL_HEADERS]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, CALENDAR_CALL_HEADERS.length).setFontWeight('bold');
  } else {
    const headers = sheet
      .getRange(1, 1, 1, CALENDAR_CALL_HEADERS.length)
      .getDisplayValues()[0];
    if (JSON.stringify(headers) !== JSON.stringify(CALENDAR_CALL_HEADERS)) {
      throw new Error('Existing Calendar Calls headers do not match');
    }
  }
  return sheet;
}

function queueCalendarLeadIds_(sheet, leadIds, now) {
  const existing = new Set();
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues()
      .forEach(function (row) { if (row[0]) existing.add(String(row[0])); });
  }
  const rows = [];
  leadIds.forEach(function (leadId) {
    const id = String(leadId || '').trim();
    if (!id || existing.has(id)) return;
    existing.add(id);
    rows.push([id, 'PENDING', now, '', '', 0, '', now]);
  });
  if (!rows.length) return 0;

  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, rows.length, CALENDAR_CALL_HEADERS.length).setValues(rows);
  sheet.getRange(startRow, 3, rows.length, 2).setNumberFormat('d mmm yyyy, h:mm am/pm');
  sheet.getRange(startRow, 8, rows.length, 1).setNumberFormat('d mmm yyyy, h:mm:ss am/pm');
  return rows.length;
}

function processPendingLeadCalls_(spreadsheet, leadsSheet, leadIds, now, suppliedConfig) {
  const config = suppliedConfig || calendarConfig_();
  const result = {
    enabled: config.enabled,
    queuedCount: 0,
    scheduledCount: 0,
    errorCount: 0,
  };
  if (!config.enabled) return result;

  const queue = calendarCallsSheet_(spreadsheet);
  if (queue.getLastRow() < 2) return result;
  const allowedIds = leadIds && leadIds.length
    ? new Set(leadIds.map(function (value) { return String(value); }))
    : null;
  const rows = queue
    .getRange(2, 1, queue.getLastRow() - 1, CALENDAR_CALL_HEADERS.length)
    .getValues();
  const pending = [];
  rows.forEach(function (row, index) {
    const leadId = String(row[0] || '');
    const status = String(row[1] || '').toUpperCase();
    const attempts = Math.max(0, Number(row[5] || 0));
    if (!leadId || (allowedIds && !allowedIds.has(leadId))) return;
    if (!['PENDING', 'ERROR'].includes(status) || attempts >= CALENDAR_MAX_ATTEMPTS) return;
    pending.push({
      rowNumber: index + 2,
      leadId: leadId,
      queuedAt: validDate_(row[2]) ? new Date(row[2]) : new Date(now),
      attempts: attempts,
    });
  });
  if (!pending.length) return result;

  const active = pending.slice(0, CALENDAR_MAX_PER_RUN);
  const source = leadsSheet || spreadsheet.getSheetByName(PORTAL_LEADS_SHEET);
  const records = leadRecordsById_(source, active.map(function (item) { return item.leadId; }));
  let calendar;
  try {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.attendee)) {
      throw new Error('CALENDAR_ATTENDEE is not configured with a valid email');
    }
    calendar = config.calendarId
      ? CalendarApp.getCalendarById(config.calendarId)
      : CalendarApp.getDefaultCalendar();
    if (!calendar) throw new Error('The configured Google Calendar was not found');
  } catch (error) {
    active.forEach(function (item) {
      writeCalendarCallError_(queue, item, error, now);
      result.errorCount += 1;
    });
    return result;
  }

  active.forEach(function (item) {
    try {
      const record = records[item.leadId];
      if (!record) throw new Error('The matching lead row was not found');
      let event = existingLeadCallEvent_(calendar, item.leadId, item.queuedAt, now);
      if (!event) {
        event = createLeadCallEvent_(calendar, item.leadId, record, item.queuedAt, now, config);
      }
      const startTime = event.getStartTime();
      queue.getRange(item.rowNumber, 2, 1, 7).setValues([[
        'SCHEDULED',
        item.queuedAt,
        startTime,
        String(event.getId() || ''),
        item.attempts + 1,
        '',
        now,
      ]]);
      queue.getRange(item.rowNumber, 3, 1, 2).setNumberFormat('d mmm yyyy, h:mm am/pm');
      queue.getRange(item.rowNumber, 8).setNumberFormat('d mmm yyyy, h:mm:ss am/pm');
      result.scheduledCount += 1;
    } catch (error) {
      writeCalendarCallError_(queue, item, error, now);
      result.errorCount += 1;
    }
  });
  return result;
}

function writeCalendarCallError_(sheet, item, error, now) {
  const message = String(error && error.message ? error.message : error)
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 180);
  sheet.getRange(item.rowNumber, 2, 1, 7).setValues([[
    'ERROR',
    item.queuedAt,
    '',
    '',
    item.attempts + 1,
    message,
    now,
  ]]);
  sheet.getRange(item.rowNumber, 3).setNumberFormat('d mmm yyyy, h:mm am/pm');
  sheet.getRange(item.rowNumber, 8).setNumberFormat('d mmm yyyy, h:mm:ss am/pm');
}

function leadRecordsById_(sheet, leadIds) {
  const result = {};
  if (!sheet || sheet.getLastRow() < 2) return result;
  const columnCount = Math.min(sheet.getLastColumn(), MAX_COLUMNS);
  const headers = sheet.getRange(1, 1, 1, columnCount).getDisplayValues()[0].map(String);
  const idColumn = headers.indexOf('id');
  if (idColumn < 0) return result;
  const wanted = new Set(leadIds.map(function (value) { return String(value); }));
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, columnCount).getDisplayValues();
  rows.forEach(function (row) {
    const leadId = String(row[idColumn] || '');
    if (!wanted.has(leadId)) return;
    const record = {};
    headers.forEach(function (header, index) { record[header] = String(row[index] || ''); });
    result[leadId] = record;
  });
  return result;
}

function existingLeadCallEvent_(calendar, leadId, queuedAt, now) {
  const start = new Date(Math.min(queuedAt.getTime(), now.getTime()) - 60 * 60 * 1000);
  const end = new Date(Math.max(queuedAt.getTime(), now.getTime()) + 48 * 60 * 60 * 1000);
  const events = calendar.getEvents(start, end);
  for (let index = 0; index < events.length; index += 1) {
    if (typeof events[index].getTag === 'function' &&
        events[index].getTag(CALENDAR_LEAD_TAG) === leadId) {
      return events[index];
    }
  }
  return null;
}

function createLeadCallEvent_(calendar, leadId, record, queuedAt, now, config) {
  const preferred = queuedAt.getTime() + config.delayMinutes * 60 * 1000;
  const retryFloor = now.getTime() + 5 * 60 * 1000;
  const start = new Date(Math.max(preferred, retryFloor));
  start.setSeconds(0, 0);
  const remainder = start.getMinutes() % 5;
  if (remainder) start.setMinutes(start.getMinutes() + 5 - remainder);
  const end = new Date(start.getTime() + config.durationMinutes * 60 * 1000);

  const name = calendarField_(record, ['full_name', 'name', 'customer_name', 'contact_name'], 100) ||
    'New enquiry';
  const phone = calendarPhone_(record);
  const dialNumber = calendarDialNumber_(phone);
  const email = calendarField_(record, ['email', 'email_address', 'contact_email'], 160);
  const postcode = calendarField_(record, ['postcode', 'post_code', 'postal_code'], 20);
  const tvSize = calendarField_(
    record,
    ['what_size_is_your_tv', 'tv_size', 'television_size'],
    100,
  );
  const platform = calendarField_(record, ['platform', 'source', 'lead_source'], 60);
  const adName = calendarField_(record, ['ad_name', 'ad', 'campaign_name'], 160);
  const received = calendarField_(
    record,
    ['created_time', 'received_at', 'submitted_at', 'created_at'],
    80,
  );
  const callLink = calendarCallLink_(leadId, platform);
  const description = [
    'Melbourne TVs lead follow-up',
    '',
    'Customer: ' + name,
    phone ? 'Phone: ' + phone : 'Phone: MISSING - check the lead sheet',
    dialNumber ? 'Tap to call: tel:' + dialNumber : '',
    email ? 'Email: ' + email : '',
    postcode ? 'Postcode: ' + postcode : '',
    tvSize ? 'TV size: ' + tvSize : '',
    platform ? 'Source: ' + platform : '',
    adName ? 'Ad: ' + adName : '',
    received ? 'Lead received: ' + received : '',
    callLink ? 'Call through Melbourne TVs: ' + callLink : '',
    '',
    'Lead ID: ' + calendarText_(leadId, 100),
  ].filter(function (line) { return line !== ''; }).join('\n');

  const title = 'Call Melbourne TVs lead - ' + name +
    (phone ? ' - ' + phone : ' - PHONE MISSING');

  const event = calendar.createEvent(
    title,
    start,
    end,
    {
      description: description,
      guests: config.attendee,
      sendInvites: true,
      location: postcode,
    },
  );
  if (typeof event.setTag === 'function') event.setTag(CALENDAR_LEAD_TAG, leadId);
  if (typeof event.addPopupReminder === 'function') event.addPopupReminder(10);
  if (typeof event.setColor === 'function' && CalendarApp.EventColor && CalendarApp.EventColor.MAUVE) {
    event.setColor(CalendarApp.EventColor.MAUVE);
  }
  return event;
}

function calendarField_(record, names, maximum) {
  for (let index = 0; index < names.length; index += 1) {
    const value = calendarText_(record && record[names[index]], maximum);
    if (value) return value;
  }
  return '';
}

function calendarPhone_(record) {
  return calendarField_(
    record,
    ['phone_number', 'phone', 'mobile', 'mobile_number', 'contact_phone', 'contact_number'],
    80,
  ).replace(/^(?:p|phone):\s*/i, '').trim();
}

function calendarDialNumber_(phone) {
  const value = String(phone || '').trim();
  const digits = value.replace(/\D/g, '');
  if (!digits) return '';
  return value.charAt(0) === '+' ? '+' + digits : digits;
}

function calendarCallLink_(leadId, platform) {
  const sourceText = String(platform || '').trim().toLowerCase();
  const source = sourceText === 'website' ? 'website' : 'meta';
  return 'https://melbournetvs.com/operations/calls/start/?ref=' +
    encodeURIComponent(String(leadId || '')) + '&source=' + encodeURIComponent(source);
}

function calendarText_(value, maximum) {
  return String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, maximum);
}

function logRun_(request) {
  const run = request && typeof request.run === 'object' ? request.run : {};
  const runTime = new Date(String(run.runAt || ''));
  const status = String(run.status || '').toUpperCase();
  if (isNaN(runTime.getTime()) || !['OK', 'ERROR'].includes(status)) {
    return jsonResponse_({ ok: false, error: 'Invalid run log payload' });
  }

  const numberOrBlank = function (value) {
    if (value === null || value === undefined || value === '') return '';
    const number = Number(value);
    return isFinite(number) ? number : '';
  };
  const leadCount = numberOrBlank(run.leadCount);
  const newLeadCount = numberOrBlank(run.newLeadCount);
  const durationSeconds = Math.max(0, Number(run.durationMs || 0)) / 1000;
  const details = safeCell_(run.details || '');

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const requestedName = String(request.runsSheetName || 'Runs').slice(0, 80);
  const sheet = spreadsheet.getSheetByName(requestedName) || spreadsheet.insertSheet(requestedName);
  if (sheet.getMaxRows() < RUN_HEADER_ROW + 1) {
    sheet.insertRowsAfter(sheet.getMaxRows(), RUN_HEADER_ROW + 1 - sheet.getMaxRows());
  }

  const existingHeaders = sheet
    .getRange(RUN_HEADER_ROW, 1, 1, RUN_HEADERS.length)
    .getDisplayValues()[0];
  if (existingHeaders.every(function (value) { return value === ''; })) {
    sheet.getRange(RUN_HEADER_ROW, 1, 1, RUN_HEADERS.length).setValues([RUN_HEADERS]);
  } else if (JSON.stringify(existingHeaders) !== JSON.stringify(RUN_HEADERS)) {
    return jsonResponse_({ ok: false, error: 'Existing Runs headers do not match' });
  }
  sheet.getRange(RUN_HEADER_ROW, 2).setNote(
    'Grey = individual two-minute checks; orange = completed 30-minute blocks; ' +
    'purple = completed 1-hour blocks; blue = completed 24-hour daily rollups; ' +
    'red = a genuine error with diagnostic details.',
  );

  const targetRow = Math.max(sheet.getLastRow() + 1, RUN_HEADER_ROW + 1);
  if (targetRow > sheet.getMaxRows()) sheet.insertRowAfter(sheet.getMaxRows());
  const target = sheet.getRange(targetRow, 1, 1, RUN_HEADERS.length);
  target.setValues([[
    runTime,
    status,
    leadCount,
    newLeadCount,
    durationSeconds,
    details,
  ]]);
  target.getCell(1, 1).setNumberFormat('d mmm yyyy, h:mm:ss am/pm');
  target.getCell(1, 5).setNumberFormat('0.0 "s"');

  compactRunHistory_(sheet, runTime);
  updateRunSummary_(sheet, runTime, status, newLeadCount, details, run.source, run.schedule);

  let calendarResult = { enabled: false, scheduledCount: 0, errorCount: 0 };
  try {
    calendarResult = processPendingLeadCalls_(
      spreadsheet,
      spreadsheet.getSheetByName(PORTAL_LEADS_SHEET),
      null,
      runTime,
    );
  } catch (error) {
    calendarResult = { enabled: true, scheduledCount: 0, errorCount: 1 };
  }

  return jsonResponse_({
    ok: true,
    logged: true,
    calendarEnabled: calendarResult.enabled,
    calendarScheduledCount: calendarResult.scheduledCount,
    calendarErrorCount: calendarResult.errorCount,
  });
}

function updateRunSummary_(sheet, runTime, status, newLeadCount, details, source, schedule) {
  const safeSource = safeCell_(source || 'Meta Lead API').slice(0, 80);
  const safeSchedule = safeCell_(schedule || 'Event-driven + 2-minute health').slice(0, 80);
  const displayedNewLeads = newLeadCount === '' ? 0 : newLeadCount;

  sheet.getRange('A2').setValue('Last run');
  sheet.getRange('B2').setValue(runTime).setNumberFormat('d mmm yyyy, h:mm:ss am/pm');
  sheet.getRange('D2').setValue('Status');
  sheet.getRange('E2').setValue(status)
    .setBackground(status === 'ERROR' ? RUN_COLORS.error : RUN_COLORS.day)
    .setFontColor(status === 'ERROR' ? '#9c0006' : '#000000')
    .setFontWeight('bold');
  sheet.getRange('F2').setValue('New leads: ' + displayedNewLeads);

  sheet.getRange('A3').setValue('Last successful');
  sheet.getRange('D3').setValue('Last error');
  if (status === 'OK') {
    sheet.getRange('B3').setValue(runTime).setNumberFormat('d mmm yyyy, h:mm:ss am/pm');
    sheet.getRange('E3').setValue('None').clearNote();
  } else {
    sheet.getRange('E3').setValue(runTime)
      .setNumberFormat('d mmm yyyy, h:mm:ss am/pm')
      .setNote(String(details || '').slice(0, 300));
  }

  sheet.getRange('A4').setValue('Schedule');
  sheet.getRange('B4').setValue(safeSchedule);
  sheet.getRange('C4').setValue('Source');
  sheet.getRange('D4').setValue(safeSource);
  sheet.getRange('E4').setValue('Runs logged');
  sheet.getRange('F4').setValue(Math.max(0, sheet.getLastRow() - RUN_HEADER_ROW));
}

function compactRunHistory_(sheet, now) {
  const lastRow = sheet.getLastRow();
  if (lastRow < RUN_DATA_ROW) return;

  const rowCount = lastRow - RUN_DATA_ROW + 1;
  const range = sheet.getRange(RUN_DATA_ROW, 1, rowCount, RUN_HEADERS.length);
  const values = range.getValues();
  const notes = range.getNotes();
  const records = [];

  values.forEach(function (row, index) {
    const time = row[0] instanceof Date ? row[0] : new Date(row[0]);
    if (isNaN(time.getTime()) || !row[1]) return;
    const status = String(row[1]).toUpperCase();
    const saved = parseRunNote_(notes[index][5]);
    records.push({
      time: time,
      status: status,
      leadCount: numericOrBlank_(row[2]),
      newLeadCount: numericOrZero_(row[3]),
      durationTotal: saved ? numericOrZero_(saved.durationTotal) : numericOrZero_(row[4]),
      checkCount: saved ? Math.max(1, numericOrZero_(saved.checkCount)) : 1,
      details: saved && saved.details ? saved.details : detailCounts_(String(row[5] || '')),
      kind: status === 'ERROR' ? 'error' : (saved && saved.kind ? saved.kind : 'raw'),
      firstAt: saved && validDate_(saved.firstAt) ? new Date(saved.firstAt) : time,
      lastAt: saved && validDate_(saved.lastAt) ? new Date(saved.lastAt) : time,
    });
  });

  const halfHourBoundary = halfHourStart_(now);
  const rawToRollUp = records.filter(function (record) {
    return record.status === 'OK' && record.kind === 'raw' && record.time < halfHourBoundary;
  });
  const afterHalfHour = records.filter(function (record) {
    return !(record.status === 'OK' && record.kind === 'raw' && record.time < halfHourBoundary);
  });
  groupRecords_(rawToRollUp, function (record) {
    return halfHourStart_(record.time).toISOString();
  }, 'halfHour').forEach(function (record) { afterHalfHour.push(record); });

  const hourBoundary = hourStart_(now);
  const halfHoursToRollUp = afterHalfHour.filter(function (record) {
    return record.status === 'OK' && record.kind === 'halfHour' && record.time < hourBoundary;
  });
  const afterHour = afterHalfHour.filter(function (record) {
    return !(record.status === 'OK' && record.kind === 'halfHour' && record.time < hourBoundary);
  });
  groupRecords_(halfHoursToRollUp, function (record) {
    return hourStart_(record.time).toISOString();
  }, 'hour').forEach(function (record) { afterHour.push(record); });

  const timeZone = sheet.getParent().getSpreadsheetTimeZone();
  const todayKey = dayKey_(now, timeZone);
  const hoursToRollUp = afterHour.filter(function (record) {
    return record.status === 'OK' && record.kind === 'hour' &&
      dayKey_(record.time, timeZone) < todayKey;
  });
  const finalRecords = afterHour.filter(function (record) {
    return !(record.status === 'OK' && record.kind === 'hour' &&
      dayKey_(record.time, timeZone) < todayKey);
  });
  groupRecords_(hoursToRollUp, function (record) {
    return dayKey_(record.time, timeZone);
  }, 'day').forEach(function (record) { finalRecords.push(record); });

  const cutoff = new Date(now.getTime() - RUN_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const retained = finalRecords
    .filter(function (record) { return record.time >= cutoff; })
    .sort(function (left, right) { return left.time - right.time; });

  range.clearContent();
  range.clearNote();
  range.setBackground(null);
  range.setFontColor(null);
  range.setFontWeight('normal');
  range.setNumberFormat('General');
  if (!retained.length) return;

  const output = retained.map(function (record) {
    return [
      record.time,
      record.status,
      record.leadCount,
      record.newLeadCount,
      record.checkCount ? record.durationTotal / record.checkCount : 0,
      displayRunDetails_(record, timeZone),
    ];
  });
  const outputRange = sheet.getRange(RUN_DATA_ROW, 1, output.length, RUN_HEADERS.length);
  outputRange.setValues(output);
  outputRange.setBackgrounds(retained.map(function (record) {
    return Array(RUN_HEADERS.length).fill(RUN_COLORS[record.kind] || RUN_COLORS.raw);
  }));
  outputRange.setFontColors(retained.map(function (record) {
    return Array(RUN_HEADERS.length).fill(record.kind === 'error' ? '#9c0006' : '#000000');
  }));
  outputRange.setFontWeights(retained.map(function (record) {
    return Array(RUN_HEADERS.length).fill(record.kind === 'raw' ? 'normal' : 'bold');
  }));
  outputRange.setNumberFormats(retained.map(function () {
    return ['d mmm yyyy, h:mm:ss am/pm', '@', '0', '0', '0.0 "s"', '@'];
  }));
  outputRange.setNotes(retained.map(function (record) {
    return ['', '', '', '', '', RUN_NOTE_PREFIX + JSON.stringify({
      kind: record.kind,
      checkCount: record.checkCount,
      durationTotal: record.durationTotal,
      details: record.details,
      firstAt: record.firstAt.toISOString(),
      lastAt: record.lastAt.toISOString(),
    })];
  }));
}

function groupRecords_(records, keyFor, kind) {
  const groups = {};
  records.forEach(function (record) {
    const key = keyFor(record);
    if (!groups[key]) {
      groups[key] = {
        time: kind === 'day'
          ? record.time
          : (kind === 'hour' ? hourStart_(record.time) : halfHourStart_(record.time)),
        status: 'OK',
        leadCount: record.leadCount,
        newLeadCount: 0,
        durationTotal: 0,
        checkCount: 0,
        details: {},
        kind: kind,
        firstAt: record.firstAt,
        lastAt: record.lastAt,
      };
    }
    const group = groups[key];
    if (record.time > group.time || group.leadCount === '') group.leadCount = record.leadCount;
    group.newLeadCount += numericOrZero_(record.newLeadCount);
    group.durationTotal += numericOrZero_(record.durationTotal);
    group.checkCount += Math.max(1, numericOrZero_(record.checkCount));
    if (record.firstAt < group.firstAt) group.firstAt = record.firstAt;
    if (record.lastAt > group.lastAt) group.lastAt = record.lastAt;
    Object.keys(record.details || {}).forEach(function (detail) {
      group.details[detail] = (group.details[detail] || 0) + record.details[detail];
    });
  });
  return Object.keys(groups).sort().map(function (key) { return groups[key]; });
}

function displayRunDetails_(record, timeZone) {
  if (record.kind === 'error' || record.kind === 'raw') {
    return Object.keys(record.details || {})[0] || '';
  }
  const label = record.kind === 'day'
    ? 'Daily rollup (' + Utilities.formatDate(record.time, timeZone, 'd MMM') + ')'
    : (record.kind === 'hour'
      ? '1-hour block (' + formatTime_(record.time, timeZone) + RUN_RANGE_SEPARATOR +
        formatTime_(new Date(record.time.getTime() + 59 * 60 * 1000), timeZone) + ')'
      : '30-minute block (' + formatTime_(record.time, timeZone) + RUN_RANGE_SEPARATOR +
        formatTime_(new Date(record.time.getTime() + 29 * 60 * 1000), timeZone) + ')');
  const detailText = Object.keys(record.details || {}).sort().slice(0, 3).map(function (detail) {
    return detail + ' x' + record.details[detail];
  }).join(', ');
  const checkLabel = record.checkCount === 1 ? ' check' : ' checks';
  return label + ': ' + record.checkCount + checkLabel + (detailText ? '; ' + detailText : '');
}

function parseRunNote_(note) {
  const text = String(note || '');
  if (text.indexOf(RUN_NOTE_PREFIX) !== 0) return null;
  try {
    return JSON.parse(text.slice(RUN_NOTE_PREFIX.length));
  } catch (error) {
    return null;
  }
}

function detailCounts_(detail) {
  const result = {};
  result[detail || 'completed'] = 1;
  return result;
}

function numericOrZero_(value) {
  const number = Number(value);
  return isFinite(number) ? number : 0;
}

function numericOrBlank_(value) {
  if (value === '' || value === null || value === undefined) return '';
  const number = Number(value);
  return isFinite(number) ? number : '';
}

function validDate_(value) {
  return !isNaN(new Date(String(value || '')).getTime());
}

function formatTime_(date, timeZone) {
  return Utilities.formatDate(date, timeZone, 'h:mm a').toLowerCase();
}

function halfHourStart_(date) {
  const result = new Date(date.getTime());
  result.setMinutes(result.getMinutes() < 30 ? 0 : 30, 0, 0);
  return result;
}

function hourStart_(date) {
  const result = new Date(date.getTime());
  result.setMinutes(0, 0, 0);
  return result;
}

function dayKey_(date, timeZone) {
  return Utilities.formatDate(date, timeZone, 'yyyy-MM-dd');
}

function safeCell_(value) {
  const text = String(value == null ? '' : value).slice(0, 10000);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
