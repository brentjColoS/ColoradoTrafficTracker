'use strict';
const fs = require('node:fs');
const path = require('node:path');

async function run(c) {
  const {report,pages,origin,fixture,measure,docker,db,output}=c;
  const evidence=report.coldOpening={openings:[],history:[],sql:[]};
  const sql=async query=>JSON.parse(await docker('exec',db,'psql','-X','-U','postgres','-qAt','-v','ON_ERROR_STOP=1','-c',
    "set statement_timeout='15s'; "+query));
  async function inventory() {
    return sql(`select json_build_object(
      'samples',(select count(*) from traffic_sample_all),
      'incidents',(select count(*) from traffic_incident_all),
      'zones',(select count(*) from traffic_speed_zone_sample),
      'events',(select count(*) from traffic_incident_event),
      'sampleCanaries',(select md5(string_agg(to_jsonb(s)::text,'' order by s.sample_ref_id)) from
        (select * from traffic_sample_all order by sample_ref_id limit 100) s),
      'incidentCanaries',(select md5(string_agg(to_jsonb(s)::text,'' order by s.incident_ref_id)) from
        (select * from traffic_incident_all order by incident_ref_id limit 100) s),
      'zoneCanaries',(select md5(string_agg(to_jsonb(s)::text,'' order by s.id)) from
        (select * from traffic_speed_zone_sample order by id limit 100) s))`);
  }
  const save=()=>fs.writeFileSync(path.join(output,'cold-progress.json'),JSON.stringify(report,null,2)+'\n');
  evidence.before=await inventory();
  try {
    for(const phase of ['initial','restart']) {
      if(phase==='restart') await c.restart();
      await docker('exec',db,'psql','-X','-U','postgres','-qAt','-c','select pg_stat_statements_reset()');
      await measure(phase+'-open',async(page,n)=>{
        await page.goto(origin+'/dashboard/',{waitUntil:'domcontentloaded',timeout:20000});
        await page.waitForFunction(()=>window.__capacityUsefulAt>0,{},{timeout:20000});
        const value=await page.evaluate(()=>{
          const t=performance.getEntriesByType('navigation')[0];
          const bytes=new TextEncoder();
          const bootstrap=JSON.parse(document.getElementById('dashboardBootstrap').textContent);
          return {usefulMs:Math.round(window.__capacityUsefulAt),ttfbMs:Math.round(t.responseStart),
            transferMs:Math.round(t.responseEnd-t.responseStart),
            afterResponseMs:Math.round(window.__capacityUsefulAt-t.responseEnd),
            domContentLoadedMs:Math.round(t.domContentLoadedEventEnd),protocol:t.nextHopProtocol,
            encodedBytes:t.encodedBodySize,decodedBytes:t.decodedBodySize,
            bootstrap:Object.entries(bootstrap).map(([key,value])=>({key,bytes:bytes.encode(JSON.stringify(value)).length}))};
        });
        evidence.openings.push({phase,session:n,...value});
        if(value.protocol!=='h2'||value.encodedBytes>=value.decodedBytes) throw new Error('Cold opening requires compressed HTTP/2');
      });
      evidence.sql.push({phase,queries:await sql(`select coalesce(json_agg(q),'[]') from
        (select calls,round(total_exec_time::numeric,2) total_ms,round(max_exec_time::numeric,2) max_ms,
        left(query,400) query from pg_stat_statements where query not like '%pg_stat_statements%'
        order by total_exec_time desc limit 15) q`)});
      save();
      if(report.failures.length) break;
      await measure(phase+'-history',async(page,n)=>{
        await page.waitForFunction(()=>state.snapshots.size===5&&chartHistory.bounds?.size===2,{},{timeout:20000});
        const hours=[2,6,24,168,720][n%5],focus=(n+(phase==='restart'?1:0))%2?'I70':'I25';
        await page.locator('[data-corridor-focus="'+focus+'"]').click();
        await page.getByRole('button',{name:['2H','6H','24H','7D','30D'][n%5],exact:true}).click();
        await page.locator('button[data-chart-view="'+(n>=5?'zones':'overall')+'"]').click();
        await page.evaluate(({end,hours,focus})=>{
          window.__coldProbe={startedAt:performance.now(),chartAt:null,cardsAt:null};
          const inspect=()=>{
            const p=window.__coldProbe,route=chartRouteData(focus);
            let covered=end-hours*3600000;
            for(const part of [...(route?.parts||[])].filter(p=>!p.value.chartUnavailable).sort((a,b)=>a.start-b.start)) {
              if(part.start>covered+60000) break;covered=Math.max(covered,part.end);
            }
            const graph=chartHistory.endTime===end&&!window.ContinuousHistory?.moving&&route&&!route.chartUnavailable
              &&covered>=end-60000&&document.getElementById('chartSummary').textContent.includes(document.getElementById('chartHistoryWindow').textContent);
            if(graph&&p.chartAt===null) p.chartAt=performance.now();
            const card=document.getElementById(focus.toLowerCase()+'Summary');
            const frame=HISTORY_WINDOW_FORMATTER.format(new Date(Math.floor(end/60000)*60000));
            if(graph&&card.getAttribute('aria-busy')==='false'&&card.title.startsWith('Observed data in the selected window')
                &&card.title.includes(frame)&&Number(document.getElementById(focus.toLowerCase()+'AverageSpeed').textContent)>0
                &&Number(document.getElementById(focus.toLowerCase()+'TravelTime').textContent)>0
                &&/^\d+$/.test(document.getElementById(focus.toLowerCase()+'ActiveIncidents').textContent)&&p.cardsAt===null)
              p.cardsAt=performance.now();
          };
          new MutationObserver(inspect).observe(document,{subtree:true,childList:true,characterData:true,attributes:true,
            attributeFilter:['aria-busy','title','data-summary-mode']});
          setHistoryEnd(end);inspect();
        },{end:Date.parse(fixture.anchor)-29*86400000,hours,focus});
        await page.waitForFunction(()=>window.__coldProbe?.cardsAt!==null,{},{timeout:20000});
        const value=await page.evaluate(()=>({chartMs:Math.round(window.__coldProbe.chartAt-window.__coldProbe.startedAt),
          cardsMs:Math.round(window.__coldProbe.cardsAt-window.__coldProbe.startedAt),markerNote:document.getElementById('chartHistoryMarkerNotice').title}));
        evidence.history.push({phase,session:n,hours,focus,view:n>=5?'zones':'overall',...value});
      });
      save();
      if(report.failures.length) break;
    }
  } finally {
    evidence.after=await inventory();evidence.inventoryUnchanged=JSON.stringify(evidence.before)===JSON.stringify(evidence.after);
    if(!evidence.inventoryUnchanged) report.failures.push('Cold opening/restart changed retained rows or canary content');
    save();
  }
  if(evidence.openings.some(x=>x.usefulMs<=0||x.usefulMs>2000)) report.failures.push('Cold opening exceeded two-second target');
  if(evidence.history.some(x=>x.chartMs>10000||x.cardsMs>10000)) report.failures.push('Cold historical window exceeded ten-second target');
}
module.exports={run};
