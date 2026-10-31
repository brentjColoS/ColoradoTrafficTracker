const { vm, readFileSync, path, incidentTypesSource, mapSource, dashboard, vslSnapshot } = require('./core.cjs');
const { testDirectory } = require('./core.cjs');

function roadSignFixture() {
  const frames=new Map(),windowEvents=new Map(),writes=[];
  let next=0,Sign;
  class Element {
    constructor(){this.events=new Map();this.isConnected=true;}
    attachShadow(){this.shadowRoot={};}
    addEventListener(name,callback){this.events.set(name,callback);}
    removeEventListener(name,callback){if(this.events.get(name)===callback)this.events.delete(name);}
    getAttribute(){return "I25";}
  }
  const context=vm.createContext({
    HTMLElement:Element,
    customElements:{get(){return undefined;},define(name,constructor){Sign=constructor;}},
    window:{innerWidth:1200,innerHeight:800,
      addEventListener(name,callback){windowEvents.set(name,callback);},
      removeEventListener(name,callback){if(windowEvents.get(name)===callback)windowEvents.delete(name);},
      requestAnimationFrame(callback){const id=++next;frames.set(id,callback);return id;},
      cancelAnimationFrame(id){frames.delete(id);}
    }
  });
  vm.runInContext(readFileSync(path.join(testDirectory,
    '../../api-service/src/main/resources/static/dashboard/road-sign-display.js'),'utf8'),context);
  const sign=new Sign();
  sign.stage={style:{setProperty(name,value){writes.push({name,value});}},setAttribute(){}};
  sign.image={};
  const flush=()=>{const batch=[...frames.values()];frames.clear();batch.forEach(callback=>callback());};
  sign.connectedCallback();
  return {sign,frames,windowEvents,writes,flush};
}

function corridorMap(rendererLoader) {
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, { hidden: id === 'corridorMapPanel', textContent: '', title: '', children: [], events: {},
      appendChild(child) { this.children.push(child); }, replaceChildren() { this.children = []; },
      addEventListener(name, callback) { this.events[name] = callback; } });
    return nodes.get(id);
  };
  const attributionButton = { dataset: {}, listeners: {},
    addEventListener(name, callback) { this.listeners[name] = callback; } };
  const attributionDetails = {
    open: true, compactShow: true, initiallyCollapsed: false, dataset: {},
    classList: {
      add(name) {
        if (name === 'corridor-map-attribution-collapsed') attributionDetails.initiallyCollapsed = true;
        if (name === 'maplibregl-compact-show') attributionDetails.compactShow = true;
      },
      contains(name) { return name === 'corridor-map-attribution-collapsed' && attributionDetails.initiallyCollapsed; },
      remove(name) {
        if (name === 'maplibregl-compact-show') attributionDetails.compactShow = false;
        if (name === 'corridor-map-attribution-collapsed') attributionDetails.initiallyCollapsed = false;
      }
    },
    querySelector: () => attributionButton,
    removeAttribute(key) { if (key === 'open') this.open = false; },
    setAttribute(key) { if (key === 'open') this.open = true; }
  };
  get('corridorMap').querySelector = selector => selector === '.maplibregl-ctrl-attrib' ? attributionDetails : null;
  const window = {
    CORRIDOR_MAP_RENDERER_LOADER: rendererLoader,
    location: { pathname: '/dashboard/' },
    setTimeout,
    clearTimeout
  };
  const context = vm.createContext({
    console, URL, AbortSignal,
    window,
    document: {
      getElementById: get,
      querySelectorAll: selector => selector.includes('frequency')
        ? [get('frequencyLegend')]
        : selector.includes('current') ? [get('currentLegend')] : [],
      createElement: tagName => ({ tagName, textContent: '', className: '', hidden: false, style: {setProperty(key,value){this[key]=value;}}, attributes: {}, children: [], dataset: {}, events: {},
        appendChild(child) { this.children.push(child); },
        setAttribute(key, value) { this.attributes[key] = value; },
        addEventListener(name, callback) { this.events[name] = callback; } }),
      documentElement: { dataset: { theme: 'light' } }
    }
  });
  vm.runInContext(incidentTypesSource, context);
  vm.runInContext(readFileSync(path.join(testDirectory, '../../api-service/src/main/resources/static/dashboard/variable-speed-signs.js'), 'utf8'), context);
  vm.runInContext(readFileSync(path.join(testDirectory, '../../api-service/src/main/resources/static/dashboard/corridor-map-data.js'), 'utf8'), context);
  vm.runInContext(readFileSync(path.join(testDirectory, '../../api-service/src/main/resources/static/dashboard/corridor-map-style.js'), 'utf8'), context);
  vm.runInContext(mapSource, context);
  return { nodes, context, attributionDetails, attributionButton };
}

function fakeMapRenderer(instances, popups = [], markers = []) {
  class Map {
    constructor(options) {
      this.options = options;
      this.sources = new globalThis.Map();
      for (const [id, source] of Object.entries(options.style.sources)) {
        this.sources.set(id, { data: source.data, setData(data) { this.data = data; } });
      }
      this.canvas = { attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } };
      this.canvas.style = {};
      this.zoom = 8;
      this.listeners = new globalThis.Map();
      instances.push(this);
    }
    addControl() {}
    on(event, layerOrHandler, handler) {
      this.listeners.set(handler ? `${event}:${layerOrHandler}` : event, handler || layerOrHandler);
    }
    once(event, callback) { this.listeners.set(event, callback); }
    loaded() { return false; }
    isStyleLoaded() { return true; }
    getSource(id) { return this.sources.get(id); }
    getLayer() { return true; }
    getCanvas() { return this.canvas; }
    getZoom() { return this.zoom; }
    queryRenderedFeatures() { return this.renderedFeatures || []; }
    setPaintProperty(layer, property, value) {
      this.paintChanges ||= [];
      this.paintChanges.push({ layer, property, value });
    }
    setLayoutProperty(layer, property, value) {
      this.layoutChanges ||= [];
      this.layoutChanges.push({layer,property,value});
    }
    remove() { this.removed = true; }
    resize() { this.resized = true; }
    fitBounds(bounds, options) { this.bounds = bounds; this.fitOptions = options; }
  }
  class Popup {
    constructor(options) { this.options = options; popups.push(this); }
    setLngLat(value) { this.coordinates = value; return this; }
    setDOMContent(value) { this.content = value; return this; }
    addTo(value) { this.map = value; return this; }
    remove() { this.removed = true; return this; }
  }
  class Marker {
    constructor(options) { this.element = options.element; this.options = options; markers.push(this); }
    setLngLat(value) { this.coordinates = value; return this; }
    addTo(value) { this.map = value; return this; }
    getElement() { return this.element; }
    getLngLat() { return this.coordinates; }
    getOffset() { return {x:this.options.offset?.[0]||0,y:this.options.offset?.[1]||0}; }
    setOffset(offset) { this.options.offset = offset; return this; }
    remove() { this.removed = true; }
  }
  return { default: { Map, Popup, Marker, NavigationControl: class {}, AttributionControl: class {} } };
}

function zoneMotionFixture(reduced = false, withShield = false) {
  const d = dashboard(), motions = [], frames = [];
  d.context.window.matchMedia = () => ({matches: reduced});
  d.context.window.requestAnimationFrame = callback => frames.push(callback);
  d.run("state.focusedCorridor='I70';state.chartView='zones';drawAllCharts=()=>{}");
  const graph = {hidden:false, classList:{add(){},remove(){}},
    getBoundingClientRect:()=>({left:withShield && !d.run('state.zoneFinder') ? 72 : 0,
      top:400,width:d.run('state.zoneFinder') ? 800 : withShield ? 1128 : 1200})};
  const shield = {hidden:false, classList:{add(){},remove(){}},
    getBoundingClientRect:()=>({left:d.run('state.zoneFinder') ? -72 : 0,top:400,width:72})};
  const map = d.run("document.getElementById('corridorMapPanel')");
  map.hidden = false;
  map.getBoundingClientRect = () => d.run('state.zoneFinder')
    ? {left:800,top:400,width:400} : {left:600,top:1500,width:600};
  for (const node of [graph,shield,map]) node.animate = (keyframes,options) => {
    const motion = {node,keyframes,options,cancelled:false,cancel(){this.cancelled=true;}};
    motions.push(motion); return motion;
  };
  d.run("document.getElementById('i70Chart')").closest = selector => selector === '.chart-lane'
    ? {querySelector:()=>withShield ? shield : null} : graph;
  return {d,motions,frames};
}

async function zoneMapFixture() {
  const instances=[],markers=[],selections=[];
  const d=corridorMap(async()=>fakeMapRenderer(instances,[],markers));
  const feature={type:'Feature',properties:{startMileMarker:206,endMileMarker:216,direction:'EASTBOUND',
    speedLimitSegments:[{startMileMarker:206,endMileMarker:213.1,description:'West approach'},
      {startMileMarker:213.1,endMileMarker:216,description:'Tunnel'}]},
    geometry:{type:'LineString',coordinates:[[-106,39.6],[-105,39.8]]}};
  const groups=[{key:'west',referenceLabel:'Z1',referenceColor:'#58c4e6',postedSpeedMph:60,startMileMarker:206,endMileMarker:213.1},
    {key:'tunnel',referenceLabel:'Z2',referenceColor:'#b39aff',postedSpeedMph:50,startMileMarker:213.1,endMileMarker:216}];
  await d.context.window.CorridorMapPanel.render({corridor:'I70',zoneMode:true,corridorFeature:feature});
  d.context.window.CorridorMapPanel.setZones(groups,null,key=>selections.push(key));
  return {d,instances,markers,groups,selections};
}

function variableLimitDemoHarness(capture, saved, snapshotStatus=200, live=false) {
  const calls=[];
  const nativeFetch=async (input)=>{
    calls.push(input);
    if(input==='variable-limit-snapshot.json' || String(input).includes('/traffic/map/variable-speed-limits/current')) return new Response(JSON.stringify(saved),{status:snapshotStatus});
    return new Response(JSON.stringify({traffic:{status:200,version:'traffic',data:{speed:54}}}),{status:200});
  };
  const window={location:{origin:'https://preview.invalid',href:'https://preview.invalid/dashboard-experimental/variable-limit-demo/'},fetch:nativeFetch,
    VariableSpeedSigns:require("../../../api-service/src/main/resources/static/dashboard/variable-speed-signs.js")};
  const document={getElementById:()=>null,documentElement:{dataset:live?{variableLimitDemoLive:"true"}:capture?{variableLimitDemoAt:capture}:{}}};
  vm.runInNewContext(readFileSync('api-service/src/main/resources/static/dashboard/variable-limit-demo.js','utf8'),
    {window,document,URL,Response,Date,Number,Error,JSON});
  return {window,calls,nativeFetch};
}

function speedAreaFixture() {
  const instances=[],markers=[],popups=[],reads=[];
  const d=corridorMap(async()=>{
    const renderer=fakeMapRenderer(instances,popups,markers);
    renderer.default.Map.prototype.project=function(coordinates) {
      return {x:100+(coordinates[0]+105.61)*1000*(this.zoom<11?1:20),y:180};
    };
    return renderer;
  });
  const canvas=d.nodes.get('corridorMap');canvas.clientWidth=600;canvas.clientHeight=400;
  d.context.window.fetch=async path=>{reads.push(path);return {ok:true,json:async()=>({})};};
  const feature={type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[[-106,39.6],[-105,39.8]]}};
  return {d,instances,markers,popups,reads,canvas,
    render:(signs,extra={})=>d.context.window.CorridorMapPanel.render({corridor:'I70',corridorFeature:feature,variableSpeedSigns:vslSnapshot(signs),...extra}),
    areas:()=>markers.filter(m=>!m.removed&&m.element.className.includes('corridor-speed-area')),
    signs:()=>markers.filter(m=>!m.removed&&m.element.className.includes('corridor-variable-speed-sign'))};
}

module.exports = { roadSignFixture, corridorMap, fakeMapRenderer, zoneMotionFixture, zoneMapFixture, variableLimitDemoHarness, speedAreaFixture };
