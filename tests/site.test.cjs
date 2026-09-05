const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const configSource = script.slice(0, script.indexOf('/* 開價、租金與投報率'));
const config = vm.runInNewContext(configSource + '\nCONFIG;');
const extraHeaders = ['LINE ID', '個資同意', '希望看屋時間', '通知狀態', '預約識別碼'];
function clockAt(iso = '2026-09-05T12:00:00+08:00') {
  return class extends Date { constructor(...args) { super(...(args.length ? args : [iso])); } static now() { return Date.parse(iso); } };
}
const rulesAt = iso => vm.runInNewContext(configSource + '\nBookingRules;', { Date: clockAt(iso) });

test('page script parses and anchor IDs are unique', () => {
  assert.doesNotThrow(() => new vm.Script(script));
  assert.match(html, /<\/html>\s*$/);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(id), id);
  const sections = [...html.matchAll(/<section[^>]*id="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(sections, ['top', 'feature', 'interior', 'location', 'specs', 'amenity', 'invest', 'booking']);
});

test('public area ratio and rental calculation match the displayed areas and asking price', () => {
  assert.equal((9.36 + 0.93 + 5.96).toFixed(2), '16.25');
  assert.equal((5.96 / 16.25 * 100).toFixed(2), '36.68');
  assert.match(html, /36\.68%（依本戶坪數計算）/);
  assert.match(html, /170 元／坪／月/);
  assert.match(html, /年繳享 95 折/);
  assert.equal(config.MARKET_RENT, 36000);
  assert.equal(config.PRICE_WAN, 1980);
  assert.equal((config.MARKET_RENT * 12 / (config.PRICE_WAN * 10000) * 100).toFixed(2), '2.18');
});

test('page and sharing metadata show market rent only, not historical rent claims', () => {
  assert.match(html, /目前月租行情參考/);
  assert.match(html, /行情毛投報試算/);
  assert.doesNotMatch(html, /過往實際月租|實際出租紀錄|HISTORICAL_RENT|historicalRentVal|未調漲租金/);
  assert.match(html, /月租 36,000 元為目前租金行情參考/);
  assert.match(html, /meta property="og:description"[^>]*月租行情參考36,000元/);
});

test('every configured media file exists; actual photos and concept plan stay separate', () => {
  const files = Object.values(config.MEDIA).flat().filter(Boolean);
  for (const file of files) assert.ok(fs.existsSync(path.join(root, 'media', file)), file);
  assert.equal(config.MEDIA.interior.filter(file => /\.(jpg|png)$/i.test(file)).length, 10);
  assert.ok(!config.MEDIA.interior.includes(config.MEDIA.conceptPlan));
  for (const entries of Object.values(config.ROOM_MEDIA)) {
    for (const entry of entries) assert.ok(config.MEDIA.interior.includes(entry.file), entry.file);
  }
  assert.match(html, /og:image" content="https:\/\/hebiguan\.vercel\.app\/media\/interior-living-window\.jpg/);
});

test('all repeated asking prices render from the same config', () => {
  const nodes = Object.fromEntries(['marketRentVal', 'annualVal', 'yieldVal'].map(id => [id, {}]));
  const prices = [{}, {}, {}];
  const tablePrice = {};
  const source = script.slice(script.indexOf('/* 開價、租金與投報率'), script.indexOf('/* 分區圖片'));
  vm.runInNewContext(source, {
    CONFIG: config,
    document: {
      getElementById: id => nodes[id],
      querySelectorAll: selector => selector === '[data-price-wan]' ? prices : [tablePrice],
    },
  });
  for (const node of prices) assert.match(node.innerHTML, /^1,980/);
  assert.equal(tablePrice.textContent, '1,980 萬');
  assert.match(nodes.marketRentVal.innerHTML, /^36,000/);
  assert.match(nodes.annualVal.innerHTML, /^43\.2/);
  assert.match(nodes.yieldVal.innerHTML, /^2\.18/);
});

test('form requires real name, phone and consent; LINE ID is optional and buyer email is removed', () => {
  assert.match(html, /label for="fName">姓名/);
  assert.match(html, /placeholder="請填寫姓名"/);
  for (const id of ['fLineId']) {
    const input = html.match(new RegExp('<input[^>]*id="' + id + '"[^>]*>'))[0];
    assert.doesNotMatch(input, /\brequired\b/);
    assert.match(html, new RegExp('label for="' + id + '">[^<]+<small>選填</small>'));
  }
  for (const id of ['fName', 'fPhone', 'fAgree']) {
    const input = html.match(new RegExp('<input[^>]*id="' + id + '"[^>]*>'))[0];
    assert.match(input, /\brequired\b/);
  }
  assert.doesNotMatch(html, /方便收信時再填寫/);
  assert.doesNotMatch(html, /id="fEmail"|name="email"|form\.email|電子郵件|電子信箱/);
  assert.match(html, /id="fLineId"[^>]*placeholder="請填 LINE ID"/);
  assert.doesNotMatch(html, /非顯示名稱|每個時段接待一組，留時間好好認識這個家/);
  assert.equal(config.SLOT_CAPACITY, 1);
  assert.match(html, /一只皮箱，即可入住。/);
  const title = html.match(/<select[^>]*id="fTitle"[\s\S]*?<\/select>/)[0];
  assert.doesNotMatch(title, /\brequired\b|\bselected\b/);
  assert.match(title, /<option value="">請選擇<\/option>/);
  assert.match(title, /<option value="先生">先生<\/option><option value="小姐">小姐<\/option>/);
  assert.match(html, /label for="fTitle">稱謂<small>選填<\/small>/);
  assert.doesNotMatch(html, /form\.title\.value/); // Avoid the native form title attribute.
});

test('transaction references are always visible while full building details start collapsed', () => {
  const invest = html.match(/<section[^>]*id="invest"[\s\S]*?<\/section>/)[0];
  assert.match(invest, /class="market-reference"/);
  assert.match(invest, /成交案例參考/);
  assert.match(invest, /class="comp-table"/);
  assert.doesNotMatch(invest, /<details\b|<summary\b/);
  const specs = html.match(/<section[^>]*id="specs"[\s\S]*?<\/section>/)[0];
  const detailsTag = specs.match(/<details\b[^>]*>/)[0];
  assert.match(detailsTag, /class="building-details reveal"/);
  assert.doesNotMatch(detailsTag, /\bopen\b/);
  const visibleFacts = specs.slice(0, specs.indexOf('<details'));
  assert.match(visibleFacts, /class="unit-facts reveal"/);
  assert.match(visibleFacts, /16\.25/);
  assert.match(visibleFacts, /170 元／坪／月/);
  assert.match(visibleFacts, /年繳享 95 折/);
  const expandedFacts = specs.slice(specs.indexOf('<details'));
  for (const text of ['9.36', '0.93', '5.96', '36.68%', '建築團隊']) assert.ok(expandedFacts.includes(text), text);
});

test('static facility labels have no hover while disclosure controls share hover and keyboard cues', () => {
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.doesNotMatch(css, /\.tag-wall[^{}]*:hover/);
  const tagStyle = css.match(/\.tag-wall span\{([^}]+)\}/)[1];
  assert.doesNotMatch(tagStyle, /transition|cursor:\s*pointer/);
  const amenity = html.match(/<section[^>]*id="amenity"[\s\S]*?<\/section>/)[0];
  for (const [, tags] of amenity.matchAll(/<div class="tag-wall">([\s\S]*?)<\/div>/g)) {
    assert.doesNotMatch(tags, /<(a|button)\b|tabindex=|onclick=/);
  }
  assert.match(css, /@media\(hover:hover\)\{\s*\.room-details summary:hover,\.building-details summary:hover\{[^}]*background:[^}]*box-shadow:/);
  assert.match(css, /\.room-details summary:focus-visible,\.building-details summary:focus-visible\{outline:2px solid/);
  assert.match(css, /\.room-details summary:active,\.building-details summary:active/);
  for (const className of ['room-details', 'building-details']) {
    assert.match(css, new RegExp('\\.' + className + '\\[open\\] summary::after\\{content:"－"'));
  }
});

function submissionHarness(response = { ok: true }, capabilities = { bookingSchemaVersion: 3 }) {
  let handler;
  let resetCount = 0;
  const requests = [];
  const classList = { add() {} };
  const nodes = {
    bookForm: { addEventListener: (event, fn) => { handler = fn; } },
    formMsg: { classList }, submitBtn: { disabled: false }, fAgree: { checked: true },
    fDate: { dispatchEvent() {} },
    bookingReceipt: { hidden: true, focus() {}, scrollIntoView() {} }, receiptDetails: {}, scheduleStatus: {},
  };
  const slot = '14:00 – 15:00';
  const form = {
    name: { value: ' 王測試 ' }, phone: { value: ' 0900000000 ', removeAttribute() {}, setAttribute() {}, focus() {} },
    title: { value: '' },
    lineId: { value: '' }, company: { value: '' },
    preferredTime: { value: '' },
    date: { value: '2026/9/6（日）' },
    slot: { value: slot, selectedOptions: [{ value: slot, disabled: false }] },
    reset() { resetCount++; },
    querySelectorAll() { return [this.name, this.title, this.phone, this.lineId, this.date, this.slot, this.preferredTime]; },
  };
  form.elements = { namedItem: name => form[name] };
  form.querySelectorAll().forEach(input => { input.dataset = {}; });
  const source = script.slice(script.indexOf('/* 表單送出 →'), script.indexOf('/* 進場動畫：'));
  const rules = rulesAt();
  const context = vm.createContext({
    CONFIG: config,
    document: { getElementById: id => nodes[id] },
    Booking: { refresh: async () => {}, updateSchedule() {} },
    BookingRules: rules,
    crypto: { randomUUID: () => 'test-request-00000001' },
    Event: class {},
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (options.method === 'GET') {
        return { json: async () => {
          if (capabilities instanceof Error) throw capabilities;
          return capabilities;
        } };
      }
      const result = typeof response === 'function' ? response() : response;
      if (result instanceof Error) throw result;
      return { json: async () => result };
    },
  });
  vm.runInContext('let pendingBooking = null;\n' + source, context);
  return { nodes, form, requests, rules, context, submit: () => handler({ preventDefault() {}, target: form }), resets: () => resetCount };
}

test('LINE ID can be empty; submission includes consent and no buyer email', async () => {
  const h = submissionHarness();
  await h.submit();
  assert.equal(h.requests.length, 2);
  assert.match(h.requests[0].url, /\?action=capabilities$/);
  assert.equal(h.requests[1].options.method, 'POST');
  assert.equal(h.requests[1].options.headers, undefined); // Keep the existing simple CORS request.
  assert.deepEqual(JSON.parse(h.requests[1].options.body), {
    name: '王測試', title: '', phone: '0900000000', lineId: '', privacyConsent: true, date: '2026/9/6（日）', slot: '14:00 – 15:00', preferredTime: '', requestId: 'test-request-00000001',
  });
  assert.equal(h.nodes.bookingReceipt.hidden, false);
  assert.match(h.nodes.receiptDetails.textContent, /2026\/9\/6（日）\n14:00 – 15:00/);
  assert.equal(h.resets(), 1);
  assert.equal(h.nodes.submitBtn.disabled, false);
});

test('provided LINE ID is trimmed and sent without an email property', async () => {
  const h = submissionHarness();
  h.form.lineId.value = ' buyer_line ';
  await h.submit();
  const payload = JSON.parse(h.requests[1].options.body);
  assert.equal(payload.lineId, 'buyer_line');
  assert.equal(Object.hasOwn(payload, 'email'), false);
});

test('optional titles use existing backend columns and owner notification without collecting email', async () => {
  for (const title of ['', '先生', '小姐']) {
    const frontend = submissionHarness();
    frontend.form.title.value = title;
    await frontend.submit();
    const payload = JSON.parse(frontend.requests.find(request => request.options.method === 'POST').options.body);
    assert.equal(payload.title, title);
    assert.equal(Object.hasOwn(payload, 'email'), false);
    const backend = backendHarness();
    assert.deepEqual(backend.post(payload), { ok: true });
    assert.equal(backend.rows[1][2], title);
    assert.equal(backend.rows[1][4], '');
    assert.equal(backend.rows[1][5], payload.date);
    assert.equal(backend.rows[1][6], payload.slot);
    assert.ok(backend.messages[0].subject.includes('王測試' + title));
    assert.ok(backend.messages[0].body.includes('姓名：王測試 ' + title));
    assert.deepEqual(backend.post(payload), { ok: true });
    assert.equal(backend.rows.length, 2);
    assert.equal(backend.messages.length, 1);
  }
});

test('unexpected optional title is omitted and a missing title never blocks a reservation', async () => {
  const h = submissionHarness();
  h.form.title.value = 'unexpected';
  await h.submit();
  const payload = JSON.parse(h.requests.find(request => request.options.method === 'POST').options.body);
  assert.equal(payload.title, '');
  assert.equal(h.nodes.bookingReceipt.hidden, false);
});

test('old or unreadable backend capabilities block POST to prevent silently losing LINE ID', async () => {
  for (const capabilities of [{}, null, { bookingSchemaVersion: 1 }, { bookingSchemaVersion: 2 }, new Error('not JSON')]) {
    const h = submissionHarness({ ok: true }, capabilities);
    h.form.lineId.value = 'buyer_line';
    await h.submit();
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].options.method, 'GET');
    assert.match(h.nodes.formMsg.textContent, /更新中，資料尚未送出/);
    assert.equal(h.resets(), 0);
    assert.equal(h.nodes.submitBtn.disabled, false);
  }
});

for (const [label, change, message] of [
  ['missing name', h => { h.form.name.value = ' '; }, /姓名與聯絡電話/],
  ['missing phone', h => { h.form.phone.value = ''; }, /姓名與聯絡電話/],
  ['invalid phone', h => { h.form.phone.value = 'abc'; }, /有效的手機或市話/],
  ['missing consent', h => { h.nodes.fAgree.checked = false; }, /個資告知/],
  ['full selected slot', h => { h.form.slot.selectedOptions[0].disabled = true; }, /無可預約時段/],
  ['unlisted date', h => { h.form.date.value = '2020/1/1（三）'; }, /不在開放場次/],
]) {
  test('submission blocks ' + label, async () => {
    const h = submissionHarness();
    change(h);
    await h.submit();
    assert.equal(h.requests.length, 0);
    assert.match(h.nodes.formMsg.textContent, message);
  });
}

test('capacity rejection and network errors retain the entered contact details', async () => {
  for (const response of [{ ok: false, reason: 'full' }, new Error('offline')]) {
    const h = submissionHarness(response);
    await h.submit();
    assert.equal(h.resets(), 0);
    assert.equal(h.nodes.submitBtn.disabled, false);
    assert.match(h.nodes.formMsg.textContent, /額滿|尚未確認送出結果/);
  }
});

const legacyHeaders = ['時間', '姓名', '稱謂', '電話', 'Email', '看屋日期', '時段'];
const validBooking = { name: '王測試', title: '', phone: '0900000000', lineId: '', privacyConsent: true, date: '2026/9/6（日）', slot: '14:00 – 15:00' };

function backendHarness(initialRows = [legacyHeaders], options = {}) {
  const rows = initialRows ? initialRows.map(row => [...row]) : [];
  let exists = initialRows !== null;
  const messages = [];
  let sheetAccesses = 0;
  let mailAttempts = 0, locked = false;
  const sheet = {
    getLastRow: () => rows.length,
    getLastColumn: () => Math.max(0, ...rows.map(row => row.length)),
    appendRow: row => { if (options.writeFails) throw Error('mock write failure'); rows.push(Array.from(row)); },
    getRange: (startRow, startCol, rowCount = 1, colCount = 1) => {
      const range = {
        getValues: () => Array.from({ length: rowCount }, (_, r) =>
          Array.from({ length: colCount }, (_, c) => rows[startRow + r - 1]?.[startCol + c - 1] ?? '')),
        setValue: value => {
          if (options.statusFails && /已寄送|寄送失敗/.test(value)) throw Error('mock status failure');
          rows[startRow - 1] ??= [];
          rows[startRow - 1][startCol - 1] = value;
          return range;
        },
        setFontWeight: () => range,
      };
      return range;
    },
  };
  const context = vm.createContext({
    SpreadsheetApp: {
      getActiveSpreadsheet: () => {
        sheetAccesses++;
        return { getSheetByName: () => exists ? sheet : null, insertSheet: () => { exists = true; return sheet; }, getUrl: () => 'mock-sheet' };
      },
      flush() { if (options.flushFails) throw Error('mock flush failure'); },
    },
    LockService: { getScriptLock: () => ({ waitLock() { locked = true; }, releaseLock() { locked = false; } }) },
    Utilities: { formatDate: () => 'test timestamp' },
    MailApp: { sendEmail: message => { assert.equal(locked, false); mailAttempts++; if (options.mailFails) throw Error('mock mail failure'); messages.push(message); } },
    Date: clockAt(options.now), console: { error() {} },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ text, setMimeType() { return this; } }) },
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'apps-script/Code.gs'), 'utf8'), context);
  return {
    rows, messages, sheetAccesses: () => sheetAccesses, mailAttempts: () => mailAttempts,
    settings: JSON.parse(vm.runInContext('JSON.stringify({dates:BOOKING_DATES,capacity:SLOT_CAPACITY,version:BOOKING_SCHEMA_VERSION})', context)),
    normalizePhone: value => context.normalizePhone_(value),
    slotStart: (date, slot) => context.slotStart_(date, slot),
    post: payload => JSON.parse(context.doPost({ postData: { contents: JSON.stringify(payload) } }).text),
    get: action => JSON.parse(context.doGet({ parameter: { action } }).text),
  };
}

test('Apps Script migrates legacy headers, permits blank LINE ID and rejects a second group', () => {
  const h = backendHarness();
  assert.deepEqual(h.post(validBooking), { ok: true });
  assert.deepEqual(h.rows[0], [...legacyHeaders, ...extraHeaders]);
  assert.deepEqual(h.rows[1], ['test timestamp', '王測試', '', "'0900000000", '', '2026/9/6（日）', '14:00 – 15:00', '', '已同意', '', '已寄送', '']);
  assert.equal(h.messages.length, 1);
  assert.match(h.messages[0].subject, /王測試/);
  assert.match(h.messages[0].body, /LINE ID：未填寫/);
  assert.doesNotMatch(h.messages[0].body, /Email：/);
  assert.deepEqual(h.post(validBooking), { ok: false, reason: 'full' });
  assert.equal(h.rows.length, 2);
  assert.equal(h.messages.length, 1);
});

test('backend ignores buyer email from stale clients and still notifies only the owner', () => {
  const h = backendHarness();
  assert.deepEqual(h.post({ ...validBooking, email: 'buyer@example.test' }), { ok: true });
  assert.equal(h.rows[1][4], '');
  assert.equal(h.messages.length, 1);
  assert.ok(h.messages[0].to);
  assert.notEqual(h.messages[0].to, 'buyer@example.test');
  assert.doesNotMatch(h.messages[0].body, /buyer@example\.test|Email：/);
});

test('backend saves LINE ID as literal text and includes it in owner notification', () => {
  const h = backendHarness();
  assert.deepEqual(h.post({ ...validBooking, lineId: ' 001234 ' }), { ok: true });
  assert.equal(h.rows[1][7], "'001234");
  assert.match(h.messages[0].body, /LINE ID：001234/);
  assert.match(h.messages[0].body, /個資同意：已同意/);
});

test('backend cannot be bypassed without required name, phone, date or slot', () => {
  for (const field of ['name', 'phone', 'date', 'slot']) {
    const h = backendHarness();
    assert.deepEqual(h.post({ ...validBooking, [field]: ' ' }), { ok: false, reason: 'required_fields' });
    assert.deepEqual(h.rows, [legacyHeaders]);
    assert.equal(h.sheetAccesses(), 0);
    assert.equal(h.messages.length, 0);
  }
});

test('backend requires explicit consent before writing or notifying', () => {
  for (const privacyConsent of [undefined, false, '', 'false', 0]) {
    const h = backendHarness();
    assert.deepEqual(h.post({ ...validBooking, privacyConsent }), { ok: false, reason: 'consent_required' });
    assert.deepEqual(h.rows, [legacyHeaders]);
    assert.equal(h.sheetAccesses(), 0);
    assert.equal(h.messages.length, 0);
  }
});

test('migration preserves existing bookings, custom columns and capacity counts', () => {
  const oldRow = ['old time', '舊預約', '先生', '0900000000', 'past@example.test', '2026/9/6（日）', '14:00 – 15:00', '保留備註'];
  const h = backendHarness([[...legacyHeaders, '備註'], oldRow]);
  assert.deepEqual(h.post({ ...validBooking, slot: '15:00 – 16:00', lineId: 'buyer_line' }), { ok: true });
  assert.deepEqual(h.rows[0], [...legacyHeaders, '備註', ...extraHeaders]);
  assert.deepEqual(h.rows[1], oldRow);
  assert.equal(h.rows[2][7], '');
  assert.equal(h.rows[2][8], "'buyer_line");
  assert.equal(h.rows[2][9], '已同意');
  assert.deepEqual(h.get('availability'), { '2026/9/6（日）|14:00 – 15:00': 1, '2026/9/6（日）|15:00 – 16:00': 1 });
  assert.deepEqual(h.post(validBooking), { ok: false, reason: 'full' });
  assert.deepEqual(h.post({ ...validBooking, slot: '16:00 – 17:00' }), { ok: true });
  assert.equal(h.rows[0].length, 13); // Repeated requests never append duplicate headers.
});

test('a new sheet receives the complete schema and capabilities checks do not mutate a sheet', () => {
  const h = backendHarness(null);
  assert.deepEqual(h.get('capabilities'), { bookingSchemaVersion: 3 });
  assert.equal(h.sheetAccesses(), 0);
  assert.deepEqual(h.rows, []);
  assert.deepEqual(h.post(validBooking), { ok: true });
  assert.deepEqual(h.rows[0], [...legacyHeaders, ...extraHeaders]);
});

test('frontend and backend whitelist the same dates, slots, capacity and schema version', () => {
  const h = backendHarness(), rules = rulesAt();
  assert.deepEqual(h.settings.dates, JSON.parse(JSON.stringify(config.DATES.filter(d => !d.flexible))));
  assert.equal(h.settings.capacity, config.SLOT_CAPACITY);
  assert.equal(h.settings.version, config.BOOKING_SCHEMA_VERSION);
  for (const date of config.DATES) for (const slot of rules.allSlots(date)) assert.equal(h.slotStart(date.label, slot), rules.start(date, slot));
});

test('legacy form-encoded true value is accepted only when consent is explicit', () => {
  const h = backendHarness();
  assert.deepEqual(h.post({ ...validBooking, privacyConsent: 'true' }), { ok: true });
});

test('frontend and backend normalize Taiwanese mobile, landline and international phones identically', () => {
  const h = backendHarness(), rules = rulesAt();
  const cases = [
    ['0912-345-678', '0912345678'], ['０９１２ ３４５ ６７８', '0912345678'],
    ['(02) 2345-6789', '0223456789'], ['03-1234567', '031234567'],
    ['+886 912 345 678', '0912345678'], ['+886 (0)2 2345 6789', '0223456789'],
    ['+1 (212) 555-0123', '+12125550123'],
    ['abc', ''], ['0912abc345678', ''], ['123', ''], ['++886912345678', ''],
    ['0912/345/678', ''], ['0912345678901234', ''],
  ];
  for (const [input, expected] of cases) {
    assert.equal(rules.normalizePhone(input), expected, input);
    assert.equal(h.normalizePhone(input), expected, input);
  }
  assert.deepEqual(h.post({ ...validBooking, phone: 'abc' }), { ok: false, reason: 'invalid_phone' });
  assert.equal(h.sheetAccesses(), 0);
});

test('Taipei slot cutoff is exact, independent of device timezone; passed days disappear', () => {
  const rules = rulesAt(), d = config.DATES[0], h = backendHarness();
  assert.equal(h.slotStart(d.label, '14:00 – 15:00'), rules.start(d, '14:00 – 15:00'));
  assert.equal(rules.slotsOf(d, Date.parse('2026-09-06T05:59:59Z')).length, 3);
  assert.deepEqual(Array.from(rules.slotsOf(d, Date.parse('2026-09-06T06:00:00Z'))), ['15:00 – 16:00', '16:00 – 17:00']);
  assert.equal(rules.slotsOf(d, Date.parse('2026-09-06T08:00:00Z')).length, 0);
  assert.equal(rules.slotsOf(d, Date.parse('2026-09-07T00:00:00+08:00')).length, 0);
  const future = config.DATES.filter(d => rules.slotsOf(d, Date.parse('2026-09-13T00:00:00+08:00')).length);
  assert.deepEqual(Array.from(future, d => d.flexible), [true]);
});

test('server rejects expired or unlisted dates and slots without storing bookings', () => {
  const h = backendHarness(null, { now: '2026-09-06T14:00:00+08:00' });
  assert.deepEqual(h.post(validBooking), { ok: false, reason: 'expired_slot' });
  assert.deepEqual(h.rows, []);
  for (const patch of [{ date: '2020/1/1（三）' }, { slot: '13:00 – 14:00' }, { slot: '14:30 – 15:30' }, { date: '任意其他時間' }]) {
    assert.deepEqual(h.post({ ...validBooking, ...patch }), { ok: false, reason: 'invalid_slot' });
  }
  assert.equal(h.messages.length, 0);
  assert.deepEqual(h.post({ ...validBooking, slot: '15:00 – 16:00' }), { ok: true });
});

test('notification failure and status-write failure never turn a saved reservation into a failure', () => {
  for (const options of [{ mailFails: true }, { statusFails: true }, { mailFails: true, statusFails: true }, { flushFails: true }]) {
    const h = backendHarness(undefined, options);
    const payload = { ...validBooking, requestId: 'test-request-00000001' };
    assert.deepEqual(h.post(payload), { ok: true });
    assert.equal(h.rows.length, 2);
    assert.deepEqual(h.post(payload), { ok: true });
    assert.equal(h.rows.length, 2);
    assert.ok(h.mailAttempts() <= 1);
    if (options.mailFails && !options.statusFails) assert.equal(h.rows[1][10], '寄送失敗，請查看預約');
  }
});

test('actual storage failure is reported and never sends a notification', () => {
  const h = backendHarness(undefined, { writeFails: true });
  assert.deepEqual(h.post(validBooking), { ok: false, reason: 'server_error' });
  assert.equal(h.rows.length, 1);
  assert.equal(h.mailAttempts(), 0);
});

test('retry keys deduplicate, reject changed data, and do not disclose a booking', () => {
  const h = backendHarness();
  const payload = { ...validBooking, requestId: 'test-request-00000001' };
  assert.deepEqual(h.post(payload), { ok: true });
  assert.deepEqual(h.post(payload), { ok: true });
  assert.equal(h.messages.length, 1);
  assert.deepEqual(h.post({ ...payload, phone: '0912345678' }), { ok: false, reason: 'request_conflict' });
  assert.deepEqual(h.post({ ...payload, requestId: 'test-request-00000002' }), { ok: false, reason: 'full' });
  assert.deepEqual(h.post({ ...payload, requestId: '../bad' }), { ok: false, reason: 'invalid_request' });
  const later = backendHarness(h.rows, { now: '2026-09-07T12:00:00+08:00' });
  assert.deepEqual(later.post(payload), { ok: true });
  assert.equal(later.rows.length, 2);
  assert.equal(later.messages.length, 0);
});

test('preferred time is stored as literal text only for flexible reservations', () => {
  const h = backendHarness(), flexible = config.DATES.find(d => d.flexible);
  assert.deepEqual(h.post({ ...validBooking, date: flexible.label, slot: flexible.slots[0], preferredTime: '=週三中午' }), { ok: true });
  assert.equal(h.rows[1][9], "'=週三中午");
  assert.match(h.messages[0].body, /希望看屋時間：=週三中午/);
  assert.deepEqual(h.post({ ...validBooking, preferredTime: '隱藏欄位殘值' }), { ok: true });
  assert.equal(h.rows[2][9], '');
});

test('flexible frontend submits preferred time; normal slots omit hidden leftover text', async () => {
  for (const flexible of [true, false]) {
    const h = submissionHarness();
    h.form.preferredTime.value = ' 平日中午 ';
    if (flexible) {
      const d = config.DATES.find(d => d.flexible);
      h.form.date.value = d.label; h.form.slot.value = d.slots[0]; h.form.slot.selectedOptions[0].value = d.slots[0];
    }
    await h.submit();
    assert.equal(JSON.parse(h.requests[1].options.body).preferredTime, flexible ? '平日中午' : '');
    assert.equal(h.nodes.receiptDetails.textContent.includes('平日中午'), flexible);
  }
});

test('same-page network retry retains its request key and double-clicks do not submit twice', async () => {
  let attempt = 0;
  const h = submissionHarness(() => ++attempt === 1 ? new Error('lost response') : { ok: true });
  await h.submit(); await h.submit();
  const posts = h.requests.filter(r => r.options.method === 'POST');
  assert.equal(JSON.parse(posts[0].options.body).requestId, JSON.parse(posts[1].options.body).requestId);
  const double = submissionHarness();
  await Promise.all([double.submit(), double.submit()]);
  assert.equal(double.requests.filter(r => r.options.method === 'POST').length, 1);
});

test('unknown response freezes auto-selection and retries the same booking even after its start time', async () => {
  let attempt = 0;
  const h = submissionHarness(() => ++attempt === 1 ? new Error('response lost') : { ok: true });
  await h.submit();
  assert.match(h.nodes.submitBtn.textContent, /確認送出結果/);
  for (const input of h.form.querySelectorAll()) assert.equal(input.disabled, true);
  // Real schedule functions must return before touching selectors while a response is unknown.
  const scheduleSource = script.slice(script.indexOf('  function buildSlots(){', script.indexOf('const Booking =')), script.indexOf('  async function refresh(){', script.indexOf('const Booking =')));
  vm.runInContext(scheduleSource + '\nbuildSlots(); updateSchedule();', h.context);
  h.rules.validSelection = () => false; // Clock passes the original slot start before retry.
  await h.submit();
  assert.equal(h.requests.filter(r => r.options.method === 'POST').length, 2);
  assert.deepEqual(JSON.parse(h.requests[1].options.body), JSON.parse(h.requests[3].options.body));
  for (const input of h.form.querySelectorAll()) assert.equal(input.disabled, false);
  assert.equal(h.nodes.bookingReceipt.hidden, false);
});

test('unreadable POST response is uncertain, while an explicit rejection unlocks the form', async () => {
  let attempt = 0;
  const h = submissionHarness(() => ++attempt === 1 ? {} : { ok: false, reason: 'expired_slot' });
  await h.submit();
  assert.equal(h.form.date.disabled, true);
  await h.submit();
  assert.equal(h.form.date.disabled, false);
  assert.match(h.nodes.formMsg.textContent, /已開始/);
  assert.equal(h.resets(), 0);
});

test('new server rejection reasons have actionable messages', async () => {
  for (const [reason, message] of [['invalid_phone', /電話格式/], ['expired_slot', /已開始/], ['invalid_slot', /停止開放/], ['request_conflict', /資料已變更/]]) {
    const h = submissionHarness({ ok: false, reason });
    await h.submit();
    assert.match(h.nodes.formMsg.textContent, message);
    assert.equal(h.resets(), 0);
  }
});

test('all generated responsive sources exist and preserve original image access', () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'media/optimized/manifest.js'), 'utf8'), context);
  for (const [original, data] of Object.entries(context.window.HEBIGUAN_IMAGES)) {
    assert.ok(fs.existsSync(path.join(root, 'media', original)));
    for (const variant of data.variants) {
      assert.ok(fs.existsSync(path.join(root, 'media', variant.file)), variant.file);
      assert.ok(variant.width <= data.width);
    }
  }
  for (const [asset] of html.matchAll(/media\/optimized\/[^"\s,)]+\.(?:webp|js)/g)) assert.ok(fs.existsSync(path.join(root, asset)), asset);
  assert.match(html, /original\.href = src\(f\)/);
  assert.match(html, /id="lbZoomIn"/);
  assert.match(html, /id="mobileNavToggle"[^>]*aria-expanded="false"/);
  assert.match(html, /id="preferredTimeRow" hidden/);
});
