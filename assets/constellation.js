(function () {
  'use strict';
  var DATA_URL = new URL('data/constellation.json', document.baseURI).toString();
  var state = { query: '', track: 'all', view: 'map', selectedId: null, selectedTheme: null, expanded: false };
  var data, app, searchTimer;

  function el(tag, options) {
    var node = document.createElement(tag); options = options || {};
    Object.keys(options).forEach(function (key) {
      var value = options[key];
      if (key === 'text') node.textContent = value == null ? '' : String(value);
      else if (key === 'className') node.className = value;
      else if (key === 'attrs') Object.keys(value).forEach(function (name) { if (value[name] !== null) node.setAttribute(name, value[name]); });
      else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2).toLowerCase(), value);
      else node[key] = value;
    });
    return node;
  }
  function append(parent) { Array.prototype.slice.call(arguments, 1).filter(Boolean).forEach(function (child) { parent.appendChild(child); }); return parent; }
  function normalized(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }
  // Plotly hover templates support HTML. Escape public text before passing it to
  // customdata so submitted values stay literal there as they do in DOM text.
  function plotText(value) { return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function authorsText(node) { return (node.authors || []).map(function (author) { return author.name + ' ' + (author.affiliation || ''); }).join(' '); }
  function searchText(node) { return [node.presenter, authorsText(node), node.title, node.affiliation, node.discipline, node.abstract].join(' '); }
  function trackClass(track) { return track === 'Industry' ? 'track industry' : 'track'; }
  function button(label, className, handler, attrs) { return el('button', { text: label, className: className || 'button', onClick: handler, attrs: attrs || { type: 'button' } }); }
  function nodeById(id) { return (data.nodes || []).find(function (node) { return node.submission_id === id; }) || null; }
  function selectedNode() { return state.selectedId ? nodeById(state.selectedId) : null; }
  function modeHasMap() { return data && data.mode === 'map' && data.nodes.some(function (node) { return Number.isFinite(node.x) && Number.isFinite(node.y); }); }
  function validTrack(value) { return value === 'Academic' || value === 'Industry' || value === 'all' ? value : 'all'; }
  function readUrl() {
    var params = new URLSearchParams(window.location.search);
    state.query = params.get('q') || ''; state.track = validTrack(params.get('track') || 'all');
    state.view = params.get('view') === 'list' ? 'list' : 'map'; state.selectedId = params.get('submission') || null;
    if (state.view === 'map' && data && !modeHasMap()) state.view = 'list';
    state.selectedTheme = null; state.expanded = false;
  }
  function updateUrl(method) {
    var url = new URL(window.location.href); url.search = '';
    if (state.query) url.searchParams.set('q', state.query);
    if (state.track !== 'all') url.searchParams.set('track', state.track);
    if (state.view !== 'map') url.searchParams.set('view', state.view);
    if (state.selectedId) url.searchParams.set('submission', state.selectedId);
    window.history[method || 'pushState']({}, '', url);
  }
  function rememberedControlFocus() {
    var active = document.activeElement;
    if (!active || (active.id !== 'constellation-search' && active.id !== 'constellation-track')) return null;
    return { id: active.id, start: active.selectionStart, end: active.selectionEnd };
  }
  function restoreFocus(target) {
    if (!target) return;
    if (target === 'profile') {
      var heading = document.getElementById('profile-heading');
      if (heading) { heading.focus(); heading.scrollIntoView({ block: 'start', behavior: 'auto' }); }
      return;
    }
    if (target === 'result-or-search') {
      var current = state.selectedId && document.getElementById('result-' + state.selectedId);
      var fallback = current || document.getElementById('constellation-search');
      if (fallback) fallback.focus();
      return;
    }
    var control = document.getElementById(target.id);
    if (control) {
      control.focus();
      if (typeof target.start === 'number' && typeof control.setSelectionRange === 'function') control.setSelectionRange(target.start, target.end);
    }
  }
  function setState(next, method, focusTarget) { Object.assign(state, next); updateUrl(method); render(focusTarget || rememberedControlFocus()); }
  function results() {
    var query = normalized(state.query), tokens = query ? query.split(' ') : [];
    return data.nodes.filter(function (node) {
      if (state.track !== 'all' && node.track !== state.track) return false;
      if (state.selectedTheme !== null && node.cluster !== state.selectedTheme) return false;
      var text = normalized(searchText(node)); return !tokens.length || tokens.every(function (token) { return text.indexOf(token) !== -1; });
    }).sort(function (a, b) {
      if (query) {
        var aExact = [a.presenter, a.title].concat((a.authors || []).map(function (x) { return x.name; })).some(function (value) { return normalized(value) === query; });
        var bExact = [b.presenter, b.title].concat((b.authors || []).map(function (x) { return x.name; })).some(function (value) { return normalized(value) === query; });
        if (aExact !== bExact) return aExact ? -1 : 1;
      }
      return a.title.localeCompare(b.title) || a.submission_id.localeCompare(b.submission_id);
    });
  }
  function scheduleText(schedule) {
    if (!schedule || !schedule.date || !schedule.start_time) return 'Schedule: TBD';
    var day = new Date(schedule.date + 'T12:00:00');
    var date = Number.isNaN(day.valueOf()) ? schedule.date : day.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    var time = schedule.start_time + (schedule.end_time ? '–' + schedule.end_time : '');
    var place = [schedule.room, schedule.session_title].filter(Boolean).join(' · ');
    return 'Schedule: ' + date + ', ' + time + (place ? ' · ' + place : '');
  }
  function categoryText(category) { return ({ shared_interest: 'Shared interest', research_practice: 'Research meets practice', across_themes: 'Across themes' })[category] || category; }
  function recommendationsFor(node, includeAllTracks) {
    return (data.recommendations || []).filter(function (rec) {
      var target = rec.source === node.submission_id && nodeById(rec.target);
      return target && (includeAllTracks || state.track === 'all' || target.track === state.track);
    }).sort(function (a, b) { return a.rank - b.rank || a.target.localeCompare(b.target); });
  }
  function emptyMessage(text) { return el('p', { className: 'empty-state', text: text }); }

  function buildToolbar() {
    var form = el('form', { className: 'toolbar', onSubmit: function (event) { event.preventDefault(); } });
    var searchLabel = el('label', { className: 'field', text: 'Find a person, title, or topic' });
    var input = el('input', { value: state.query, attrs: { type: 'search', id: 'constellation-search', autocomplete: 'off', placeholder: 'e.g., María García or human review' }, onInput: function (event) {
      var control = event.currentTarget, query = control.value, focus = { id: control.id, start: control.selectionStart, end: control.selectionEnd };
      window.clearTimeout(searchTimer); searchTimer = window.setTimeout(function () { setState({ query: query, selectedTheme: null }, 'replaceState', focus); }, 150);
    } });
    searchLabel.htmlFor = 'constellation-search'; searchLabel.appendChild(input);
    var trackLabel = el('label', { className: 'field', text: 'Track' });
    var select = el('select', { value: state.track, attrs: { id: 'constellation-track' }, onChange: function (event) { setState({ track: event.target.value }, 'pushState'); } });
    [['all', 'All tracks'], ['Academic', 'Academic'], ['Industry', 'Industry']].forEach(function (pair) { select.appendChild(el('option', { text: pair[1], value: pair[0] })); });
    select.value = state.track;
    trackLabel.htmlFor = 'constellation-track'; trackLabel.appendChild(select);
    var switcher = el('div', { className: 'view-switch', attrs: { role: 'group', 'aria-label': 'View' } });
    switcher.append(button('Map', '', function () { setState({ view: 'map' }, 'pushState'); }, { type: 'button', 'aria-pressed': String(state.view === 'map'), disabled: modeHasMap() ? null : 'disabled', title: modeHasMap() ? '' : 'Map coordinates are unavailable for this release' }), button('List', '', function () { setState({ view: 'list' }, 'pushState'); }, { type: 'button', 'aria-pressed': String(state.view === 'list') }));
    var reset = button('Reset', 'button secondary', function () { state = { query: '', track: 'all', view: 'map', selectedId: null, selectedTheme: null, expanded: false }; if (!modeHasMap()) state.view = 'list'; updateUrl('pushState'); render({ id: 'constellation-search' }); });
    form.append(searchLabel, trackLabel, switcher, reset); return form;
  }
  function buildList(items) {
    if (!items.length) return emptyMessage(state.query ? 'No presentations match that search. Try a name, title, or broader topic.' : 'No presentations are available with these filters.');
    var list = el('ul', { className: 'result-list', attrs: { 'aria-label': 'Presentation results' } });
    items.forEach(function (node) {
      var meta = el('span', { className: 'result-meta', text: node.presenter + (node.affiliation ? ' · ' + node.affiliation : '') }); meta.appendChild(el('span', { className: trackClass(node.track), text: node.track }));
      var resultButton = el('button', { className: 'result-button', attrs: { type: 'button', id: 'result-' + node.submission_id, 'aria-current': state.selectedId === node.submission_id ? 'true' : 'false' }, onClick: function () { setState({ selectedId: node.submission_id, expanded: false }, 'pushState', 'profile'); } });
      resultButton.append(el('span', { className: 'result-title', text: node.title }), meta);
      var item = el('li', {}); item.appendChild(resultButton); list.appendChild(item);
    }); return list;
  }
  function buildThemes() {
    var aside = el('aside', { className: 'themes', attrs: { 'aria-label': 'Browse themes' } });
    aside.append(el('h2', { text: 'Browse themes' }), el('p', { text: 'Choose a theme to narrow the list or map.' }));
    var list = el('div', { className: 'theme-list' });
    (data.clusters || []).slice().sort(function (a, b) { return a.id === -1 ? 1 : b.id === -1 ? -1 : a.name.localeCompare(b.name); }).forEach(function (cluster) {
      var theme = el('button', { className: 'theme-button', attrs: { type: 'button', 'aria-pressed': String(state.selectedTheme === cluster.id) }, onClick: function () { state.selectedTheme = state.selectedTheme === cluster.id ? null : cluster.id; render(); } });
      theme.style.setProperty('--theme-color', cluster.color || '#999999'); theme.append(el('strong', { text: cluster.name }), el('span', { text: cluster.narrative || (cluster.size + ' presentations') })); list.appendChild(theme);
    }); aside.appendChild(list); return aside;
  }
  function buildRecommendations(node) {
    var section = el('section', { className: 'recommendations', attrs: { 'aria-labelledby': 'related-heading' } }); section.appendChild(el('h3', { text: 'Related work', attrs: { id: 'related-heading' } }));
    // Apply the active target-track restriction before the visible top-three/six cut.
    var allRows = recommendationsFor(node, true), rows = recommendationsFor(node);
    if (!rows.length) {
      section.appendChild(el('p', { text: allRows.length && state.track !== 'all' ? 'No close matches found within the active Track filter. Clear the filter to see all related work.' : 'No close matches found in this release. Browse a topic or theme to explore other opted-in work.' }));
      return section;
    }
    var shown = state.expanded ? rows.slice(0, 6) : rows.slice(0, 3), grid = el('div', { className: 'recommendation-grid' });
    shown.forEach(function (rec) {
      var target = nodeById(rec.target); if (!target) return;
      var card = el('article', { className: 'match-card' }), tags = el('div', {});
      (rec.categories || []).forEach(function (category) { tags.appendChild(el('span', { className: 'match-label', text: categoryText(category) })); });
      if (rec.existing_collaborator) tags.appendChild(el('span', { className: 'match-label collaborator', text: 'Existing collaborator' }));
      card.append(tags, el('h3', { text: target.title }), el('span', { className: 'card-meta', text: target.presenter + (target.affiliation ? ' · ' + target.affiliation : '') }));
      card.appendChild(el('span', { className: trackClass(target.track), text: target.track })); card.appendChild(el('p', { text: rec.explanation }));
      if (rec.discussion_prompt) card.appendChild(el('p', { text: 'Suggested discussion: ' + rec.discussion_prompt }));
      if (rec.evidence && rec.evidence.length) {
        var details = el('details', {}); details.appendChild(el('summary', { text: 'Why this connection' })); details.appendChild(el('p', { className: 'evidence-heading', text: 'Evidence excerpts by source' })); var evidence = el('ul', { className: 'evidence-list' });
        rec.evidence.forEach(function (item) {
          var evidenceNode = nodeById(item.submission_id), source = evidenceNode ? evidenceNode.presenter + ' — ' + evidenceNode.title : 'a related presentation';
          evidence.appendChild(el('li', { text: 'Evidence from ' + source + ': ' + item.excerpt }));
        }); details.appendChild(evidence); card.appendChild(details);
      }
      var cardActions = el('div', { className: 'match-actions' });
      if (target.schedule && target.schedule.date) cardActions.appendChild(el('a', { className: 'schedule-link', text: 'View in Schedule', href: 'conference-agenda.html#pres-' + encodeURIComponent(target.submission_id), attrs: { 'aria-label': 'View in Schedule: ' + target.title } }));
      cardActions.appendChild(button('Show on map', 'button secondary', function () { setState({ selectedId: target.submission_id, view: 'map', expanded: false }, 'pushState', 'profile'); }, { type: 'button', 'aria-label': 'Show on map: ' + target.title }));
      card.appendChild(cardActions);
      grid.appendChild(card);
    }); section.appendChild(grid);
    if (rows.length > 3) section.appendChild(button(state.expanded ? 'Show fewer matches' : 'More related work', 'button secondary more-button', function () { state.expanded = !state.expanded; render(); }));
    return section;
  }
  function buildProfile(node) {
    var panel = el('aside', { className: 'profile-panel', attrs: { 'aria-label': 'Selected presentation' } }), top = el('div', { className: 'profile-topline' }), heading = el('div', {});
    var theme = (data.clusters || []).find(function (cluster) { return cluster.id === node.cluster; });
    heading.append(el('span', { className: trackClass(node.track), text: node.track }), el('h2', { text: node.title, attrs: { id: 'profile-heading', tabindex: '-1' } }), el('p', { className: 'card-meta', text: node.presenter + (node.affiliation ? ' · ' + node.affiliation : '') }), el('p', { className: 'card-meta', text: 'Theme: ' + (theme ? theme.name : 'Not assigned') }));
    top.append(heading, button('×', 'profile-close', function () { var closingId = state.selectedId; setState({ selectedId: null }, 'pushState', document.getElementById('result-' + closingId) ? { id: 'result-' + closingId } : 'result-or-search'); }, { type: 'button', 'aria-label': 'Close selected presentation' })); panel.appendChild(top);
    if (state.track !== 'all' && node.track !== state.track) panel.appendChild(el('p', { className: 'filter-note', text: 'This selected presentation is outside the ' + state.track + ' filter. It remains visible here; results and map show the active filter.' }));
    // Descriptive "about this work" block first (abstract, authors, session), then the
    // networking recommendations below it.
    panel.appendChild(el('h3', { text: 'About this work' }));
    var abstract = node.abstract || node.abstract_preview || 'No abstract is available.';
    var preview = node.abstract_preview || abstract;
    if (node.abstract && preview !== node.abstract) {
      panel.appendChild(el('p', { text: preview }));
      var abstractDetails = el('details', { className: 'abstract-details' });
      abstractDetails.append(el('summary', { text: 'Read full abstract' }), el('p', { text: node.abstract }));
      panel.appendChild(abstractDetails);
    } else panel.appendChild(el('p', { text: abstract }));
    panel.appendChild(el('h3', { text: 'Presenters and authors' }));
    var authors = el('ul', { className: 'author-list' }); (node.authors || []).forEach(function (author) { authors.appendChild(el('li', { text: author.name + (author.affiliation ? ' · ' + author.affiliation : '') + (author.role ? ' (' + author.role + ')' : '') })); }); panel.appendChild(authors);
    panel.append(el('h3', { text: 'Session' }), el('p', { className: 'schedule', text: scheduleText(node.schedule) }));
    var sessionActions = el('div', { className: 'profile-actions' });
    if (node.schedule && node.schedule.date) sessionActions.appendChild(el('a', { className: 'schedule-link', text: 'View in Schedule', href: 'conference-agenda.html#pres-' + encodeURIComponent(node.submission_id) }));
    if (modeHasMap()) sessionActions.appendChild(button('Show on map', 'button secondary', function () { setState({ view: 'map' }, 'pushState', 'profile'); }));
    if (sessionActions.childNodes.length) panel.appendChild(sessionActions);
    panel.appendChild(buildRecommendations(node));
    return panel;
  }
  function drawMap(items) {
    var panel = el('section', { className: 'content-panel map-panel', attrs: { 'aria-label': 'Constellation map' } }); panel.appendChild(el('p', { className: 'map-help', text: 'Select a point for the readable profile. Circles are Academic and diamonds are Industry; only connections for the selected presentation or theme are drawn.' }));
    if (!window.Plotly) { panel.appendChild(el('p', { className: 'map-unavailable', text: 'The local map asset could not load. List view remains available.' })); return panel; }
    var plot = el('div', { attrs: { id: 'constellation-plot', role: 'img', 'aria-label': 'Map of selected conference presentations. Use the List view for complete presentation details.' } }); panel.appendChild(plot);
    window.setTimeout(function () {
      var included = {}; items.forEach(function (node) { included[node.submission_id] = node; });
      var focus = state.selectedId ? [state.selectedId] : state.selectedTheme !== null ? items.filter(function (node) { return node.cluster === state.selectedTheme; }).map(function (node) { return node.submission_id; }) : [], edgeX = [], edgeY = [];
      (data.edges || []).forEach(function (edge) { var source = included[edge.source], target = included[edge.target]; if (source && target && (focus.indexOf(edge.source) !== -1 || focus.indexOf(edge.target) !== -1)) { edgeX.push(source.x, target.x, null); edgeY.push(source.y, target.y, null); } });
      var traces = []; if (edgeX.length) traces.push({ type: 'scatter', mode: 'lines', x: edgeX, y: edgeY, hoverinfo: 'skip', line: { color: 'rgba(80,80,80,.35)', width: 1.5 }, showlegend: false });
      var groups = {}; items.forEach(function (node) { var key = String(node.cluster); (groups[key] = groups[key] || []).push(node); });
      Object.keys(groups).sort().forEach(function (key) { var group = groups[key], cluster = (data.clusters || []).find(function (item) { return String(item.id) === key; }); traces.push({ type: 'scatter', mode: 'markers', name: cluster ? plotText(cluster.name) : 'Presentations', x: group.map(function (node) { return node.x; }), y: group.map(function (node) { return node.y; }), customdata: group.map(function (node) { return [node.submission_id, plotText(node.title), plotText(node.presenter), plotText(node.track)]; }), marker: { size: group.map(function (node) { return node.submission_id === state.selectedId ? 17 : 11; }), symbol: group.map(function (node) { return node.track === 'Industry' ? 'diamond' : 'circle'; }), color: group.map(function (node) { return node.color || '#999'; }), line: { color: '#fff', width: 1.2 } }, hovertemplate: '<b>%{customdata[1]}</b><br>%{customdata[2]} · %{customdata[3]}<extra></extra>' }); });
      window.Plotly.newPlot(plot, traces, { margin: { l: 12, r: 12, t: 14, b: 20 }, paper_bgcolor: '#fff', plot_bgcolor: '#fff', showlegend: true, legend: { orientation: 'h', y: -.12 }, xaxis: { visible: false }, yaxis: { visible: false, scaleanchor: 'x' } }, { responsive: true, displayModeBar: false }).then(function () { plot.on('plotly_click', function (event) { var id = event.points && event.points[0] && event.points[0].customdata && event.points[0].customdata[0]; if (id) setState({ selectedId: id, expanded: false }, 'pushState', 'profile'); }); });
    }, 0); return panel;
  }
  function render(focusTarget) {
    if (!data || !app) return; app.replaceChildren(); app.appendChild(buildToolbar()); var selected = selectedNode();
    if (state.selectedId && !selected) app.appendChild(el('p', { className: 'notice error', text: 'That presentation is not available in this release. You can browse the current constellation below.' }));
    var items = results(); app.appendChild(el('p', { className: 'result-summary', text: items.length + ' presentation' + (items.length === 1 ? '' : 's') + ' shown' + (state.selectedTheme !== null ? ' in the selected theme' : '') + '.', attrs: { role: 'status', 'aria-atomic': 'true' } }));
    var layout = el('div', { className: 'layout' }), mapAvailable = state.view === 'map' && modeHasMap(), primary = mapAvailable ? drawMap(items) : el('section', { className: 'content-panel' });
    // A selected profile is the primary reading task in List view. Give it room
    // without changing the balanced map/profile layout.
    if (selected && !mapAvailable) layout.classList.add('layout-with-profile');
    if (!mapAvailable) primary.appendChild(buildList(items)); layout.append(primary, selected ? buildProfile(selected) : buildThemes()); app.appendChild(layout);
    if (state.view === 'map' && !modeHasMap()) app.appendChild(el('p', { className: 'notice', text: 'This release has no map coordinates, so List view is shown.' }));
    restoreFocus(focusTarget);
  }
  function showFailure() { app.replaceChildren(el('p', { className: 'notice error', text: 'Constellation data is unavailable right now. Please reconnect and try again; this page does not keep a saved copy of constellation data.' })); }
  async function start() {
    app = document.getElementById('constellation-app'); readUrl();
    try {
      var response = await fetch(DATA_URL, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } }); if (!response.ok) throw new Error('data request failed');
      var parsed = await response.json(); if (!parsed || parsed.schema_version !== 2 || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.recommendations)) throw new Error('unsupported constellation format'); data = parsed;
      if (state.view === 'map' && !modeHasMap()) state.view = 'list';
      if (data.mode === 'empty') { app.replaceChildren(el('p', { className: 'notice', text: 'There are no opted-in constellation presentations in this release.' })); return; } render(state.selectedId ? 'profile' : null);
    } catch (error) { console.warn('Constellation unavailable', error); showFailure(); }
  }
  window.addEventListener('popstate', function () { readUrl(); render(state.selectedId ? 'profile' : 'result-or-search'); }); document.addEventListener('DOMContentLoaded', start);
  if ('serviceWorker' in navigator) window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
}());
