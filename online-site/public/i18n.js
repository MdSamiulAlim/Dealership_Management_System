/* Reversible presentation-only localization. Never changes record values or form values. */
(() => {
  const catalogue = window.ArafatLanguageCatalog;
  const normalize = value => String(value).trim().replace(/\s+/g, ' ').toLowerCase();
  const entries = new Map(), aliases = new Map();
  for (const [en, bn] of catalogue.entries) { const pair = {en, bn}; entries.set(normalize(en), pair); aliases.set(normalize(en), pair); aliases.set(normalize(bn), pair); }
  for (const [alias, en] of Object.entries(catalogue.aliases)) { const pair = entries.get(normalize(en)); if (pair) aliases.set(normalize(alias), pair); }
  let language = 'bn';
  try { language = localStorage.getItem('arafat-language') === 'en' ? 'en' : 'bn'; } catch {}
  const latinDigits = value => String(value).replace(/[০-৯]/g, digit => '০১২৩৪৫৬৭৮৯'.indexOf(digit));
  const digits = value => language === 'bn' ? String(value).replace(/[0-9]/g, digit => '০১২৩৪৫৬৭৮৯'[Number(digit)]) : latinDigits(value);
  const patterns = [];
  function template(en, bn, variants = []) {
    const pair = {en, bn};
    for (const source of [en, bn, ...variants]) {
      const names = []; let expression = '^', last = 0;
      for (const match of source.matchAll(/\{(\w+)\}/g)) {
        const numeric = ['count','visible','low','shown','before','after','min','max','version'].includes(match[1]);
        const money = ['amount','total'].includes(match[1]);
        expression += source.slice(last, match.index).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + (numeric ? '([0-9০-৯.,+−–-]+)' : money ? '([0-9০-৯.,৳+−–\\s-]+)' : '(.+?)'); names.push(match[1]); last = match.index + match[0].length;
      }
      expression += source.slice(last).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
      patterns.push({regex:new RegExp(expression, 'i'), names, pair});
    }
  }
  template('{count} records', '{count}টি রেকর্ড', ['{count}টি রেকর্ড']);
  template('{visible} of {total} records', '{total}টির মধ্যে {visible}টি দেখানো হচ্ছে');
  template('{count} bags available', '{count} বস্তা আছে', ['{count} Bag available']);
  template('{count} bags short', '{count} বস্তা ঘাটতি');
  template('{count} Bag', '{count} বস্তা');
  template('{count} kg', '{count} কেজি');
  template('{count} invoices today', 'আজ {count}টি ইনভয়েস');
  template('{count} low-stock products • first {shown} shown', '{count}টি পণ্যের মজুত কম • নিচে প্রথম {shown}টি');
  template('{count} products • {low} low stock', '{count} পণ্য • {low}টি মজুত কম', ['{count} পণ্য • {low}টি low stock']);
  template('Due from {count} customers', '{count} কাস্টমারের কাছে পাওনা');
  template('{count} Pending', '{count}টি সমন্বয় বাকি');
  template('{count} active', '{count}টি ফিল্টার চালু');
  template('{count} products found', '{count}টি পণ্য পাওয়া গেছে');
  template('Product {count}', 'পণ্য {count}');
  template('Find product for item {count}', '{count} নম্বর পণ্যের জন্য খুঁজুন');
  template('Last {count} days', 'গত {count} দিন');
  template('Last {count} days sales: {amount}', 'গত {count} দিনের বিক্রি: {amount}');
  template('{count} expenses · {amount}', '{count}টি খরচ · {amount}');
  template('Updated {time}', 'হালনাগাদ {time}');
  template('{range} • Daily total sales (BDT)', '{range} • প্রতিদিনের মোট বিক্রি (টাকা)', ['{range} • প্রতিদিনের মোট বিক্রি (BDT)']);
  template('Encrypted Offline mode enabled. {count} pending action(s).', 'এনক্রিপ্ট করা অফলাইন চালু আছে। {count}টি কাজের সমন্বয় বাকি।');
  template('Editing {invoice} · Version {version}', '{invoice} সম্পাদনা · সংস্করণ {version}');
  template('Return · {invoice}', 'ফেরত · {invoice}');
  template('{count} Bag remaining', '{count} বস্তা ফেরত দেওয়া যাবে');
  template('Returned: {count}', 'ফেরত: {count}');
  template('Packet code for {name}', '{name}-এর প্যাকেট কোড');
  template('Default rate for {name}', '{name}-এর নির্ধারিত দাম');
  template('Edit {name}', '{name} সম্পাদনা');
  template('View {invoice}', '{invoice} দেখুন');
  template('Return quantity for {name}', '{name}-এর ফেরতের পরিমাণ');
  template('Missing required field: {field}', 'প্রয়োজনীয় ঘর পূরণ হয়নি: {field}');
  template('{field} must be a whole number.', '{field} পূর্ণসংখ্যা হতে হবে।');
  template('{field} must be a whole number greater than zero.', '{field} শূন্যের চেয়ে বড় পূর্ণসংখ্যা হতে হবে।');
  template('{field} must be a whole number of zero or more.', '{field} শূন্য বা তার বেশি পূর্ণসংখ্যা হতে হবে।');
  template('Enter a value of at least {min}.', 'কমপক্ষে {min} দিন।');
  template('Enter a value no greater than {max}.', 'সর্বোচ্চ {max} দিন।');
  template('Current Bag: {before} → {after}', 'বর্তমান বস্তা: {before} → {after}');
  template('Adjustment: {count} Bag', 'সমন্বয়: {count} বস্তা');
  template('Subtotal: {amount}', 'ছাড়ের আগের মোট: {amount}');
  template('Discount: {amount}', 'ছাড়: {amount}');
  template('Total: {amount}', 'মোট: {amount}');
  template('Paid: {amount}', 'জমা: {amount}');
  template('Due: {amount}', 'বাকি: {amount}');
  template('Return credit: {amount}', 'ফেরতের মূল্য: {amount}');
  template('Refunded: {amount}', 'ফেরত দেওয়া টাকা: {amount}');
  template('Cancel {invoice}?', '{invoice} বাতিল করবেন?');
  template('Delete {entity}: {name}?', '{entity} থেকে {name} মুছবেন?');
  template('Stock Adjustment: {type}', 'মজুত সমন্বয়: {type}');
  template('Conflict: {message}', 'তথ্যের বিরোধ: {message}');
  template('Date: {date}', 'তারিখ: {date}');
  template('Edit Sale — {invoice}', 'বিক্রি সম্পাদনা — {invoice}');
  template('Total: {total}  •  Due: {amount}', 'মোট: {total}  •  বাকি: {amount}');
  const numberKeys = new Set(['count','total','visible','low','shown','amount','before','after','min','max','version','time']);
  function interpolate(source, values) { return source.replace(/\{(\w+)\}/g, (_, key) => numberKeys.has(key) ? digits(values[key] ?? '') : String(values[key] ?? '')); }
  function format(en, values = {}) {
    const item = patterns.find(item => item.pair.en === en);
    return interpolate(item ? item.pair[language] : en, values);
  }
  function text(value) {
    const source = String(value ?? ''), clean = source.trim();
    if (!clean) return source;
    const pair = aliases.get(normalize(clean));
    if (pair) return source.replace(clean, pair[language]);
    for (const pattern of patterns) {
      const match = pattern.regex.exec(clean);
      if (!match) continue;
      const values = Object.fromEntries(pattern.names.map((name, index) => [name, match[index + 1]]));
      if (values.field) values.field = text(values.field);
      if (values.message) values.message = text(values.message);
      return source.replace(clean, interpolate(pattern.pair[language], values));
    }
    if (/^[0-9০-৯৳.,+−–\s%-]+$/.test(clean) && /[0-9০-৯]/.test(clean)) return digits(source);
    return source;
  }
  const originals = new WeakMap(), attributes = new WeakMap();
  const skip = 'script,style,textarea,kbd,[translate="no"],[data-no-i18n],#languageSelect';
  let observer, applying = false, queued = false;
  function apply(root = document.body) {
    if (!root || applying) return;
    applying = true; observer?.disconnect();
    try {
      document.documentElement.lang = language;
      // Freeze implicit enum values before localizing their labels.
      for (const option of root.querySelectorAll('option:not([value])')) option.value = option.textContent;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (node.parentElement?.closest(skip) || !node.data.trim()) continue;
        const prior = originals.get(node), source = prior && prior.last === node.data ? prior.source : node.data;
        const output = text(source);
        originals.set(node, {source, last:output});
        if (output !== node.data) node.data = output;
      }
      for (const element of root.querySelectorAll('[placeholder],[aria-label],[title],[data-label]')) {
        if (element.closest('[translate="no"],[data-no-i18n],#languageSelect')) continue;
        let original = attributes.get(element); if (!original) attributes.set(element, original = new Map());
        for (const attribute of ['placeholder','aria-label','title','data-label']) {
          if (!element.hasAttribute(attribute)) continue;
          const current = element.getAttribute(attribute), prior = original.get(attribute), source = prior && prior.last === current ? prior.source : current, output = text(source);
          original.set(attribute, {source, last:output});
          if (output !== current) element.setAttribute(attribute, output);
        }
      }
      const select = document.getElementById('languageSelect'); if (select) select.value = language;
      const title = document.getElementById('pageTitle'); if (title) document.title = `${title.textContent} | Arafat Traders`;
    } finally { applying = false; observer?.observe(document.body, {subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['placeholder','aria-label','title','data-label']}); }
  }
  function schedule() { if (!queued) { queued = true; queueMicrotask(() => { queued = false; apply(); }); } }
  function validation(control) {
    control.setCustomValidity('');
    const v = control.validity;
    if (v.valid) { delete control.dataset.localeInvalid; return; }
    const message = v.valueMissing ? text('Please fill out this field.') : v.rangeUnderflow ? format('Enter a value of at least {min}.', {min:control.min}) : v.rangeOverflow ? format('Enter a value no greater than {max}.', {max:control.max}) : v.stepMismatch ? text(control.step === '1' ? 'Enter a whole number.' : 'Enter an amount with up to two decimal places.') : text('Enter a valid value.');
    control.setCustomValidity(message); control.dataset.localeInvalid = 'true';
  }
  function setLanguage(value) {
    language = value === 'en' ? 'en' : 'bn';
    try { localStorage.setItem('arafat-language', language); } catch {}
    for (const control of document.querySelectorAll('[data-locale-invalid]')) validation(control);
    apply(); window.dispatchEvent(new CustomEvent('workspace:language', {detail:language}));
  }
  document.addEventListener('invalid', event => { if (event.target.setCustomValidity) validation(event.target); }, true);
  document.addEventListener('input', event => { if (event.target.dataset.localeInvalid) { event.target.setCustomValidity(''); delete event.target.dataset.localeInvalid; } });
  document.addEventListener('change', event => { if (event.target.dataset.localeInvalid) { event.target.setCustomValidity(''); delete event.target.dataset.localeInvalid; } });
  const formats = {bn:{money:new Intl.NumberFormat('bn-BD',{style:'currency',currency:'BDT',currencyDisplay:'narrowSymbol',maximumFractionDigits:2,minimumFractionDigits:0}),qty:new Intl.NumberFormat('bn-BD',{maximumFractionDigits:2})},en:{money:new Intl.NumberFormat('en-BD',{style:'currency',currency:'BDT',currencyDisplay:'narrowSymbol',maximumFractionDigits:2,minimumFractionDigits:0}),qty:new Intl.NumberFormat('en-BD',{maximumFractionDigits:2})}};
  window.AppI18n = {text,format,apply,setLanguage,digits,get language(){return language;},number:(value,kind='qty') => formats[language][kind].format(Number(value||0))};
  observer = new MutationObserver(schedule); apply();
})();
