(() => {
  function tracePath(points) {
    const lengths=points.slice(1).map((point,index)=>Math.hypot(point.x-points[index].x,point.y-points[index].y));
    const length=lengths.reduce((sum,value)=>sum+value,0);
    return {length,d:points.map(({x,y},index)=>`${index?"L":"M"}${x.toFixed(2)} ${y.toFixed(2)}`).join(""),
      at(fraction) {
        let distance=Math.max(0,Math.min(1,fraction))*length;
        for(let index=0;index<lengths.length;index++) {
          if(distance<=lengths[index]||index===lengths.length-1) {
            const weight=lengths[index]>0?distance/lengths[index]:0;
            return {x:points[index].x+(points[index+1].x-points[index].x)*weight,
              y:points[index].y+(points[index+1].y-points[index].y)*weight};
          }
          distance-=lengths[index];
        }
      }};
  }
  function start({canvas,from,to,shield,fromShield,map,animation,phases,expanding,paint,color,gridColor,rangeColors}) {
    const root=document.createElement("div"),viewport=document.createElement("div"),image=document.createElement("canvas");
    root.className="i25-trace-handoff";viewport.className="i25-trace-viewport";
    root.setAttribute("aria-hidden","true");root.inert=true;
    const width=Math.max(from.width,to.width),height=Math.max(from.height,to.height),ratio=Math.min(2,window.devicePixelRatio||1);
    const parent=canvas.closest(".comparison-panel"),parentPosition=parent.style.position;
    parent.style.position="relative";
    Object.assign(root.style,{position:"absolute",left:'0',top:'0',width:`${width}px`,height:`${height}px`,pointerEvents:"none",zIndex:"2",willChange:'transform'});
    Object.assign(viewport.style,{overflow:"hidden",position:"absolute",left:"0",top:"0",width:`${width}px`,height:`${height}px`,transformOrigin:'0 0',willChange:'transform'});
    Object.assign(image.style,{width:`${width}px`,height:`${height}px`,transformOrigin:'0 0',willChange:'transform'});
    image.style.setProperty("--chart-font-scale",getComputedStyle(canvas).getPropertyValue("--chart-font-scale"));
    image.width=Math.round(width*ratio);image.height=Math.round(height*ratio);
    const context=image.getContext("2d");context.setTransform(ratio,0,0,ratio,0,0);
    const background=document.createElementNS("http://www.w3.org/2000/svg","svg"),grid=document.createElementNS("http://www.w3.org/2000/svg","path");
    background.classList.add("i25-trace-grid");background.setAttribute("viewBox",`0 0 ${width} ${height}`);
    Object.assign(background.style,{position:"absolute",inset:"0",width:"100%",height:"100%"});
    grid.setAttribute("fill","none");grid.setAttribute("stroke",gridColor);grid.setAttribute("stroke-width","1");
    grid.setAttribute("stroke-dasharray","3 3");background.appendChild(grid);
    const pulse=document.createElementNS("http://www.w3.org/2000/svg","svg"),path=document.createElementNS("http://www.w3.org/2000/svg","path");
    pulse.classList.add("i25-trace-pulse");pulse.setAttribute("viewBox",`0 0 ${width} ${height}`);
    path.classList.add("i25-mountain-ink");
    Object.assign(pulse.style,{position:"absolute",inset:"0",width:"100%",height:"100%",overflow:"hidden"});
    path.setAttribute("fill","none");path.setAttribute("stroke",color);path.setAttribute("stroke-width","3.2");
    path.setAttribute("stroke-linecap","round");path.setAttribute("stroke-linejoin","round");
    path.setAttribute("pathLength","1");path.setAttribute("stroke-dasharray","1");
    path.style.filter=`drop-shadow(0 0 6px ${color})`;
    const outline=document.createElementNS("http://www.w3.org/2000/svg","path");
    outline.classList.add("i25-mountain-outline");outline.setAttribute("fill","none");outline.setAttribute("stroke",color);
    outline.setAttribute("stroke-width","1.4");outline.setAttribute("stroke-linejoin","round");outline.style.opacity=".3";
    pulse.append(outline,path);
    const dots=[3.8,2.7,1.7].map((radius,index)=>{
      const dot=document.createElementNS("http://www.w3.org/2000/svg","circle");
      dot.classList.add("i25-mountain-ink-dot");
      dot.setAttribute("r",String(radius));dot.setAttribute("fill",color);dot.style.opacity=String(1-index*.3);
      pulse.appendChild(dot);return dot;
    });
    const ranges=[
      {name:"green",color:rangeColors.green,lag:0,peaks:[[0,.86],[.10,.65],[.19,.75],[.31,.34],[.40,.61],[.47,.55],
        [.58,.23],[.69,.59],[.77,.47],[.84,.73],[.92,.65],[1,.88]]},
      {name:"rose",color:rangeColors.rose,lag:.07,peaks:[[0,.93],[.08,.76],[.18,.84],[.29,.47],[.41,.73],[.48,.68],
        [.56,.41],[.67,.70],[.74,.58],[.85,.83],[.91,.76],[1,.94]]}
    ].map(range=>{
      const group=document.createElementNS("http://www.w3.org/2000/svg","g");
      group.classList.add("i25-mountain-layer");group.setAttribute("data-range",range.name);
      const backdrop=document.createElementNS("http://www.w3.org/2000/svg","path"),ink=document.createElementNS("http://www.w3.org/2000/svg","path");
      [backdrop,ink].forEach(node=>{
        node.setAttribute("fill","none");node.setAttribute("stroke",range.color);node.setAttribute("stroke-linecap","round");
        node.setAttribute("stroke-linejoin","round");node.setAttribute("pathLength","1");
      });
      backdrop.classList.add("i25-mountain-range-outline");backdrop.setAttribute("stroke-width","1.2");backdrop.style.opacity=".22";
      ink.classList.add("i25-mountain-range");ink.setAttribute("stroke-width","2.2");ink.setAttribute("stroke-dasharray","1");
      ink.style.filter=`drop-shadow(0 0 3px ${range.color})`;
      group.append(backdrop,ink);
      const tail=[3,2,1.2].map((radius,index)=>{
        const dot=document.createElementNS("http://www.w3.org/2000/svg","circle");dot.classList.add("i25-mountain-range-dot");
        dot.setAttribute("r",String(radius));dot.setAttribute("fill",range.color);dot.style.opacity=String(1-index*.3);
        group.appendChild(dot);return dot;
      });
      pulse.appendChild(group);return {...range,backdrop,ink,tail};
    });
    pulse.append(path,...dots);
    viewport.appendChild(image);root.append(background,viewport,pulse);parent.appendChild(root);
    const opacity=canvas.style.opacity,live=canvas.parentElement.querySelector(".chart-live-label"),liveOpacity=live?.style.opacity;
    const shieldTransform=shield?.style.transform,shieldTo=shield?.getBoundingClientRect();
    canvas.style.opacity="0";if(live)live.style.opacity="0";
    const startScroll=window.scrollY;
    const duration=Number(animation.effect.getTiming().duration)||900;
    const peaks=[[0,.82],[.10,.55],[.17,.64],[.30,.18],[.40,.48],[.46,.40],
      [.57,.06],[.68,.44],[.75,.32],[.84,.62],[.90,.51],[1,.80]];
    let frame,current=from,cleared=false,lastFrame=null,lastPaint=null,painted,lastMesh=null;
    const textScale=Math.max(1,Math.min(1.5,parseFloat(image.style.getPropertyValue('--chart-font-scale'))||1));
    const clamp=value=>Math.max(0,Math.min(1,value));
    const easeAt=value=>{
      let low=0,high=1,t=value;
      for(let index=0;index<14;index++) {
        t=(low+high)/2;
        const x=3*(1-t)*(1-t)*t*.4+3*(1-t)*t*t*.2+t*t*t;
        if(x<value)low=t;else high=t;
      }
      return 3*(1-t)*t*t+t*t*t;
    };
    const clear=()=>{
      if(cleared)return;cleared=true;cancelAnimationFrame(frame);root.remove();image.width=0;image.height=0;
      parent.style.position=parentPosition;
      canvas.style.opacity=opacity;if(live)live.style.opacity=liveOpacity;
      if(shield)shield.style.transform=shieldTransform;
    };
    const draw=()=>{
      const progress=clamp(Number(animation.currentTime||0)/duration);
      const phase=expanding?clamp(progress/phases.graphEnd):clamp((progress-phases.mapStart)/(1-phases.mapStart));
      const head=expanding?clamp((progress-phases.traceStart)/(phases.traceEnd-phases.traceStart))
        :1-clamp((progress-phases.mapStart)/(1-phases.mapStart));
      const mapPhase=expanding?clamp((progress-phases.mapStart)/(1-phases.mapStart)):1-clamp(progress/phases.graphEnd);
      const frameKey=`${phase}|${head}|${mapPhase}|${window.scrollY}|${document.documentElement.dataset.theme}`;
      if(frameKey===lastFrame&&progress<1&&animation.playState!=="idle") { frame=requestAnimationFrame(draw);return; }
      lastFrame=frameKey;
      const ease=easeAt(phase);
      const mix=(a,b)=>a+(b-a)*ease;
      current={left:mix(from.left,to.left),top:mix(from.top,to.top)+startScroll-window.scrollY,
        width:mix(from.width,to.width),height:mix(from.height,to.height)};
      const parentBounds=parent.getBoundingClientRect();
      const x=current.left-parentBounds.left-parent.clientLeft,y=current.top-parentBounds.top-parent.clientTop;
      const mapTop=map.getBoundingClientRect().top;
      const paintKey=`${current.width}|${current.height}|${document.documentElement.dataset.theme}`;
      if (paintKey!==lastPaint) {
        context.clearRect(0,0,width,height);painted=paint(image,{width:current.width,height:current.height}) || {};lastPaint=paintKey;
      }
      const {domain,endpoint}=painted;
      root.style.transform=`translate3d(${x}px,${y}px,0)`;
      viewport.style.transform=`scale(${current.width/width},${current.height/height})`;
      image.style.transform=`scale(${width/current.width},${height/current.height})`;
      const top=16*textScale,bottom=height-30*textScale,left=34*textScale;
      let mesh="";
      if(domain?.step>0) {
        for(let speed=Math.ceil(domain.min/domain.step)*domain.step;speed<=domain.max;speed+=domain.step) {
          const y=bottom-(speed-domain.min)/(domain.max-domain.min)*(bottom-top);
          mesh+=`M${left} ${y}H${width-5}`;
        }
      }
      for(let index=0;index<=10;index++){const x=left+(width-left-5)*index/10;mesh+=`M${x} ${top}V${bottom}`;}
      if (mesh!==lastMesh) {grid.setAttribute("d",mesh);lastMesh=mesh;}
      background.style.clipPath=`inset(0 0 0 ${current.width}px)`;
      if(shield&&fromShield&&shieldTo)shield.style.transform=`translateY(${(fromShield.top-shieldTo.top)*(1-ease)}px)`;
      const free=width-current.width-36;
      const ceiling=top+12,floor=Math.min(bottom-12,mapTop-current.top-22);
      const available=Math.max(0,floor-ceiling);
      const connected=Number.isFinite(endpoint?.x)&&Number.isFinite(endpoint?.y);
      pulse.style.opacity=String(connected?clamp((free-40)/80)*clamp((available-30)/50)*(1-mapPhase):0);
      const origin=connected?endpoint:{x:current.width-5,y:ceiling+available*.82};
      const junction={x:current.width+9,y:origin.y};
      const inMountain=([x,y])=>({x:current.width+18+Math.max(0,free)*x,y:ceiling+available*y});
      const mountains=peaks.map(inMountain);
      mountains[0].y=Math.max(ceiling,Math.min(floor,origin.y));
      const ridge=tracePath([origin,junction,...mountains]);
      path.setAttribute("d",ridge.d);outline.setAttribute("d",ridge.d);
      path.setAttribute("stroke-dashoffset",String(1-head));
      dots.forEach((dot,index)=>{
        const {x,y}=ridge.at(head-index*.035);
        dot.setAttribute("cx",String(x));dot.setAttribute("cy",String(y));
      });
      const forkAt=Math.hypot(junction.x-origin.x,junction.y-origin.y)/Math.max(1,ridge.length);
      const followHead=clamp((head-forkAt)/Math.max(.01,1-forkAt));
      ranges.forEach(range=>{
        const lower=range.peaks.map(inMountain);lower[0].y=mountains[0].y;
        const branch=tracePath([junction,...lower]),rangeHead=clamp((followHead-range.lag)/(1-range.lag));
        range.backdrop.setAttribute("d",branch.d);range.ink.setAttribute("d",branch.d);
        range.ink.setAttribute("stroke-dashoffset",String(1-rangeHead));
        range.tail.forEach((dot,index)=>{
          const {x,y}=branch.at(rangeHead-index*.025);
          dot.setAttribute("cx",String(x));dot.setAttribute("cy",String(y));dot.style.visibility=rangeHead>0?"visible":"hidden";
        });
      });
      if(progress>=1||animation.playState==="idle")clear();else frame=requestAnimationFrame(draw);
    };
    draw();
    return {clear,bounds:()=>current};
  }
  window.DashboardTraceHandoff={start};
})();
