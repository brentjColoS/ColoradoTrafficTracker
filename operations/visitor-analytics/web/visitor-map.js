const vendor = '/dashboard/vendor/maplibre-gl/6.10.0/';

export function areaCircle(point, radiusMiles=30) {
  const [longitude,latitude]=point.map(value=>value*Math.PI/180),distance=radiusMiles*1.609344/6371;
  const ring=Array.from({length:64},(_,i)=>{
    const bearing=i*2*Math.PI/64;
    const lat=Math.asin(Math.sin(latitude)*Math.cos(distance)+Math.cos(latitude)*Math.sin(distance)*Math.cos(bearing));
    const lon=longitude+Math.atan2(Math.sin(bearing)*Math.sin(distance)*Math.cos(latitude),Math.cos(distance)-Math.sin(latitude)*Math.sin(lat));
    return [lon*180/Math.PI,lat*180/Math.PI];
  });
  return [...ring,ring[0]];
}

export function groupAreas(rows) {
  const groups = new Map();
  for (const row of rows) {
    const area = row.area, point = area?.coordinates;
    if (!area?.approximate || typeof area.label !== 'string' || !Array.isArray(point) || point.length !== 2
        || !point.every(Number.isFinite) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) continue;
    const key = JSON.stringify([area.label,point]);
    if (!groups.has(key)) groups.set(key,{key,label:area.label,point,count:0});
    groups.get(key).count++;
  }
  return [...groups.values()];
}

export async function createVisitorMap(container, status, choices, onSelect) {
  if (!document.getElementById('visitMapCss')) {
    const css = document.createElement('link');
    css.id = 'visitMapCss';css.rel = 'stylesheet';css.href = vendor+'maplibre-gl.css';
    document.head.append(css);
  }
  let timeout;
  const module = await Promise.race([
    import(vendor+'maplibre-gl.mjs'),
    new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Map loading timed out')),10000);})
  ]).finally(()=>clearTimeout(timeout));
  const renderer = module.default || module;
  const map = new renderer.Map({container,center:[-98,39],zoom:2,attributionControl:false,
    refreshExpiredTiles:false,style:{version:8,sources:{base:{type:'raster',tileSize:256,
      tiles:['https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}'],
      maxzoom:16,attribution:'<a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noopener">USGS The National Map</a>'},
      'area-context':{type:'geojson',data:{type:'FeatureCollection',features:[]}}},
      layers:[{id:'background',type:'background',paint:{'background-color':'#17201a'}},
        {id:'base',type:'raster',source:'base',paint:{'raster-opacity':0.8}},
        {id:'area-fill',type:'fill',source:'area-context',paint:{'fill-color':'#83c99a','fill-opacity':0.18}},
        {id:'area-edge',type:'line',source:'area-context',paint:{'line-color':'#83c99a','line-opacity':0.6,'line-width':1}}]}});
  map.addControl(new renderer.NavigationControl({showCompass:false}),'top-right');
  map.addControl(new renderer.AttributionControl({compact:true}),'bottom-right');
  map.on('error',()=>{status.textContent='Background map unavailable; area buttons and journeys still work.';});
  let markers = [], signature = '', removed = false, circles={type:'FeatureCollection',features:[]};
  map.on('load',()=>{if(!removed)map.getSource('area-context')?.setData(circles);});
  return {
    update(rows, selected) {
      if (removed) return;
      for (const marker of markers) marker.remove();
      markers=[];choices.replaceChildren();
      const groups = groupAreas(rows);
      circles={type:'FeatureCollection',features:groups.map(group=>({type:'Feature',properties:{},
        geometry:{type:'Polygon',coordinates:[areaCircle(group.point)]}}))};
      map.getSource('area-context')?.setData(circles);
      const button = (label, key) => {
        const node = document.createElement('button');node.type='button';node.textContent=label;
        node.setAttribute('aria-pressed',String(selected===key));
        node.addEventListener('click',()=>onSelect(selected===key ? null : key));return node;
      };
      choices.append(button('All areas',null));
      for (const group of groups) {
        choices.append(button(`${group.label} · ${group.count}`,group.key));
        const pin = button(String(group.count),group.key);pin.className='visit-area-pin';
        pin.setAttribute('aria-label',`${group.label}: ${group.count} ${group.count===1 ? 'visit' : 'visits'}. Filter journeys.`);
        pin.title=group.label+' (approximate)';
        markers.push(new renderer.Marker({element:pin}).setLngLat(group.point).addTo(map));
      }
      const located = groups.reduce((sum,g)=>sum+g.count,0), unknown = rows.length-located;
      if (unknown) choices.append(button(`Location unavailable · ${unknown}`,'unknown'));
      status.textContent=`${located} mapped ${located===1 ? 'visit' : 'visits'} · ${groups.length} approximate ${groups.length===1 ? 'area' : 'areas'} · ${unknown} without a map location. Current page only, not all retained history.`;
      const next = JSON.stringify([groups.map(group=>group.key),selected]);
      map.resize();
      if (groups.length && next!==signature) {
        const focused=groups.find(group=>group.key===selected);
        const points=focused ? areaCircle(focused.point) : groups.map(group=>group.point);
        const bounds=new renderer.LngLatBounds();for(const point of points) bounds.extend(point);
        map.fitBounds(bounds,{padding:45,maxZoom:6,duration:0});
      }
      signature=next;
    },
    remove() { removed=true;for(const marker of markers) marker.remove();markers=[];map.remove();choices.replaceChildren(); }
  };
}
