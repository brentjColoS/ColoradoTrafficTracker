const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const directory = path.join(__dirname,'../../operations/visitor-analytics/web');
const source = readFileSync(path.join(directory,'visitors.js'),'utf8');

async function panel(sourceBase = 'https://traffic.example/') {
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
  const requests=[],copied=[];
  const document = {documentElement:{dataset:{}},getElementById:id=>nodes.get(id),
    createElement:()=>new Node(),createTextNode:value=>value,
    querySelectorAll:selector=>selector==='a[data-source]' ? links : buttons};
  vm.runInNewContext(source,{document,window:{matchMedia:()=>({matches:false,addEventListener(){}})},
    localStorage:{getItem:()=>null,setItem(){}},navigator:{clipboard:{writeText:async text=>copied.push(text)}},
    AbortController,URL,fetch:async (url,options)=>{
      requests.push({url,options});
      const query=new URL(url,'https://traffic.example/operator/visitors/').searchParams;
      const category=query.get('category'),count={nonhome:3,all:6,home:3,external:2,automation:1}[category];
      return {ok:true,json:async()=>({collected:true,sourceBase,category,collectionScope:'production',
        generatedAt:1780000000,visitors:count,views:count,referred:0,activity:[],sources:[],pages:[],
        totals:{home:3},groupTotals:{external:2,home:3,automation:1},homes:['192.0.2.10'],
        currentIp:'192.0.2.10',currentIsHome:true,homeAllowed:true,position:0,
        nextCursor:query.has('cursor') ? '' : 'older-page'})};
    }});
  const settle=()=>new Promise(resolve=>setImmediate(resolve));
  await settle();
  return {nodes,categories,links,buttons,requests,copied,
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
