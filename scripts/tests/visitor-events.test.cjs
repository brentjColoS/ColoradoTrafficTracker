const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {randomUUID} = require('node:crypto');
const code = readFileSync(path.join(__dirname,'../../api-service/src/main/resources/static/dashboard/visitor-events.js'),'utf8');

function browser(options = {}) {
  const documentEvents = {}, captureEvents = {}, windowEvents = {}, timers = new Map(), requests = [], beacons = [];
  const storage = options.storage || new Map(); let clock = 1780000000000, nextTimer = 0;
  const navigator = {globalPrivacyControl:options.gpc, doNotTrack:options.dnt,
    sendBeacon(url,blob){beacons.push({url,blob});return true;}};
  const location = new URL(options.url || 'https://traffic.example/dashboard-experimental/');
  const document = {hidden:false,referrer:'https://linkedin.com/private/path?secret=private',
    documentElement:{dataset:{theme:'dark'}},querySelector(){return options.enabled === false ? null : {content:options.endpoint || '/dashboard-experimental-events'};},
    addEventListener(name,callback,capture){(capture ? captureEvents : documentEvents)[name]=callback;}};
  const window = {location,innerWidth:393,innerHeight:852,CTT_ENTRY_SOURCE:options.source ?? 'resume',
    addEventListener(name,callback){windowEvents[name]=callback;}};
  const sessionStorage = {getItem(key){if(options.blockStorage)throw Error('Blocked');return storage.get(key)||null;},
    setItem(key,value){if(options.blockStorage)throw Error('Blocked');storage.set(key,value);},removeItem(key){storage.delete(key);}};
  vm.runInNewContext(code,{document,window,navigator,sessionStorage,URL,Blob,crypto:{randomUUID},
    Date:class extends Date {static now(){return clock;}},setTimeout(fn){timers.set(++nextTimer,fn);return nextTimer;},
    clearTimeout(id){timers.delete(id);},fetch(url,config){requests.push({url,config});return options.fetchResult || Promise.resolve({ok:options.ok!==false});}});
  function click(id='',dataset={},extra={}) {
    const node={id,dataset,disabled:false,parentElement:{open:false},matches(){return false;},
      closest(){return null;},getAttribute(){return 'true';},hasAttribute(){return false;},...extra};
    const event={isTrusted:true,target:{closest(selector){return selector==='#apiRun' && id!=='apiRun' ? null : node;}}};
    captureEvents.click?.(event);
    if (extra.disableAfterCapture) node.disabled=true;
    documentEvents.click?.(event);
  }
  return {document,window,navigator,storage,requests,beacons,timers,click,
    flush(){const pending=[...timers.values()];timers.clear();pending.forEach(fn=>fn());},
    advance(ms){clock+=ms;},hide(){document.hidden=true;documentEvents.visibilitychange?.();windowEvents.pagehide?.();},
    submit(submitter){documentEvents.submit?.({isTrusted:true,target:{id:'apiExplorerForm'},submitter});}};
}

test('visitor collection stays off without explicit activation, on production paths, and for browser privacy signals',()=>{
  for(const options of [{enabled:false},{url:'https://traffic.example/dashboard/'},{gpc:true},{dnt:'1'},{dnt:'yes'},{blockStorage:true}]) {
    const b=browser(options);b.click('refreshButton');b.flush();b.hide();
    assert.equal(b.requests.length,0);assert.equal(b.beacons.length,0);assert.equal(b.storage.size,0);
  }
});

test('one delayed batch contains allowlisted actions without typed content, URLs, cookies, or referrer paths',()=>{
  const b=browser();b.click('',{corridorFocus:'I70'});b.click('',{hours:'6'});b.click('zoneFinderToggle');b.click('unknown',{value:'secret typed text'});
  assert.equal(b.requests.length,0);assert.equal(b.timers.size,1);b.flush();
  assert.equal(b.requests.length,1);
  const request=b.requests[0],data=JSON.parse(request.config.body);
  assert.equal(request.url,'/dashboard-experimental-events');assert.equal(request.config.credentials,'omit');
  assert.deepEqual(data.events.map(e=>e.action),['','corridor:I70','range:6','zone-finder:on']);
  assert.equal(data.source,'resume');assert.equal(data.referrer,'linkedin.com');
  for(const privateValue of ['secret typed text','private/path','secret=','cookie'])assert.ok(!request.config.body.includes(privateValue));
  assert.equal(new Set(data.events.map(e=>e.id)).size,data.events.length);
});

test('hidden/pagehide flushes only once and navigation retains the short-lived session and entry source',async()=>{
  const b=browser();b.click('apiCopy');b.hide();assert.equal(b.beacons.length,1);assert.equal(b.timers.size,0);
  const first=JSON.parse(await b.beacons[0].blob.text());
  const next=browser({storage:b.storage,source:'',url:'https://traffic.example/dashboard-experimental/api.html'});
  next.window.CTT_ENTRY_SOURCE='';next.flush();
  const data=JSON.parse(next.requests[0].config.body);
  assert.equal(first.session,data.session);assert.equal(data.source,'resume');
});

test('privacy enabled before flush discards the queue and session; failures do not retry or block the page',async()=>{
  const b=browser();b.navigator.globalPrivacyControl=true;b.flush();assert.equal(b.requests.length,0);assert.equal(b.storage.size,0);
  const failed=browser({ok:false});failed.flush();await new Promise(resolve=>setImmediate(resolve));
  failed.click('refreshButton');failed.flush();assert.equal(failed.requests.length,1);assert.equal(failed.timers.size,0);
});

test('idle sessions rotate, queue bursts stay bounded, and keyboard form submit is recorded once',()=>{
  const b=browser();b.flush();const first=JSON.parse(b.requests[0].config.body).session;
  b.advance(31*60000);b.click('apiCopy');b.hide();
  const saved=JSON.parse(b.storage.get('ctt-visitor-session:/dashboard-experimental/'));assert.notEqual(saved.id,first);
  const burst=browser();for(let i=0;i<100;i++)burst.click('refreshButton');
  assert.equal(JSON.parse(burst.requests[0].config.body).events.length,20);
  assert.equal(JSON.parse(burst.requests[0].config.body).events[0].action,'');
  const form=browser();form.submit();form.flush();assert.deepEqual(JSON.parse(form.requests[0].config.body).events.map(e=>e.action),['','api:run']);
});

test('an old document request failing after navigation cannot clear the next page session',async()=>{
  let reject;
  const previous=browser({fetchResult:new Promise((_,fail)=>{reject=fail;})});previous.flush();
  const next=browser({storage:previous.storage,source:'',url:'https://traffic.example/dashboard-experimental/system.html'});
  const saved=next.storage.get('ctt-visitor-session:/dashboard-experimental/');
  reject(Error('Navigation interrupted request'));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(next.storage.get('ctt-visitor-session:/dashboard-experimental/'),saved);
  const third=browser({storage:next.storage,source:'',url:'https://traffic.example/dashboard-experimental/api.html'});third.flush();
  const data=JSON.parse(third.requests[0].config.body);
  assert.equal(data.session,JSON.parse(saved).id);assert.equal(data.source,'resume');
});

test('API execution is captured before its handler disables the button without double-counting native submission',()=>{
  const b=browser();b.click('apiRun',{}, {disableAfterCapture:true});b.submit({id:'apiRun'});b.flush();
  assert.deepEqual(JSON.parse(b.requests[0].config.body).events.map(e=>e.action),['','api:run']);
});

test('production collects only its four explicitly activated pages and cannot share experimental sessions',()=>{
  const storage=new Map();
  const experimental=browser({storage});experimental.flush();
  const oldSession=JSON.parse(experimental.requests[0].config.body).session;
  for(const suffix of ['', 'index.html', 'system.html', 'api.html', 'data.html']){
    const b=browser({storage,url:'https://traffic.example/dashboard/'+suffix,endpoint:'/visitor-events'});
    b.click('apiCopy');b.flush();
    assert.equal(b.requests.length,1);assert.equal(b.requests[0].url,'/visitor-events');
    const data=JSON.parse(b.requests[0].config.body);
    assert.notEqual(data.session,oldSession);assert.equal(data.events[0].page,'/dashboard/'+suffix);
  }
  for(const options of [
    {url:'https://traffic.example/dashboard-experimental/',endpoint:'/visitor-events'},
    {url:'https://traffic.example/dashboard/operator',endpoint:'/visitor-events'},
    {url:'https://traffic.example/dashboard/',endpoint:'/other'},
    {url:'https://traffic.example/dashboard/',endpoint:'/visitor-events',enabled:false},
    {url:'https://traffic.example/dashboard/',endpoint:'/visitor-events',gpc:true},
    {url:'https://traffic.example/dashboard/',endpoint:'/visitor-events',dnt:'1'}]) {
    const b=browser(options);b.flush();b.hide();assert.equal(b.requests.length+b.beacons.length,0);
  }
});
