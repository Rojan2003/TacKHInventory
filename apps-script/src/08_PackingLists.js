/**
 * 08_PackingLists.js
 * "Paste packing list": turns the text of one or more Watchtower packing lists into pending deliveries,
 * creating catalogue items for unknown symbols. Dry run first (writes nothing), then apply (mutation).
 *
 * Input format (lines may use "|" or " - " as separators; a title may wrap onto the next line):
 *   Packing List  3770278
 *   30 - g26.1-E | English - Awake!
 *   150 - g26.1-TG | Tagalog - Awake!
 *   2 - ldstd-2-E | Literature Display Stand - Double-sided
 */

var PACKING_SOURCE_NAME = 'Branch Office';

/** Segment names that count as a language (lower-case key -> display name). Anything else belongs to the title. */
var PACKING_LANGUAGE_NAMES = {
  'english': 'English', 'tagalog': 'Tagalog', 'cebuano': 'Cebuano', 'iloko': 'Iloko', 'ilocano': 'Iloko', 'hiligaynon': 'Hiligaynon',
  'bicol': 'Bicol', 'bikol': 'Bicol', 'waray-waray': 'Waray-Waray', 'waray': 'Waray-Waray', 'pangasinan': 'Pangasinan',
  'kapampangan': 'Kapampangan', 'pampango': 'Kapampangan', 'chinese': 'Chinese', 'chinese simplified': 'Chinese (Simplified)',
  'korean': 'Korean', 'japanese': 'Japanese', 'spanish': 'Spanish', 'filipino sign language': 'Filipino Sign Language',
  'american sign language': 'American Sign Language', 'chavacano': 'Chavacano', 'tausug': 'Tausug', 'maranao': 'Maranao'
};

/** Symbol suffix (after the last hyphen) -> language, used when the pasted line names no language. */
var PACKING_SUFFIX_LANGUAGES = {
  E: 'English', TG: 'Tagalog', CV: 'Cebuano', IL: 'Iloko', HV: 'Hiligaynon', BI: 'Bicol', WA: 'Waray-Waray', PN: 'Pangasinan',
  PP: 'Kapampangan', S: 'Spanish', CH: 'Chinese', CHS: 'Chinese (Simplified)', KO: 'Korean', J: 'Japanese', FSL: 'Filipino Sign Language', ASL: 'American Sign Language'
};

var PACKING_HEADER_RE = /^packing\s*list\s*(?:no\.?|number|#)?\s*[:#]?\s*(\d{4,})\s*$/i;
var PACKING_LINE_RE = /^(\d+)\s*-\s*([A-Za-z][A-Za-z0-9.\-]*)\s*(.*)$/;

function packingLanguageFromSymbol(symbol) {
  var parts = String(symbol || '').split('-');
  if (parts.length < 2) return '';
  return PACKING_SUFFIX_LANGUAGES[parts[parts.length - 1].toUpperCase()] || '';
}

/** Category: title keywords first, then exact symbol patterns, else Book. */
function packingCategory(symbol, title) {
  var t = String(title || '').toLowerCase();
  var s = String(symbol || '');
  if (/awake/.test(t)) return 'Awake';
  if (/watchtower/.test(t)) return 'Watchtower';
  if (/meeting workbook|life and ministry/.test(t)) return 'Meeting Workbook';
  if (/bound volume/.test(t)) return 'Bound Volume';
  if (/\btract\b/.test(t)) return 'Tract';
  if (/contact card/.test(t)) return 'Contact card';
  if (/display stand|literature stand|literature cart|display holder/.test(t)) return 'Equipment';
  if (/^(w|wp|wlp)\d/i.test(s)) return 'Watchtower';
  if (/^g\d/i.test(s)) return 'Awake';
  if (/^mwb/i.test(s)) return 'Meeting Workbook';
  if (/^vol\d/i.test(s)) return 'Bound Volume';
  if (/^T-/i.test(s)) return 'Tract';
  if (/^jwcd/i.test(s)) return 'Contact card';
  if (/^ldstd/i.test(s)) return 'Equipment';
  return 'Book';
}

/**
 * Pure parser. Returns { lists: [{ number, lines: [{ quantity, symbol, language, title, raw }], unparsed: [{ text, reason }], notes: [] }],
 * unparsed: [{ text, reason }] } where the top-level unparsed holds lines that appear before any header.
 */
function parsePackingLists(text) {
  var lines = String(text || '').replace(/\r\n?/g, '\n').replace(/\t/g, ' ').split('\n')
    .map(function (l) { return l.replace(/\s+/g, ' ').trim(); }).filter(Boolean);
  var result = { lists: [], unparsed: [] };
  var current = null;
  lines.forEach(function (raw) {
    var h = PACKING_HEADER_RE.exec(raw);
    if (h) { current = { number: h[1], lines: [], unparsed: [], notes: [] }; result.lists.push(current); return; }
    if (!current) { result.unparsed.push({ text: raw, reason: 'Appears before any "Packing List <number>" line.' }); return; }
    var m = PACKING_LINE_RE.exec(raw);
    if (m) {
      var qty = parseInt(m[1], 10);
      if (!(qty > 0)) { current.unparsed.push({ text: raw, reason: 'Quantity must be a positive whole number.' }); return; }
      var symbol = m[2];
      var rest = m[3].replace(/^\s*(\||-)\s*/, '');
      var language = '', title = rest;
      // Only a known language name counts as the language segment; otherwise everything after the symbol is the title.
      var firstSep = rest.search(/\s*(\||\s-\s)\s*/);
      var first = firstSep === -1 ? rest : rest.slice(0, firstSep);
      var known = PACKING_LANGUAGE_NAMES[first.trim().toLowerCase()];
      if (known) {
        language = known;
        title = firstSep === -1 ? '' : rest.slice(firstSep).replace(/^\s*(\||-)\s*/, '');
      }
      if (!language) language = packingLanguageFromSymbol(symbol);
      current.lines.push({ quantity: qty, symbol: symbol, language: language, title: title.trim(), raw: raw });
      return;
    }
    if (!current.lines.length) { current.unparsed.push({ text: raw, reason: 'Not a "<quantity> - <symbol>" line and nothing above it to continue.' }); return; }
    var last = current.lines[current.lines.length - 1];
    last.title = (last.title ? last.title + ' ' : '') + raw; // wrapped title
    last.raw += ' ' + raw;
  });
  // Merge repeated symbols within a list.
  result.lists.forEach(function (list) {
    var bySymbol = {}, merged = [];
    list.lines.forEach(function (l) {
      var key = l.symbol.toLowerCase();
      if (bySymbol[key]) { bySymbol[key].quantity += l.quantity; list.notes.push('Symbol ' + l.symbol + ' appeared more than once; quantities were added together.'); return; }
      bySymbol[key] = l;
      merged.push(l);
    });
    list.lines = merged;
  });
  return result;
}

function packingListNumberIndex() {
  var out = {};
  table(SHEETS.DELIVERIES).read().forEach(function (d) {
    var n = String(d.packingListNumber || '').trim();
    if (n) out[n] = d.reference;
  });
  return out;
}

/** Matches parsed lines against the catalogue and existing deliveries. Reads only. */
function buildPackingListPlan(parsed) {
  var bySku = {};
  table(SHEETS.ITEMS).read().forEach(function (i) { bySku[String(i.sku).trim().toLowerCase()] = i; });
  var existingNumbers = packingListNumberIndex();
  var seenInPaste = {};
  var lists = parsed.lists.map(function (list) {
    var entry = { number: list.number, status: 'ok', problem: '', lines: [], unparsed: list.unparsed.slice(), notes: list.notes.slice() };
    if (existingNumbers[list.number]) { entry.status = 'duplicate'; entry.problem = 'Packing list ' + list.number + ' was already entered as delivery ' + existingNumbers[list.number] + '.'; }
    else if (seenInPaste[list.number]) { entry.status = 'duplicate'; entry.problem = 'Packing list ' + list.number + ' appears more than once in this paste.'; }
    seenInPaste[list.number] = true;
    list.lines.forEach(function (l) {
      var item = bySku[l.symbol.toLowerCase()];
      if (item) {
        entry.lines.push({ quantity: l.quantity, symbol: l.symbol, language: l.language, title: l.title, category: item.category || '', itemId: item.itemId, sku: item.sku, name: item.name, action: toBool(item.active) ? 'exists' : 'existsInactive' });
        if (!toBool(item.active)) entry.unparsed.push({ text: l.raw, reason: 'Item ' + item.sku + ' exists but is inactive. Reactivate it on the Inventory page first.' });
        return;
      }
      if (!l.title) { entry.unparsed.push({ text: l.raw, reason: 'No title found and no catalogue item with symbol ' + l.symbol + '.' }); return; }
      var name = l.language ? l.title + ' (' + l.language + ')' : l.title;
      entry.lines.push({ quantity: l.quantity, symbol: l.symbol, language: l.language, title: l.title, category: packingCategory(l.symbol, l.title), itemId: '', sku: l.symbol, name: name, action: 'create' });
    });
    if (entry.status === 'ok' && !entry.lines.length && !entry.unparsed.length) { entry.status = 'empty'; entry.problem = 'No quantity lines found under this packing list number.'; }
    if (entry.status === 'ok' && entry.unparsed.length) { entry.status = 'problems'; entry.problem = entry.unparsed.length + ' line(s) could not be used.'; }
    if (entry.status === 'ok' && !entry.lines.length) { entry.status = 'empty'; entry.problem = 'No usable lines.'; }
    return entry;
  });
  return { lists: lists, unparsed: parsed.unparsed };
}

/**
 * deliveries.importPackingLists { text, deliveryDate?, apply?, skipProblems? }
 * apply=false: dry run, writes nothing. apply=true: creates missing items and one pending delivery per list,
 * inside the lock with idempotency. Lists that are duplicates/empty/have problems block the whole paste unless
 * skipProblems=true, in which case they are skipped and reported.
 */
function deliveriesImportPackingLists(params, ctx) {
  requirePermission(ctx.user, 'deliveries.manage');
  var text = requireString(params, 'text', 'Packing list text', 200000);
  var deliveryDate = params.deliveryDate ? requireDate(params.deliveryDate, 'Delivery date') : toIsoDate(new Date());
  var apply = toBool(params.apply);
  var skipProblems = toBool(params.skipProblems);

  if (!apply) {
    var dry = buildPackingListPlan(parsePackingLists(text));
    return { apply: false, deliveryDate: deliveryDate, lists: dry.lists, unparsed: dry.unparsed, itemsCreated: [], deliveriesCreated: [] };
  }

  requirePermission(ctx.user, 'items.manage');
  return runMutation('deliveries.importPackingLists', ctx, function () {
    var plan = buildPackingListPlan(parsePackingLists(text)); // rebuilt inside the lock against fresh rows
    var blocked = plan.lists.filter(function (l) { return l.status !== 'ok'; });
    if (!plan.lists.length) fail(ERR.VALIDATION, 'No "Packing List <number>" line was found in the pasted text.');
    if ((blocked.length || plan.unparsed.length) && !skipProblems) {
      var reasons = blocked.map(function (l) { return l.number + ': ' + l.problem; }).concat(plan.unparsed.map(function (u) { return u.reason; }));
      fail(ERR.VALIDATION, 'Fix these before importing, or tick "Skip lists with problems": ' + reasons.join(' '));
    }
    var usable = plan.lists.filter(function (l) { return l.status === 'ok'; });
    if (!usable.length) fail(ERR.VALIDATION, 'Nothing to import: every packing list in the paste has a problem.');

    var now = nowIso();
    var itemsTable = table(SHEETS.ITEMS);
    var created = {};
    var itemsCreated = [];
    usable.forEach(function (list) {
      list.lines.forEach(function (l) {
        if (l.action !== 'create') return;
        var key = l.sku.toLowerCase();
        if (created[key]) { l.itemId = created[key].itemId; return; }
        var item = {
          itemId: newId('itm'), sku: l.sku, name: l.name, description: 'Created from packing list ' + list.number, category: l.category, unit: 'pcs',
          minStock: 0, active: 'TRUE', createdAt: now, createdBy: ctx.user.email, updatedAt: now, updatedBy: ctx.user.email
        };
        itemsTable.append(item);
        table(SHEETS.BALANCES).append({ itemId: item.itemId, physicalQty: 0, lastTxnId: '', updatedAt: now });
        writeAudit(ctx.user.email, 'items.create', 'LiteratureItems', item.itemId, 'Created item ' + item.sku + ' - ' + item.name + ' from packing list ' + list.number, ctx.requestId, { packingListNumber: list.number });
        created[key] = item;
        itemsCreated.push(item.sku);
        l.itemId = item.itemId;
      });
    });

    var receivedBy = ctx.user.name || ctx.user.email;
    var deliveriesCreated = [];
    usable.forEach(function (list) {
      var d = deliveriesCreate({
        deliveryDate: deliveryDate, sourceType: 'supplier', sourceName: PACKING_SOURCE_NAME, receivedBy: receivedBy,
        notes: 'Packing list ' + list.number, packingListNumber: list.number,
        items: list.lines.map(function (l) { return { itemId: l.itemId, quantity: l.quantity }; })
      }, ctx);
      list.deliveryId = d.deliveryId;
      list.reference = d.reference;
      deliveriesCreated.push({ deliveryId: d.deliveryId, reference: d.reference, number: list.number });
    });
    writeAudit(ctx.user.email, 'deliveries.importPackingLists', 'Deliveries', deliveriesCreated.map(function (d) { return d.reference; }).join(','),
      'Imported ' + deliveriesCreated.length + ' packing list(s), created ' + itemsCreated.length + ' item(s)' + (blocked.length ? ', skipped ' + blocked.length : ''), ctx.requestId,
      { packingLists: deliveriesCreated.map(function (d) { return d.number; }), itemsCreated: itemsCreated, skipped: blocked.map(function (l) { return l.number; }) });
    return { apply: true, deliveryDate: deliveryDate, lists: plan.lists, unparsed: plan.unparsed, itemsCreated: itemsCreated, deliveriesCreated: deliveriesCreated };
  });
}
