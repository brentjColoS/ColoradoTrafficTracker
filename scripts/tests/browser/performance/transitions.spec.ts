import {test,expect} from '../fixtures/dashboard';
import {writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';

test.use({nativeAnimationClock:true});

for(const corridor of ['I25','I70']) for(const scene of ['mode','size','finder-size']) test(`${corridor} ${scene} transition performance`,async({page,dashboard},testInfo)=>{
  await page.setViewportSize({width:2560,height:1440});
  const revision=process.env.CTT_MOTION_REVISION;
  if(revision){
    if(!/^[a-f0-9]{7,40}$/.test(revision))throw Error('Use an explicit local commit for the motion baseline');
    for(const asset of ['dashboard.js','dashboard.css','dashboard-trace-handoff.js','corridor-map.js']){
      const body=execFileSync('git',['show',`${revision}:api-service/src/main/resources/static/dashboard/${asset}`]);
      await page.route(`**/dashboard/${asset}?*`,route=>route.fulfill({body,contentType:asset.endsWith('.css')?'text/css':'text/javascript'}));
    }
  }
  await page.goto(dashboard.url+'/dashboard/?corridor='+corridor);
  expect(await page.evaluate(()=>requestAnimationFrame.toString().includes('[native code]'))).toBe(true);
  const settled=async()=>{
    await expect(page.locator('.map-view-changing,.zone-layout-moving,[aria-busy="true"]#zoneMapExpand')).toHaveCount(0);
    await expect.poll(()=>page.locator('#comparisonPanel,.corridor-map-stage').evaluateAll(nodes=>nodes.reduce((n,node)=>n+node.getAnimations().length,0))).toBe(0);
    await expect.poll(()=>page.locator('#corridorMap').evaluate(node=>(node as HTMLElement).inert)).toBe(false);
  };
  if(scene==='mode'||scene==='finder-size'){
    await page.getByRole('button',{name:'Speed zones',exact:true}).click();await settled();
    if(scene==='finder-size')await page.getByRole('button',{name:'Zone Finder',exact:true}).click();
    else{
      await page.getByRole('button',{name:'Enlarge map',exact:true}).click();
      await expect(page.locator('#zoneMapExpand')).toHaveAttribute('aria-pressed','true');
    }
    await settled();
  }
  const toggle=()=>page.getByRole('button',{name:scene==='mode'?'Zone Finder':/map/,exact:scene==='mode'}).click();
  for(let i=0;i<2;i++){await toggle();await settled();}
  await page.evaluate(()=>{
    const result={draws:0,drawMs:0,tracePaints:0,frames:[] as number[],longTasks:[] as number[],longFrames:[] as any[],active:true};
    (window as any).motionProfile=result;
    const draw=(window as any).drawAllCharts;
    (window as any).drawAllCharts=function(...args:any[]){const start=performance.now();try{return draw(...args);}finally{result.draws++;result.drawMs+=performance.now()-start;}};
    const handoff=(window as any).DashboardTraceHandoff,start=handoff.start;
    handoff.start=function(options:any){const paint=options.paint;return start({...options,paint:(...args:any[])=>{result.tracePaints++;return paint(...args);}});};
    let previous=performance.now();const frame=(now:number)=>{if(!result.active)return;result.frames.push(now-previous);previous=now;requestAnimationFrame(frame);};requestAnimationFrame(frame);
    new PerformanceObserver(list=>result.longTasks.push(...list.getEntries().map(entry=>entry.duration))).observe({type:'longtask'});
    if(PerformanceObserver.supportedEntryTypes.includes('long-animation-frame'))new PerformanceObserver(list=>result.longFrames.push(...list.getEntries().map((entry:any)=>({duration:entry.duration,blocking:entry.blockingDuration,scripts:entry.scripts?.map((s:any)=>({name:s.sourceFunctionName,url:s.sourceURL,layout:s.forcedStyleAndLayoutDuration,duration:s.duration}))})))).observe({type:'long-animation-frame'});
  });
  const cdp=await page.context().newCDPSession(page),trace:any[]=[];cdp.on('Tracing.dataCollected',event=>trace.push(...event.value));
  const rate=process.env.CTT_MOTION_CPU==='1'?1:4,tracing=process.env.CTT_MOTION_TRACE!=='0';
  await cdp.send('Performance.enable');await cdp.send('Emulation.setCPUThrottlingRate',{rate});
  if(tracing)await cdp.send('Tracing.start',{categories:'devtools.timeline,disabled-by-default-devtools.timeline.stack,blink.user_timing',transferMode:'ReportEvents'});
  const before=await cdp.send('Performance.getMetrics');
  for(let i=0;i<2;i++){await toggle();await settled();}
  const after=await cdp.send('Performance.getMetrics');
  if(tracing){const completed=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));await cdp.send('Tracing.end');await completed;}
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
  const profile=await page.evaluate(()=>{const result=(window as any).motionProfile;result.active=false;return result;});
  const fields=['LayoutCount','RecalcStyleCount','LayoutDuration','ScriptDuration','TaskDuration'];
  const metrics=Object.fromEntries(fields.map(name=>[name,(after.metrics.find(m=>m.name===name)?.value||0)-(before.metrics.find(m=>m.name===name)?.value||0)]));
  const events=Object.entries(trace.filter(event=>event.ph==='X'&&event.dur).reduce((all:any,event)=>{const item=all[event.name]??={count:0,ms:0,max:0};item.count++;item.ms+=event.dur/1000;item.max=Math.max(item.max,event.dur/1000);return all;},{})).sort((a:any,b:any)=>b[1].ms-a[1].ms).slice(0,15);
  const frames=[...profile.frames].sort((a,b)=>a-b),summary={revision:revision||'working',rate,tracing,corridor,scene,metrics,events,draws:profile.draws,drawMs:profile.drawMs,tracePaints:profile.tracePaints,frames:frames.length,p95:frames[Math.floor(frames.length*.95)],over34:frames.filter(frame=>frame>34).length,max:frames.at(-1),longTasks:profile.longTasks,longFrames:profile.longFrames};
  expect(profile.draws).toBeGreaterThan(0);
  console.log(JSON.stringify(summary));
  await testInfo.attach('transition-profile.json',{body:JSON.stringify(summary,null,2),contentType:'application/json'});
  const tracePath=testInfo.outputPath('transition-trace.json');
  await writeFile(tracePath,JSON.stringify({traceEvents:trace}));
  await testInfo.attach('transition-trace.json',{path:tracePath,contentType:'application/json'});
});
