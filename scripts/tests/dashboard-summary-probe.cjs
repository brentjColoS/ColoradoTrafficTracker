// Fixture-only bounded comparison; never loaded by the application.
function summaryProbe() {
  const button=document.createElement('button'),output=document.createElement('output');
  button.textContent='Measure historical navigation (8s)';button.id='summaryProbeStart';output.id='summaryProbeResult';
  const shell=document.createElement('aside');shell.style.cssText='position:fixed;bottom:8px;right:8px;z-index:10000;background:#fffded;color:#002500;padding:8px;max-width:520px;font:11px monospace';
  shell.append(button,output);document.body.append(shell);
  button.onclick=async()=>{
    if(button.disabled||document.hidden)return;button.disabled=true;output.textContent='Measuring…';
    const fetchBefore=window.fetch,drawBefore=drawAllCharts,reads=[],draws=[],frames=[];
    let frameId,previous=performance.now(),started=previous,observer,tasks=[];
    const supportsTasks=typeof PerformanceObserver==='function'&&PerformanceObserver.supportedEntryTypes.includes('longtask');
    window.fetch=async(...args)=>{const at=performance.now(),path=String(args[0]);try{return await fetchBefore(...args);}finally{if(path.includes('/dashboard-api/'))reads.push({path:path.split('?')[0],ms:performance.now()-at});}};
    drawAllCharts=function(...args){const at=performance.now();try{return drawBefore(...args);}finally{draws.push(performance.now()-at);}};
    if(supportsTasks){observer=new PerformanceObserver(list=>tasks.push(...list.getEntries().map(e=>e.duration)));observer.observe({type:'longtask'});}
    const intervals=[],timeouts=[];let hidden=false;
    const onHidden=()=>{if(document.hidden)hidden=true;};document.addEventListener('visibilitychange',onHidden);
    const tick=now=>{frames.push(now-previous);previous=now;if(now-started<8000&&!hidden)frameId=requestAnimationFrame(tick);};frameId=requestAnimationFrame(tick);
    const heights=[];heights.push(document.querySelector('.corridor-summary-grid').getBoundingClientRect().height);
    let presses=0;
    intervals.push(setInterval(()=>{if(presses++<12&&!hidden)document.getElementById('historyOlder').click();},180));
    try {
      await new Promise(resolve=>timeouts.push(setTimeout(resolve,8200)));
      const sorted=frames.slice(1).sort((a,b)=>a-b),sortDraws=draws.slice().sort((a,b)=>a-b);
      const percentile=(rows,p)=>rows.length?Number(rows[Math.floor((rows.length-1)*p)].toFixed(2)):null;
      const timing=reads.filter(r=>r.path.endsWith('/window-summary'));
      heights.push(document.querySelector('.corridor-summary-grid').getBoundingClientRect().height);
      output.textContent=JSON.stringify({baseline:new URLSearchParams(location.search).has('summaryBaseline'),hidden,
        frames:sorted.length,frameMedianMs:percentile(sorted,.5),frameP95Ms:percentile(sorted,.95),framesOver50ms:sorted.filter(v=>v>50).length,
        drawCalls:draws.length,drawP95Ms:percentile(sortDraws,.95),summaryReads:timing.length,summaryReadMs:timing.map(r=>Number(r.ms.toFixed(2))),
        graphReads:reads.filter(r=>r.path.endsWith('/history')).length,longTasks:supportsTasks?tasks.length:null,
        panelHeightChange:Number((heights[1]-heights[0]).toFixed(2)),summary:document.getElementById('i25AverageSpeed').textContent});
    } finally {
      clearInterval(intervals[0]);timeouts.forEach(clearTimeout);cancelAnimationFrame(frameId);observer?.disconnect();
      document.removeEventListener('visibilitychange',onHidden);window.fetch=fetchBefore;drawAllCharts=drawBefore;button.disabled=false;
    }
  };
}
module.exports={source:`(${summaryProbe.toString()})();`};
