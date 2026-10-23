(() => {
  'use strict';
  const $ = (s, root=document) => root.querySelector(s);
  const $$ = (s, root=document) => [...root.querySelectorAll(s)];
  const fmtMoney = (v, compact=false) => {
    if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
    return new Intl.NumberFormat('en-IN', {style:'currency',currency:'INR',maximumFractionDigits: compact ? 0 : 2,notation: compact ? 'compact' : 'standard'}).format(Number(v));
  };
  const fmtNum = (v, digits=2) => v === null || v === undefined || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString('en-IN',{maximumFractionDigits:digits,minimumFractionDigits:digits});
  const fmtPct = (v, digits=2) => v === null || v === undefined || !Number.isFinite(Number(v)) ? '—' : `${Number(v)>0?'+':''}${Number(v).toFixed(digits)}%`;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const signalClass = s => s === 'BUY' ? 'buy' : s === 'SELL' ? 'sell' : s === 'DATA BLOCKED' ? 'blocked' : 'hold';
  const changeClass = v => Number(v)>0 ? 'positive-text' : Number(v)<0 ? 'negative-text' : 'neutral-text';
  const SIGNAL_COLORS = {'BUY':'#55c58a','SELL':'#ff737a','HOLD':'#8193a0','DATA BLOCKED':'#e9b45e'};
  let snapshot = null, currentView = 'overview', commandSelection = 0, toastTimer;

  async function loadSnapshot() {
    try {
      const response = await fetch('./snapshot.json', {cache:'no-store'});
      if (!response.ok) throw new Error('snapshot unavailable');
      const incoming = await response.json();
      if (incoming && Array.isArray(incoming.signals) && incoming.signals.length) snapshot = incoming;
      else throw new Error('invalid snapshot');
    } catch (e) {
      showToast('Could not load snapshot. Cached/demo data remains visible.');
    }
    if (!snapshot) snapshot = window.STRATA_DEMO_SNAPSHOT || null;
    if (!snapshot) return;
    renderAll();
  }

  function botState() {
    return snapshot?.bot || {config:{starting_capital:1000000,max_positions:15,cost_bps_per_side:15,slippage_bps_per_side:5},cash:1000000,positions:{},pending_orders:[],trades:[],equity_history:[]};
  }
  function signalRows() { return Array.isArray(snapshot?.signals) ? snapshot.signals : []; }
  function closedTrades() { return botState().trades || []; }
  function openPositions() { return Object.values(botState().positions || {}); }
  function priceRows() { return snapshot?.prices || []; }
  function signalCounts() {
    const counts = {'BUY':0,'SELL':0,'HOLD':0,'DATA BLOCKED':0};
    signalRows().forEach(r => counts[r.signal] = (counts[r.signal]||0)+1);
    return counts;
  }
  function metrics() {
    const b=botState(), positions=openPositions(), trades=closedTrades();
    const invested=positions.reduce((s,p)=>s+Number(p.market_value||Number(p.quantity||0)*Number(p.last_price||p.entry_price||0)),0);
    const unreal=positions.reduce((s,p)=>s+Number(p.unrealised_pnl||0),0);
    const realised=trades.reduce((s,t)=>s+Number(t.net_pnl||0),0);
    const start=Number(b.config?.starting_capital||1000000);
    const equity=Number(b.cash||0)+invested;
    const netPnl=equity-start;
    const wins=trades.filter(t=>Number(t.net_pnl)>0), losses=trades.filter(t=>Number(t.net_pnl)<0);
    const grossWins=wins.reduce((s,t)=>s+Number(t.net_pnl),0), grossLoss=Math.abs(losses.reduce((s,t)=>s+Number(t.net_pnl),0));
    const eq=b.equity_history||[];
    let peak=start,maxDD=0;
    eq.forEach(x=>{peak=Math.max(peak,Number(x.equity||start));if(peak>0)maxDD=Math.min(maxDD,(Number(x.equity||start)/peak-1)*100);});
    return {b,positions,trades,invested,unreal,realised,start,equity,netPnl,returnPct:start?(netPnl/start*100):0,wins,losses,winRate:trades.length?wins.length/trades.length*100:null,avgTrade:trades.length?trades.reduce((s,t)=>s+Number(t.net_pnl||0),0)/trades.length:null,avgWin:wins.length?grossWins/wins.length:null,avgLoss:losses.length?losses.reduce((s,t)=>s+Number(t.net_pnl||0),0)/losses.length:null,profitFactor:grossLoss?grossWins/grossLoss:(grossWins>0?Infinity:null),maxDD};
  }
  function renderAll() {
    const demo = snapshot.data_mode === 'DEMO';
    const generatedMs = Date.parse(snapshot.generated_at || '');
    const snapshotAgeDays = Number.isFinite(generatedMs) ? Math.max(0, (Date.now() - generatedMs) / 86400000) : null;
    const stale = !demo && snapshotAgeDays !== null && snapshotAgeDays > 5;
    $('#demoBanner').classList.toggle('hidden', !demo);
    $('#sidebarStatus').textContent = demo ? 'Demo environment' : stale ? 'Snapshot may be stale' : (snapshot.status==='OK'?'Pipeline healthy':'Partial data run');
    $('#sidebarDate').textContent = demo ? 'Synthetic data only' : `As of ${snapshot.exchange_date||'—'}`;
    $('#sidebarDot').style.background = demo || stale ? 'var(--amber)' : snapshot.status==='OK' ? 'var(--green)' : 'var(--amber)';
    $('#ribbonUniverse').textContent = snapshot.universe_label || (demo ? 'NIFTY 500' : 'CUSTOM UNIVERSE');
    $('#ribbonDate').textContent = snapshot.exchange_date || '—';
    $('#ribbonRun').textContent = demo ? 'DEMO DATA' : new Date(snapshot.generated_at||Date.now()).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'})+' IST';
    $('#ribbonCoverage').innerHTML = `${snapshot.coverage?.price_histories ?? signalRows().length} / ${snapshot.coverage?.expected ?? 500} <span class="coverage-muted">${demo?'sample':'symbols'}</span>`;
    $('#sourceLabel').textContent = demo ? 'SYNTHETIC SNAPSHOT' : (snapshot.source||'YFINANCE').toUpperCase();
    $('#marketState').textContent = 'MARKET CLOSED';
    $('#footerDataState').textContent = demo ? 'SYNTHETIC DATA · NOT FOR INVESTMENT USE' : `${snapshot.source?.toUpperCase()||'DATA'} · EOD · NOT REAL-TIME`;
    $('#healthSummary').textContent = demo ? 'Demo data only. Live coverage has not been validated.' : `${snapshot.coverage?.price_histories||0}/${snapshot.coverage?.expected||0} price histories · ${snapshot.coverage?.fundamentals_coverage_pct??0}% fundamentals coverage.${stale?' Snapshot is older than 5 days; verify the scheduled pipeline run.':''}`;
    renderOverview(); renderScanner(); renderBot(); renderTrades(); renderPerformance(); renderData();
  }
  function renderOverview() {
    const c=signalCounts(), m=metrics();
    $('#kpiEquity').textContent=fmtMoney(m.equity, true); $('#kpiPnl').textContent=fmtMoney(m.netPnl, true);
    $('#kpiPnl').className='kpi-value '+changeClass(m.netPnl);
    $('#kpiPnlPct').textContent=`${fmtPct(m.returnPct)} since inception`; $('#kpiPnlPct').className=changeClass(m.returnPct);
    $('#kpiEquitySub').textContent=snapshot.data_mode==='DEMO'?'Illustrative model ledger':'Rule Bot model equity';
    $('#kpiPositions').innerHTML=`${m.positions.length} <small>/ ${m.b.config?.max_positions||15}</small>`;
    $('#kpiCash').textContent=`Cash ${fmtMoney(m.b.cash,true)}`;
    $('#kpiBuys').textContent=c.BUY; $('#kpiSignalSub').textContent=`${c.SELL} sell · ${c.HOLD} hold · ${c['DATA BLOCKED']} blocked`;
    $('#signalTotal').textContent=signalRows().length; $('#blockedCount').textContent=c['DATA BLOCKED'];
    const total=Math.max(signalRows().length,1);
    $('#signalBar').innerHTML=['BUY','SELL','HOLD','DATA BLOCKED'].map(k=>`<span style="width:${c[k]/total*100}%;background:${SIGNAL_COLORS[k]}" title="${k}: ${c[k]}"></span>`).join('');
    $('#signalLegend').innerHTML=['BUY','SELL','HOLD','DATA BLOCKED'].map(k=>`<div class="signal-legend-row"><i style="background:${SIGNAL_COLORS[k]}"></i><span>${k==='DATA BLOCKED'?'Blocked':k[0]+k.slice(1).toLowerCase()}</span><strong>${c[k]}</strong></div>`).join('');
    const hist=m.b.equity_history||[]; $('#chartEquity').textContent=fmtMoney(m.equity); $('#chartChange').textContent=hist.length>1?`${hist.length} daily snapshots`:'No performance history yet';
    $('#chartChange').className='neutral-text'; $('#chartLastDate').textContent=snapshot.exchange_date||'LATEST';
    $('#chartEmpty').classList.toggle('hidden',hist.length>1);
    drawLineChart($('#equityChart'),hist.map(x=>Number(x.equity)),m.start);
    const top=[...signalRows()].filter(r=>r.signal!=='DATA BLOCKED').sort((a,b)=>(b.score??-1)-(a.score??-1)).slice(0,6);
    $('#topSignalsBody').innerHTML=top.map(stock=>`<tr data-symbol="${esc(stock.symbol)}"><td><div class="symbol-cell"><strong>${esc(stock.symbol)}</strong><span>${esc(stock.company||'')}</span></div></td><td class="price-cell">${fmtNum(stock.price)}</td><td class="change ${changeClass(stock.change_pct)}">${fmtPct(stock.change_pct)}</td><td class="score-cell">${stock.score==null?'—':fmtNum(stock.score,1)}</td><td><span class="signal-badge ${signalClass(stock.signal)}">${esc(stock.signal)}</span></td></tr>`).join('') || `<tr><td colspan="5">No signal-ready symbols.</td></tr>`;
    $('#topSignalsFoot').textContent=`Top ${top.length} by current rule score`;
    $('#botStatusPill').textContent=snapshot.data_mode==='DEMO'?'DEMO LEDGER':(m.positions.length?'TRACKING':'READY');
    $('#botStatusPill').className='status-pill '+(snapshot.data_mode==='DEMO'?'status-warning':'status-ok');
    $('#botTitle').textContent=snapshot.data_mode==='DEMO'?'Illustrative Rule Bot':'Rule Bot · Active ruleset';
    $('#botDescription').textContent=`${m.positions.length} open positions · ${m.trades.length} closed trades`;
    $('#botInvested').textContent=fmtMoney(m.invested,true); $('#botCash').textContent=fmtMoney(m.b.cash,true);
    $('#botNextTitle').textContent=snapshot.data_mode==='DEMO'?'Waiting for live data configuration':'Next scheduled run';
    $('#botNextText').textContent=snapshot.data_mode==='DEMO'?'Import universe and run the pipeline':'After next market close · IST';
  }
  function renderScanner() {
    const industries=[...new Set(signalRows().map(x=>x.industry||'Unknown'))].sort();
    const select=$('#industryFilter'), prev=select.value;
    select.innerHTML='<option value="ALL">All industries</option>'+industries.map(i=>`<option value="${esc(i)}">${esc(i)}</option>`).join('');
    if(industries.includes(prev)) select.value=prev;
    const q=($('#scannerSearch')?.value||'').toLowerCase(), sig=$('#signalFilter')?.value||'ALL', ind=select.value, sort=$('#sortFilter')?.value||'score';
    let rows=signalRows().filter(r=>(`${r.symbol} ${r.company||''}`.toLowerCase().includes(q))&&(sig==='ALL'||r.signal===sig)&&(ind==='ALL'||r.industry===ind));
    rows.sort((a,b)=>sort==='symbol'?a.symbol.localeCompare(b.symbol):sort==='change'?(b.change_pct??-Infinity)-(a.change_pct??-Infinity):sort==='price'?(b.price??-Infinity)-(a.price??-Infinity):(b.score??-Infinity)-(a.score??-Infinity));
    $('#scannerCount').textContent=`${rows.length} of ${signalRows().length} symbols`;
    $('#scannerFreshness').textContent=snapshot.data_mode==='DEMO'?'Synthetic snapshot':`As of ${snapshot.exchange_date||'—'}`;
    $('#scannerFooterText').textContent=`Ruleset ${snapshot.ruleset_version||'—'} · ${snapshot.source||'Demo'}`;
    $('#scannerBody').innerHTML=rows.map(r=>`<tr data-symbol="${esc(r.symbol)}"><td><div class="symbol-cell"><strong>${esc(r.symbol)}</strong><span>${esc(r.company||r.symbol)}</span></div></td><td class="industry-cell">${esc(r.industry||'—')}</td><td class="price-cell">${fmtNum(r.price)}</td><td class="change ${changeClass(r.change_pct)}">${fmtPct(r.change_pct)}</td><td class="score-cell">${r.score==null?'—':fmtNum(r.score,1)}</td><td><span class="techfund">${r.technical_score??'—'} / ${r.fundamental_score??'—'}</span></td><td><span class="signal-badge ${signalClass(r.signal)}">${esc(r.signal)}</span></td><td class="date-cell">${esc(r.date||snapshot.exchange_date||'—')}</td></tr>`).join('');
    $('#scannerEmpty').classList.toggle('hidden',rows.length>0);
  }
  function renderBot() {
    const m=metrics(), b=m.b;
    $('#botEquityBig').textContent=fmtMoney(m.equity,true); $('#botReturnBig').textContent=`${fmtPct(m.returnPct)} since inception`; $('#botReturnBig').className=changeClass(m.returnPct);
    $('#botInvestedBig').textContent=fmtMoney(m.invested,true); $('#botExposure').textContent=`${m.equity?fmtNum(m.invested/m.equity*100,1):'0.0'}% exposure`;
    $('#botUnrealised').textContent=fmtMoney(m.unreal,true); $('#botUnrealised').className='kpi-value '+changeClass(m.unreal);
    $('#botRealised').textContent=fmtMoney(m.realised,true); $('#botRealised').className='kpi-value '+changeClass(m.realised); $('#botClosedCount').textContent=`${m.trades.length} closed trades`;
    $('#positionCountLabel').textContent=`${m.positions.length} positions`;
    $('#positionsBody').innerHTML=m.positions.map(p=>`<tr><td><div class="symbol-cell"><strong>${esc(p.symbol)}</strong><span>${esc(p.industry||'')}</span></div></td><td>${p.quantity}</td><td class="price-cell">${fmtNum(p.entry_price)}</td><td class="price-cell">${fmtNum(p.last_price)}</td><td>${fmtMoney(p.market_value)}</td><td class="change ${changeClass(p.unrealised_pnl)}">${fmtMoney(p.unrealised_pnl)}</td></tr>`).join('');
    $('#positionsEmpty').classList.toggle('hidden',m.positions.length>0);
    const pending=(b.pending_orders||[]).filter(o=>o.status!=='filled'&&!String(o.status).startsWith('rejected'));
    $('#pendingCount').textContent=`${pending.length} pending`;
    $('#pendingList').innerHTML=pending.slice(0,8).map(o=>`<div class="pending-item"><span class="pending-side ${o.side==='BUY'?'buy':'sell'}">${o.side==='BUY'?'↑':'↓'}</span><div class="pending-copy"><strong>${esc(o.side)} · ${esc(o.symbol)}</strong><span>Signal ${esc(o.signal_date)} · next valid open</span></div><span class="pending-status">QUEUED</span></div>`).join('');
    $('#pendingEmpty').classList.toggle('hidden',pending.length>0);
    $('#recentTradesBody').innerHTML=m.trades.slice(-6).reverse().map(t=>`<tr><td><strong>${esc(t.symbol)}</strong></td><td>${esc(t.entry_date||'—')}</td><td>${fmtNum(t.entry_price)}</td><td>${esc(t.exit_date||'—')}</td><td>${fmtNum(t.exit_price)}</td><td>${t.quantity}</td><td class="change ${changeClass(t.net_pnl)}">${fmtMoney(t.net_pnl)}</td><td class="change ${changeClass(t.return_pct_net)}">${fmtPct(t.return_pct_net,3)}</td></tr>`).join('')||'<tr><td colspan="7">No closed trades yet.</td></tr>';
  }
  function renderTrades() {
    const m=metrics(), q=($('#tradeSearch')?.value||'').toLowerCase(), status=$('#tradeStatusFilter')?.value||'ALL';
    const closed=m.trades, wins=m.wins, losses=m.losses;
    $('#tradeClosedKpi').textContent=closed.length; $('#tradeWinRate').textContent=m.winRate==null?'—':fmtPct(m.winRate,1); $('#tradeAvgPnl').textContent=fmtMoney(m.avgTrade); $('#tradeProfitFactor').textContent=m.profitFactor==null?'—':m.profitFactor===Infinity?'∞':fmtNum(m.profitFactor,2);
    let rows=[];
    if(status!=='CLOSED') rows=rows.concat(m.positions.map(p=>({status:'OPEN',symbol:p.symbol,entry_date:p.entry_date,entry_price:p.entry_price,quantity:p.quantity,market_value:p.market_value,net_pnl:p.unrealised_pnl,return_pct_net:p.entry_price?(p.last_price/p.entry_price-1)*100:null,costs:p.entry_fee||0})));
    if(status!=='OPEN') rows=rows.concat(closed.map(t=>({...t,status:'CLOSED'})));
    rows=rows.filter(r=>(r.symbol||'').toLowerCase().includes(q)).sort((a,b)=>String(b.exit_date||b.entry_date||'').localeCompare(String(a.exit_date||a.entry_date||'')));
    $('#tradeBody').innerHTML=rows.map(t=>`<tr><td><div class="symbol-cell"><strong>${esc(t.symbol)}</strong><span>${t.status==='OPEN'?'OPEN POSITION':'CLOSED TRADE'}</span></div></td><td>${esc(t.entry_date||'—')}</td><td class="price-cell">${fmtNum(t.entry_price)}</td><td>${esc(t.exit_date||'—')}</td><td class="price-cell">${t.exit_price==null?'—':fmtNum(t.exit_price)}</td><td>${t.quantity??'—'}</td><td>${fmtMoney(t.costs||0)}</td><td class="change ${changeClass(t.net_pnl)}">${fmtMoney(t.net_pnl)}</td><td class="change ${changeClass(t.return_pct_net)}">${fmtPct(t.return_pct_net,3)}</td></tr>`).join('');
    $('#tradesEmpty').classList.toggle('hidden',rows.length>0);
  }
  function renderPerformance() {
    const m=metrics(), hist=m.b.equity_history||[];
    $('#statTotalReturn').textContent=fmtPct(m.returnPct); $('#statTotalReturn').className=changeClass(m.returnPct);
    $('#statMaxDrawdown').textContent=fmtPct(m.maxDD); $('#statClosedTrades').textContent=m.trades.length;
    $('#statWinRate').textContent=m.winRate==null?'—':fmtPct(m.winRate,1); $('#statAvgWin').textContent=m.avgWin==null?'—':fmtMoney(m.avgWin); $('#statAvgLoss').textContent=m.avgLoss==null?'—':fmtMoney(m.avgLoss);
    $('#statProfitFactor').textContent=m.profitFactor==null?'—':m.profitFactor===Infinity?'∞':fmtNum(m.profitFactor,2);
    $('#statCostModel').textContent=`${fmtNum((m.b.config?.cost_bps_per_side||15)+(m.b.config?.slippage_bps_per_side||5),0)} bps / side`;
    $('#performanceChartEmpty').classList.toggle('hidden',hist.length>1);
    drawLineChart($('#performanceChart'),hist.map(x=>Number(x.equity)),m.start);
  }
  function renderData() {
    const demo=snapshot.data_mode==='DEMO', cov=snapshot.coverage||{}, expected=cov.expected||500, prices=cov.price_histories??signalRows().length, funds=cov.fundamentals_with_any_fields??signalRows().filter(r=>r.fundamentals&&Object.values(r.fundamentals).some(v=>v!==null&&v!==undefined)).length, ready=signalRows().filter(r=>r.signal!=='DATA BLOCKED').length;
    $('#dataStatusTitle').textContent=demo?'Demo snapshot loaded':snapshot.status==='OK'?'Latest pipeline snapshot loaded':'Partial pipeline snapshot';
    const generatedMs=Date.parse(snapshot.generated_at||''); const ageDays=Number.isFinite(generatedMs)?Math.max(0,(Date.now()-generatedMs)/86400000):null; const stale=!demo&&ageDays!==null&&ageDays>5;
    $('#dataStatusText').textContent=demo?'No live data run has been recorded. Automated refresh begins after a valid universe is configured.':`Exchange date ${snapshot.exchange_date}; generated ${snapshot.generated_at_ist||snapshot.generated_at||'—'}.${stale?' Snapshot is older than 5 days; check GitHub Actions run history.':''}`;
    $('#sourceHealthPill').textContent=demo?'DEMO':stale?'STALE':snapshot.status||'UNKNOWN'; $('#sourceHealthPill').className='status-pill '+(demo||stale?'status-warning':snapshot.status==='OK'?'status-ok':'status-warning');
    $('#dataPriceCoverage').textContent=`${prices} / ${expected}`; $('#dataPriceProgress').style.width=`${Math.min(100,prices/expected*100)}%`;
    $('#dataFundCoverage').textContent=`${funds} / ${expected}`; $('#dataFundProgress').style.width=`${Math.min(100,funds/expected*100)}%`;
    $('#dataSignalCoverage').textContent=`${ready} / ${signalRows().length}`; $('#dataSignalProgress').style.width=`${signalRows().length?ready/signalRows().length*100:0}%`;
    $('#dataProvider').textContent=demo?'Synthetic demo':snapshot.source||'Unknown'; $('#dataLastDate').textContent=snapshot.exchange_date||'—'; $('#dataRunId').textContent=demo?'DEMO-SNAPSHOT':`${snapshot.exchange_date||'RUN'}-${snapshot.ruleset_version||'v1'}`; $('#dataRunStatus').textContent=demo?'DEMO ONLY':snapshot.status||'UNKNOWN';
    $('#rulesetVersion').textContent=snapshot.ruleset_version||'v0.1.0'; $('#maxHoldings').textContent=botState().config?.max_positions||15; $('#maxPositionSize').textContent=`${fmtNum((botState().config?.max_position_pct||.1)*100,0)}% of starting capital`;
    const blocked=signalRows().filter(r=>r.signal==='DATA BLOCKED'); $('#blockedTableCount').textContent=`${blocked.length} rows`;
    $('#blockedBody').innerHTML=blocked.slice(0,100).map(r=>`<tr><td><strong>${esc(r.symbol)}</strong></td><td><span class="signal-badge blocked">DATA BLOCKED</span></td><td>${esc((r.reasons||[]).join('; ')||'Required fields unavailable')}</td><td>${esc(r.date||snapshot.exchange_date||'—')}</td></tr>`).join('');
    $('#blockedEmpty').classList.toggle('hidden',blocked.length>0);
  }
  function drawLineChart(canvas, values, baseline) {
    if(!canvas) return; const rect=canvas.getBoundingClientRect(); if(!rect.width||!rect.height) return;
    const dpr=window.devicePixelRatio||1; canvas.width=Math.floor(rect.width*dpr);canvas.height=Math.floor(rect.height*dpr);
    const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);const w=rect.width,h=rect.height;
    ctx.clearRect(0,0,w,h);const pad={l:8,r:8,t:12,b:16};const pw=w-pad.l-pad.r,ph=h-pad.t-pad.b;
    ctx.strokeStyle='#22313b';ctx.lineWidth=1;ctx.setLineDash([3,4]);
    for(let i=0;i<4;i++){const y=pad.t+ph*i/3;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke();}ctx.setLineDash([]);
    if(!values||values.length<2||values.some(v=>!Number.isFinite(v)))return;
    const all=values.concat(Number.isFinite(Number(baseline))?[Number(baseline)]:[]);let min=Math.min(...all),max=Math.max(...all);if(min===max){min*=.99;max*=1.01;}const extra=(max-min)*.12;min-=extra;max+=extra;
    const x=i=>pad.l+pw*i/(values.length-1),y=v=>pad.t+ph-(v-min)/(max-min)*ph;
    if(Number.isFinite(Number(baseline))){ctx.strokeStyle='#465965';ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(pad.l,y(Number(baseline)));ctx.lineTo(w-pad.r,y(Number(baseline)));ctx.stroke();ctx.setLineDash([]);}
    const gradient=ctx.createLinearGradient(0,pad.t,0,h-pad.b);gradient.addColorStop(0,'rgba(103,217,232,.20)');gradient.addColorStop(1,'rgba(103,217,232,0)');
    ctx.beginPath();values.forEach((v,i)=>i?ctx.lineTo(x(i),y(v)):ctx.moveTo(x(i),y(v)));ctx.lineTo(x(values.length-1),h-pad.b);ctx.lineTo(x(0),h-pad.b);ctx.closePath();ctx.fillStyle=gradient;ctx.fill();
    ctx.beginPath();values.forEach((v,i)=>i?ctx.lineTo(x(i),y(v)):ctx.moveTo(x(i),y(v)));ctx.strokeStyle='#67d9e8';ctx.lineWidth=2;ctx.lineJoin='round';ctx.stroke();
    const last=values[values.length-1];ctx.beginPath();ctx.arc(x(values.length-1),y(last),3.2,0,Math.PI*2);ctx.fillStyle='#67d9e8';ctx.fill();ctx.strokeStyle='#0f1a22';ctx.lineWidth=2;ctx.stroke();
  }
  function openStockDetail(symbol) {
    const r=signalRows().find(x=>x.symbol===symbol); if(!r)return;
    $('#detailTitle').textContent=r.symbol;
    $('#detailSubtitle').textContent=`${r.company||r.symbol} · ${r.industry||'Industry unavailable'}`;
    $('#detailSignal').textContent=r.signal||'—'; $('#detailSignal').className=`signal-badge ${signalClass(r.signal)}`;
    $('#detailPrice').textContent=fmtMoney(r.price); $('#detailChange').textContent=fmtPct(r.change_pct); $('#detailChange').className=changeClass(r.change_pct);
    $('#detailScore').textContent=r.score==null?'—':`${fmtNum(r.score,1)} / 100`;
    $('#detailRuleset').textContent=r.ruleset_version||snapshot.ruleset_version||'Ruleset —';
    $('#detailDate').textContent=r.date||snapshot.exchange_date||'—'; $('#detailSource').textContent=snapshot.data_mode==='DEMO'?'Synthetic demo':snapshot.source||'Unknown source';
    const t=r.technical||{}, f=r.fundamentals||{};
    const techItems=[['SMA 20',t.SMA20],['SMA 50',t.SMA50],['SMA 200',t.SMA200],['RSI (14)',t.RSI14, ''],['MACD',t.MACD],['MACD signal',t.MACD_SIGNAL],['ATR (14)',t.ATR14],['20-session return',t.RETURN_20D,'%']];
    $('#detailTechnicals').innerHTML=techItems.map(([label,value,suffix=''])=>`<div class="detail-metric"><span>${esc(label)}</span><strong>${value==null?'—':`${fmtNum(value)}${suffix}`}</strong></div>`).join('');
    const fundItems=[['Trailing P/E',f.PE_Ratio],['Forward P/E',f.Forward_PE],['EPS (TTM)',f.EPS_TTM],['Market cap (₹ Cr)',f.Market_Cap_Cr],['Price / book',f.PB_Ratio],['ROE',f.ROE_pct,'%'],['Debt / equity',f.Debt_Equity],['Revenue growth',f.Revenue_Growth_pct,'%'],['Dividend yield',f.Div_Yield_pct,'%'],['Current ratio',f.Current_Ratio],['Profit margin',f.Profit_Margins_pct,'%'],['Fundamentals fetched',f.fetched_at||'Demo']];
    $('#detailFundamentals').innerHTML=fundItems.map(([label,value,suffix=''])=>`<div class="detail-metric"><span>${esc(label)}</span><strong>${value==null?'Not available':typeof value==='string'?esc(value):`${fmtNum(value)}${suffix}`}</strong></div>`).join('');
    const reasons=(r.reasons||[]).map(x=>({text:x,failed:false})).concat((r.failed_conditions||[]).map(x=>({text:x,failed:true})));
    $('#detailReasons').innerHTML=reasons.map(x=>`<div class="reason-item ${x.failed?'failed':''}"><i>${x.failed?'!':'✓'}</i><span>${esc(x.text)}</span></div>`).join('')||'<div class="reason-item"><i>i</i><span>No rule explanation was included in the snapshot.</span></div>';
    $('#detailOverlay').classList.remove('hidden'); document.body.style.overflow='hidden';
    const series=snapshot.charts?.[symbol]||[];drawLineChart($('#detailChart'),series.map(x=>Number(x.close)),null);
  }
  function closeStockDetail(){ $('#detailOverlay').classList.add('hidden');document.body.style.overflow=''; }

  function showView(view) {
    const target=$(`#view-${view}`); if(!target) return;
    currentView=view; $$('.view').forEach(v=>v.classList.toggle('active',v===target));
    $$('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
    const names={overview:'Overview',scanner:'Market scanner',bot:'Rule Bot',trades:'Trade ledger',performance:'Performance',data:'Data & rules'};
    $('#pageName').textContent=names[view]||view;
    $('#sidebar').classList.remove('open'); window.location.hash=view;
    if(view==='performance') renderPerformance();
    setTimeout(()=>$$('canvas').forEach(c=>{const r=c.id==='equityChart'?metrics().b.equity_history||[]:metrics().b.equity_history||[];drawLineChart(c,r.map(x=>Number(x.equity)),metrics().start);}),20);
  }
  function showToast(msg) {const el=$('#toast');el.textContent=msg;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2600);}
  function openCommand() {$('#commandOverlay').classList.remove('hidden');$('#commandInput').value='';commandSelection=0;renderCommandResults();setTimeout(()=>$('#commandInput').focus(),20);}
  function closeCommand() {$('#commandOverlay').classList.add('hidden');}
  function renderCommandResults() {
    const q=$('#commandInput').value.trim().toLowerCase();const pages=[['Overview','overview','Workspace overview'],['Market scanner','scanner','Search the Nifty 500 universe'],['Rule Bot','bot','Portfolio and open positions'],['Trade ledger','trades','Completed trades and P&L'],['Performance','performance','Strategy return and drawdown'],['Data & rules','data','Source health and strategy rules']].map(x=>({type:'page',title:x[0],id:x[1],desc:x[2]}));
    const stocks=signalRows().filter(r=>!q||`${r.symbol} ${r.company||''}`.toLowerCase().includes(q)).slice(0,7).map(r=>({type:'stock',title:r.symbol,id:r.symbol,desc:r.company||r.industry||'Stock detail'}));
    const filtered=pages.filter(p=>!q||`${p.title} ${p.desc}`.toLowerCase().includes(q));const results=(q?filtered:pages.slice(0,4)).concat(stocks).slice(0,10);commandSelection=Math.min(commandSelection,Math.max(0,results.length-1));
    $('#commandResults').innerHTML=results.map((r,i)=>`<div class="command-result ${i===commandSelection?'selected':''}" data-command-type="${r.type}" data-command-id="${esc(r.id)}"><span class="result-symbol">${r.type==='page'?'↗':'⌕'}</span><div><strong>${esc(r.title)}</strong><small>${esc(r.desc)}</small></div><kbd>${r.type==='page'?'PAGE':'SYMBOL'}</kbd></div>`).join('')||'<div class="empty-state">No matching page or symbol.</div>';
    $$('.command-result').forEach((el,i)=>el.addEventListener('click',()=>chooseCommand(results[i])));
  }
  function chooseCommand(r) {if(!r)return;closeCommand();if(r.type==='page')showView(r.id);else openStockDetail(r.id);}
  function downloadText(name,text,type='text/plain') {const blob=new Blob([text],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);}
  function exportCsv(rows,name) {if(!rows.length){showToast('No rows available to export.');return;}const keys=[...new Set(rows.flatMap(r=>Object.keys(r)))];const csv=[keys.join(','),...rows.map(r=>keys.map(k=>`"${String(typeof r[k]==='object'?JSON.stringify(r[k]):r[k]??'').replace(/"/g,'""')}"`).join(','))].join('\r\n');downloadText(name,csv,'text/csv;charset=utf-8;');showToast('CSV export prepared.');}

  $$('[data-view]').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));
  $$('[data-navigate]').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.navigate)));
  ['scannerSearch','signalFilter','industryFilter','sortFilter'].forEach(id=>$('#'+id)?.addEventListener('input',renderScanner));
  ['tradeSearch','tradeStatusFilter'].forEach(id=>$('#'+id)?.addEventListener('input',renderTrades));
  $('#searchTrigger').addEventListener('click',openCommand);$('#commandInput').addEventListener('input',()=>{commandSelection=0;renderCommandResults();});
  $('#commandOverlay').addEventListener('click',e=>{if(e.target.id==='commandOverlay')closeCommand();});
  document.addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openCommand();return;}
    if(e.key==='Escape'){closeCommand();closeStockDetail();}
    if(!$('#commandOverlay').classList.contains('hidden')){
      const items=$$('.command-result');if(e.key==='ArrowDown'){e.preventDefault();commandSelection=Math.min(commandSelection+1,items.length-1);renderCommandResults();}
      if(e.key==='ArrowUp'){e.preventDefault();commandSelection=Math.max(0,commandSelection-1);renderCommandResults();}
      if(e.key==='Enter'){e.preventDefault();items[commandSelection]?.click();}
      return;
    }
    if(!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)&&!e.ctrlKey&&!e.metaKey){const keys={'1':'overview','2':'scanner','3':'bot','4':'trades','5':'performance','6':'data'};if(keys[e.key])showView(keys[e.key]);if(e.key==='/'){e.preventDefault();openCommand();}}
  });
  $('#mobileMenu').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
  $('#refreshButton').addEventListener('click',()=>{loadSnapshot();showToast('Snapshot reload requested.');});
  $('#bannerDismiss').addEventListener('click',()=>$('#demoBanner').classList.add('hidden'));
  $('#exportSignals').addEventListener('click',()=>exportCsv(signalRows().map(r=>({symbol:r.symbol,company:r.company,industry:r.industry,price:r.price,change_pct:r.change_pct,score:r.score,technical_score:r.technical_score,fundamental_score:r.fundamental_score,signal:r.signal,date:r.date,ruleset_version:r.ruleset_version})),`strata-signals-${snapshot.exchange_date||'snapshot'}.csv`));
  $('#exportTrades').addEventListener('click',()=>exportCsv(closedTrades(),`strata-trades-${snapshot.exchange_date||'snapshot'}.csv`));
  $('#downloadSnapshot').addEventListener('click',()=>downloadText(`strata-snapshot-${snapshot.exchange_date||'demo'}.json`,JSON.stringify(snapshot,null,2),'application/json'));
  $('#topSignalsBody').addEventListener('click',e=>{const tr=e.target.closest('tr[data-symbol]');if(tr)openStockDetail(tr.dataset.symbol);});
  $('#scannerBody').addEventListener('click',e=>{const tr=e.target.closest('tr[data-symbol]');if(tr)openStockDetail(tr.dataset.symbol);});
  $('#detailClose').addEventListener('click',closeStockDetail);$('#detailOverlay').addEventListener('click',e=>{if(e.target.id==='detailOverlay')closeStockDetail();});
  window.addEventListener('resize',()=>{if(snapshot){drawLineChart($('#equityChart'),metrics().b.equity_history.map(x=>Number(x.equity)),metrics().start);drawLineChart($('#performanceChart'),metrics().b.equity_history.map(x=>Number(x.equity)),metrics().start);}});
  if('serviceWorker' in navigator && (location.protocol==='https:'||location.hostname==='localhost')) navigator.serviceWorker.register('./sw.js').catch(()=>{});
  const initial=location.hash.replace('#','');if(['overview','scanner','bot','trades','performance','data'].includes(initial))showView(initial);
  loadSnapshot();
})();
