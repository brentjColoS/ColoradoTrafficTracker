const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync,existsSync} = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname,'../../api-service/src/main/resources/static/dashboard');
const html = readFileSync(path.join(root,'why.html'),'utf8');
const source = readFileSync(path.join(root,'why.js'),'utf8');

function workshop(observe=true,{reduced=false,playMode='resolve'}={}) {
  const events=target=>Object.assign(target,{addEventListener(event,handler){const previous=this[event];this[event]=previous ? (...args)=>{previous(...args);handler(...args);} : handler;}});
  const node=()=>events({attributes:{},textContent:'',setAttribute(key,value){this.attributes[key]=value;}});
  const rows=Array.from({length:4},()=>({dataset:{},nodes:Object.fromEntries(['line','area','speed','state','needle','point','cursor'].map(key=>[key,node()])),
    querySelector(selector){return this.nodes[selector.replace('.why-pattern-','')];}}));
  const pattern={dataset:{},classList:{toggle(){}},querySelectorAll:()=>rows};
  const time={...node(),value:'5',addEventListener(event,handler){this[event]=handler;}};
  const clock=node(),takeaway=node(),explanation=node(),play=node();
  const trip={classes:new Set(),classList:{toggle(key,value){if(value)trip.classes.add(key);else trip.classes.delete(key);}}};
  const pending=[];
  const video=events({paused:true,currentTime:0,playCalls:0,
    play(){
      this.playCalls++;
      if(playMode==='blocked') return Promise.reject(Object.assign(new Error('Playback blocked'),{name:'NotAllowedError'}));
      if(playMode==='pending') return new Promise((resolve,reject)=>pending.push({resolve(){video.paused=false;resolve();},reject}));
      this.paused=false;return Promise.resolve();
    },pause(){this.paused=true;}});
  const videoToggle=node();
  const videoViewport=node();
  const nodes={whyPattern:pattern,whyPatternTime:time,whyPatternClock:clock,whyPatternTakeaway:takeaway,whyPatternExplanation:explanation,whyPatternPlay:play,
    whyTrip:trip,whyTripVideo:video,whyTripMedia:videoViewport,whyTripToggle:videoToggle};
  let callback,disconnected=false,timerId=0,now=0;
  const observed=[],timers=new Map();
  const media=events({matches:reduced});
  const themes=[];
  const window=events({matchMedia:()=>media,BrowserTheme:{initialize:options=>themes.push(options)}});
  if(observe) window.IntersectionObserver=class {
    constructor(handler){callback=handler;}
    observe(node){observed.push(node);}
    disconnect(){disconnected=true;}
  };
  const document=events({hidden:false,getElementById:id=>nodes[id],querySelectorAll:()=>[videoViewport,pattern]});
  const noNetwork=()=>{throw new Error('The Why illustration must not request traffic data');};
  const patterns=vm.runInNewContext(source+';whyPatterns',{document,window,fetch:noNetwork,setInterval:noNetwork,
    setTimeout(handler,delay){timers.set(++timerId,{handler,delay,at:now+delay});return timerId;},clearTimeout(id){timers.delete(id);}});
  return {rows,time,clock,takeaway,explanation,trip,video,videoViewport,videoToggle,pending,window,pattern,play,timers,observed,patterns,themes,
    advance(milliseconds){
      const until=now+milliseconds;
      while(timers.size){
        const [id,timer]=[...timers.entries()].sort((a,b)=>a[1].at-b[1].at)[0];
        if(timer.at>until)break;
        now=timer.at;timers.delete(id);timer.handler();
      }
      now=until;
    },
    setPlayMode(mode){playMode=mode;},
    setTime(value){time.value=String(value);time.input();},
    tick(){const [id,timer]=timers.entries().next().value;timers.delete(id);timer.handler();},
    hide(hidden){document.hidden=hidden;document.visibilitychange();},
    reduce(matches){media.matches=matches;media.change();},
    get disconnected(){return disconnected;},
    videoVisibility:visible=>callback([{target:videoViewport,isIntersecting:visible}]),
    visibility:visible=>callback([{target:videoViewport,isIntersecting:visible},{target:pattern,isIntersecting:visible}])};
}
const settled=()=>new Promise(resolve=>setImmediate(resolve));

test('the Why page has working local assets, unique targets and no live collection activation',()=>{
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(([,id])=>id);
  assert.equal(ids.length,new Set(ids).size);
  assert.equal([...html.matchAll(/<h1\b/g)].length,1);
  for(const [,reference] of html.matchAll(/(?:src|href|poster)="([^"]+)"/g)) {
    if(reference.startsWith('https://')) continue;
    if(reference.startsWith('#')) assert.ok(ids.includes(reference.slice(1)),reference);
    else assert.ok(existsSync(path.resolve(root,reference.split('?')[0])),reference);
  }
  assert.doesNotMatch(html,/ctt-visitor-endpoint|visitor-events\.js|maplibre/);
  assert.match(html,/Selected historical example, not a forecast/);
});

test('the Why page uses the current shared theme without loading unrelated API or system controllers',()=>{
  assert.ok(html.indexOf('browser-theme.js?v=shared-theme-1') < html.indexOf('why.js?v=shared-theme-1'));
  assert.doesNotMatch(html,/information-(?:pages|api|data)\.js/);
  const view=workshop();
  assert.equal(view.themes.length,1);
  assert.equal(view.themes[0].recheckStoredPreference,true);
});

test('every public page exposes the same local navigation and current page',()=>{
  const pages=['index.html','system.html','data.html','why.html','api.html'];
  const destinations=['./','why.html','system.html','data.html','api.html','https://github.com/brentjColoS/ColoradoTrafficTracker'];
  for(const page of pages) {
    const markup=readFileSync(path.join(root,page),'utf8');
    const nav=markup.match(/<nav class="site-nav"[^>]*>([\s\S]*?)<\/nav>/)[1];
    assert.deepEqual([...nav.matchAll(/href="([^"]+)"/g)].map(([,href])=>href),destinations,page);
    const current=[...nav.matchAll(/<a\b[^>]*aria-current="page"[^>]*>/g)];
    assert.equal(current.length,1,page);
    assert.match(current[0][0],new RegExp(`href="${page==='index.html'?'\\./':page.replace('.','\\.')}"`));
    assert.match(markup,/dashboard\.css\?v=centered-site-header-1/);
  }
});

test('one native time control keeps all historical days and accessible readouts synchronized',()=>{
  const view=workshop();
  for(let index=0;index<=8;index++) {
    view.setTime(index);
    const positions=view.rows.map(row=>row.nodes.cursor.attributes.transform);
    assert.ok(positions.every(position=>position===positions[0]));
    for(const [day,row] of view.rows.entries()) {
      assert.equal(row.nodes.cursor.attributes.transform,`translate(${index*45} 0)`);
      assert.ok(Number.isFinite(row.nodes.point.attributes.cy));
      assert.ok(view.time.attributes['aria-valuetext'].includes(`${view.patterns[day].date}: ${row.nodes.speed.textContent}, ${row.nodes.state.textContent.toLowerCase()}`));
      assert.equal(row.nodes.speed.textContent,`${view.patterns[day].speeds[index].toFixed(1)} mph`);
    }
    assert.ok(view.time.attributes['aria-valuetext'].startsWith(view.clock.textContent));
  }
  view.setTime(0);assert.equal(view.clock.textContent,'10–11 AM');
  view.setTime(1);assert.equal(view.clock.textContent,'11 AM–12 PM');
  view.setTime(8);assert.equal(view.clock.textContent,'6–7 PM');
});

test('selected history preserves the same hourly window and scale without inventing measurements between hours',()=>{
  const view=workshop();
  assert.equal(view.patterns.map(day=>day.date).join(','),'2026-09-02,2026-09-09,2026-09-16,2026-09-20');
  for(const day of view.patterns) {
    assert.equal(day.speeds.length,9);assert.equal(day.samples.length,9);
    assert.ok(day.samples.every(count=>count>=59&&count<=60));
    assert.ok(day.speeds.every(speed=>speed>=40&&speed<=70));
  }
  view.setTime(6);
  assert.equal(view.rows[3].nodes.speed.textContent,'41.6 mph');
  assert.equal(view.rows[3].nodes.point.attributes.cy,40-(view.patterns[3].speeds[6]-40)*1.2);
  assert.ok(view.patterns.slice(0,3).every(day=>day.speeds[6]>67));
  assert.match(view.takeaway.textContent,/Three Wednesdays/);
  assert.ok(view.patterns.slice(0,3).every(day=>new Date(day.date+'T12:00:00Z').getUTCDay()===3));
  assert.equal(new Date(view.patterns[3].date+'T12:00:00Z').getUTCDay(),0);
  assert.match(html,/Lines connect hourly means/);
  assert.match(html,/combining both directions/);
  assert.match(html,/Mountain Daylight Time/);
  assert.match(html,/MM 206–259/);
  assert.match(html,/<input[^>]+type="range"[^>]+min="0"[^>]+max="8"/);
});

test('invalid workshop input cannot move a cursor off its illustration',()=>{
  const view=workshop();
  for(const value of [-50,90,'unavailable']) {
    view.setTime(value);
    assert.equal(view.rows.every(row=>Number(row.nodes.cursor.attributes.transform.match(/\d+/)[0])<=360),true);
    assert.doesNotMatch(view.clock.textContent,/NaN|undefined/);
  }
});

test('trend labels distinguish a slowdown, a low plateau and clearing without calling the first hour a trend',()=>{
  const view=workshop();
  view.setTime(0);assert.ok(view.rows.every(row=>row.nodes.state.textContent==='Start'));
  view.setTime(1);assert.equal(view.rows[3].nodes.state.textContent,'Slowing');
  assert.ok(view.rows.slice(0,3).every(row=>row.nodes.state.textContent==='Moving'));
  view.setTime(6);assert.equal(view.rows[3].nodes.state.textContent,'Slow');
  view.setTime(7);assert.equal(view.rows[3].nodes.state.textContent,'Clearing');
  assert.equal(view.rows[3].dataset.state,'clearing');
  assert.match(view.time.attributes['aria-valuetext'],/44.6 mph, clearing/);
});

test('each chart includes matching mph guides and its own time marks',()=>{
  assert.equal([...html.matchAll(/class="why-pattern-mph"/g)].length,4);
  assert.equal([...html.matchAll(/class="why-pattern-times"/g)].length,4);
  assert.equal([...html.matchAll(/M0 4H360 M0 16H360 M0 28H360 M0 40H360/g)].length,4);
  assert.match(html,/40–70 mph/);
  assert.match(html,/<span>10a<\/span><span>2p<\/span><span>6p<\/span>/);
});

test('the hero uses a muted inline native loop without preloading or unconditional autoplay',()=>{
  const video=html.match(/<video\b[^>]*>/)[0];
  for(const attribute of ['muted','loop','playsinline','controls']) assert.match(video,new RegExp(`\\b${attribute}\\b`));
  assert.match(video,/preload="none"/);
  assert.match(video,/width="480" height="350"/);
  assert.doesNotMatch(video,/\bautoplay\b/);
  assert.match(video,/poster="media\/why-snowboarding-still.jpg"/);
  assert.match(html,/<div\b[^>]*\bid="whyTripMedia"[^>]*\bdata-why-motion/);
  assert.doesNotMatch(video,/\bdata-why-motion/,'visibility must survive hiding the video for its still');
  assert.match(html,/<img[^>]+src="media\/why-snowboarding-still.jpg"[^>]+alt="[^"]+"/);
});

test('video playback waits for visibility and retains its position across offscreen pauses',async()=>{
  const view=workshop();
  assert.equal(view.video.playCalls,0);
  assert.equal(view.observed.includes(view.videoViewport),true);
  view.videoVisibility(true);view.videoVisibility(true);await settled();
  assert.equal(view.video.playCalls,1);
  assert.equal(view.video.paused,false);
  assert.equal(view.timers.size,0,'the native video loop needs no polling timer');
  view.video.currentTime=4;
  view.videoVisibility(false);assert.equal(view.video.paused,true);
  view.videoVisibility(true);await settled();
  assert.equal(view.video.currentTime,4);
  assert.equal(view.video.paused,false);
});

test('video pauses for hidden tabs and page exits, and only bfcache returns can resume it',async()=>{
  const view=workshop();
  view.videoVisibility(true);await settled();
  view.hide(true);assert.equal(view.video.paused,true);
  view.hide(false);await settled();assert.equal(view.video.paused,false);
  view.window.pagehide({persisted:true});assert.equal(view.video.paused,true);assert.equal(view.disconnected,false);
  view.window.pageshow();await settled();assert.equal(view.video.paused,false);
  view.window.pagehide({persisted:false});assert.equal(view.video.paused,true);assert.equal(view.disconnected,true);
  const calls=view.video.playCalls;
  view.window.pageshow();assert.equal(view.video.playCalls,calls);
});

test('the illustration remains usable without motion-observer support',()=>{
  const view=workshop(false);
  view.setTime(5);
  assert.equal(view.clock.textContent,'3–4 PM');
  assert.equal(view.trip.classes.has('is-static'),true);
  assert.equal(view.videoToggle.hidden,true);
  assert.equal(view.video.playCalls,0);
  assert.equal(view.play.disabled,true);
  assert.equal(view.timers.size,0);
});

test('reduced motion shows the supplied still and never starts the video',async()=>{
  const view=workshop(true,{reduced:true});
  view.videoVisibility(true);await settled();
  assert.equal(view.trip.classes.has('is-static'),true);
  assert.equal(view.videoToggle.hidden,true);
  assert.equal(view.video.playCalls,0);
  view.reduce(false);await settled();assert.equal(view.video.paused,false);
  view.reduce(true);assert.equal(view.video.paused,true);
  assert.equal(view.trip.classes.has('is-static'),true);
});

test('manual video pause persists across scrolling and tab changes, independently of the comparison',async()=>{
  const view=workshop();view.visibility(true);await settled();
  view.videoToggle.click();assert.equal(view.video.paused,true);
  assert.equal(view.videoToggle.textContent,'Play video');
  assert.equal([...view.timers.values()].filter(timer=>timer.delay!==180_000).length,1);
  view.visibility(false);view.visibility(true);view.hide(true);view.hide(false);await settled();
  assert.equal(view.video.paused,true);
  view.videoToggle.click();await settled();assert.equal(view.video.paused,false);
});

test('blocked autoplay offers a manual retry and decoding errors fall back to the still',async()=>{
  const view=workshop(true,{playMode:'blocked'});view.videoVisibility(true);await settled();
  assert.equal(view.videoToggle.textContent,'Play video');
  view.setPlayMode('resolve');view.videoToggle.click();await settled();
  assert.equal(view.video.paused,false);
  view.video.error();assert.equal(view.video.paused,true);
  assert.equal(view.trip.classes.has('is-static'),true);
  assert.equal(view.videoToggle.hidden,true);
});

test('three uninterrupted visible paused minutes show the still, and Play restores the video at its position',async()=>{
  const view=workshop();view.videoVisibility(true);await settled();
  view.video.currentTime=4;view.videoToggle.click();
  assert.equal(view.timers.size,1);
  view.advance(179_999);assert.equal(view.trip.classes.has('is-static'),false);
  view.videoVisibility(true);assert.equal(view.timers.size,1);
  view.advance(1);assert.equal(view.trip.classes.has('is-static'),true);
  assert.equal(view.timers.size,0);
  assert.equal(view.videoToggle.hidden,false);
  assert.equal(view.videoToggle.textContent,'Play video');
  assert.equal(view.video.paused,true);
  view.videoToggle.click();await settled();
  assert.equal(view.trip.classes.has('is-static'),false);
  assert.equal(view.video.paused,false);
  assert.equal(view.video.currentTime,4);
  assert.equal(view.timers.size,0);
});

test('offscreen, hidden, reduced-motion and cached-page intervals reset the paused-still countdown',async()=>{
  for(const reason of ['offscreen','hidden','reduced','cached']) {
    const view=workshop();view.videoVisibility(true);await settled();view.videoToggle.click();
    view.advance(120_000);
    if(reason==='offscreen')view.videoVisibility(false);
    if(reason==='hidden')view.hide(true);
    if(reason==='reduced')view.reduce(true);
    if(reason==='cached')view.window.pagehide({persisted:true});
    assert.equal(view.timers.size,0,reason);
    view.advance(600_000);
    if(reason==='offscreen')view.videoVisibility(true);
    if(reason==='hidden')view.hide(false);
    if(reason==='reduced')view.reduce(false);
    if(reason==='cached')view.window.pageshow();
    view.advance(179_999);assert.equal(view.trip.classes.has('is-static'),false,reason);
    view.advance(1);assert.equal(view.trip.classes.has('is-static'),true,reason);
    assert.equal(view.videoToggle.hidden,false,reason);
  }
});

test('resuming or leaving the page cancels idle work, including a stale already-queued timeout',async()=>{
  const view=workshop();view.videoVisibility(true);await settled();view.videoToggle.click();
  const stale=[...view.timers.values()][0].handler;
  view.advance(100_000);view.videoToggle.click();await settled();
  assert.equal(view.timers.size,0);
  view.videoToggle.click();stale();
  assert.equal(view.trip.classes.has('is-static'),false);
  view.advance(179_999);assert.equal(view.trip.classes.has('is-static'),false);
  view.window.pagehide({persisted:false});assert.equal(view.timers.size,0);
  view.advance(600_000);assert.equal(view.trip.classes.has('is-static'),false);
});

test('a late play result cannot restart offscreen video, and a cancelled request can recover on re-entry',async()=>{
  const view=workshop(true,{playMode:'pending'});
  view.videoVisibility(true);view.videoVisibility(false);view.pending.shift().resolve();await settled();
  assert.equal(view.video.paused,true);
  view.videoVisibility(true);view.videoVisibility(false);view.videoVisibility(true);
  view.setPlayMode('resolve');
  view.pending.shift().reject(Object.assign(new Error('Cancelled by pause'),{name:'AbortError'}));await settled();
  assert.equal(view.video.paused,false);
});

test('illustration playback owns one timer only while visible and releases it across page lifecycle changes',()=>{
  const view=workshop();
  assert.equal(view.timers.size,0);
  view.visibility(true);view.visibility(true);
  assert.equal(view.timers.size,1);
  view.tick();assert.equal(view.clock.textContent,'4–5 PM');
  assert.equal(view.timers.size,1);
  view.visibility(false);assert.equal(view.timers.size,0);
  view.visibility(true);view.hide(true);assert.equal(view.timers.size,0);
  view.hide(false);assert.equal(view.timers.size,1);
  view.window.pagehide({persisted:true});assert.equal(view.timers.size,0);
  view.window.pageshow();assert.equal(view.timers.size,1);
  view.window.pagehide({persisted:false});assert.equal(view.timers.size,0);
  view.window.pageshow();assert.equal(view.timers.size,0);
  assert.equal(view.disconnected,true);
});

test('manual focus or input pauses playback until explicitly resumed, and reduced motion leaves a manual illustration',()=>{
  const view=workshop();
  view.visibility(true);view.time.focus();assert.equal(view.timers.size,0);
  view.hide(true);view.hide(false);assert.equal(view.timers.size,0);
  view.play.click();assert.equal(view.timers.size,1);
  view.setTime(4);assert.equal(view.timers.size,0);
  assert.equal(view.clock.textContent,'2–3 PM');
  view.play.click();view.time.pointerdown();assert.equal(view.timers.size,0);
  view.play.click();view.reduce(true);assert.equal(view.timers.size,0);
  assert.equal(view.play.disabled,true);
  view.setTime(8);assert.equal(view.clock.textContent,'6–7 PM');
  view.reduce(false);assert.equal(view.timers.size,0);
  view.play.click();assert.equal(view.timers.size,1);
  assert.equal([...view.timers.values()][0].delay,4500);
  view.tick();assert.equal(view.clock.textContent,'10–11 AM');
  assert.equal(view.pattern.dataset.rewinding,'true');
});
