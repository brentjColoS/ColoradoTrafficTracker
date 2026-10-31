const { vm, assert, informationPages, estimatesSource, informationSource, readFileSync, path } = require('./core.cjs');
const { testDirectory } = require('./core.cjs');

const motionDiagnostic = require("../dashboard-motion-preview.cjs");

async function motionServerTest(t, fixtureGet, readSource) {
  const server = motionDiagnostic.createMotionServer({ fixtureGet, readSource });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return async (pathname, options = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${pathname}`, options);
    return { status:response.status, headers:response.headers, body:await response.text() };
  };
}

function motionProbeTest() {
  let now=0,id=0;
  const timers=new Map(),frames=new Map(),events=new Map();
  const selected={value:'map',disabled:false},button={disabled:false},output={textContent:''};
  const target={scrollIntoView(){},querySelector(){return {};},querySelectorAll(){return [];},
    getAnimations(){return[{playState:'running'}];},focus(){},blur(){}};
  const controls={style:{},querySelector(selector){return selector==='select'?selected:selector==='button'?button:output;}};
  class Element {}
  Element.prototype.getBoundingClientRect=function(){return{width:400};};
  const original=Element.prototype.getBoundingClientRect;
  const eventApi={addEventListener(name,callback){events.set(name,callback);},
    removeEventListener(name,callback){if(events.get(name)===callback)events.delete(name);}};
  const document={...eventApi,hidden:false,createElement(){return controls;},
    body:{appendChild(){}},querySelector(){return target;},getElementById(){return null;}};
  const context={document,window:{...eventApi,__motionPaintCalls:0},Element,URLSearchParams,
    location:{search:'?motionRevision=current&motionScene=map'},innerWidth:1093,innerHeight:827,devicePixelRatio:2,
    performance:{now:()=>now},setTimeout(callback,ms){timers.set(++id,{callback,ms});return id;},
    clearTimeout(id){timers.delete(id);},requestAnimationFrame(callback){frames.set(++id,callback);return id;},
    cancelAnimationFrame(id){frames.delete(id);}};
  vm.runInNewContext(motionDiagnostic.probe,context);
  const fireTimer=ms=>{const entry=[...timers].find(([,timer])=>timer.ms===ms);assert.ok(entry);
    timers.delete(entry[0]);entry[1].callback();};
  const tick=()=>{now+=16.6667;const next=[...frames];frames.clear();for(const[,callback]of next)callback(now);};
  const start=async()=>{const completion=button.onclick();fireTimer(500);await new Promise(setImmediate);return{completion};};
  const clean=()=>{assert.equal(Element.prototype.getBoundingClientRect,original);
    assert.equal(frames.size,0);assert.equal(timers.size,0);assert.equal(events.size,0);
    assert.equal(button.disabled,false);assert.equal(selected.disabled,false);};
  return{start,tick,clean,fireTimer,document,events,output};
}

function connectorFixture() {
  const page=informationPage(),order=[],frames=new Map(),events={},observers=[];
  let id=0;
  for(const [name,top,bottom]of [['tomtomProvider',10,50],['routeAuthority',10,40],['ingestService',100,200]]) {
    const node=page.context.document.getElementById(name);
    node.getBoundingClientRect=()=>{order.push('read');return {top,bottom};};
  }
  const container={getBoundingClientRect(){order.push('read');return {top:60,bottom:100};}};
  const links=['tomtomProvider','routeAuthority'].map(from=>({
    dataset:{connectorFrom:from,connectorTo:'ingestService'},parentElement:container,
    style:{setProperty(name,value){order.push('write');this[name]=value;}}
  }));
  page.nodes.get('systemArchitecture').querySelectorAll=()=>links;
  Object.assign(page.context.window,{
    requestAnimationFrame(callback){const next=++id;frames.set(next,callback);return next;},
    cancelAnimationFrame(next){frames.delete(next);},
    addEventListener(name,callback){events[name]=callback;},
    IntersectionObserver:class {
      constructor(callback){this.callback=callback;observers.push(this);}
      observe(){} disconnect(){this.disconnected=true;}
    },
    ResizeObserver:class {
      constructor(callback){this.callback=callback;observers.push(this);}
      observe(){} disconnect(){this.disconnected=true;}
    }
  });
  page.context.document.addEventListener=(name,callback)=>events[name]=callback;
  const flush=()=>{const batch=[...frames.values()];frames.clear();batch.forEach(fn=>fn());};
  page.run('initializeArchitectureConnectors()');
  return {page,order,frames,events,observers,links,flush};
}

function verificationFixture(reduced=false) {
  const page=informationPage(),timers=new Map(),events={};
  let next=0,observer;
  const panel=page.context.document.getElementById('verificationConsole');
  const gates=Array.from({length:6},()=>page.context.document.createElement('li'));
  panel.querySelectorAll=()=>gates;
  Object.assign(page.context.window,{
    matchMedia(){return {matches:reduced};},
    setTimeout(callback,delay){const id=++next;timers.set(id,{callback,delay});return id;},
    clearTimeout(id){timers.delete(id);},
    addEventListener(name,callback){events[name]=callback;},
    IntersectionObserver:class {
      constructor(callback){this.callback=callback;observer=this;}
      observe(){} disconnect(){this.disconnected=true;}
    }
  });
  page.context.document.addEventListener=(name,callback)=>events[name]=callback;
  page.run('initializeVerificationConsole()');
  return {page,panel,gates,timers,events,get observer(){return observer;}};
}

function informationPage(fetch = async () => { throw new Error('Offline'); }, pathname = '/dashboard/system.html', architectureItems = [], initialize = false) {
  const nodes = new Map();
  const pageName = pathname.endsWith('/data.html') ? 'data' : pathname.endsWith('/api.html') ? 'api' : 'system';
  const ownedIds = new Set([...informationPages[pageName].matchAll(/\sid="([^"]+)"/g)].map(match=>match[1]));
  function node(tagName = 'div') {
    const classes = new Set();
    return { tagName, textContent: '', className: '', dataset: {}, attributes: {}, children: [], disabled: false,
      events: {}, classList: {
        add(...names) { names.forEach(name => classes.add(name)); },
        remove(...names) { names.forEach(name => classes.delete(name)); },
        toggle(name, force) { force === false ? classes.delete(name) : classes.add(name); },
        contains(name) { return classes.has(name); }
      },
      appendChild(child) { this.children.push(child); return child; },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = [...children]; },
      setAttribute(key, value) { this.attributes[key] = value; },
      addEventListener(name, handler) { this.events[name] = handler; },
      querySelector() { return node(); },
      closest() { return null; },
      matches(selector) { return selector === '[tabindex]' && this.tabIndex !== undefined; } };
  }
  const get = id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
  const context = vm.createContext({ console, Date, Intl, Number, String, AbortSignal,
    window: { location: { pathname }, fetch, setTimeout() { return 1; }, clearTimeout() {},
      localStorage: { getItem() { return null; }, setItem() {} } },
    document: { getElementById: id => ownedIds.has(id) ? get(id) : null,
      createElement: node, createTextNode: text => ({ textContent: text }),
      querySelectorAll: () => architectureItems, documentElement: node('html') } });
  if (pageName === 'data') vm.runInContext(estimatesSource, context);
  vm.runInContext(initialize ? informationSource : informationSource.replace('\ninitializeInformationPage();', ''), context);
  return { nodes, context, run: code => vm.runInContext(code, context) };
}

function borderTraceFixture() {
  const order=[],frames=new Map(),events={},observers=[];
  let nextFrame=0;
  const panels=[240,360].map(width=>{
    const classes=new Set(),children=[];
    return { get clientWidth(){order.push('read');return width;},
      get clientHeight(){order.push('read');return 120;},
      classList:{add(name){classes.add(name);}},children,
      appendChild(child){children.push(child);},classes };
  });
  const page=informationPage(undefined,'/dashboard/system.html',panels);
  const create=page.context.document.createElement;
  page.context.document.createElementNS=(_,tag)=>{
    const node=create(tag),set=node.setAttribute.bind(node);
    node.setAttribute=(name,value)=>{if(name==='viewBox'||name==='d')order.push('write');set(name,value);};
    return node;
  };
  Object.assign(page.context.window,{
    requestAnimationFrame(callback){const id=++nextFrame;frames.set(id,callback);return id;},
    cancelAnimationFrame(id){frames.delete(id);},
    getComputedStyle(){order.push('read');return {borderTopLeftRadius:'12px'};},
    addEventListener(name,callback){events[name]=callback;},
    ResizeObserver:class {
      constructor(callback){this.callback=callback;observers.push(this);}
      observe(){} disconnect(){this.disconnected=true;}
    }
  });
  const flush=()=>{const batch=[...frames.values()];frames.clear();batch.forEach(callback=>callback());};
  page.run('initializePanelBorderTraces()');
  return {panels,page,frames,order,observers,events,flush};
}

const dataHeroSource = readFileSync(path.join(testDirectory, '../../api-service/src/main/resources/static/dashboard/data-hero-map.js'), 'utf8');

function dataHero({ pathname='/dashboard-experimental/data.html', features, fetch, delayedGeometry,
  styleLoaded=true, loader, visible, reduced=false, animate=true, summaries, snapshots, paceFetch } = {}) {
  const classes=new Set(), events={}, frames=new Map(), timers=new Map(), observers=[];
  const state={ maps:[], reads:[], paint:[], fits:[], removed:0, resized:0, projected:0, options:null, overlays:[] };
  const classList=set=>({add(...names){names.forEach(name=>set.add(name));},toggle(name,value){if(value)set.add(name);else set.delete(name);}});
  const node={clientWidth:480,clientHeight:320,classList:classList(classes),querySelector:()=>null,
    appendChild(overlay){state.overlays.push(overlay);}};
  const status={textContent:''},labels={i25MapPace:{},i70MapPace:{}},canvas={setAttribute(){}};
  const clock=Date.parse('2026-10-07T17:00:00Z');
  class FixtureDate extends Date {static now(){return clock;}}
  let serial=0;
  const renderer={Map:class {
    constructor(options){state.maps.push(this);state.options=options;this.handlers={};}
    addControl(){}
    on(name,handler){this.handlers[name]=handler;}
    once(name,handler){this.handlers[name]=handler;}
    isStyleLoaded(){return styleLoaded;}
    getCanvas(){return canvas;}
    resize(){state.resized++;}
    fitBounds(bounds,options){state.fits.push({bounds,options});}
    project([longitude,latitude]){state.projected++;return {x:(longitude+106)*100*node.clientWidth/480,y:(41-latitude)*100*node.clientHeight/320};}
    getLayer(id){return state.options.style.layers.some(layer=>layer.id===id);}
    setPaintProperty(...args){state.paint.push(args);}
    remove(){state.removed++;}
  },AttributionControl:class {}};
  const validFeatures=features??[
    {type:'Feature',id:'I25',properties:{corridor:'I25',startMileMarker:208,endMileMarker:271},geometry:{type:'LineString',coordinates:[[-105,39.6],[-105,40.4]]}},
    {type:'Feature',id:'I70',properties:{corridor:'I70',startMileMarker:206,endMileMarker:274},geometry:{type:'MultiLineString',coordinates:[[[-106,39.7],[-105,39.8]]]}}
  ];
  class Observer{
    constructor(callback){this.callback=callback;this.disconnected=false;observers.push(this);}
    observe(){}
    disconnect(){this.disconnected=true;}
  }
  const motion={matches:reduced,addEventListener(name,callback){this.callback=callback;},removeEventListener(){this.callback=null;}};
  const document={hidden:false,documentElement:{dataset:{}},
    addEventListener(name,callback){events[name]=callback;},
    getElementById:id=>id==='dataHeroMap'?node:id==='dataHeroMapStatus'?status:labels[id]||null,
    createElement(){
      const overlay={classList:classList(new Set()),dataset:{},setAttribute(){},animations:[]};
      if(animate)overlay.animate=(keyframes,options)=>{
        const animation={keyframes,options,currentTime:0,playbackRate:1,playState:'running',
          cancel(){this.playState='idle';this.cancelled=true;},pause(){this.playState='paused';},
          play(){this.playState='running';},updatePlaybackRate(rate){this.playbackRate=rate;}};
        overlay.animations.push(animation);return animation;
      };
      return overlay;
    }
  };
  const context=vm.createContext({console,Number,String,URL,AbortSignal,AbortController,Date:FixtureDate,document,
    window:{
      location:{pathname}, DATA_HERO_RENDERER_LOADER:loader??(async()=>renderer),matchMedia:()=>motion,
      ...(visible===undefined?{}:{IntersectionObserver:class extends Observer{
        observe(){this.callback([{target:node,isIntersecting:visible}]);}
      }}),
      fetch:async(url,options)=>{
        state.reads.push({url,options});
        if(fetch)return fetch(url,options);
        const override=paceFetch?.(url,options);
        if(override!==undefined)return override;
        const corridor=new URL(url,'https://example.test').searchParams.get('corridor')||'I25';
        let payload;
        if(url.endsWith('/map/config'))payload={tileUrl:'https://example.test/detail/{z}/{x}/{y}.png',
          overviewTileUrl:'https://example.test/normal/{z}/{x}/{y}.png',detailMinZoom:10,maxZoom:19,attribution:'Test'};
        else if(url.includes('/summary?'))payload=summaries?.[corridor]??{corridor,
          latest:{avgCurrentSpeed:120,polledAt:new Date(clock-60000).toISOString()}};
        else if(url.includes('/flow-cells/current?'))payload=snapshots?.[corridor]??{corridor,
          observedAt:new Date(clock-60000).toISOString(),cells:[{
            startMileMarker:corridor==='I25'?208:206,endMileMarker:corridor==='I25'?271:274,
            direction:'COMBINED',speedMph:60}]};
        else payload=delayedGeometry?delayedGeometry():{type:'FeatureCollection',features:validFeatures};
        return {ok:true,json:async()=>payload};
      },
      requestAnimationFrame:fn=>{const id=++serial;frames.set(id,fn);return id;},
      cancelAnimationFrame:id=>frames.delete(id),
      setTimeout:(fn,ms)=>{const id=++serial;timers.set(id,{fn,ms});return id;},
      clearTimeout:id=>timers.delete(id),ResizeObserver:Observer,MutationObserver:Observer,
      addEventListener:(name,fn)=>events[name]=fn
    }});
  vm.runInContext(estimatesSource,context);
  vm.runInContext(dataHeroSource,context);
  const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
  const flushFrames=()=>{const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn());};
  const fireTimer=()=>{const [id,timer]=[...timers][0];timers.delete(id);timer.fn();};
  return {context,node,state,status,labels,classes,events,frames,timers,observers,settle,flushFrames,fireTimer,document,motion,clock};
}

function healthActivityFixture(reduced=false) {
  const make=()=>({classes:new Set(),events:{},dataset:{},textContent:'',
    classList:{add(name){this.owner.classes.add(name);},remove(name){this.owner.classes.delete(name);},toggle(name,on){on?this.add(name):this.remove(name);}},
    addEventListener(name,callback){this.events[name]=callback;}});
  const node=()=>{const value=make();value.classList.owner=value;return value;};
  const cards=new Map(['routes','ingest','api','database'].map(key=>{
    const card=node(),label=node();card.dataset.healthChannel=key;card.label=label;card.querySelector=()=>label;return[key,card];
  }));
  const panel=node(),counts=[node(),node()];
  counts.forEach(value=>{value.parentElement=node();value.textContent='100';});
  panel.querySelectorAll=selector=>selector.includes('SampleCount')?counts:counts.map(n=>n.parentElement).filter(n=>n.classes.has('pipeline-window-updated'));
  const root=node();root.querySelectorAll=()=>[...cards.values()];root.querySelector=()=>panel;
  let observer,clock=Date.parse('2026-10-14T22:00:00Z');
  class ClockDate extends Date{constructor(value){super(value===undefined?clock:value);}static now(){return clock;}}
  const document={hidden:false,events:{},querySelectorAll:()=>[root],addEventListener(name,fn){this.events[name]=fn;}};
  const motion={matches:reduced,events:{},addEventListener(name,fn){this.events[name]=fn;}};
  const window={events:{},matchMedia:()=>motion,addEventListener(name,fn){this.events[name]=fn;},IntersectionObserver:class{
    constructor(fn){observer=this;this.callback=fn;}observe(){}disconnect(){}
  }};
  const source=readFileSync(path.join(testDirectory,'../../api-service/src/main/resources/static/dashboard/health-panel.js'),'utf8');
  vm.runInNewContext(source,{window,document,Date:ClockDate,URLSearchParams});
  return {cards,panel,counts,root,document,window,motion,monitor:window.HealthMonitor,
    advance(){clock+=1000;},visible(value=true){observer.callback([{target:root,isIntersecting:value}]);},
    clear(){cards.forEach(card=>card.classes.clear());panel.classes.clear();counts.forEach(n=>n.parentElement.classes.clear());}};
}

function heartbeatLifecycleFixture() {
  let reads = 0, serial = 0, observed;
  const timers = new Map(), events = {document: {}, window: {}};
  const page = informationPage(async () => {
    reads++;
    return {ok: true, json: async () => ({status: 'HEALTHY', checks: []})};
  });
  const panel = page.nodes.get('systemOverview');
  const animations = ['status-ecg-reveal', 'status-ecg-handoff', 'status-content-yield',
    'status-snapshot-yield', 'status-beacon-pulse', 'grid-light-sweep'].map(animationName => ({
    animationName, currentTime: 2600,
    play() { throw new Error('CSS visibility must control playback'); }
  }));
  panel.getAnimations = options => {
    assert.deepEqual({...options}, {subtree: true});
    return animations;
  };
  Object.defineProperty(panel, 'offsetWidth', {get() { throw new Error('Forced layout'); }});
  const listen = target => (name, callback) => (events[target][name] ||= []).push(callback);
  page.context.document.addEventListener = listen('document');
  page.context.document.querySelectorAll = () => [panel];
  Object.assign(page.context.window, {
    addEventListener: listen('window'),
    setTimeout(fn, ms) { const id = ++serial; timers.set(id, {fn, ms}); return id; },
    clearTimeout(id) { timers.delete(id); },
    IntersectionObserver: class {
      constructor(callback) { observed = callback; }
      observe() {} disconnect() {}
    }
  });
  page.run('initializeMotionBudget()');
  const view = visible => observed([{target: panel, isIntersecting: visible}]);
  const emit = (target, name, value = {}) => events[target][name]?.forEach(fn => fn(value));
  const fire = () => {
    assert.equal(timers.size, 1);
    const [id, timer] = [...timers][0];
    timers.delete(id); timer.fn();
  };
  return {page, panel, timers, animations, view, emit, fire, reads: () => reads};
}

module.exports = { motionDiagnostic, motionServerTest, motionProbeTest, connectorFixture, verificationFixture, informationPage, borderTraceFixture, dataHeroSource, dataHero, healthActivityFixture, heartbeatLifecycleFixture };
