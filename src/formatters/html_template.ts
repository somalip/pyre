export function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Pyre</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet"/>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg: #000000;
  --bg1: #0a0a0a;
  --bg2: #141414;
  --bg3: rgba(255,255,255,0.05);
  --border: #333333;
  --border2: #444444;
  --text: #ffffff;
  --text2: #aaaaaa;
  --text3: #666666;
  --accent: #ffffff;
  --accent2: #dddddd;
  --cyan: #ffffff;
  --green: #ffffff;
  --yellow: #bbbbbb;
  --red: #dddddd;
  --orange: #cccccc;
  --purple: #eeeeee;
  --glow: rgba(255,255,255,0.15);
  --font: 'Inter', -apple-system, sans-serif;
  --mono: 'JetBrains Mono', ui-monospace, monospace;
}
html,body{height:100%;overflow:hidden;background:var(--bg);color:var(--text);font-family:var(--font);font-size:12px;}
body {
  background-image: radial-gradient(var(--bg3) 1px, transparent 1px);
  background-size: 20px 20px;
  display:flex;flex-direction:column;height:100vh;
}

#titlebar{
  height:42px;min-height:42px;-webkit-app-region:drag;
  display:flex;align-items:center;padding:0 16px;
  border-bottom:1px solid var(--border);
  background:rgba(5,5,8,0.8);backdrop-filter:blur(10px);
  z-index:100;
}
#titlebar-logo{
  font-family:var(--mono);font-size:14px;font-weight:700;
  color:var(--cyan);margin-right:24px;text-transform:uppercase;
  letter-spacing:0.1em;
}
#titlebar-host{font-family:var(--mono);font-size:11px;color:var(--text2);flex:1;}
#conn-badge{display:flex;align-items:center;gap:6px;font-size:11px;font-family:var(--mono);color:var(--text2);-webkit-app-region:no-drag;}
.conn-dot{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 8px var(--green);animation:pulse 2s infinite;}
.conn-dot.offline{background:var(--red);box-shadow:0 0 8px var(--red);animation:none;}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}

#tabbar{
  display:flex;align-items:center;gap:4px;padding:6px 14px 0;
  border-bottom:1px solid var(--border);
  background:rgba(10,12,22,0.8);overflow-x:auto;-webkit-app-region:no-drag;
}
#tabbar::-webkit-scrollbar{display:none}
.tab{
  padding:8px 16px;font-size:11px;font-family:var(--mono);color:var(--text3);
  cursor:pointer;white-space:nowrap;user-select:none;
  border-bottom:2px solid transparent;transition:all 0.2s;
  text-transform:uppercase;font-weight:600;
}
.tab:hover{color:var(--text2);background:var(--bg3);}
.tab.active{color:var(--accent);border-bottom:2px solid var(--accent);background:linear-gradient(0deg, rgba(255,255,255,0.1), transparent);}
.tab-key{opacity:0.5;margin-right:6px;}

#main{flex:1;overflow-y:auto;overflow-x:hidden;padding:16px;display:flex;flex-direction:column;}
#main::-webkit-scrollbar{width:8px}
#main::-webkit-scrollbar-thumb{background:var(--border);border-radius:4px}

#statusbar{
  height:28px;min-height:28px;display:flex;align-items:center;padding:0 16px;gap:20px;
  font-size:10px;color:var(--text3);border-top:1px solid var(--border);
  background:var(--bg);font-family:var(--mono);
}
.sb-item{display:flex;align-items:center;gap:6px;}
.sb-sep{color:var(--border);}
.up-val{color:var(--text);}

/* btop cards */
.card{
  background:var(--bg1);
  border:1px solid var(--border);
  border-radius:6px;
  padding:16px;
  position:relative;
  margin-top:12px;
  transition:border-color 0.2s, box-shadow 0.2s;
  display:flex;flex-direction:column;
}
.card:hover{border-color:var(--cyan);box-shadow:0 0 10px rgba(255,255,255,0.05);}
.card-title{
  position:absolute;top:-9px;left:12px;
  background:var(--bg);
  padding:0 8px;font-size:11px;font-family:var(--mono);font-weight:700;
  color:var(--accent);text-transform:uppercase;
  display:flex;align-items:center;gap:6px;
}
.card-title::before{content:"";display:block;width:6px;height:6px;border-radius:50%;background:var(--accent);box-shadow:0 0 5px var(--accent);}

/* Grid System */
.grid-2x2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; flex:1; }
.panel-row { display:flex; gap:12px; margin-bottom:12px; }
.panel-col { display:flex; flex-direction:column; gap:12px; flex:1; }
.detail-split { display:flex; gap:16px; height:100%; }
.detail-left { flex:6; display:flex; flex-direction:column; gap:12px; }
.detail-right { flex:4; display:flex; flex-direction:column; gap:12px; }
.detail-full { display:flex; flex-direction:column; gap:12px; height:100%; }

/* Stats */
.stat{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dashed var(--border);}
.stat:last-child{border-bottom:none;}
.stat-label{font-size:11px;color:var(--text2);}
.stat-val{font-family:var(--mono);font-size:12px;color:var(--text);font-weight:500;}
.big-metric{text-align:center;padding:20px 0;}
.big-val{font-family:var(--mono);font-size:48px;font-weight:700;color:var(--cyan);text-shadow:0 0 15px rgba(255,255,255,0.3);}
.big-unit{font-family:var(--mono);font-size:14px;color:var(--text2);margin-top:8px;}

/* Gauges */
.gauge-wrap{margin:8px 0;}
.gauge-header{display:flex;justify-content:space-between;margin-bottom:6px;font-size:11px;font-family:var(--mono);}
.gauge-pct{font-weight:600;}
.gauge-track{height:20px;background:var(--bg2);border-radius:4px;overflow:hidden;position:relative;border:1px solid var(--border);}
.gauge-fill{height:100%;transition:width 0.4s ease;display:flex;align-items:center;justify-content:flex-end;padding-right:6px;font-family:var(--mono);font-size:10px;font-weight:700;color:#000;}
.gauge-fill.ok{background:linear-gradient(90deg,var(--text),#999);}
.gauge-fill.warn{background:linear-gradient(90deg,var(--text2),#666);}
.gauge-fill.crit{background:linear-gradient(90deg,var(--text3),#333);}

/* SVG Rings */
.ring-container { display:flex; justify-content:space-around; padding:20px 0; background:var(--bg1); border:1px solid var(--border); border-radius:6px; margin-bottom:12px; }
.ring-box { display:flex; flex-direction:column; align-items:center; gap:10px; }
.ring-title { font-family:var(--mono); font-size:11px; color:var(--text2); font-weight:700; text-transform:uppercase; }
.svg-ring { position:relative; width:100px; height:100px; }
.svg-ring.large { width:200px; height:200px; }
.svg-ring svg { transform:rotate(-90deg); width:100%; height:100%; }
.ring-center { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; }
.ring-val { font-family:var(--mono); font-size:22px; font-weight:700; }
.svg-ring.large .ring-val { font-size:42px; }

/* Sparklines */
.spark-wrap { flex:1; min-height:80px; display:flex; flex-direction:column; margin-top:8px; }
.spark-label { font-family:var(--mono); font-size:10px; color:var(--text3); margin-bottom:4px; }
canvas.spark { width:100%; height:80px; display:block; border-radius:4px; background:var(--bg2); border:1px solid var(--border); }
canvas.spark.large { height:200px; }

/* Core Grid */
.core-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(30px, 1fr)); gap:6px; margin-top:12px; }
.core-col { display:flex; flex-direction:column; gap:4px; align-items:center; }
.core-bar { width:100%; height:100px; background:var(--bg2); border-radius:4px; display:flex; align-items:flex-end; overflow:hidden; border:1px solid var(--border); }
.core-fill { width:100%; transition:height 0.3s; }
.core-fill.ok { background:linear-gradient(0deg,var(--text),#999); }
.core-fill.warn { background:linear-gradient(0deg,var(--text2),#666); }
.core-fill.crit { background:linear-gradient(0deg,var(--text3),#333); }
.core-lbl { font-family:var(--mono); font-size:9px; color:var(--text2); }

/* Table */
.table-wrap { flex:1; overflow-y:auto; border:1px solid var(--border); border-radius:6px; background:var(--bg1); }
table.proc { width:100%; border-collapse:collapse; font-family:var(--mono); font-size:11px; text-align:left; }
table.proc thead th { position:sticky; top:0; background:var(--bg2); padding:8px 12px; color:var(--accent); font-weight:700; text-transform:uppercase; border-bottom:1px solid var(--border); cursor:pointer; user-select:none; z-index:10; }
table.proc thead th:hover { color:var(--cyan); background:var(--border); }
table.proc tbody tr { border-bottom:1px solid var(--border); cursor:default; }
table.proc tbody tr:nth-child(even) { background:rgba(255,255,255,0.01); }
table.proc tbody tr:hover { background:var(--bg2); }
table.proc td { padding:6px 12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:250px; }
.proc-cmd { color:var(--text); }
.table-wrap::-webkit-scrollbar { width:8px; }
.table-wrap::-webkit-scrollbar-thumb { background:var(--border); }

/* Helpers */
.flex-row { display:flex; gap:12px; }
.flex-1 { flex:1; }
.mb-12 { margin-bottom:12px; }
.txt-green { color:var(--green); }
.txt-yellow { color:var(--yellow); }
.txt-red { color:var(--red); }
.txt-cyan { color:var(--cyan); }
.txt-purple { color:var(--purple); }

/* Chips */
.chips { display:flex; flex-wrap:wrap; gap:8px; margin-top:8px; }
.chip { padding:6px 12px; border-radius:4px; font-family:var(--mono); font-size:11px; border:1px solid var(--border); background:var(--bg2); }
.chip.ok { border-color:var(--green); color:var(--green); }
.chip.warn { border-color:var(--yellow); color:var(--yellow); }
.chip.crit { border-color:var(--red); color:var(--red); }

.anomaly { display:flex; gap:12px; padding:12px; border:1px solid var(--red); background:rgba(255,255,255,0.1); border-radius:6px; margin-bottom:12px; }
.anomaly-icon { font-size:20px; }
.anomaly-title { font-family:var(--mono); font-weight:700; color:var(--red); font-size:12px; }
.anomaly-desc { font-family:var(--mono); font-size:11px; color:var(--text); margin-top:4px; }

.view { display:none; height:100%; flex-direction:column; }
.view.active { display:flex; }
#view-content { flex:1; display:flex; flex-direction:column; animation:fadeIn 0.2s ease; height:100%; }
@keyframes fadeIn{from{opacity:0;}to{opacity:1;}}

</style>
</head>
<body>
<div id="titlebar">
  <span id="titlebar-logo">Pyre</span>
  <span id="titlebar-host">Loading...</span>
  <div id="conn-badge"><div class="conn-dot" id="conn-dot"></div><span id="conn-text">Connecting</span></div>
</div>
<div id="tabbar">
  <div class="tab active" data-view="overview" onclick="switchView('overview')"><span class="tab-key">1</span>Overview</div>
  <div class="tab" data-view="cpu" onclick="switchView('cpu')"><span class="tab-key">2</span>CPU</div>
  <div class="tab" data-view="memory" onclick="switchView('memory')"><span class="tab-key">3</span>Memory</div>
  <div class="tab" data-view="gpu" onclick="switchView('gpu')"><span class="tab-key">4</span>GPU</div>
  <div class="tab" data-view="power" onclick="switchView('power')"><span class="tab-key">5</span>Power</div>
  <div class="tab" data-view="battery" onclick="switchView('battery')"><span class="tab-key">6</span>Battery</div>
  <div class="tab" data-view="thermal" onclick="switchView('thermal')"><span class="tab-key">7</span>Thermal</div>
  <div class="tab" data-view="network" onclick="switchView('network')"><span class="tab-key">8</span>Network</div>
  <div class="tab" data-view="disk" onclick="switchView('disk')"><span class="tab-key">9</span>Disk</div>
  <div class="tab" data-view="processes" onclick="switchView('processes')"><span class="tab-key">P</span>Processes</div>
  <div class="tab" data-view="anomalies" onclick="switchView('anomalies')"><span class="tab-key">A</span>Anomalies</div>
</div>
<div id="main">
  <div id="view-content"></div>
</div>
<div id="statusbar">
  <div class="sb-item">⟳ <span id="sb-refresh" class="up-val">–</span></div><div class="sb-sep">│</div>
  <div class="sb-item">↑ <span id="sb-uptime" class="up-val">–</span></div><div class="sb-sep">│</div>
  <div class="sb-item">CPU <span id="sb-cpu" class="up-val">–</span></div><div class="sb-sep">│</div>
  <div class="sb-item">MEM <span id="sb-mem" class="up-val">–</span></div><div class="sb-sep">│</div>
  <div class="sb-item">BATT <span id="sb-batt" class="up-val">–</span></div><div class="sb-sep">│</div>
  <div class="sb-item">PROCS <span id="sb-procs" class="up-val">–</span></div>
</div>
<script>
let currentView = 'overview';
let latestData = null;
const history = { cpu:[], mem:[], temp:[], rxRate:[], txRate:[], power:[] };
const MAX_HIST = 100;
let procSort = { col:'cpu', dir:'desc' };

function pushHist(arr, val) { arr.push(val||0); if(arr.length>MAX_HIST)arr.shift(); }
function fmtBytes(b, dec=2) {
  if(!b) return '0 B';
  const k=1024, s=['B','KB','MB','GB','TB'];
  const i=Math.floor(Math.log(Math.abs(b))/Math.log(k));
  return parseFloat((b/Math.pow(k,i)).toFixed(dec))+' '+s[i];
}
function statusCls(v) { return v>85?'crit':v>65?'warn':'ok'; }
function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function svgRing(val, max, label, unit='', size=100) {
  const r = size*0.4, circ = 2*Math.PI*r;
  const pct = Math.min(100, Math.max(0, (val/max)*100));
  const off = circ*(1 - pct/100);
  const cls = statusCls(pct);
  const col = cls==='crit'?'var(--text3)':cls==='warn'?'var(--text2)':'var(--text)';
  return \`<div class="ring-box">
    <div class="ring-title">\${label}</div>
    <div class="svg-ring \${size>150?'large':''}">
      <svg viewBox="0 0 \${size} \${size}">
        <circle cx="\${size/2}" cy="\${size/2}" r="\${r}" fill="none" stroke="var(--border)" stroke-width="\${size*0.08}"/>
        <circle cx="\${size/2}" cy="\${size/2}" r="\${r}" fill="none" stroke="\${col}" stroke-width="\${size*0.08}"
          stroke-dasharray="\${circ}" stroke-dashoffset="\${off}" stroke-linecap="round"
          style="transition:stroke-dashoffset 0.5s ease" />
      </svg>
      <div class="ring-center">
        <div class="ring-val" style="color:\${col}">\${val.toFixed(1)}\${unit}</div>
      </div>
    </div>
  </div>\`;
}

function drawSpark(id, arr, col1, col2, mx) {
  const c = document.getElementById(id);
  if(!c || !arr.length) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = c.getBoundingClientRect();
  c.width = rect.width * dpr;
  c.height = rect.height * dpr;
  const W = c.width, H = c.height;
  const ctx = c.getContext('2d');
  ctx.clearRect(0,0,W,H);
  
  // Grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1 * dpr;
  [0.25, 0.5, 0.75].forEach(y => {
    ctx.beginPath(); ctx.moveTo(0, H*y); ctx.lineTo(W, H*y); ctx.stroke();
  });

  const m = mx || Math.max(...arr, 1);
  const pts = arr.map((v,i) => [i/(arr.length-1||1)*W, H - (v/m)*H]);
  
  const grad = ctx.createLinearGradient(0,0,W,0);
  grad.addColorStop(0, col1); grad.addColorStop(1, col2);
  const aGrad = ctx.createLinearGradient(0,0,0,H);
  aGrad.addColorStop(0, col2+'66'); aGrad.addColorStop(1, 'transparent');

  ctx.beginPath(); ctx.moveTo(pts[0][0], H);
  pts.forEach(p=>ctx.lineTo(p[0],p[1])); ctx.lineTo(pts[pts.length-1][0], H);
  ctx.fillStyle = aGrad; ctx.fill();

  ctx.beginPath(); pts.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));
  ctx.strokeStyle = grad; ctx.lineWidth = 2 * dpr; ctx.stroke();
}

function gaugeHtml(lbl, pct, valStr='') {
  const cls = statusCls(pct);
  return \`<div class="gauge-wrap">
    <div class="gauge-header"><span>\${lbl}</span><span class="txt-\${cls==='crit'?'red':cls==='warn'?'yellow':'green'}">\${pct.toFixed(1)}%</span></div>
    <div class="gauge-track"><div class="gauge-fill \${cls}" style="width:\${pct}%">\${valStr}</div></div>
  </div>\`;
}

function statRow(k,v) { return \`<div class="stat"><div class="stat-label">\${k}</div><div class="stat-val">\${escapeHtml(v)}</div></div>\`; }
function card(title, content, cls='') { return \`<div class="card \${cls}"><div class="card-title">\${title}</div>\${content}</div>\`; }

function renderOverview(d) {
  const cpu = d.cpu.usage;
  const mem = d.memory.usagePercent;
  const temp = d.cpu.temperature ?? d.thermal.temperatures?.cpu_die ?? 0;
  const batt = d.battery?.level ?? 0;

  const rings = \`<div class="ring-container">
    \${svgRing(cpu, 100, 'CPU', '%')}
    \${svgRing(mem, 100, 'MEM', '%')}
    \${svgRing(temp, 100, 'TEMP', '°')}
    \${d.battery ? svgRing(batt, 100, 'BATT', '%') : ''}
  </div>\`;

  const topProcs = (d.processes||[]).slice(0,8).map(p=>\`<tr>
    <td>\${p.pid}</td>
    <td class="proc-cmd" title="\${escapeHtml(p.command)}">\${escapeHtml(p.command)}</td>
    <td>\${escapeHtml(p.user)}</td>
    <td class="txt-\${statusCls(p.cpu)}">\${p.cpu.toFixed(1)}</td>
    <td>\${p.mem.toFixed(1)}</td>
  </tr>\`).join('');

  return \`<div class="detail-full">
    \${rings}
    <div class="grid-2x2">
      \${card('CPU', \`
        \${gaugeHtml('Usage', cpu, d.cpu.frequency+' MHz')}
        <div class="spark-wrap"><div class="spark-label">CPU History</div><canvas class="spark" id="sp-ov-cpu"></canvas></div>
      \`)}
      \${card('Memory', \`
        \${gaugeHtml('Usage', mem, fmtBytes(d.memory.used))}
        \${statRow('Total', fmtBytes(d.memory.total))}
        \${statRow('Free', fmtBytes(d.memory.free))}
        \${statRow('Swap', fmtBytes(d.memory.swapUsed)+' / '+fmtBytes(d.memory.swapTotal))}
      \`)}
      \${card('Network', \`
        <div class="flex-row mb-12">
          <div class="flex-1 txt-cyan" style="font-family:var(--mono);font-size:14px;font-weight:700">⬇ \${fmtBytes(d.network.rxBytes)}</div>
          <div class="flex-1 txt-purple" style="font-family:var(--mono);font-size:14px;font-weight:700;text-align:right">⬆ \${fmtBytes(d.network.txBytes)}</div>
        </div>
        <div class="flex-row" style="flex:1">
          <div class="spark-wrap" style="margin:0"><canvas class="spark" id="sp-ov-rx"></canvas></div>
          <div class="spark-wrap" style="margin:0"><canvas class="spark" id="sp-ov-tx"></canvas></div>
        </div>
      \`)}
      \${card('Top Processes', \`
        <div class="table-wrap" style="border:none;background:transparent;overflow:hidden;">
          <table class="proc">
            <thead><tr><th>PID</th><th>Command</th><th>User</th><th>CPU%</th><th>MEM%</th></tr></thead>
            <tbody>\${topProcs}</tbody>
          </table>
        </div>
      \`, 'mb-0')}
    </div>
  </div>\`;
}

function renderCpu(d) {
  let cores = '';
  if(d.cpu.coreUsage) {
    cores = '<div class="core-grid">' + d.cpu.coreUsage.map((u,i) => {
      const p = Math.min(100,u);
      return \`<div class="core-col">
        <div class="core-bar"><div class="core-fill \${statusCls(p)}" style="height:\${p}%"></div></div>
        <div class="core-lbl">C\${i}</div>
      </div>\`;
    }).join('') + '</div>';
  }
  return \`<div class="detail-split">
    <div class="detail-left">
      \${card('CPU Usage', \`
        <div class="spark-wrap" style="flex:none"><canvas class="spark large" id="sp-cpu-l"></canvas></div>
        \${cores}
      \`, 'flex-1')}
    </div>
    <div class="detail-right">
      \${card('Processor Info', \`
        <div class="big-metric"><div class="big-val">\${d.cpu.usage.toFixed(1)}%</div><div class="big-unit">Overall Utilisation</div></div>
        \${statRow('Model', d.cpu.brand)}
        \${statRow('Cores', d.cpu.physicalCores + ' Physical / ' + d.cpu.cores + ' Logical')}
        \${statRow('Clock', d.cpu.frequency + ' MHz')}
        \${statRow('Load 1m', d.cpu.loadAvg[0].toFixed(2))}
        \${statRow('Load 5m', d.cpu.loadAvg[1].toFixed(2))}
        \${statRow('Load 15m', d.cpu.loadAvg[2].toFixed(2))}
      \`, 'flex-1')}
    </div>
  </div>\`;
}

function renderMemory(d) {
  return \`<div class="detail-full">
    \${card('Memory', \`
      <div class="big-metric"><div class="big-val">\${d.memory.usagePercent.toFixed(1)}%</div><div class="big-unit">Memory Used</div></div>
      \${gaugeHtml('RAM', d.memory.usagePercent, fmtBytes(d.memory.used))}
      \${gaugeHtml('Swap', d.memory.swapTotal? (d.memory.swapUsed/d.memory.swapTotal)*100 : 0, fmtBytes(d.memory.swapUsed))}
      <div class="grid-2x2" style="margin-top:20px;flex:none">
        <div>\${statRow('Total', fmtBytes(d.memory.total))}\${statRow('Used', fmtBytes(d.memory.used))}</div>
        <div>\${statRow('Free', fmtBytes(d.memory.free))}\${statRow('Cached', fmtBytes(d.memory.total - d.memory.free - d.memory.used))}</div>
      </div>
      <div class="spark-wrap" style="margin-top:20px"><div class="spark-label">Memory History</div><canvas class="spark large" id="sp-mem-l"></canvas></div>
    \`, 'flex-1')}
  </div>\`;
}

function renderGpu(d) {
  if(!d.gpu) return '<div class="big-metric">No GPU Data</div>';
  return \`<div class="detail-full">
    \${card('Graphics Processor', \`
      <div class="big-metric"><div class="big-val">\${d.gpu.utilization.toFixed(1)}%</div><div class="big-unit">\${d.gpu.model}</div></div>
      \${gaugeHtml('Utilisation', d.gpu.utilization)}
      \${statRow('VRAM Used', fmtBytes(d.gpu.memory))}
      \${statRow('Active Processes', d.gpu.processes)}
      \${d.gpu.temperature? statRow('Temperature', d.gpu.temperature+'°C') : ''}
    \`, 'flex-1')}
  </div>\`;
}

function renderPower(d) {
  const tw = d.power?.combinedWatts ?? (d.battery?.powerWatts || 0);
  return \`<div class="detail-full">
    \${card('Power Consumption', \`
      <div class="big-metric"><div class="big-val">\${tw.toFixed(2)} W</div><div class="big-unit">Total Draw</div></div>
      <div class="flex-row">
        \${d.power?.cpuWatts!=null ? \`<div class="flex-1">\${gaugeHtml('CPU Package', Math.min(100,d.power.cpuWatts/100*100), d.power.cpuWatts.toFixed(2)+'W')}</div>\` : ''}
        \${d.power?.gpuWatts!=null ? \`<div class="flex-1">\${gaugeHtml('GPU Package', Math.min(100,d.power.gpuWatts/200*100), d.power.gpuWatts.toFixed(2)+'W')}</div>\` : ''}
      </div>
    \`, 'flex-1')}
  </div>\`;
}

function renderBattery(d) {
  if(!d.battery) return '<div class="big-metric">No Battery</div>';
  return \`<div class="detail-full">
    \${card('Battery', \`
      <div class="ring-container" style="border:none;background:transparent;">
        \${svgRing(d.battery.level, 100, 'LEVEL', '%', 200)}
      </div>
      <div class="grid-2x2">
        <div>
          \${statRow('State', d.battery.state)}
          \${statRow('Power Source', d.battery.powerSource)}
          \${statRow('Condition', d.battery.condition)}
          \${d.battery.cycles ? statRow('Cycles', d.battery.cycles) : ''}
        </div>
        <div>
          \${d.battery.timeRemaining ? statRow('Time Remaining', d.battery.timeRemaining) : ''}
          \${d.battery.powerWatts ? statRow('Power Draw', d.battery.powerWatts.toFixed(2)+' W') : ''}
          \${d.battery.maxCapacityPercent ? statRow('Max Capacity', d.battery.maxCapacityPercent+'%') : ''}
        </div>
      </div>
    \`, 'flex-1')}
  </div>\`;
}

function renderThermal(d) {
  const chips = d.thermal.temperatures ? Object.entries(d.thermal.temperatures).map(([k,v]) => \`<div class="chip \${statusCls(v)}">\${k}: \${v.toFixed(1)}°C</div>\`).join('') : '';
  return \`<div class="detail-full">
    \${card('Thermal Status', \`
      \${statRow('State', d.thermal.state)}
      \${statRow('Pressure', d.thermal.pressureLevel ?? 'Normal')}
      <div class="chips mb-12">\${chips}</div>
      <div class="spark-wrap"><div class="spark-label">CPU Temp History</div><canvas class="spark large" id="sp-therm-l"></canvas></div>
    \`, 'flex-1')}
  </div>\`;
}

function renderNetwork(d) {
  return \`<div class="detail-split">
    <div class="detail-left">
      \${card('Traffic', \`
        <div class="flex-row">
          <div class="flex-1 spark-wrap"><div class="spark-label txt-cyan">⬇ RX Rate</div><canvas class="spark large" id="sp-net-rx-l"></canvas></div>
          <div class="flex-1 spark-wrap"><div class="spark-label txt-purple">⬆ TX Rate</div><canvas class="spark large" id="sp-net-tx-l"></canvas></div>
        </div>
      \`, 'flex-1')}
    </div>
    <div class="detail-right">
      \${card('Interface Info', \`
        <div class="big-metric" style="padding:10px 0"><div class="big-val txt-cyan" style="font-size:24px">\${d.network.interface}</div><div class="big-unit">\${d.network.ip}</div></div>
        \${statRow('RX Total', fmtBytes(d.network.rxBytes))}
        \${statRow('TX Total', fmtBytes(d.network.txBytes))}
        \${statRow('RX Packets', (d.network.rxPackets||0).toLocaleString())}
        \${statRow('TX Packets', (d.network.txPackets||0).toLocaleString())}
        \${d.network.connections ? statRow('TCP Conns', d.network.connections) : ''}
      \`, 'flex-1')}
    </div>
  </div>\`;
}

function renderDisk(d) {
  const rows = (d.disk||[]).map(ds => \`
    <div class="mb-12">
      <div class="flex-row" style="justify-content:space-between;font-family:var(--mono);font-size:12px;margin-bottom:6px;">
        <span class="txt-cyan" style="font-weight:700">\${ds.mountpoint}</span>
        <span>\${ds.used} / \${ds.size}</span>
      </div>
      \${gaugeHtml('', parseFloat(ds.capacity)||0, ds.capacity)}
    </div>\`).join('');
  return \`<div class="detail-full">\${card('Storage Volumes', rows, 'flex-1')}</div>\`;
}

function sortProcs(procs) {
  const col = procSort.col;
  const dir = procSort.dir;
  return [...procs].sort((a,b)=>{
    let va=a[col], vb=b[col];
    if(typeof va==='string'){va=va.toLowerCase();vb=vb.toLowerCase();}
    return (va<vb ? -1 : va>vb ? 1 : 0) * (dir==='asc'?1:-1);
  });
}
function sortBy(col) {
  if(procSort.col===col) procSort.dir = procSort.dir==='asc'?'desc':'asc';
  else {procSort.col=col; procSort.dir='desc';}
  if(latestData) updateView();
}
function sortHdr(col) { return procSort.col===col ? (procSort.dir==='asc'?' ↑':' ↓') : ''; }
function fmtTime(s) { if(!s)return'–'; const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sc=Math.floor(s%60); return h?h+'h'+m+'m':m?m+'m'+sc+'s':sc+'s'; }

function renderProcesses(d) {
  const procs = sortProcs(d.processes||[]);
  const rows = procs.map(p=>\`<tr>
    <td>\${p.pid}</td>
    <td class="proc-cmd" title="\${escapeHtml(p.command)}">\${escapeHtml(p.command)}</td>
    <td>\${escapeHtml(p.user)}</td>
    <td class="txt-\${statusCls(p.cpu)}">\${p.cpu.toFixed(1)}</td>
    <td>\${p.mem.toFixed(1)}</td>
    <td>\${p.threads||0}</td>
    <td>\${p.state}</td>
    <td>\${fmtTime(p.runtime)}</td>
  </tr>\`).join('');
  return \`<div class="detail-full">
    \${card('Process List ('+procs.length+')', \`
      <div class="table-wrap">
        <table class="proc">
          <thead><tr>
            <th onclick="sortBy('pid')">PID\${sortHdr('pid')}</th>
            <th onclick="sortBy('command')">Command\${sortHdr('command')}</th>
            <th onclick="sortBy('user')">User\${sortHdr('user')}</th>
            <th onclick="sortBy('cpu')">CPU%\${sortHdr('cpu')}</th>
            <th onclick="sortBy('mem')">MEM%\${sortHdr('mem')}</th>
            <th onclick="sortBy('threads')">Thr\${sortHdr('threads')}</th>
            <th onclick="sortBy('state')">State\${sortHdr('state')}</th>
            <th onclick="sortBy('runtime')">Time\${sortHdr('runtime')}</th>
          </tr></thead>
          <tbody>\${rows}</tbody>
        </table>
      </div>
    \`, 'flex-1')}
  </div>\`;
}

function renderAnomalies(d) {
  const arr = d.anomalies||[];
  if(!arr.length) return '<div class="big-metric"><div class="big-val txt-green" style="font-size:32px">System Healthy</div></div>';
  const rows = arr.map(a=>\`<div class="anomaly"><div class="anomaly-icon">⚠️</div><div><div class="anomaly-title">\${escapeHtml(a.type||'Alert')}</div><div class="anomaly-desc">\${escapeHtml(a.message||a.detail||JSON.stringify(a))}</div></div></div>\`).join('');
  return \`<div class="detail-full">\${card('Anomalies', rows, 'flex-1')}</div>\`;
}

function drawSparks() {
  drawSpark('sp-ov-cpu', history.cpu, '#ffffff', '#999999');
  drawSpark('sp-ov-rx', history.rxRate, '#ffffff', '#999999');
  drawSpark('sp-ov-tx', history.txRate, '#bbbbbb', '#666666');
  drawSpark('sp-cpu-l', history.cpu, '#ffffff', '#999999');
  drawSpark('sp-mem-l', history.mem, '#bbbbbb', '#666666');
  drawSpark('sp-therm-l', history.temp, '#dddddd', '#888888');
  drawSpark('sp-net-rx-l', history.rxRate, '#ffffff', '#999999');
  drawSpark('sp-net-tx-l', history.txRate, '#bbbbbb', '#666666');
}

function switchView(v) {
  currentView = v;
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active', t.dataset.view===v));
  if(latestData) updateView();
}

function updateView() {
  const el = document.getElementById('view-content');
  if(!el || !latestData) return;
  const d = latestData;
  const map = {overview:renderOverview, cpu:renderCpu, memory:renderMemory, gpu:renderGpu, power:renderPower, battery:renderBattery, thermal:renderThermal, network:renderNetwork, disk:renderDisk, processes:renderProcesses, anomalies:renderAnomalies};
  if(map[currentView]) {
    el.innerHTML = map[currentView](d);
    requestAnimationFrame(drawSparks);
  }
}

let prx=null, ptx=null;
function ingestData(d) {
  latestData = d;
  pushHist(history.cpu, d.cpu.usage);
  pushHist(history.mem, d.memory.usagePercent);
  pushHist(history.temp, d.cpu.temperature ?? d.thermal.temperatures?.cpu_die ?? 0);
  if(prx!==null) {
    pushHist(history.rxRate, Math.max(0, d.network.rxBytes-prx));
    pushHist(history.txRate, Math.max(0, d.network.txBytes-ptx));
  }
  prx=d.network.rxBytes; ptx=d.network.txBytes;
  if(d.power?.combinedWatts) pushHist(history.power, d.power.combinedWatts);

  document.getElementById('titlebar-host').textContent = d.header.hostname+' · '+d.header.os;
  document.getElementById('sb-uptime').textContent = d.header.uptime;
  document.getElementById('sb-cpu').textContent = d.cpu.usage.toFixed(1)+'%';
  document.getElementById('sb-mem').textContent = d.memory.usagePercent.toFixed(1)+'%';
  document.getElementById('sb-batt').textContent = d.battery ? d.battery.level+'%' : '–';
  document.getElementById('sb-procs').textContent = (d.processes||[]).length;
  document.getElementById('sb-refresh').textContent = new Date().toLocaleTimeString();
  
  updateView();
}

window.__pyreUpdate = function(jsStr) {
  try {
    const d = JSON.parse(jsStr);
    document.getElementById('conn-dot').className='conn-dot';
    document.getElementById('conn-text').textContent='Live';
    ingestData(d);
  } catch(e) { document.getElementById('conn-text').textContent='Err: '+e.message; }
};

let pTimer=null;
async function pollOnce() {
  try {
    const r=await fetch('/api/stats',{cache:'no-store'});
    if(!r.ok){ document.getElementById('conn-dot').className='conn-dot offline'; return; }
    document.getElementById('conn-dot').className='conn-dot';
    ingestData(await r.json());
  } catch(e) { document.getElementById('conn-dot').className='conn-dot offline'; }
}
setTimeout(()=>{ if(!latestData && !pTimer) { pollOnce(); pTimer=setInterval(pollOnce, 2000); } }, 4000);

const keyMap = {'1':'overview','2':'cpu','3':'memory','4':'gpu','5':'power','6':'battery','7':'thermal','8':'network','9':'disk','p':'processes','a':'anomalies'};
document.addEventListener('keydown', e => { if(keyMap[e.key.toLowerCase()]) switchView(keyMap[e.key.toLowerCase()]); });
</script>
</body>
</html>`;
}
