// Lantern's page. It reads window.RADAR from data.js and draws the ranked board,
// a filterable table, a per-protocol detail view, and the live-token comparables.
// No network and no framework: every figure comes from the snapshot factors.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('app');
  if (!DATA || !DATA.rows) {
    app.textContent = 'Lantern has no data. Run main.ts so data.js sits beside dashboard/.';
    return;
  }

  var SORTS = {
    rank: 1,
    name: 1,
    category: 1,
    primary_chain: 1,
    tvl_usd: 1,
    change_7d: 1,
    age_days: 1,
    combined: 1,
    implied_value_usd: 1,
  };

  var state = {
    view: 'board',
    slug: '',
    q: '',
    cat: 'all',
    chain: 'all',
    cohort: 'all',
    tvl: 0,
    growth: 'all',
    sort: 'rank',
    dir: 1,
  };

  // The arithmetic main.ts uses: round(TVL × peer × growth × maturity × chain).
  function impliedFromFactors(row) {
    var n = Math.round(row.tvl_usd * row.peer_multiple * row.growth_multiplier * row.maturity_multiplier * row.chain_multiplier);
    if (n < 1) return 1;
    if (n > 1e14) return 1e14;
    return n;
  }

  function modelText() {
    return 'peerMultiple is the winsorized median market-cap / TVL of live tokens in that category, shrunk toward the global median by n/(n+k), then clamped. growthMult scales the clamped seven-day TVL change; a missing change is flat. maturityMult is a Gaussian of years listed with no token recorded, peaking just past a year. chainMult is extra-chain breadth times a shrunk primary-chain quality. A recorded market cap, symbol, or CoinGecko id stays off this board and prices the multiples. CEX, bridge, liquid staking, liquid restaking, restaked BTC, version-marker names, and wrapped, staked, or exchange-branded names are skipped by rule.';
  }

  function runLine() {
    var m = DATA.model;
    return (
      'This run: winsor ' + m.winsor_lo + '×–' + m.winsor_hi + '×, shrink k=' + m.shrink_k +
      ', global median ' + m.global_multiple + '× from ' + m.peer_protocols + ' live peers, growth weight ' +
      m.growth_weight + ' on [' + m.growth_floor + ', +' + m.growth_cap + '], maturity center ' +
      m.maturity_center_years + 'y (σ ' + m.maturity_sigma_years + '), unknown-age ' + m.maturity_unknown + '×.'
    );
  }

  function skipLine() {
    var s = DATA.skipped;
    return 'Skipped by rule: ' + s.cex + ' CEX, ' + s.bridge + ' bridge, ' + s.liquid_staking + ' liquid staking, ' +
      s.liquid_restaking + ' liquid restaking, ' + s.restaked_btc + ' restaked BTC, ' + s.versioned + ' versioned, ' +
      s.wrapped_or_staked_name + ' wrapped or staked. ' + DATA.token_recorded + ' recorded tokens stay off the board.';
  }

  function peerStrip() {
    return h('div', { class: 'peers' }, DATA.categories.slice(0, 6).map(function (c) {
      return h('span', { class: 'peer-chip', text: c.category + ' ' + c.multiple.toFixed(2) + '×  n=' + c.peers });
    }));
  }

  function peerNote(row) {
    var cat = row.category || 'Uncategorized';
    var m = DATA.model;
    if (!row.peer_n) {
      return cat + ' has no live peer in the pricing sample, so the multiple is the global median ' + m.global_multiple + '×.';
    }
    var noun = row.peer_n === 1 ? 'live token' : 'live tokens';
    return cat + ' winsorized median is ' + row.peer_raw + '× from ' + row.peer_n + ' ' + noun +
      ', shrunk with k=' + m.shrink_k + ' toward the global median ' + m.global_multiple + '×, then clamped to ' +
      m.peer_lo + '×–' + m.peer_hi + '×, giving ' + row.peer_multiple + '×.';
  }

  function growthNote(row) {
    var m = DATA.model;
    if (row.growth_missing) return 'Seven-day TVL change is unreported, so growth is flat at ' + row.growth_multiplier + '×.';
    var clamped = Math.abs(row.change_7d - row.growth_pct) > 0.0001;
    var tail = clamped
      ? ' Clamped to ' + fmtPct(row.growth_pct) + ' before weight ' + m.growth_weight + ' produces ' + row.growth_multiplier + '×.'
      : ' Weight ' + m.growth_weight + ' produces ' + row.growth_multiplier + '×.';
    return 'Seven-day TVL change is ' + fmtPct(row.change_7d) + '.' + tail;
  }

  function maturityNote(row) {
    var m = DATA.model;
    if (row.age_days === null) {
      return 'No listing date is recorded, so maturity uses the unknown-age factor ' + row.maturity_multiplier + '×.';
    }
    var years = (row.age_days / 365).toFixed(2);
    return 'Listed ' + row.listed_at + ', ' + row.age_days + ' days with no token recorded (' + years + ' years). The Gaussian is centered at ' +
      m.maturity_center_years + ' years, so this age scores ' + row.maturity_multiplier + '×.';
  }

  function chainNote(row) {
    var n = row.chains.length;
    var where = n ? n + ' chain' + (n === 1 ? '' : 's') + ', primary ' + row.primary_chain : 'No chain is listed';
    return where + '. Breadth ' + row.chain_breadth.toFixed(4) + '×, primary-chain quality ' + row.chain_quality.toFixed(4) + '×, combined chain factor ' + row.chain_multiplier.toFixed(4) + '×.';
  }

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    var sign = n < 0 ? '-' : '';
    var v = Math.abs(n);
    if (v >= 1e12) return sign + '$' + (v / 1e12).toFixed(2) + 'T';
    if (v >= 1e9) return sign + '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return sign + '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return sign + '$' + Math.round(v / 1e3) + 'K';
    return sign + '$' + Math.round(v);
  }

  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    var sign = n > 0 ? '+' : '';
    return sign + n.toFixed(2) + '%';
  }

  function fmtAge(days) {
    if (days === null || days === undefined) return '—';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return days + 'd';
  }

  function fmtMult(n, digits) {
    if (!isFinite(n)) return '—';
    return n.toFixed(digits) + '×';
  }

  function h(tag, props) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === false || v === null || v === undefined) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (v === true) node.setAttribute(k, '');
        else node.setAttribute(k, String(v));
      });
    }
    for (var i = 2; i < arguments.length; i++) append(node, arguments[i]);
    return node;
  }

  function append(node, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) {
      child.forEach(function (c) { append(node, c); });
      return;
    }
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }

  function cats() {
    var set = {};
    DATA.rows.forEach(function (r) { set[r.category || 'Uncategorized'] = 1; });
    return Object.keys(set).sort();
  }

  function chains() {
    var set = {};
    DATA.rows.forEach(function (r) { r.chains.forEach(function (c) { set[c] = 1; }); });
    return Object.keys(set).sort();
  }

  function pass(row) {
    if (state.q) {
      var hay = (row.name + ' ' + row.slug).toLowerCase();
      if (hay.indexOf(state.q.toLowerCase()) < 0) return false;
    }
    if (state.cat !== 'all' && (row.category || 'Uncategorized') !== state.cat) return false;
    if (state.chain !== 'all' && row.chains.indexOf(state.chain) < 0) return false;
    if (state.cohort !== 'all' && row.cohort !== state.cohort) return false;
    if (row.tvl_usd < state.tvl) return false;
    if (state.growth === 'up' && !(row.change_7d > 0)) return false;
    if (state.growth === 'down' && !(row.change_7d < 0)) return false;
    if (state.growth === 'hot' && !(row.change_7d >= 5)) return false;
    if (state.growth === 'cold' && !(row.change_7d <= -5)) return false;
    return true;
  }

  function cmp(a, b) {
    var key = state.sort;
    var dir = state.dir;
    var av;
    var bv;
    if (key === 'name' || key === 'category' || key === 'primary_chain') {
      av = (a[key] || '').toLowerCase();
      bv = (b[key] || '').toLowerCase();
      if (av < bv) return -dir;
      if (av > bv) return dir;
    } else if (key === 'change_7d' || key === 'age_days') {
      var aMiss = a[key] === null || a[key] === undefined;
      var bMiss = b[key] === null || b[key] === undefined;
      if (aMiss !== bMiss) return aMiss ? 1 : -1;
      av = a[key];
      bv = b[key];
      if (av !== bv) return av < bv ? -dir : dir;
    } else {
      av = a[key];
      bv = b[key];
      if (av !== bv) return av < bv ? -dir : dir;
    }
    if (a.slug < b.slug) return -1;
    if (a.slug > b.slug) return 1;
    return 0;
  }

  function filtered() {
    return DATA.rows.filter(pass).sort(cmp);
  }

  function readHash() {
    var raw = location.hash.replace(/^#/, '');
    state.view = 'board';
    state.slug = '';
    state.q = '';
    state.cat = 'all';
    state.chain = 'all';
    state.cohort = 'all';
    state.tvl = 0;
    state.growth = 'all';
    state.sort = 'rank';
    state.dir = 1;
    if (!raw) return;
    if (raw === 'live') { state.view = 'live'; return; }
    if (raw.slice(0, 2) === 'p/') {
      state.view = 'detail';
      state.slug = decodeURIComponent(raw.slice(2));
      return;
    }
    var p = new URLSearchParams(raw);
    state.q = p.get('q') || '';
    state.cat = p.get('cat') || 'all';
    state.chain = p.get('chain') || 'all';
    state.cohort = p.get('cohort') || 'all';
    state.tvl = Number(p.get('tvl') || 0) || 0;
    state.growth = p.get('growth') || 'all';
    var sort = p.get('sort') || 'rank';
    state.sort = SORTS[sort] ? sort : 'rank';
    state.dir = p.get('dir') === '-1' ? -1 : 1;
  }

  function hashFor() {
    if (state.view === 'detail' && state.slug) return '#p/' + encodeURIComponent(state.slug);
    if (state.view === 'live') return '#live';
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.cat !== 'all') p.set('cat', state.cat);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.cohort !== 'all') p.set('cohort', state.cohort);
    if (state.tvl) p.set('tvl', String(state.tvl));
    if (state.growth !== 'all') p.set('growth', state.growth);
    if (state.sort !== 'rank') p.set('sort', state.sort);
    if (state.dir !== 1) p.set('dir', String(state.dir));
    var q = p.toString();
    return q ? '#' + q : '';
  }

  function writeHash() {
    var next = hashFor();
    var current = location.pathname + location.search + (location.hash || '');
    var target = location.pathname + location.search + next;
    if (current === target) return;
    history.replaceState(null, '', target || location.pathname);
  }

  function go(partial) {
    Object.keys(partial).forEach(function (k) { state[k] = partial[k]; });
    writeHash();
    render();
  }

  function openDetail(slug) { go({ view: 'detail', slug: slug }); }
  function showBoard() { go({ view: 'board', slug: '' }); }
  function showLive() { go({ view: 'live', slug: '' }); }

  function setSort(key) {
    if (state.sort === key) go({ sort: key, dir: -state.dir });
    else go({ sort: key, dir: key === 'name' || key === 'category' || key === 'rank' || key === 'primary_chain' ? 1 : -1 });
  }

  function option(value, label, selected) {
    return h('option', { value: value, selected: selected, text: label });
  }

  function header(slim) {
    return h('header', { class: slim ? 'top slim' : 'top' },
      h('div', { class: 'brand' },
        h('div', { class: 'lantern', 'aria-hidden': 'true' }),
        h('div', null,
          h('p', { class: 'kicker', text: 'Token launch radar' }),
          h('h1', { text: 'Lantern' }),
          h('p', { class: 'lede', text: 'Pre-token protocols, priced from the market caps of tokens that already trade.' })
        )
      ),
      h('div', { class: 'stats' },
        stat(String(DATA.board_size), 'Ranked'),
        stat(String(DATA.watchlist_size), 'Watchlist'),
        stat(String(DATA.early_size), 'Early'),
        stat(String(DATA.token_recorded), 'Live, set aside')
      )
    );
  }

  function stat(value, label) {
    return h('div', { class: 'stat' }, h('b', { text: value }), h('span', { text: label }));
  }

  function method() {
    return h('section', { class: 'method' },
      h('p', { class: 'formula', text: 'implied = round(TVL × peerMultiple × growthMult × maturityMult × chainMult)' }),
      h('p', { text: modelText() }),
      h('p', { class: 'runline', text: runLine() }),
      h('p', { class: 'runline', text: skipLine() }),
      peerStrip()
    );
  }

  function tabs() {
    return h('div', { class: 'tabs', role: 'tablist' },
      h('button', { type: 'button', class: state.view === 'live' ? '' : 'on', role: 'tab', onclick: showBoard, text: 'Pre-token board' }),
      h('button', { type: 'button', class: state.view === 'live' ? 'on' : '', role: 'tab', onclick: showLive, text: 'Live comparables, not ranked' })
    );
  }

  function toolbar() {
    var search = h('input', {
      id: 'q',
      type: 'search',
      value: state.q,
      placeholder: 'Name or slug',
      'aria-label': 'Search protocols',
      oninput: function (e) { go({ q: e.target.value, view: 'board' }); },
    });
    return h('div', { class: 'toolbar' },
      h('label', { class: 'field' }, h('span', { text: 'Search' }), search),
      h('label', { class: 'field' }, h('span', { text: 'Category' }),
        h('select', { 'aria-label': 'Category', onchange: function (e) { go({ cat: e.target.value, view: 'board' }); } },
          [option('all', 'All categories', state.cat === 'all')].concat(cats().map(function (c) { return option(c, c, state.cat === c); }))
        )
      ),
      h('label', { class: 'field' }, h('span', { text: 'Chain' }),
        h('select', { 'aria-label': 'Chain', onchange: function (e) { go({ chain: e.target.value, view: 'board' }); } },
          [option('all', 'All chains', state.chain === 'all')].concat(chains().map(function (c) { return option(c, c, state.chain === c); }))
        )
      ),
      h('label', { class: 'field' }, h('span', { text: 'Cohort' }),
        h('select', { 'aria-label': 'Cohort', onchange: function (e) { go({ cohort: e.target.value, view: 'board' }); } },
          option('all', 'Watchlist and early', state.cohort === 'all'),
          option('watchlist', 'Watchlist only', state.cohort === 'watchlist'),
          option('early', 'Early only', state.cohort === 'early')
        )
      ),
      h('label', { class: 'field' }, h('span', { text: 'Min TVL' }),
        h('select', { 'aria-label': 'Minimum TVL', onchange: function (e) { go({ tvl: Number(e.target.value), view: 'board' }); } },
          option('0', 'Any TVL', state.tvl === 0),
          option('10000000', '$10M', state.tvl === 10000000),
          option('50000000', '$50M', state.tvl === 50000000),
          option('100000000', '$100M', state.tvl === 100000000),
          option('500000000', '$500M', state.tvl === 500000000)
        )
      ),
      h('label', { class: 'field' }, h('span', { text: '7-day TVL' }),
        h('select', { 'aria-label': 'Seven-day growth', onchange: function (e) { go({ growth: e.target.value, view: 'board' }); } },
          option('all', 'Any change', state.growth === 'all'),
          option('up', 'Up', state.growth === 'up'),
          option('down', 'Down', state.growth === 'down'),
          option('hot', 'Up 5% or more', state.growth === 'hot'),
          option('cold', 'Down 5% or more', state.growth === 'cold')
        )
      ),
      h('div', { class: 'legend' },
        h('span', null, h('i', { class: 'sq' }), 'Watchlist'),
        h('span', null, h('i', { class: 'sq-o' }), 'Early')
      )
    );
  }

  function describeFilters(n) {
    var bits = [];
    if (state.q) bits.push('matching “' + state.q + '”');
    if (state.cat !== 'all') bits.push(state.cat);
    if (state.chain !== 'all') bits.push('on ' + state.chain);
    if (state.cohort === 'watchlist') bits.push('watchlist only');
    if (state.cohort === 'early') bits.push('early only');
    if (state.tvl) bits.push('TVL at least ' + fmtUsd(state.tvl));
    if (state.growth === 'up') bits.push('TVL up over 7 days');
    if (state.growth === 'down') bits.push('TVL down over 7 days');
    if (state.growth === 'hot') bits.push('TVL up 5% or more');
    if (state.growth === 'cold') bits.push('TVL down 5% or more');
    var what = bits.length ? bits.join(', ') : 'All categories, chains, and cohorts';
    return n + ' of ' + DATA.board_size + ' protocols. ' + what + '. Rank is fixed by implied value; sorting does not reassign it.';
  }

  function th(label, key, numeric) {
    var on = state.sort === key;
    var arrow = on ? (state.dir < 0 ? ' ↓' : ' ↑') : '';
    return h('th', { class: numeric ? 'num' : '', scope: 'col' },
      h('button', { type: 'button', class: on ? 'on' : '', onclick: function () { setSort(key); }, text: label + arrow })
    );
  }

  function pctCell(n) {
    var cls = 'num';
    if (n > 0) cls += ' up';
    else if (n < 0) cls += ' down';
    else cls += ' muted';
    return h('td', { class: cls, text: fmtPct(n) });
  }

  function boardTable(rows) {
    var head = h('tr', null,
      th('#', 'rank', true),
      th('Protocol', 'name', false),
      th('Category', 'category', false),
      th('Chain', 'primary_chain', false),
      th('TVL', 'tvl_usd', true),
      th('7-day', 'change_7d', true),
      th('Age', 'age_days', true),
      th('Multiple', 'combined', true),
      th('Implied', 'implied_value_usd', true)
    );
    var body = rows.map(function (r) {
      return h('tr', {
        class: 'click',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter') openDetail(r.slug); },
      },
        h('td', { class: r.rank <= 3 ? 'rank top' : 'rank', text: String(r.rank) }),
        h('td', null,
          h('span', { class: r.cohort === 'watchlist' ? 'sq' : 'sq-o' }),
          h('span', { class: 'name', text: r.name })
        ),
        h('td', { text: r.category || 'Uncategorized' }),
        h('td', { text: r.primary_chain + (r.chains.length > 1 ? ' +' + (r.chains.length - 1) : '') }),
        h('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        pctCell(r.change_7d),
        h('td', { class: 'num muted', text: fmtAge(r.age_days) }),
        h('td', { class: 'num', text: fmtMult(r.combined, 2) }),
        h('td', { class: 'num implied', text: fmtUsd(r.implied_value_usd) })
      );
    });
    return h('table', null, h('thead', null, head), h('tbody', null, body));
  }

  function factor(value, label, result) {
    return h('div', { class: result ? 'factor result' : 'factor' }, h('b', { text: value }), h('span', { text: label }));
  }

  function detail(row) {
    var implied = impliedFromFactors(row);
    var comps = DATA.live.filter(function (l) { return l.category === row.category; }).slice(0, 3);
    var above = row.cohort === 'early' && row.tvl_usd >= DATA.floor_usd;
    var note = above
      ? ' Above the ' + fmtUsd(DATA.floor_usd) + ' floor, but the house watchlist does not name it. No token is recorded, and none of the skip rules fired.'
      : '';
    return h('article', null,
      h('button', { class: 'back', type: 'button', onclick: showBoard, text: '← Back to the board' }),
      h('div', { class: 'detail-head' },
        h('div', null,
          h('h2', { text: row.name }),
          h('p', { class: 'meta' },
            h('span', { class: row.cohort === 'watchlist' ? 'tag' : 'tag early', text: row.cohort }),
            'Rank ' + row.rank + ' · ' + (row.category || 'Uncategorized') + ' · ' + fmtUsd(row.tvl_usd) + ' TVL · ' +
            fmtPct(row.change_7d) + ' over 7 days · ' + fmtAge(row.age_days) + ' listed · ' +
            (row.chains.slice(0, 4).join(', ') || 'no chain') + (row.chains.length > 4 ? ' +' + (row.chains.length - 4) : '')
          ),
          note ? h('p', { class: 'meta', text: note.trim() }) : null
        )
      ),
      h('div', { class: 'detail-grid' },
        h('div', null,
          h('div', { class: 'eq' },
            factor(fmtUsd(row.tvl_usd), 'TVL'),
            h('span', { class: 'times', text: '×' }),
            factor(fmtMult(row.peer_multiple, 4), 'Peer'),
            h('span', { class: 'times', text: '×' }),
            factor(fmtMult(row.growth_multiplier, 4), 'Growth'),
            h('span', { class: 'times', text: '×' }),
            factor(fmtMult(row.maturity_multiplier, 4), 'Maturity'),
            h('span', { class: 'times', text: '×' }),
            factor(fmtMult(row.chain_multiplier, 4), 'Chain'),
            h('span', { class: 'times', text: '=' }),
            factor(fmtUsd(implied), 'Implied value', true)
          ),
          h('div', { class: 'notes' },
            h('p', null, h('strong', { text: 'Peer. ' }), peerNote(row)),
            h('p', null, h('strong', { text: 'Growth. ' }), growthNote(row)),
            h('p', null, h('strong', { text: 'Maturity. ' }), maturityNote(row)),
            h('p', null, h('strong', { text: 'Chain. ' }), chainNote(row))
          ),
          h('div', { class: 'comps' },
            h('h3', { text: 'Live tokens in ' + (row.category || 'this category') }),
            comps.length
              ? h('ul', null, comps.map(function (c) {
                  return h('li', { text: c.name + (c.symbol ? ' (' + c.symbol + ')' : '') + ' trades at ' + fmtUsd(c.mcap_usd) + ' market cap on ' + fmtUsd(c.tvl_usd) + ' TVL, ' + fmtMult(c.multiple, 2) + ' before winsor and shrink.' });
                }))
              : h('p', { class: 'meta', text: 'No priced token in this category. The multiple falls back to the global median.' })
          )
        ),
        h('section', { class: 'plan' },
          h('h3', { text: 'Farm plan' }),
          h('ol', null, row.farm_steps.map(function (step, i) {
            return h('li', null, h('span', { class: 'n', text: String(i + 1) }), h('span', { text: step }));
          }))
        )
      )
    );
  }

  // Same exclusion the model uses before it computes a category multiple.
  function inPeerSample(category) {
    if (category === 'CEX' || category === 'Liquid Staking' || category === 'Liquid Restaking' || category === 'Restaked BTC') return false;
    if (category && /\bbridge\b/i.test(category)) return false;
    return true;
  }

  function liveTable() {
    var rows = DATA.live.slice().sort(function (a, b) { return b.mcap_usd - a.mcap_usd || (a.slug < b.slug ? -1 : 1); });
    return h('table', null,
      h('thead', null, h('tr', null,
        h('th', { text: 'Protocol' }),
        h('th', { text: 'Category' }),
        h('th', { class: 'num', text: 'TVL' }),
        h('th', { class: 'num', text: 'Market cap' }),
        h('th', { class: 'num', text: 'Mcap / TVL' }),
        h('th', { class: 'num', text: '7d' })
      )),
      h('tbody', null, rows.map(function (r) {
        return h('tr', null,
          h('td', null,
            h('span', { class: 'name', text: r.name }),
            h('span', { class: 'slug', text: (r.symbol ? r.symbol + ' · ' : '') + r.slug + (inPeerSample(r.category) ? '' : ' · not in the peer sample') })
          ),
          h('td', { text: r.category || 'Uncategorized' }),
          h('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
          h('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
          h('td', { class: 'num', text: fmtMult(r.multiple, 2) }),
          pctCell(r.change_7d)
        );
      }))
    );
  }

  function footer() {
    return h('p', { class: 'foot', text: 'Lantern ' + DATA.model_version + ' · snapshot ' + DATA.as_of + ' · floor ' + fmtUsd(DATA.floor_usd) + ' · ' + DATA.source });
  }

  function render() {
    var focusSearch = document.activeElement && document.activeElement.id === 'q';
    var caret = focusSearch ? document.activeElement.selectionStart : null;
    var rows = state.view === 'board' ? filtered() : [];
    var selected = null;
    if (state.view === 'detail') {
      for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === state.slug) selected = DATA.rows[i];
    }
    app.textContent = '';
    var wrap = h('main', { class: 'wrap', id: 'app-main' },
      header(state.view === 'detail'),
      state.view === 'detail'
        ? h('section', { class: 'method tight' },
            h('p', { class: 'formula', text: 'implied = round(TVL × peerMultiple × growthMult × maturityMult × chainMult)' })
          )
        : method(),
      state.view === 'detail' ? null : tabs(),
      state.view === 'board' ? toolbar() : null,
      state.view === 'board' ? h('p', { class: rows.length === DATA.board_size && !state.q ? 'count' : 'count on', text: describeFilters(rows.length) }) : null,
      state.view === 'board' && rows.length === 0 ? h('p', { class: 'empty', text: 'No protocol matches these filters.' }) : null,
      state.view === 'board' && rows.length ? boardTable(rows) : null,
      state.view === 'detail' && selected ? detail(selected) : null,
      state.view === 'detail' && !selected ? h('p', { class: 'empty', text: 'That slug is not on the board.' }) : null,
      state.view === 'live' ? h('p', { class: 'banner', text: 'These protocols already record a token, sorted by market cap. They are not ranked. Peer multiples drop exchanges, bridges, liquid staking, liquid restaking, and restaked BTC, then winsorize market-cap / TVL and shrink it toward the global median.' }) : null,
      state.view === 'live' ? liveTable() : null,
      state.view === 'detail' ? null : footer()
    );
    app.appendChild(wrap);
    if (focusSearch && state.view === 'board') {
      var el = document.getElementById('q');
      if (el) {
        el.focus();
        if (typeof caret === 'number') el.setSelectionRange(caret, caret);
      }
    }
  }

  window.addEventListener('hashchange', function () {
    readHash();
    render();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.view !== 'board') showBoard();
  });

  readHash();
  render();
})();
