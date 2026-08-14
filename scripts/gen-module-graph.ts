/**
 * Generate `docs/module-graph.html` — a self-contained interactive force-directed
 * graph of internal `src/` module imports for PiLore. Nodes are `.ts` files
 * under `src/` (grouped by layer: adapters, core, domains, infrastructure,
 * packs, src), and an edge `a -> b` means file `a` imports file `b`. Only ESM
 * relative imports that resolve inside `src/` become edges; external packages
 * (`@earendil-works/*`, Node builtins, `pg`, ...) are excluded. The page opens
 * directly in a browser: the graph data is inlined as JSON and the
 * `force-graph` library loads from a pinned CDN. `--check` verifies the
 * committed artifact is fresh.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const srcRoot = join(root, 'src')
const OUT = 'docs/module-graph.html'
const REPOSITORY_URL = 'https://github.com/jdhnsu/PiloreAi'

/** Pinned `force-graph` UMD release; bump deliberately and re-run the generator. */
const FORCE_GRAPH_VERSION = '1.43.4'

/** Current git branch, for GitHub blob links; falls back to `main`. */
function defaultBranch(): string {
  try {
    const head = readFileSync(join(root, '.git', 'HEAD'), 'utf8').trim()
    const ref = head.match(/^ref:\s*refs\/heads\/(.+)$/)?.[1]
    return ref ?? 'main'
  } catch {
    return 'main'
  }
}

const BRANCH = defaultBranch()

interface GraphNode {
  id: string
  name: string
  group: string
  rel: string
}

interface GraphLink {
  source: string
  target: string
}

interface GraphData {
  groups: string[]
  nodes: GraphNode[]
  links: GraphLink[]
}

/** Every `.ts` file under `dir`, excluding `.d.ts`, sorted. */
function walkTs(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkTs(abs))
    else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(abs)
  }
  return out
}

/** Import/export module specifiers in one source file, deduped, in first-seen order. */
function importSpecifiers(source: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const regexes = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const re of regexes) {
    for (const match of source.matchAll(re)) {
      const spec = match[1]
      if (spec === undefined || seen.has(spec)) continue
      seen.add(spec)
      out.push(spec)
    }
  }
  return out
}

/**
 * Resolve a relative ESM specifier to a file under `src/`, or null when the
 * specifier is external or does not resolve to an existing source file.
 */
function resolveTarget(file: string, spec: string): string | null {
  if (!spec.startsWith('./') && !spec.startsWith('../')) return null
  const base = resolve(dirname(file), spec)
  const candidates: string[] = [base]
  if (base.endsWith('.js')) {
    candidates.unshift(`${base.slice(0, -3)}.ts`)
  } else if (extname(base) === '') {
    candidates.push(`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'))
  }
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile() && candidate.startsWith(`${srcRoot}${sep}`)) {
      return candidate
    }
  }
  return null
}

/** src-relative id: path with `/` separators and the extension stripped. */
function fileId(file: string): string {
  const rel = relative(srcRoot, file).split(sep).join('/')
  return rel.replace(/\.(ts|tsx)$/, '')
}

/** First path segment under src/ is the layer; files directly in src/ are `src`. */
function fileGroup(file: string): string {
  const segments = relative(srcRoot, file).split(sep)
  return segments.length > 1 ? (segments[0] ?? 'src') : 'src'
}

/** Derive the graph payload from src/ (pure, deterministic). */
function collectGraph(): GraphData {
  const nodes: GraphNode[] = []
  const links: GraphLink[] = []
  const linkKeys = new Set<string>()
  const unresolvedDetails: string[] = []
  for (const file of walkTs(srcRoot).sort()) {
    const id = fileId(file)
    nodes.push({ id, name: id, group: fileGroup(file), rel: `${id}.ts` })
    const content = readFileSync(file, 'utf8')
    for (const spec of importSpecifiers(content)) {
      if (!spec.startsWith('./') && !spec.startsWith('../')) continue
      const target = resolveTarget(file, spec)
      if (target === null) {
        unresolvedDetails.push(`${relative(root, file).split(sep).join('/')} -> ${spec}`)
        continue
      }
      const targetId = fileId(target)
      if (targetId === id) continue
      const key = `${id}|${targetId}`
      if (linkKeys.has(key)) continue
      linkKeys.add(key)
      links.push({ source: id, target: targetId })
    }
  }
  const groups = [...new Set(nodes.map(node => node.group))].sort()
  if (unresolvedDetails.length > 0) {
    console.warn(`gen-module-graph: ${unresolvedDetails.length} relative import(s) did not resolve inside src/:`)
    for (const detail of unresolvedDetails) console.warn(`  ${detail}`)
  }
  return { groups, nodes, links }
}

/** Render the full self-contained page (pure, deterministic). */
function renderHtml(data: GraphData): string {
  const json = JSON.stringify(data)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>PiLore · module dependency graph</title>
<style>
:root { --bg:#0b0e14; --bar:#10141d; --panel:#12161f; --border:#232a36; --text:#e6e9ef; --muted:#8a93a5; --accent:#ffd166; }
* { box-sizing: border-box; }
html, body { margin:0; height:100%; background:var(--bg); color:var(--text); overflow:hidden; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif; }
#stage { position:fixed; inset:0; z-index:0; }
a { color:#7fb4ff; text-decoration:none; }
a:hover { text-decoration:underline; }
.hidden { display:none !important; }

#bar { position:fixed; top:0; left:0; right:0; height:56px; z-index:5; display:flex; align-items:center; gap:14px; padding:0 16px; background:var(--bar); border-bottom:1px solid var(--border); }
#bar h1 { font-size:15px; font-weight:650; margin:0; letter-spacing:.2px; }
#bar .sub { font-size:12px; color:var(--muted); margin:0; }
#bar .grow { flex:1; }
#search { width:230px; height:32px; padding:0 10px; border:1px solid var(--border); border-radius:6px; background:#0d1119; color:var(--text); font-size:13px; }
#search::placeholder { color:#5c6675; }
button.ctl { height:32px; padding:0 12px; border:1px solid var(--border); border-radius:6px; background:#0d1119; color:var(--text); font-size:13px; cursor:pointer; }
button.ctl:hover { border-color:#39424f; }
#bar .hint { font-size:11px; color:var(--muted); }

#legend { position:fixed; top:70px; left:12px; bottom:12px; width:210px; z-index:4; overflow-y:auto; background:var(--panel); border:1px solid var(--border); border-radius:10px; padding:10px; }
#legend h2 { font-size:11px; text-transform:uppercase; letter-spacing:.8px; color:var(--muted); margin:0 0 8px; }
button.lg { display:flex; align-items:center; gap:8px; width:100%; padding:5px 6px; border:0; border-radius:6px; background:transparent; color:var(--text); font-size:12px; cursor:pointer; text-align:left; }
button.lg:hover { background:#1a2030; }
button.lg.active { background:#23304a; }
.swatch { display:inline-block; width:10px; height:10px; border-radius:3px; flex:0 0 auto; }
.lg-name { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.lg-count { color:var(--muted); font-size:11px; }

#panel { position:fixed; top:70px; right:12px; bottom:12px; width:330px; z-index:4; overflow-y:auto; background:var(--panel); border:1px solid var(--border); border-radius:10px; padding:16px; }
#panel h2 { font-size:18px; margin:0 0 2px; color:var(--accent); }
#panel .p-name { font-size:12px; color:var(--muted); margin-bottom:10px; word-break:break-all; }
#panel .p-row { font-size:12px; margin-bottom:10px; display:flex; align-items:center; gap:7px; }
#panel .p-links { font-size:12px; margin-bottom:4px; }
#panel h3 { font-size:11px; text-transform:uppercase; letter-spacing:.8px; color:var(--muted); margin:14px 0 7px; }
.p-chips { display:flex; flex-wrap:wrap; gap:6px; }
button.chip { padding:4px 8px; border:1px solid var(--border); border-radius:6px; background:#0d1119; color:var(--text); font-size:11px; cursor:pointer; }
button.chip:hover { border-color:var(--accent); color:var(--accent); }
.muted { color:var(--muted); font-size:12px; }
.p-close { position:absolute; top:8px; right:12px; font-size:20px; line-height:1; color:var(--muted); cursor:pointer; padding:2px 6px; }
.p-close:hover { color:var(--text); }

#tooltip { position:fixed; z-index:6; max-width:280px; padding:9px 11px; background:#1a2130; border:1px solid var(--border); border-radius:8px; pointer-events:none; font-size:12px; box-shadow:0 6px 20px rgba(0,0,0,.4); }
.tt-name { font-weight:650; color:var(--accent); font-size:13px; }
.tt-group { display:flex; align-items:center; gap:6px; color:var(--muted); margin:3px 0; }
.tt-stats { color:var(--muted); }

#error { position:fixed; inset:0; z-index:10; display:flex; align-items:center; justify-content:center; background:var(--bg); color:var(--text); font-size:14px; text-align:center; padding:30px; }
</style>
</head>
<body>
<div id="stage"></div>

<header id="bar">
  <h1>PiLore — module dependency graph</h1>
  <p class="sub">edge a&nbsp;→&nbsp;b means file <em>a</em> imports file <em>b</em> (src/**/*.ts, ESM relative imports)</p>
  <span class="grow"></span>
  <input id="search" type="search" placeholder="Search module… (Enter to focus, Esc to clear)" autocomplete="off">
  <button class="ctl" id="reset">Reset view</button>
  <span class="hint">drag to pan · scroll to zoom · drag a node to pin · click a node for details</span>
</header>

<div id="legend"><h2>Layers</h2><div id="legend-list"></div></div>
<div id="panel" class="hidden"></div>
<div id="tooltip" class="hidden"></div>
<div id="error" class="hidden"></div>

<script>
var GRAPH_DATA = ${json};

var stageEl = document.getElementById('stage');
var tooltipEl = document.getElementById('tooltip');
var searchEl = document.getElementById('search');
var legendListEl = document.getElementById('legend-list');
var panelEl = document.getElementById('panel');
var errorEl = document.getElementById('error');

var nodeById = new Map(GRAPH_DATA.nodes.map(function (n) { return [n.id, n]; }));
var outDegree = new Map();
var inDegree = new Map();
GRAPH_DATA.nodes.forEach(function (n) { outDegree.set(n.id, 0); inDegree.set(n.id, 0); });
GRAPH_DATA.links.forEach(function (l) {
  outDegree.set(l.source, (outDegree.get(l.source) || 0) + 1);
  inDegree.set(l.target, (inDegree.get(l.target) || 0) + 1);
});

var colorByGroup = new Map();
GRAPH_DATA.groups.forEach(function (g, i) {
  colorByGroup.set(g, 'hsl(' + Math.round(i * 360 / GRAPH_DATA.groups.length) + ', 55%, 62%)');
});
function colorFor(group) { return colorByGroup.get(group) || '#8a93a5'; }
// force-graph resolves link source/target ids into node objects; normalize back to ids.
function linkEndId(end) { return typeof end === 'object' && end !== null ? end.id : end; }
function linkKey(l) { return linkEndId(l.source) + '|' + linkEndId(l.target); }

// View state: legend layer focus, search query, hover/selection neighborhood.
var focusedGroups = new Set();
var query = '';
var hoverId = null;
var selectedId = null;
var neighborNodes = new Set();
var neighborLinks = new Set();

var mouseX = 0;
var mouseY = 0;

function matchesQuery(n) {
  return query === '' || n.id.indexOf(query) !== -1 || n.name.indexOf(query) !== -1;
}
function visible(n) {
  if (focusedGroups.size && !focusedGroups.has(n.group)) return false;
  return matchesQuery(n);
}
function nodeColor(n) {
  if (n.id === selectedId) return '#ffd166';
  if (neighborNodes.size && !neighborNodes.has(n.id)) return 'rgba(122,128,142,0.15)';
  if (!visible(n)) return 'rgba(122,128,142,0.06)';
  return colorFor(n.group);
}
function linkColor(l) {
  return neighborLinks.has(linkKey(l)) ? 'rgba(255,209,102,0.75)' : 'rgba(150,160,180,0.16)';
}
function linkWidth(l) { return neighborLinks.has(linkKey(l)) ? 1.8 : 0.6; }
function linkParticles(l) { return neighborLinks.has(linkKey(l)) ? 2 : 0; }

function recomputeNeighbors() {
  neighborNodes.clear();
  neighborLinks.clear();
  var centerId = hoverId || selectedId;
  if (!centerId) return;
  neighborNodes.add(centerId);
  GRAPH_DATA.links.forEach(function (l) {
    if (l.source === centerId || l.target === centerId) {
      neighborLinks.add(linkKey(l));
      neighborNodes.add(l.source);
      neighborNodes.add(l.target);
    }
  });
}

var graph = null;
function repaint() {
  if (!graph) return;
  graph.nodeColor(graph.nodeColor());
  graph.linkColor(graph.linkColor());
  graph.linkWidth(graph.linkWidth());
  graph.linkDirectionalParticles(graph.linkDirectionalParticles());
}

function positionTooltip() {
  var w = tooltipEl.offsetWidth;
  var h = tooltipEl.offsetHeight;
  var x = mouseX + 14;
  var y = mouseY + 14;
  if (x + w > window.innerWidth - 8) x = mouseX - w - 14;
  if (y + h > window.innerHeight - 8) y = mouseY - h - 14;
  tooltipEl.style.left = x + 'px';
  tooltipEl.style.top = y + 'px';
}
function updateTooltip(node) {
  if (!node) { tooltipEl.classList.add('hidden'); return; }
  tooltipEl.innerHTML =
    '<div class="tt-name">' + node.id + '</div>' +
    '<div class="tt-group"><span class="swatch" style="background:' + colorFor(node.group) + '"></span>' + node.group + '</div>' +
    '<div class="tt-stats">imports ' + outDegree.get(node.id) + ' · imported by ' + inDegree.get(node.id) + '</div>';
  tooltipEl.classList.remove('hidden');
  positionTooltip();
}

function chip(id) {
  return '<button class="chip" data-focus="' + id + '">' + id + '</button>';
}
function renderPanel() {
  if (!selectedId) { panelEl.classList.add('hidden'); return; }
  var n = nodeById.get(selectedId);
  var deps = GRAPH_DATA.links.filter(function (l) { return l.source === n.id; }).map(function (l) { return l.target; }).sort();
  var dependents = GRAPH_DATA.links.filter(function (l) { return l.target === n.id; }).map(function (l) { return l.source; }).sort();
  panelEl.innerHTML =
    '<div class="p-close" title="Close">×</div>' +
    '<h2>' + n.id + '</h2>' +
    '<div class="p-name">src/' + n.rel + '</div>' +
    '<div class="p-row"><span class="swatch" style="background:' + colorFor(n.group) + '"></span>' + n.group + '</div>' +
    '<div class="p-links"><a href="${REPOSITORY_URL}/blob/${BRANCH}/src/' + n.rel + '" target="_blank" rel="noopener">view on GitHub ↗</a> · ' +
    '<a href="../src/' + n.rel + '" target="_blank" rel="noopener">local file</a></div>' +
    '<h3>Imports (' + deps.length + ')</h3>' +
    '<div class="p-chips">' + (deps.length ? deps.map(chip).join('') : '<span class="muted">—</span>') + '</div>' +
    '<h3>Imported by (' + dependents.length + ')</h3>' +
    '<div class="p-chips">' + (dependents.length ? dependents.map(chip).join('') : '<span class="muted">—</span>') + '</div>';
  panelEl.classList.remove('hidden');
}

function selectNode(node) {
  selectedId = node ? node.id : null;
  recomputeNeighbors();
  repaint();
  renderPanel();
}
function focusNode(id) {
  selectedId = id;
  hoverId = null;
  recomputeNeighbors();
  repaint();
  renderPanel();
  var n = nodeById.get(id);
  if (n && typeof n.x === 'number') {
    graph.centerAt(n.x, n.y, 600);
    graph.zoom(2.2, 600);
  }
}

function renderLegend() {
  var html = '';
  GRAPH_DATA.groups.forEach(function (g) {
    var count = GRAPH_DATA.nodes.filter(function (n) { return n.group === g; }).length;
    html += '<button class="lg" data-group="' + g + '">' +
      '<span class="swatch" style="background:' + colorFor(g) + '"></span>' +
      '<span class="lg-name">' + g + '</span>' +
      '<span class="lg-count">' + count + '</span></button>';
  });
  legendListEl.innerHTML = html;
  legendListEl.querySelectorAll('.lg').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var g = btn.getAttribute('data-group');
      if (focusedGroups.has(g)) focusedGroups.delete(g); else focusedGroups.add(g);
      btn.classList.toggle('active', focusedGroups.has(g));
      repaint();
    });
  });
}

function resetView() {
  focusedGroups.clear();
  query = '';
  searchEl.value = '';
  selectedId = null;
  hoverId = null;
  recomputeNeighbors();
  repaint();
  renderPanel();
  legendListEl.querySelectorAll('.lg').forEach(function (b) { b.classList.remove('active'); });
  graph.zoomToFit(600, 80);
}

function init() {
  // Hand force-graph its own link records so it can resolve ids into node
  // references without mutating GRAPH_DATA.links (which stays id-based).
  var linksForGraph = GRAPH_DATA.links.map(function (l) { return { source: l.source, target: l.target }; });
  graph = ForceGraph()(stageEl)
    .graphData({ nodes: GRAPH_DATA.nodes, links: linksForGraph })
    .nodeId('id')
    .nodeVal(function (n) { return Math.max(2, (outDegree.get(n.id) || 0) + (inDegree.get(n.id) || 0)); })
    .nodeColor(nodeColor)
    .linkColor(linkColor)
    .linkWidth(linkWidth)
    .linkDirectionalArrowLength(4)
    .linkDirectionalArrowRelPos(1)
    .linkDirectionalParticles(linkParticles)
    .linkDirectionalParticleWidth(1.3)
    .onNodeHover(function (node) {
      hoverId = node ? node.id : null;
      recomputeNeighbors();
      repaint();
      updateTooltip(node);
    })
    .onNodeClick(selectNode)
    .onBackgroundClick(function () { selectNode(null); })
    .onNodeDragEnd(function (n) { n.fx = n.x; n.fy = n.y; });
  graph.d3Force('charge').strength(-110);
  graph.d3Force('link').distance(42);

  function size() { graph.width(window.innerWidth).height(window.innerHeight); }
  window.addEventListener('resize', size);
  size();

  stageEl.addEventListener('mousemove', function (e) {
    mouseX = e.clientX;
    mouseY = e.clientY;
    if (!tooltipEl.classList.contains('hidden')) positionTooltip();
  });

  panelEl.addEventListener('click', function (e) {
    var target = e.target;
    if (!target || typeof target.closest !== 'function') return;
    var chipEl = target.closest('[data-focus]');
    if (chipEl) { focusNode(chipEl.getAttribute('data-focus')); return; }
    if (target.closest('.p-close')) selectNode(null);
  });

  searchEl.addEventListener('input', function () {
    query = searchEl.value.trim().toLowerCase();
    repaint();
  });
  searchEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      var m = GRAPH_DATA.nodes.find(function (n) { return matchesQuery(n); });
      if (m) focusNode(m.id);
    } else if (e.key === 'Escape') {
      resetView();
    }
  });
  document.getElementById('reset').addEventListener('click', resetView);

  renderLegend();
}

function loadFailed() {
  errorEl.innerHTML = 'The <code>force-graph</code> library failed to load from the CDN.<br>' +
    'Check your internet connection and reload, or fetch it manually and serve it beside this page.';
  errorEl.classList.remove('hidden');
}

(function loadLibrary() {
  var urls = [
    'https://cdn.jsdelivr.net/npm/force-graph@${FORCE_GRAPH_VERSION}/dist/force-graph.min.js',
    'https://unpkg.com/force-graph@${FORCE_GRAPH_VERSION}/dist/force-graph.min.js',
  ];
  var i = 0;
  function next() {
    if (typeof ForceGraph !== 'undefined') { init(); return; }
    if (i >= urls.length) { loadFailed(); return; }
    var s = document.createElement('script');
    s.src = urls[i++];
    s.onload = next;
    s.onerror = next;
    document.head.appendChild(s);
  }
  next();
})();
</script>
</body>
</html>
`
}

const data = collectGraph()
const content = renderHtml(data)

if (process.argv.includes('--check')) {
  let committed: string | null = null
  try {
    committed = readFileSync(join(root, OUT), 'utf8')
  } catch {
    committed = null
  }
  if (committed === content) {
    console.log(`gen-module-graph: ${OUT} is up to date.`)
    process.exit(0)
  }
  console.error(`gen-module-graph: ${OUT} is stale. Run \`npm run gen:module-graph\` and commit ${OUT}.`)
  if (committed !== null) {
    let i = 0
    while (i < content.length && i < committed.length && content[i] === committed[i]) i += 1
    console.error(`  first difference at char ${i}:`)
    console.error(`  on disk:   ${JSON.stringify(committed.slice(i, i + 60))}`)
    console.error(`  generated: ${JSON.stringify(content.slice(i, i + 60))}`)
  }
  process.exit(1)
}

writeFileSync(join(root, OUT), content)
console.log(`gen-module-graph: wrote ${OUT} (${data.nodes.length} nodes, ${data.links.length} links).`)
