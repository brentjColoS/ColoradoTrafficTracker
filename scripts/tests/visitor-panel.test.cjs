const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const directory = path.join(__dirname,'../../operations/visitor-analytics/web');
const source = readFileSync(path.join(directory,'visitors.js'),'utf8');

async function panel(sourceBase = 'https://traffic.example/', homeStatus = 200, homeManageAllowed = true) {
  class Node {
    constructor() { this.children=[];this.attributes={};this.events={};this.dataset={};this.value=''; }
    setAttribute(name,value) { this.attributes[name]=value; }
    addEventListener(name,callback) { this.events[name]=callback; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children=children; }
    querySelector() { return this.child ||= new Node(); }
    querySelectorAll() { return this.children; }
  }
  const nodes = new Map([...readFileSync(path.join(directory,'index.html'),'utf8').matchAll(/id="([^"]+)"/g)]
    .map(([,id])=>[id,new Node()]));
  const categories = Object.fromEntries(['external','home','automation','all'].map(category=>{
    const node=new Node();node.dataset.category=category;return [category,node];
  }));
  nodes.get('categories').children=Object.values(categories);
  const days=new Node();days.dataset.days='7';nodes.get('days').append(days);
  const links=['resume','linkedin','github','portfolio'].map(source=>{
    const link=new Node();link.dataset.source=source;return link;
  });
  const buttons=links.map(link=>{
    const button=new Node();button.dataset.copySource=link.dataset.source;
    button.closest=()=>({querySelector:()=>link});return button;
  });
  const requests=[],copied=[],mapUpdates=[];let mapLoads=0,mapRemovals=0;
  const document = {documentElement:{dataset:{}},getElementById:id=>nodes.get(id),
    createElement:()=>new Node(),createTextNode:value=>value,
    querySelectorAll:selector=>selector==='a[data-source]' ? links : buttons};
  vm.runInNewContext(source.replace("await import('./visitor-map.js')",'await loadMapModule()'),{document,window:{matchMedia:()=>({matches:false,addEventListener(){}})},
    loadMapModule:async()=>{mapLoads++;return {createVisitorMap:async()=>({update:(...args)=>mapUpdates.push(args),remove:()=>{mapRemovals++;}})};},
    localStorage:{getItem:()=>null,setItem(){}},navigator:{clipboard:{writeText:async text=>copied.push(text)}},
    AbortController,URL,fetch:async (url,options)=>{
      requests.push({url,options});
      if (url==='home') return {ok:homeStatus===200,status:homeStatus};
      const query=new URL(url,'https://traffic.example/operator/visitors/').searchParams;
      const category=query.get('category'),count={nonhome:3,all:6,home:3,external:2,automation:1}[category];
      return {ok:true,json:async()=>({collected:true,sourceBase,category,collectionScope:'production',actionToken:'snapshot-token',
        generatedAt:1780000000,visitors:count,views:count,referred:0,activity:[],sources:[],pages:[],
        totals:{home:3},groupTotals:{external:2,home:3,automation:1},homes:['192.0.2.10'],
        currentIp:'192.0.2.10',currentIsHome:true,homeAllowed:homeManageAllowed,homeManageAllowed,position:0,
        nextCursor:query.has('cursor') ? '' : 'older-page'})};
    }});
  const settle=()=>new Promise(resolve=>setImmediate(resolve));
  await settle();
  return {nodes,categories,links,buttons,requests,copied,mapUpdates,
    get mapLoads(){return mapLoads;},get mapRemovals(){return mapRemovals;},
    async addHome(value){nodes.get('homeAddress').value=value;await nodes.get('homeAddressForm').events.submit({preventDefault(){}});await settle();},
    async map(open){nodes.get('visitMapPanel').open=open;await nodes.get('visitMapPanel').events.toggle();await settle();},
    async click(node) { await node.events.click();await settle(); },
    async include(value) { nodes.get('includeHome').checked=value;nodes.get('includeHome').events.change();await settle(); }};
}

test('Home inclusion updates the server filter and totals, resetting older-page cursors',async()=>{
  const view=await panel();
  assert.match(view.requests[0].url,/category=nonhome/);
  assert.equal(view.nodes.get('includeHome').checked,false);
  assert.equal(view.nodes.get('includeHome').disabled,false);
  assert.equal(view.nodes.get('views').textContent,'3');
  assert.equal(view.categories.all.attributes['aria-pressed'],'true');
  await view.click(view.nodes.get('showMore'));
  assert.match(view.requests.at(-1).url,/cursor=older-page/);
  await view.include(true);
  assert.match(view.requests.at(-1).url,/category=all$/);
  assert.equal(view.nodes.get('views').textContent,'6');
  assert.equal(view.nodes.get('homeViewsLabel').textContent,'home openings included');
  assert.equal(view.nodes.get('pageNewest').disabled,true);
  await view.include(false);
  assert.match(view.requests.at(-1).url,/category=nonhome$/);
  assert.equal(view.nodes.get('views').textContent,'3');
  assert.ok(view.requests.every(request=>!request.options.method));
});

test('area map loads only when opened, clears old markers on Home changes and releases its renderer when closed',async()=>{
  const view=await panel();
  assert.equal(view.mapLoads,0);assert.equal(view.mapUpdates.length,0);
  await view.map(true);assert.equal(view.mapLoads,1);assert.ok(view.mapUpdates.length>0);
  await view.include(true);assert.deepEqual(view.mapUpdates.at(-1)[0],[]);
  await view.map(false);assert.equal(view.mapRemovals,1);
  const count=view.mapUpdates.length;await view.include(false);assert.equal(view.mapUpdates.length,count);
  await view.map(true);assert.equal(view.mapLoads,2);
});

test('map area groups keep unknown or invalid locations unpinned and combine matching area centers',async()=>{
  const moduleSource=readFileSync(path.join(directory,'visitor-map.js'),'utf8');
  const {groupAreas,areaCircle}=await import('data:text/javascript;base64,'+Buffer.from(moduleSource).toString('base64'));
  const area={label:'Greenbelt, Maryland',coordinates:[-76.88,39],approximate:true};
  const groups=groupAreas([{area},{area},{area:null},{area:{...area,coordinates:[0,NaN]}},
    {area:{...area,approximate:false}},{area:{...area,coordinates:[0,100]}}]);
  assert.equal(groups.length,1);assert.equal(groups[0].count,2);
  assert.equal(groups[0].label,'Greenbelt, Maryland');
  const circle=areaCircle([-76.88,39]);
  assert.equal(circle.length,65);
  assert.ok(Math.abs(circle[0][1]-39-30*1.609344/6371*180/Math.PI)<1e-8);
  assert.ok(Math.abs(circle[0][0]-circle.at(-1)[0])<1e-8);
});

test('Home-only and outside-only categories keep their meaning and explain the switch scope',async()=>{
  const view=await panel();
  await view.click(view.categories.home);
  assert.match(view.requests.at(-1).url,/category=home$/);
  assert.equal(view.nodes.get('includeHome').checked,true);
  assert.equal(view.nodes.get('includeHome').disabled,true);
  assert.equal(view.nodes.get('includeHomeHelp').textContent,'Home-only view');
  for(const category of ['external','automation']) {
    await view.click(view.categories[category]);
    assert.match(view.requests.at(-1).url,new RegExp('category='+category+'$'));
    assert.equal(view.nodes.get('includeHome').checked,false);
    assert.equal(view.nodes.get('includeHome').disabled,true);
  }
  await view.click(view.categories.all);
  assert.equal(view.nodes.get('includeHome').disabled,false);
  assert.match(view.requests.at(-1).url,/category=nonhome$/);
});

test('copy buttons use the displayed short source links without changing scoped preview links',async()=>{
  for(const base of ['https://traffic.example/','http://127.0.0.1:8192/dashboard/','https://traffic.example/dashboard-experimental/']) {
    const view=await panel(base);
    for(const [index,button] of view.buttons.entries()) {
      await view.click(button);
      const expected=base+'?src='+button.dataset.copySource;
      assert.equal(view.links[index].href,expected);
      assert.equal(view.links[index].child.textContent,expected);
      assert.equal(view.copied.at(-1),expected);
    }
  }
});

test('manual Home input submits a trimmed address with the action token and refreshes classification',async()=>{
  const view=await panel();
  await view.addHome('  8.8.8.8  ');
  const writes=view.requests.filter(request=>request.url==='home');
  assert.equal(writes.length,1);
  assert.deepEqual(JSON.parse(writes[0].options.body),{enabled:true,add:'8.8.8.8'});
  assert.equal(writes[0].options.headers['X-Visitor-Action'],'snapshot-token');
  assert.equal(view.nodes.get('homeAddress').value,'');
  assert.match(view.nodes.get('homeAddressStatus').textContent,/Saved as Home/);
  assert.equal(view.nodes.get('homeAddress').disabled,false);
  assert.equal(view.nodes.get('addHomeAddress').disabled,false);
  assert.match(view.requests.at(-1).url,/category=nonhome/);
});

test('invalid Home input is retained with an inline error and blank input never writes',async()=>{
  const view=await panel('https://traffic.example/',400);
  await view.addHome('not-an-ip');
  assert.equal(view.nodes.get('homeAddress').value,'not-an-ip');
  assert.match(view.nodes.get('homeAddressStatus').textContent,/exact public IPv4 or IPv6/);
  assert.equal(view.nodes.get('addHomeAddress').disabled,false);
  assert.equal(view.nodes.get('homeAddress').disabled,false);
  const count=view.requests.length;
  await view.addHome('   ');
  assert.equal(view.requests.length,count);
  assert.match(view.nodes.get('homeAddressStatus').textContent,/Enter an IPv4 or IPv6/);
});

test('Home viewers keep filters but have no management controls or write requests',async()=>{
  const view=await panel('https://traffic.example/',200,false);
  assert.equal(view.nodes.get('homeAddressForm').hidden,true);
  assert.equal(view.nodes.get('homeToggle').hidden,true);
  assert.equal(view.nodes.get('homeList').children.filter(node=>typeof node==='object').length,0);
  assert.match(view.nodes.get('homeDescription').textContent,/Only the primary operator/);
  await view.addHome('8.8.8.8');
  assert.equal(view.requests.filter(request=>request.options.method).length,0);
  await view.include(true);assert.match(view.requests.at(-1).url,/category=all$/);
});
