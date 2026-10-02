/**
 * pyre web dashboard module.
 *
 * Provides a proper auto-refreshing web dashboard with
 * live Chart.js graphs served over HTTP. Powers `pyre web`.
 *
 * The dashboard polls the pyre REST API every 2 seconds
 * and renders live sparkline-style charts for:
 *   - CPU usage %
 *   - Memory usage %
 *   - Temperature °C
 *   - Network RX/TX rate
 *   - Power draw (watts)
 */

export interface WebDashboardOptions {
  port: number;
  apiUrl: string;
  apiKey?: string;
}

const DASHBOARD_HTML = (apiUrl: string, apiKey?: string): string => {
  const authHeader = apiKey ? `"x-api-key": "${apiKey}",\n      ` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Pyre — Live Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0a0a0f;--surface:#141418;--border:rgba(255,255,255,.08);
  --text:#f5f5f7;--muted:#a1a1a6;--accent:#ff5500;
  --cpu:#00d4ff;--mem:#ff9f0a;--gpu:#af52de;--thm:#ff453a;
  --net:#34c759;--pwr:#ffcc02;--bat:#64d2ff;
  --ok:#34c759;--warn:#ff9f0a;--crit:#ff453a;
}
html,body{height:100%;background:var(--bg);color:var(--text);
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text","Helvetica Neue",Helvetica,Arial,sans-serif;
  -webkit-font-smoothing:antialiased;overflow-x:hidden}
header{position:sticky;top:0;z-index:10;height:48px;background:rgba(10,10,15,.9);
  backdrop-filter:saturate(180%) blur(20px);border-bottom:1px solid var(--border);
  display:flex;align-items:center;padding:0 20px;gap:16px}
.logo{font-weight:700;font-size:15px;color:var(--accent);letter-spacing:-.01em}
.hostname{font-size:13px;color:var(--muted)}
.status{margin-left:auto;display:flex;gap:12px;align-items:center}
.badge{padding:3px 10px;border-radius:980px;font-size:11px;font-weight:600;font-family:ui-monospace,monospace}
.badge-live{background:rgba(52,199,89,.15);color:var(--ok);border:1px solid rgba(52,199,89,.3)}
.badge-err{background:rgba(255,69,58,.15);color:var(--crit);border:1px solid rgba(255,69,58,.3)}
.refresh{font-size:11px;color:var(--muted);font-family:ui-monospace,monospace}
main{padding:20px;display:grid;gap:16px;
  grid-template-columns:repeat(auto-fit,minmax(340px,1fr));
  max-width:1600px;margin:0 auto}
.card{background:var(--surface);border:1px solid var(--border);border-radius:16px;
  padding:16px 18px;display:flex;flex-direction:column;min-height:200px}
.card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.card-title{font-size:13px;font-weight:600;color:var(--muted);letter-spacing:-.01em;text-transform:uppercase}
.card-value{font-size:24px;font-weight:700;font-family:ui-monospace,monospace;letter-spacing:-.02em}
.card-sub{font-size:11px;color:var(--muted);margin-top:2px;font-family:ui-monospace,monospace}
.chart-wrap{flex:1;position:relative;min-height:80px;margin-top:8px}
canvas{width:100%!important;height:100%!important}
.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:16px}
.stat{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px 14px}
.stat-label{font-size:11px;color:var(--muted);text-transform:uppercase;font-weight:600;letter-spacing:-.01em}
.stat-val{font-size:20px;font-weight:700;font-family:ui-monospace,monospace;margin-top:2px}
.footer{text-align:center;padding:16px;font-size:11px;color:var(--muted)}
@media(max-width:768px){main{grid-template-columns:1fr}.summary{grid-template-columns:repeat(2,1fr)}}
</style>
</head>
<body>
<header>
  <div class="logo">🔥 Pyre</div>
  <div class="hostname" id="hostname">loading…</div>
  <div class="status">
    <div class="refresh" id="refresh">refreshing 2s</div>
    <div class="badge badge-live" id="liveBadge">● LIVE</div>
  </div>
</header>
<main>
  <div class="summary" id="summary"></div>
  <div class="card">
    <div class="card-header">
      <div class="card-title" style="color:var(--cpu)">CPU Usage %</div>
      <div class="card-value" id="cpuVal" style="color:var(--cpu)">--</div>
    </div>
    <div class="chart-wrap"><canvas id="cpuChart"></canvas></div>
  </div>
  <div class="card">
    <div class="card-header">
      <div class="card-title" style="color:var(--mem)">Memory Usage %</div>
      <div class="card-value" id="memVal" style="color:var(--mem)">--</div>
    </div>
    <div class="chart-wrap"><canvas id="memChart"></canvas></div>
  </div>
  <div class="card">
    <div class="card-header">
      <div class="card-title" style="color:var(--thm)">Temperature °C</div>
      <div class="card-value" id="tempVal" style="color:var(--thm)">--</div>
    </div>
    <div class="chart-wrap"><canvas id="tempChart"></canvas></div>
  </div>
  <div class="card">
    <div class="card-header">
      <div class="card-title" style="color:var(--net)">Network RX/TX MB/s</div>
      <div class="card-value" id="netVal" style="color:var(--net)">--</div>
    </div>
    <div class="chart-wrap"><canvas id="netChart"></canvas></div>
  </div>
  <div class="card">
    <div class="card-header">
      <div class="card-title" style="color:var(--pwr)">Power Draw (W)</div>
      <div class="card-value" id="pwrVal" style="color:var(--pwr)">--</div>
    </div>
    <div class="chart-wrap"><canvas id="pwrChart"></canvas></div>
  </div>
</main>
<div class="footer">Pyre live dashboard · auto-refresh every 2s · <span id="lastUpdate">--</span></div>
<script>
const MAX_POINTS=60;
const history={cpu:[],mem:[],temp:[],netRx:[],netTx:[],pwr:[],labels:[]};
const chartOpts=(color,label,unit='')=>({
  type:'line',data:{labels:history.labels,datasets:[{
    label:label,data:[],borderColor:color,backgroundColor:color+'22',
    borderWidth:2,pointRadius:0,tension:.4,fill:true
  }]},
  options:{responsive:true,maintainAspectRatio:false,animation:false,
    scales:{x:{display:false},y:{beginAtZero:true,grid:{color:'rgba(255,255,255,.05)'},
      ticks:{color:'#a1a1a6',font:{size:10},callback:v=>v+unit}}},
    plugins:{legend:{display:false}},
    interaction:{intersect:false,mode:'index'}}
});
const charts={
  cpu:new Chart(document.getElementById('cpuChart'),chartOpts('#00d4ff','CPU %','%')),
  mem:new Chart(document.getElementById('memChart'),chartOpts('#ff9f0a','Memory %','%')),
  temp:new Chart(document.getElementById('tempChart'),chartOpts('#ff453a','Temp','°C')),
  net:new Chart(document.getElementById('netChart'),chartOpts('#34c759','Net','MB/s')),
  pwr:new Chart(document.getElementById('pwrChart'),chartOpts('#ffcc02','Power','W')),
};
function fmtTime(d){return d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'})}
function fmtBytes(b){if(!b)return'0';if(b<1024)return b+'B';if(b<1048576)return(b/1024).toFixed(1)+'KB';return(b/1048576).toFixed(1)+'MB'}
const AUTH_HEADERS = { ${authHeader} };
async function fetchData(){
  try{
    const r=await fetch('${apiUrl}',{headers:AUTH_HEADERS});
    if(!r.ok)throw new Error(r.status);
    const d=await r.json();
    document.getElementById('hostname').textContent=d.header?.hostname||'pyre';
    document.getElementById('lastUpdate').textContent='updated '+fmtTime(new Date());
    const cpu=d.cpu?.usage??0,mem=d.memory?.usagePercent??0;
    const temp=d.cpu?.temperature??d.thermal?.temperatures?.cpu_die??null;
    const rxRate=d.network?.rxRate??(d.network?.rxBytes?0:0);
    const txRate=d.network?.txRate??(d.network?.txBytes?0:0);
    const pwr=d.power?.combinedWatts??d.power?.cpuWatts??0;
    const now=fmtTime(new Date());
    history.labels.push(now);
    history.cpu.push(cpu);history.mem.push(mem);
    history.temp.push(temp);history.netRx.push(rxRate/1048576);history.netTx.push(txRate/1048576);
    history.pwr.push(pwr);
    if(history.labels.length>MAX_POINTS){
      history.labels.shift();history.cpu.shift();history.mem.shift();
      history.temp.shift();history.netRx.shift();history.netTx.shift();history.pwr.shift();
    }
    function updChart(chart,data,color){
      chart.data.labels=history.labels;
      chart.data.datasets[0].data=data;
      chart.update('none');
    }
    updChart(charts.cpu,history.cpu,'#00d4ff');
    updChart(charts.mem,history.mem,'#ff9f0a');
    const tempData=history.temp.map(v=>v===null?null:v);
    updChart(charts.temp,tempData,'#ff453a');
    const netData=history.netRx.map((r,i)=>r+history.netTx[i]);
    updChart(charts.net,netData,'#34c759');
    updChart(charts.pwr,history.pwr,'#ffcc02');
    document.getElementById('cpuVal').textContent=cpu.toFixed(1)+'%';
    document.getElementById('memVal').textContent=mem.toFixed(1)+'%';
    document.getElementById('tempVal').textContent=temp!==null?temp.toFixed(1)+'°C':'--';
    document.getElementById('netVal').textContent=fmtBytes(rxRate+txRate)+'/s';
    document.getElementById('pwrVal').textContent=pwr.toFixed(1)+'W';
    const summary=document.getElementById('summary');
    summary.innerHTML=
      '<div class="stat"><div class="stat-label">CPU</div><div class="stat-val" style="color:var(--cpu)">'+cpu.toFixed(1)+'%</div></div>'+
      '<div class="stat"><div class="stat-label">Memory</div><div class="stat-val" style="color:var(--mem)">'+mem.toFixed(1)+'%</div></div>'+
      '<div class="stat"><div class="stat-label">Temp</div><div class="stat-val" style="color:var(--thm)">'+(temp!==null?temp.toFixed(1)+'°C':'--')+'</div></div>'+
      '<div class="stat"><div class="stat-label">Network</div><div class="stat-val" style="color:var(--net)">'+fmtBytes(d.network?.rxBytes??0)+' ↓</div></div>'+
      '<div class="stat"><div class="stat-label">Power</div><div class="stat-val" style="color:var(--pwr)">'+(pwr>0?pwr.toFixed(1)+'W':'--')+'</div></div>';
    const badge=document.getElementById('liveBadge');
    badge.className='badge badge-live';badge.textContent='● LIVE';
  }catch(e){
    const badge=document.getElementById('liveBadge');
    badge.className='badge badge-err';badge.textContent='⚠ ERR';
    console.error('pyre dashboard fetch error:',e);
  }
}
fetchData();setInterval(fetchData,2000);
</script>
</body>
</html>`;
};

export function getWebDashboardHtml(apiUrl = 'http://localhost:8080/api/all', apiKey?: string): string {
  return DASHBOARD_HTML(apiUrl, apiKey);
}
