import { useState, useMemo, useRef, useEffect, useCallback } from "react";

/* ═══════════════════════════════════════════════════════════
   GLOBAL STYLES
═══════════════════════════════════════════════════════════ */
const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;600;700;900&family=JetBrains+Mono:wght@300;400;500;600&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg0:        #020912;
    --bg1:        #050f20;
    --bg2:        #071428;
    --bg3:        #0a1e38;
    --bg4:        #0d2448;
    --border:     #0e3060;
    --border-hi:  #1a4a80;
    --cyan:       #00d4ff;
    --cyan-dim:   #0080aa;
    --cyan-glow:  rgba(0,212,255,0.15);
    --green:      #00ff9d;
    --green-dim:  #006644;
    --amber:      #ff9500;
    --amber-dim:  #6b3f00;
    --red:        #ff4455;
    --text0:      #e8f4ff;
    --text1:      #8ab0cc;
    --text2:      #3d6080;
    --text3:      #1e3a55;
  }

  html, body, #root { height: 100%; background: var(--bg0); color: var(--text0); font-family: 'JetBrains Mono', 'Courier New', monospace; font-size: 13px; -webkit-font-smoothing: antialiased; }

  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: var(--bg1); }
  ::-webkit-scrollbar-thumb { background: var(--border-hi); border-radius: 2px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--cyan-dim); }

  input[type=number]::-webkit-inner-spin-button,
  input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; }
  input[type=number] { -moz-appearance: textfield; }

  @keyframes fadein { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
  @keyframes count-up { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }

  .panel-anim { animation: fadein 0.3s ease forwards; }
  .stat-anim  { animation: count-up 0.25s ease forwards; }

  .mob-section { border-bottom: 1px solid var(--border); }
  .mob-section-header { display:flex; justify-content:space-between; align-items:center; padding:12px 16px; cursor:pointer; font-family:'Orbitron',monospace; font-size:10px; letter-spacing:0.12em; color:var(--cyan); text-transform:uppercase; background:var(--bg1); user-select:none; }
  .mob-section-header:active { background:var(--bg2); }

  .layout-thumb:hover { border-color: var(--cyan) !important; box-shadow: 0 0 24px var(--cyan-glow) !important; }

  @media print {
    body > * { display: none !important; }
    #print-report { display: block !important; }
    @page { size: letter landscape; margin: 0.4in; }
  }
`;

function InjectCSS() {
  useEffect(() => {
    const el = document.createElement("style");
    el.textContent = GLOBAL_CSS;
    document.head.appendChild(el);
    return () => document.head.removeChild(el);
  }, []);
  return null;
}

/* ═══════════════════════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════════════════════ */
const MATERIALS = [
  { name: "rPET",          density: 1.38, price: 0.55 },
  { name: "PET (Virgin)",  density: 1.38, price: 0.65 },
  { name: "PETG",          density: 1.27, price: 0.95 },
  { name: "HIPS",          density: 1.05, price: 0.85 },
  { name: "PP",            density: 0.91, price: 0.70 },
  { name: "PVC",           density: 1.40, price: 0.55 },
  { name: "ABS",           density: 1.05, price: 1.05 },
  { name: "Polycarbonate", density: 1.20, price: 1.75 },
  { name: "PLA",           density: 1.24, price: 0.95 },
  { name: "GPPS",          density: 1.05, price: 0.72 },
];
const WEB_WIDTHS  = [20, 21, 22, 24, 25, 26, 28, 30];
const GAUGES      = [0.010,0.012,0.015,0.018,0.020,0.024,0.030,0.033,0.040,0.048,0.060,0.080,0.100,0.120];
const CHAIN_EACH  = 0.75;
const MAX_INDEX   = 36;
const GCC_TO_LIN3 = 0.0361273;

/* ═══════════════════════════════════════════════════════════
   DXF PARSER
   Strategy:
   1. If a named die/cut/outline/part layer exists → use only those entities
   2. Else exclude plate/border/frame layers → use what remains
   3. Else use everything
   When multiple cavities are present (mold layout files), detect the
   repeating arc-cluster pattern and return a single cavity's dimensions
   plus the grid layout (across × down) and c/c distances.
═══════════════════════════════════════════════════════════ */
function parseDXF(text) {
  const lines = text.split(/\r?\n/);
  const entities = [];
  let i = 0;

  while (i < lines.length && lines[i].trim() !== "ENTITIES") i++;
  i++;

  while (i < lines.length) {
    const code = lines[i]?.trim();
    const val  = lines[i + 1]?.trim();
    if (code === "0" && val === "ENDSEC") break;

    if (code === "0" && (val === "LINE" || val === "ARC" || val === "LWPOLYLINE" || val === "CIRCLE")) {
      const ent = { type: val, layer: "", props: {}, pts: [] };
      i += 2;
      while (i < lines.length) {
        const c = parseInt(lines[i]?.trim());
        const v = lines[i + 1]?.trim();
        if (isNaN(c)) { i++; continue; }
        if (c === 0) break;
        if (c === 8)  ent.layer = v;
        else if (c === 10) ent.props.x1 = parseFloat(v);
        else if (c === 20) ent.props.y1 = parseFloat(v);
        else if (c === 11) ent.props.x2 = parseFloat(v);
        else if (c === 21) ent.props.y2 = parseFloat(v);
        else if (c === 40) ent.props.radius = parseFloat(v);
        else if (c === 50) ent.props.startAngle = parseFloat(v);
        else if (c === 51) ent.props.endAngle   = parseFloat(v);
        i += 2;
      }
      entities.push(ent);
    } else if (code === "0" && val === "LWPOLYLINE") {
      const ent = { type: "LWPOLYLINE", layer: "", props: {}, pts: [] };
      i += 2;
      let curX = null;
      while (i < lines.length) {
        const c = parseInt(lines[i]?.trim());
        const v = lines[i + 1]?.trim();
        if (isNaN(c)) { i++; continue; }
        if (c === 0) break;
        if (c === 8)  ent.layer = v;
        else if (c === 10) { curX = parseFloat(v); }
        else if (c === 20) { if (curX !== null) { ent.pts.push([curX, parseFloat(v)]); curX = null; } }
        i += 2;
      }
      entities.push(ent);
    } else { i++; }
  }

  // ── Layer selection ──
  const PLATE_LAYERS = new Set(["plate","border","frame","sheet","web","0"]);
  const isDieCut = e => { const l=e.layer.toLowerCase(); return l.includes("die")||l.includes("cut")||l.includes("outline")||l.includes("part"); };
  const dieCut   = entities.filter(isDieCut);
  const notPlate = entities.filter(e => !PLATE_LAYERS.has(e.layer.toLowerCase()));
  const pool     = dieCut.length >= 4 ? dieCut : notPlate.length >= 4 ? notPlate : entities;

  // mm detection helper
  const extentOf = ents => {
    let mnX=Infinity,mxX=-Infinity,mnY=Infinity,mxY=-Infinity;
    for (const e of ents) {
      const p=e.props;
      if (e.type==="LINE") { [p.x1,p.x2].forEach(v=>{ if(v!=null){mnX=Math.min(mnX,v);mxX=Math.max(mxX,v);} }); [p.y1,p.y2].forEach(v=>{ if(v!=null){mnY=Math.min(mnY,v);mxY=Math.max(mxY,v);} }); }
      else if (e.type==="ARC"||e.type==="CIRCLE") { const cx=p.x1||0,cy=p.y1||0,r=p.radius||0; mnX=Math.min(mnX,cx-r);mxX=Math.max(mxX,cx+r);mnY=Math.min(mnY,cy-r);mxY=Math.max(mxY,cy+r); }
      else if (e.type==="LWPOLYLINE") { for(const [x,y] of e.pts){mnX=Math.min(mnX,x);mxX=Math.max(mxX,x);mnY=Math.min(mnY,y);mxY=Math.max(mxY,y);} }
    }
    return { minX:mnX,maxX:mxX,minY:mnY,maxY:mxY,w:mxX-mnX,h:mxY-mnY };
  };

  // ── Try to detect multi-cavity mold layout via arc clusters ──
  // Each cavity typically has 4 corner arcs of the same radius.
  // Group arcs by radius, then cluster by proximity into cavity bounding boxes.
  const allArcs = pool.filter(e => e.type==="ARC" && e.props.radius);
  let cavityResult = null;

  if (allArcs.length >= 4) {
    // Find the most common arc radius (corner radius of cavities)
    const rCounts = {};
    allArcs.forEach(a => { const r=+a.props.radius.toFixed(4); rCounts[r]=(rCounts[r]||0)+1; });
    const cornR = +Object.entries(rCounts).sort((a,b)=>b[1]-a[1])[0][0];
    const cornerArcs = allArcs.filter(a => Math.abs(a.props.radius-cornR)<0.001);

    // Each set of 4 corner arcs defines one cavity
    if (cornerArcs.length >= 4 && cornerArcs.length % 4 === 0) {
      const numCav = cornerArcs.length / 4;
      const cavBoxes = [];
      for (let ci=0; ci<numCav; ci++) {
        const grp = cornerArcs.slice(ci*4, ci*4+4);
        const xs = grp.map(a=>a.props.x1||0), ys = grp.map(a=>a.props.y1||0);
        const mnX=Math.min(...xs)-cornR, mxX=Math.max(...xs)+cornR;
        const mnY=Math.min(...ys)-cornR, mxY=Math.max(...ys)+cornR;
        cavBoxes.push({ cx:(mnX+mxX)/2, cy:(mnY+mxY)/2, w:mxX-mnX, h:mxY-mnY });
      }

      if (cavBoxes.length >= 1) {
        // Use die cut dimensions as-drawn — preserve DXF orientation
        const partW = +cavBoxes[0].w.toFixed(4);
        const partL = +cavBoxes[0].h.toFixed(4);

        // Detect grid layout from center positions
        const roundTo = (v,d=1) => Math.round(v/d)*d;
        const uniqueY = [...new Set(cavBoxes.map(c=>roundTo(c.cy,0.1)))].sort((a,b)=>a-b);
        const uniqueX = [...new Set(cavBoxes.map(c=>roundTo(c.cx,0.1)))].sort((a,b)=>a-b);
        const across = uniqueX.length, down = uniqueY.length;
        const ctcH = across>1 ? +(uniqueX[1]-uniqueX[0]).toFixed(4) : null;
        const ctcV = down>1   ? +(uniqueY[1]-uniqueY[0]).toFixed(4) : null;

        const scale = (partW>100||partL>100) ? 1/25.4 : 1;
        cavityResult = {
          partW: +(partW*scale).toFixed(4),
          partL: +(partL*scale).toFixed(4),
          cornerR: +(cornR*scale).toFixed(4),
          across, down,
          ctcH: ctcH ? +(ctcH*scale).toFixed(4) : null,
          ctcV: ctcV ? +(ctcV*scale).toFixed(4) : null,
          units: scale===1?"in":"mm→in",
          layerUsed: dieCut.length>=4?"die/cut layer":"all layers",
          isLayout: numCav > 1,
        };
      }
    }
  }

  if (cavityResult) return cavityResult;

  // ── Fallback: full outer bounding box = die cut extent ──
  // The die cut is the driving dimension for layout — use all geometry extent.
  const ext = extentOf(pool);
  if (!isFinite(ext.minX)) return null;
  const scale = (ext.w>100||ext.h>100) ? 1/25.4 : 1;
  const arcs2 = pool.filter(e=>e.type==="ARC"&&e.props.radius);
  const cornRFallback = arcs2.length ? Math.min(...arcs2.map(e=>e.props.radius)) : 0;
  return {
    partW: +(ext.w*scale).toFixed(4),
    partL: +(ext.h*scale).toFixed(4),
    cornerR: +(cornRFallback*scale).toFixed(4),
    units: scale===1?"in":"mm→in",
    layerUsed: dieCut.length>=4?"die/cut layer":"all layers",
    isLayout: false,
  };
}

/* ═══════════════════════════════════════════════════════════
   CSV EXPORT
═══════════════════════════════════════════════════════════ */
function buildCSV(layout, inputs, stats) {
  if (!layout || !stats) return "";
  const { formW, usedIndex, cavities, maxCavities, across, down,
          sp, spH, spV, edge, ctcX, ctcY, marginLeft, marginRight, partW, partL, zH } = layout;
  const { material, gauge, partName } = inputs;
  const now = new Date().toLocaleString("en-US");

  const rows = [
    ["THERMOFORM LAYOUT OPTIMIZER — EXPORT"],
    ["Generated", now],
    [],
    ["PART INFO"],
    ["Part Name / Job #", partName || "(unnamed)"],
    ["Part Width (in)",   partW],
    ["Part Length (in)",  partL],
    ["Z-Height (in)",     zH],
    ["Orientation",       inputs.rotated ? "Rotated 90° (L×W)" : "Normal (W×L)"],
    ["Material",          material],
    ["Gauge (in)",        gauge],
    ["Gauge (thou)",      (gauge * 1000).toFixed(0)],
    ["Gauge (mm)",        (gauge * 25.4).toFixed(3)],
    [],
    ["LAYOUT"],
    ["Mold Width (in)",            formW],
    ["Sheet Width w/ Chains (in)", (formW + 2 * CHAIN_EACH).toFixed(3)],
    ["Index Length (in)",          usedIndex.toFixed(4)],
    ["Index Override (in)",        inputs.indexOverride ? parseFloat(inputs.indexOverride).toFixed(3) : "none (36 max)"],
    ["Cavities Across",            across],
    ["Cavities Down",              down],
    ["Total Cavities",             cavities],
    ["Max Possible Cavities",      maxCavities],
    ["C/C Horizontal (in)",        ctcX.toFixed(4)],
    ["C/C Vertical (in)",          ctcY.toFixed(4)],
    ["Spacing Horizontal (in)",    (spH??sp).toFixed(4)],
    ["Spacing Vertical (in)",      (spV??sp).toFixed(4)],
    ["Edge Margin — Left (in)",    marginLeft.toFixed(4)],
    ["Edge Margin — Right (in)",   marginRight.toFixed(4)],
    [],
    ["MATERIAL & WEIGHT"],
    ["Sheet Area (in²)",           stats.sheetArea.toFixed(4)],
    ["Parts Area (in²)",           stats.partsArea.toFixed(4)],
    ["Scrap Area (in²)",           stats.scrapArea.toFixed(4)],
    ["Material Utilization (%)",   stats.utilPct.toFixed(2)],
    ["Sheet Weight (lbs)",         stats.sheetLbs.toFixed(6)],
    ["Parts Weight (lbs)",         stats.partsLbs.toFixed(6)],
    ["Scrap Weight (lbs)",         stats.scrapLbs.toFixed(6)],
    [],
    ["COST"],
    ["Material $/lb",              stats.pricePerLb ? stats.pricePerLb.toFixed(3) : "(estimated) " + stats.estPrice.toFixed(3)],
    ["Sheet Cost ($)",             stats.sheetCost.toFixed(4)],
    ["Cost Per Part ($)",          stats.costPerPart.toFixed(4)],
    [],
    ["CAVITY POSITIONS (center X, center Y in inches from forming-area origin)"],
    ["Cavity #", "Row", "Col", "Center X (in)", "Center Y (in)"],
    ...layout.positions.map((p, i) => [i+1, p.row+1, p.col+1, p.cx.toFixed(4), p.cy.toFixed(4)]),
  ];

  return rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\r\n");
}

function downloadCSV(csv, filename) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

/* ═══════════════════════════════════════════════════════════
   LAYOUT ENGINE
   Horizontal: always automatic — 1×Z gap, parts centered on web.
   Vertical mode (spacingOpts.modeV):
     "edges" — gap = 1×Z, surplus → top/bottom margins
     "gaps"  — edge = 1×Z, surplus → between rows
     "ctc"   — user sets exact vertical center-to-center
═══════════════════════════════════════════════════════════ */
function calcLayout(partW, partL, zH, moldW, minGapArg, userQty, maxIdx, spacingOpts) {
  const minSp = minGapArg != null ? Math.max(0.25, minGapArg) : Math.max(zH, 0.5);
  const modeV = spacingOpts?.modeV || "gaps";
  const ctcV  = spacingOpts?.ctcV  || null;

  // ── Horizontal: always automatic (1×Z gap, centered) ──
  const spH     = minSp;
  const maxAcross = Math.max(0, Math.floor((moldW - 2*minSp + minSp) / (partW + minSp)));
  const usedW   = maxAcross * partW + Math.max(0, maxAcross - 1) * spH;
  const edgeH   = (moldW - usedW) / 2;

  // ── Row count at minimum vertical spacing ──
  const maxDown_fit = Math.max(0, Math.floor((maxIdx - 2*minSp + minSp) / (partL + minSp)));
  const maxCavities_prelim = maxAcross * maxDown_fit;
  const cavities  = (userQty != null && userQty > 0 && userQty < maxCavities_prelim) ? userQty : maxCavities_prelim;
  const fullRows  = Math.floor(cavities / maxAcross);
  const remainder = cavities % maxAcross;
  const totalRows = remainder > 0 ? fullRows + 1 : fullRows;

  // ── Vertical spacing based on mode ──
  let spV, edgeV;
  if (modeV === "ctc" && ctcV != null) {
    // User-specified c/c: gap = ctc - partL, edges get the rest
    spV   = Math.max(0, ctcV - partL);
    edgeV = Math.max(0, (maxIdx - totalRows * partL - Math.max(0, totalRows - 1) * spV) / 2);
  } else if (modeV === "edges") {
    // Gap locked at minSp, all surplus goes to top/bottom margins
    spV   = minSp;
    const usedV = totalRows * partL + Math.max(0, totalRows - 1) * spV;
    edgeV = Math.max(0, (maxIdx - usedV) / 2);
  } else {
    // "gaps" (default): edges locked at minSp, surplus distributed between rows
    edgeV = minSp;
    const remainV = maxIdx - 2 * edgeV - totalRows * partL;
    spV = totalRows > 1 ? Math.max(minSp, remainV / (totalRows - 1)) : Math.max(minSp, remainV);
  }

  const maxCavities = maxAcross * maxDown_fit;

  if (maxAcross === 0 || maxDown_fit === 0) {
    return { across:0, down:0, cavities:0, maxCavities:0, usedIndex:maxIdx, positions:[],
             sp:minSp, edge:minSp, partW, partL, formW:moldW, zH,
             marginLeft:0, marginRight:0, ctcX:partW+minSp, ctcY:partL+minSp,
             spH:minSp, spV:minSp, edgeH:minSp, edgeV:minSp };
  }

  // ── Build positions ──
  const positions = [];
  for (let row = 0; row < totalRows; row++) {
    const cols = row < fullRows ? maxAcross : remainder;
    const rowW    = cols * partW + Math.max(0, cols - 1) * spH;
    const startX  = (moldW - rowW) / 2;
    for (let col = 0; col < cols; col++) {
      positions.push({
        cx: startX + col * (partW + spH) + partW / 2,
        cy: edgeV  + row * (partL + spV) + partL / 2,
        row, col,
      });
    }
  }

  return {
    across: maxAcross, down: totalRows, cavities, maxCavities,
    usedIndex: maxIdx,
    positions,
    sp: spH, spH, spV, edgeH, edgeV,
    edge: edgeH,
    partW, partL, formW: moldW, zH,
    marginLeft: edgeH, marginRight: edgeH,
    ctcX: partW + spH,
    ctcY: partL + spV,
    modeV,
  };
}

/* ═══════════════════════════════════════════════════════════
   LAYOUT SVG
═══════════════════════════════════════════════════════════ */
function LayoutSVG({ layout, scale, printMode = false }) {
  if (!layout || layout.cavities === 0) return null;
  const { formW, usedIndex, positions, partW, partL, sp, spH=sp, spV=sp, edgeH=sp, edgeV=sp, edge, marginLeft, ctcX, ctcY, cavities, across } = layout;
  const sheetW = formW + 2*CHAIN_EACH;
  const svgW = sheetW * scale, svgH = usedIndex * scale;
  const ox = CHAIN_EACH * scale;
  const fs = Math.max(4.5, Math.min(9, scale * 0.7));
  const ar = Math.max(2, scale * 0.22);

  const C = printMode ? {
    bg:"#f5f7fa", chainBg:"#e0e4eb", chainSt:"#b0b8c8",
    formBg:"#ffffff", formSt:"#334155",
    cavFill:"#dceeff", cavSt:"#0066cc", cavNum:"#0066cc",
    dimSt:"#999", dimTx:"#333", label:"#aaa",
  } : {
    bg:"#020912", chainBg:"#040d1e", chainSt:"#0a2040",
    formBg:"#050f20", formSt:"#1a4a80",
    cavFill:"#071e3d", cavSt:"#00d4ff", cavNum:"#00d4ff",
    dimSt:"#1a4a80", dimTx:"#8ab0cc", label:"#1e3a55",
  };

  const hDim = (x1, x2, y, lbl) => {
    const mid=(x1+x2)/2;
    return (<g key={`h${x1}${x2}${y}`}>
      <line x1={x1} y1={y} x2={x2} y2={y} stroke={C.dimSt} strokeWidth={0.6}/>
      <line x1={x1} y1={y-ar} x2={x1} y2={y+ar} stroke={C.dimSt} strokeWidth={0.6}/>
      <line x1={x2} y1={y-ar} x2={x2} y2={y+ar} stroke={C.dimSt} strokeWidth={0.6}/>
      <rect x={mid-22} y={y-7} width={44} height={12} fill={C.bg}/>
      <text x={mid} y={y+4} textAnchor="middle" fill={C.dimTx} fontSize={fs} fontFamily="'JetBrains Mono',monospace">{lbl}</text>
    </g>);
  };

  const vDim = (x, y1, y2, lbl) => {
    const mid=(y1+y2)/2;
    return (<g key={`v${x}${y1}${y2}`} transform={`rotate(-90,${x},${mid})`}>
      <line x1={x} y1={y1} x2={x} y2={y2} stroke={C.dimSt} strokeWidth={0.6}/>
      <line x1={x-ar} y1={y1} x2={x+ar} y2={y1} stroke={C.dimSt} strokeWidth={0.6}/>
      <line x1={x-ar} y1={y2} x2={x+ar} y2={y2} stroke={C.dimSt} strokeWidth={0.6}/>
      <rect x={x-22} y={mid-7} width={44} height={12} fill={C.bg}/>
      <text x={x} y={mid+4} textAnchor="middle" fill={C.dimTx} fontSize={fs} fontFamily="'JetBrains Mono',monospace">{lbl}</text>
    </g>);
  };

  const row0=positions.filter(p=>p.row===0), row1=positions.filter(p=>p.row===1);

  return (
    <svg width={svgW} height={svgH+44} viewBox={`-30 -8 ${svgW+60} ${svgH+58}`} style={{display:"block"}}>
      <defs>
        <pattern id={`ch${printMode}`} patternUnits="userSpaceOnUse" width={6} height={6}>
          <rect width={6} height={6} fill={C.chainBg}/>
          <line x1={0} y1={6} x2={6} y2={0} stroke={C.chainSt} strokeWidth={0.8}/>
        </pattern>
        {!printMode && <filter id="glow"><feGaussianBlur stdDeviation="1.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>}
      </defs>

      <rect x={-30} y={-8} width={svgW+60} height={svgH+58} fill={C.bg} rx={4}/>
      <rect x={0} y={0} width={ox} height={svgH} fill={`url(#ch${printMode})`} stroke={C.chainSt} strokeWidth={0.5}/>
      <rect x={ox+formW*scale} y={0} width={ox} height={svgH} fill={`url(#ch${printMode})`} stroke={C.chainSt} strokeWidth={0.5}/>
      <rect x={ox} y={0} width={formW*scale} height={svgH} fill={C.formBg} stroke={C.formSt} strokeWidth={1}/>

      {positions.map((p,i)=>{
        const x=ox+(p.cx-partW/2)*scale, y=(p.cy-partL/2)*scale;
        const w=partW*scale, h=partL*scale;
        return (
          <g key={i} filter={printMode?undefined:"url(#glow)"}>
            <rect x={x} y={y} width={w} height={h} fill={C.cavFill} stroke={C.cavSt} strokeWidth={printMode?0.8:1} rx={2} opacity={0.9}/>
            {scale>=4 && <text x={x+w/2} y={y+h/2+fs*0.38} textAnchor="middle" fill={C.cavNum} fontSize={fs*0.72} fontFamily="'JetBrains Mono',monospace" opacity={0.55}>{i+1}</text>}
          </g>
        );
      })}

      {scale >= 3 && (<>
        {hDim(0, svgW, svgH+12, `${(formW+2*CHAIN_EACH).toFixed(3)}"`)}
        {hDim(ox, ox+formW*scale, svgH+26, `${formW.toFixed(3)}" form`)}
        {vDim(-18, 0, svgH, `${usedIndex.toFixed(3)}" idx`)}
        {across>=2 && row0.length>=2 && hDim(ox+row0[0].cx*scale, ox+row0[1].cx*scale, row0[0].cy*scale-(partL/2+edge*0.5)*scale, `${ctcX.toFixed(4)}" c/c`)}
        {row0.length>0 && row1.length>0 && vDim(ox+(row0[row0.length-1].cx+partW/2)*scale+12, row0[0].cy*scale, row1[0].cy*scale, `${ctcY.toFixed(4)}" c/c`)}
        {scale>=5 && positions.length>0 && hDim(ox, ox+(positions[0].cx-partW/2)*scale, (positions[0].cy+partL*0.6)*scale, `${marginLeft.toFixed(3)}"`)}
      </>)}

      <text x={ox/2} y={svgH/2} textAnchor="middle" fill={C.label} fontSize={fs*0.85} fontFamily="'JetBrains Mono',monospace" transform={`rotate(-90,${ox/2},${svgH/2})`}>CHAIN</text>
      <text x={ox+formW*scale+ox/2} y={svgH/2} textAnchor="middle" fill={C.label} fontSize={fs*0.85} fontFamily="'JetBrains Mono',monospace" transform={`rotate(-90,${ox+formW*scale+ox/2},${svgH/2})`}>CHAIN</text>
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════
   UTILIZATION GAUGE
═══════════════════════════════════════════════════════════ */
function UtilGauge({ pct }) {
  const r=52, cx=70, cy=70, startDeg=220, sweep=280;
  const toRad = d => (d-90)*Math.PI/180;
  const arc = (s,e) => {
    const sr=toRad(s), er=toRad(e);
    const x1=cx+r*Math.cos(sr),y1=cy+r*Math.sin(sr),x2=cx+r*Math.cos(er),y2=cy+r*Math.sin(er);
    return `M ${x1} ${y1} A ${r} ${r} 0 ${e-s>180?1:0} 1 ${x2} ${y2}`;
  };
  const filledEnd = startDeg + sweep * Math.min(pct/100,1);
  const color = pct>=80?"#00ff9d":pct>=60?"#00d4ff":pct>=40?"#ff9500":"#ff4455";
  return (
    <svg width={140} height={100} viewBox="0 0 140 100">
      <path d={arc(startDeg,startDeg+sweep)} fill="none" stroke="#0d2448" strokeWidth={10} strokeLinecap="round"/>
      <path d={arc(startDeg,filledEnd)} fill="none" stroke={color} strokeWidth={10} strokeLinecap="round" style={{filter:`drop-shadow(0 0 4px ${color})`}}/>
      {[0,25,50,75,100].map(t=>{
        const a=toRad(startDeg+sweep*(t/100)-90);
        return <line key={t} x1={cx+(r-8)*Math.cos(a)} y1={cy+(r-8)*Math.sin(a)} x2={cx+(r+2)*Math.cos(a)} y2={cy+(r+2)*Math.sin(a)} stroke="#1a4a80" strokeWidth={1.5}/>;
      })}
      <text x={cx} y={cy+4} textAnchor="middle" fill={color} fontSize={22} fontFamily="'Orbitron',monospace" fontWeight={700} style={{filter:`drop-shadow(0 0 6px ${color})`}}>{pct.toFixed(0)}</text>
      <text x={cx} y={cy+18} textAnchor="middle" fill="#3d6080" fontSize={8} fontFamily="'JetBrains Mono',monospace" letterSpacing={2}>UTIL %</text>
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════
   WEIGHT BAR
═══════════════════════════════════════════════════════════ */
function WeightBar({ label, value, total, color }) {
  const pct = total > 0 ? Math.min((value/total)*100,100) : 0;
  return (
    <div style={{marginBottom:10}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
        <span style={{color:"var(--text1)",fontSize:10,letterSpacing:"0.08em"}}>{label}</span>
        <span style={{color,fontSize:11,fontFamily:"'JetBrains Mono',monospace"}}>{value.toFixed(4)} lb</span>
      </div>
      <div style={{height:4,background:"var(--bg4)",borderRadius:2,overflow:"hidden"}}>
        <div style={{height:"100%",width:`${pct}%`,background:color,borderRadius:2,transition:"width 0.6s cubic-bezier(0.4,0,0.2,1)",boxShadow:`0 0 6px ${color}`}}/>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   LED READOUT
═══════════════════════════════════════════════════════════ */
function LEDReadout({ label, value, unit, color="var(--cyan)", large }) {
  return (
    <div style={{background:"var(--bg0)",border:"1px solid var(--border)",borderTop:`2px solid ${color}`,borderRadius:6,padding:large?"14px 16px":"10px 14px",display:"flex",flexDirection:"column",gap:3,boxShadow:"0 0 12px rgba(0,0,0,0.4),inset 0 0 20px rgba(0,0,0,0.3)"}}>
      <div style={{fontSize:9,color:"var(--text2)",letterSpacing:"0.15em",fontFamily:"'Orbitron',monospace",textTransform:"uppercase"}}>{label}</div>
      <div style={{fontSize:large?24:18,fontFamily:"'Orbitron',monospace",fontWeight:700,color,letterSpacing:"0.05em",textShadow:`0 0 10px ${color}`}}>
        {value}{unit&&<span style={{fontSize:large?12:10,marginLeft:4,color:"var(--text2)",fontWeight:400}}>{unit}</span>}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   FIELD + INPUT HELPERS
═══════════════════════════════════════════════════════════ */
function Field({ label, children }) {
  return (
    <div style={{marginBottom:12}}>
      <div style={{fontSize:9,color:"var(--text2)",letterSpacing:"0.15em",fontFamily:"'Orbitron',monospace",textTransform:"uppercase",marginBottom:5}}>{label}</div>
      {children}
    </div>
  );
}

const iStyle = {width:"100%",padding:"9px 12px",background:"var(--bg0)",border:"1px solid var(--border)",color:"var(--text0)",borderRadius:5,outline:"none",fontFamily:"'JetBrains Mono',monospace",fontSize:13,transition:"border-color 0.15s,box-shadow 0.15s"};
const onFocus = e=>{e.target.style.borderColor="var(--cyan-dim)";e.target.style.boxShadow="0 0 0 2px var(--cyan-glow)";};
const onBlur  = e=>{e.target.style.borderColor="var(--border)";e.target.style.boxShadow="none";};

function NInput({value,onChange,step,min,placeholder}) {
  return <input type="number" value={value} onChange={onChange} step={step} min={min} placeholder={placeholder} onFocus={onFocus} onBlur={onBlur} style={iStyle}/>;
}
function SInput({value,onChange,placeholder}) {
  return <input type="text" value={value} onChange={onChange} placeholder={placeholder} onFocus={onFocus} onBlur={onBlur} style={iStyle}/>;
}
function Sel({value,onChange,children}) {
  return <select value={value} onChange={onChange} onFocus={onFocus} onBlur={onBlur} style={{...iStyle,cursor:"pointer",appearance:"auto"}}>{children}</select>;
}

/* ═══════════════════════════════════════════════════════════
   CANVAS MODAL
═══════════════════════════════════════════════════════════ */
function CanvasModal({ layout, onClose, onSpacingChange }) {
  const ref = useRef(null);
  const [xf, setXf] = useState({x:40,y:40,scale:1});
  const [drag,setDrag] = useState(false);
  const last = useRef({x:0,y:0});
  const [sp, setSp] = useState(null);
  const lastPinch = useRef(null);

  useEffect(()=>{ if(layout) setSp(layout.sp); },[layout?.sp]);

  useEffect(()=>{
    if(!ref.current||!layout) return;
    const {clientWidth:cw,clientHeight:ch}=ref.current;
    const sw=(layout.formW+2*CHAIN_EACH)*10, sh=layout.usedIndex*10;
    const fit=Math.min((cw-80)/sw,(ch-120)/sh,2.5);
    setXf({scale:fit,x:(cw-sw*fit)/2,y:(ch-sh*fit)/2+40});
  },[layout]);

  const onMD = useCallback(e=>{if(e.target.tagName==="INPUT")return;setDrag(true);last.current={x:e.clientX,y:e.clientY};},[]);
  const onMM = useCallback(e=>{if(!drag)return;setXf(t=>({...t,x:t.x+e.clientX-last.current.x,y:t.y+e.clientY-last.current.y}));last.current={x:e.clientX,y:e.clientY};},[drag]);
  const onMU = useCallback(()=>setDrag(false),[]);

  const onWheel = useCallback(e=>{
    e.preventDefault();
    const f=e.deltaY<0?1.12:0.89;
    setXf(t=>{
      const ns=Math.max(0.15,Math.min(10,t.scale*f));
      const rect=ref.current.getBoundingClientRect();
      const mx=e.clientX-rect.left,my=e.clientY-rect.top;
      return {scale:ns,x:mx-(mx-t.x)*(ns/t.scale),y:my-(my-t.y)*(ns/t.scale)};
    });
  },[]);

  useEffect(()=>{const el=ref.current;if(el){el.addEventListener("wheel",onWheel,{passive:false});}return()=>{if(el)el.removeEventListener("wheel",onWheel);};},[onWheel]);

  const onTS = useCallback(e=>{if(e.touches.length===1){setDrag(true);last.current={x:e.touches[0].clientX,y:e.touches[0].clientY};}if(e.touches.length===2){lastPinch.current=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);}},[]);
  const onTM = useCallback(e=>{e.preventDefault();if(e.touches.length===1&&drag){setXf(t=>({...t,x:t.x+e.touches[0].clientX-last.current.x,y:t.y+e.touches[0].clientY-last.current.y}));last.current={x:e.touches[0].clientX,y:e.touches[0].clientY};}if(e.touches.length===2&&lastPinch.current){const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);setXf(t=>({...t,scale:Math.max(0.15,Math.min(10,t.scale*(d/lastPinch.current)))}));lastPinch.current=d;}},[drag]);
  const onTE = useCallback(()=>{setDrag(false);lastPinch.current=null;},[]);

  if(!layout) return null;

  return (
    <div style={{position:"fixed",inset:0,zIndex:2000,background:"rgba(2,9,18,0.96)",backdropFilter:"blur(10px)",display:"flex",flexDirection:"column"}}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 20px",background:"var(--bg1)",borderBottom:"1px solid var(--border)",flexShrink:0,gap:12,flexWrap:"wrap"}}>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          <span style={{fontFamily:"'Orbitron',monospace",fontSize:11,letterSpacing:"0.15em",color:"var(--cyan)",textTransform:"uppercase"}}>Layout Canvas</span>
          <span style={{color:"var(--text2)",fontSize:11}}>{layout.cavities} cav · {layout.across}×{layout.down} · {layout.usedIndex.toFixed(3)}"</span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <div style={{display:"flex",alignItems:"center",gap:8,background:"var(--bg0)",border:"1px solid var(--border)",borderRadius:6,padding:"6px 12px"}}>
            <span style={{fontSize:9,color:"var(--text2)",letterSpacing:"0.12em",fontFamily:"'Orbitron',monospace",textTransform:"uppercase"}}>Spacing</span>
            <input type="number" value={sp??""} min={0.25} max={3} step={0.0625}
              onChange={e=>{setSp(e.target.value);const v=parseFloat(e.target.value);if(!isNaN(v)&&v>=0.25)onSpacingChange(v);}}
              style={{width:56,padding:"3px 6px",background:"var(--bg0)",border:"1px solid var(--cyan-dim)",color:"var(--cyan)",borderRadius:4,fontFamily:"'JetBrains Mono',monospace",fontSize:12,outline:"none"}}/>
            <span style={{color:"var(--text2)",fontSize:10}}>"</span>
          </div>
          <div style={{display:"flex",gap:5}}>
            {["0.5×","1×","2×","Fit"].map(z=>(
              <button key={z} onClick={()=>{
                if(z==="Fit"){if(!ref.current)return;const{clientWidth:cw,clientHeight:ch}=ref.current;const sw=(layout.formW+2*CHAIN_EACH)*10,sh=layout.usedIndex*10;const fit=Math.min((cw-80)/sw,(ch-120)/sh,2.5);setXf({scale:fit,x:(cw-sw*fit)/2,y:(ch-sh*fit)/2+40});}
                else setXf(t=>({...t,scale:parseFloat(z)}));
              }} style={{padding:"5px 10px",fontSize:10,borderRadius:4,cursor:"pointer",background:"var(--bg2)",border:"1px solid var(--border)",color:"var(--text1)",fontFamily:"'JetBrains Mono',monospace"}}>{z}</button>
            ))}
          </div>
          <button onClick={onClose} style={{padding:"6px 14px",borderRadius:5,border:"1px solid #5a1a22",background:"#1a0810",color:"#ff4455",cursor:"pointer",fontFamily:"'JetBrains Mono',monospace",fontSize:12}}>✕ Close</button>
        </div>
      </div>
      {/* Canvas */}
      <div ref={ref} onMouseDown={onMD} onMouseMove={onMM} onMouseUp={onMU} onMouseLeave={onMU} onTouchStart={onTS} onTouchMove={onTM} onTouchEnd={onTE}
        style={{flex:1,overflow:"hidden",position:"relative",cursor:drag?"grabbing":"grab",background:"radial-gradient(ellipse at 50% 40%,#071428 0%,#020912 70%)",touchAction:"none"}}>
        <svg style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none"}}>
          <defs><pattern id="dotg" width={24} height={24} patternUnits="userSpaceOnUse"><circle cx={12} cy={12} r={0.8} fill="#0d2448"/></pattern></defs>
          <rect width="100%" height="100%" fill="url(#dotg)"/>
        </svg>
        <div style={{position:"absolute",transform:`translate(${xf.x}px,${xf.y}px) scale(${xf.scale})`,transformOrigin:"0 0",userSelect:"none"}}>
          <LayoutSVG layout={layout} scale={10}/>
        </div>
        <div style={{position:"absolute",bottom:12,left:"50%",transform:"translateX(-50%)",color:"var(--text3)",fontSize:10,fontFamily:"'JetBrains Mono',monospace",letterSpacing:"0.08em",pointerEvents:"none",background:"rgba(2,9,18,0.6)",padding:"4px 12px",borderRadius:20,border:"1px solid var(--border)"}}>
          scroll/pinch to zoom · drag to pan · adjust spacing above
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   PRINT REPORT
═══════════════════════════════════════════════════════════ */
function PrintReport({ layout, inputs, stats }) {
  if (!layout||!stats) return null;
  const { formW, usedIndex, cavities, across, down, sp, spH, spV, ctcX, ctcY, marginLeft, partW, partL } = layout;
  const now = new Date();
  return (
    <div id="print-report" style={{display:"none",fontFamily:"'Courier New',monospace",color:"#000",background:"#fff"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",borderBottom:"2px solid #000",paddingBottom:10,marginBottom:16}}>
        <div>
          <div style={{fontSize:18,fontWeight:700,letterSpacing:3,textTransform:"uppercase"}}>THERMOFORM LAYOUT SHEET</div>
          <div style={{fontSize:10,color:"#555",marginTop:2}}>{inputs.partName||"Unnamed Part"} · {inputs.material} · {(inputs.gauge*1000).toFixed(0)} thou gauge · {inputs.rotated?"Rotated 90°":"Normal orientation"}</div>
        </div>
        <div style={{textAlign:"right",fontSize:10,color:"#666"}}>
          <div>{now.toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"})}</div>
          <div>{now.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"})}</div>
        </div>
      </div>
      <div style={{display:"flex",justifyContent:"center",marginBottom:16}}>
        <LayoutSVG layout={layout} scale={20} printMode={true}/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:20,fontSize:10}}>
        {[
          {title:"PART DIMENSIONS",rows:[["Width",`${inputs.partW}" (${(inputs.partW*25.4).toFixed(1)} mm)`],["Length",`${inputs.partL}" (${(inputs.partL*25.4).toFixed(1)} mm)`],["Z-Height",`${inputs.zH}"`],["Material",inputs.material],["Gauge",`${inputs.gauge}" · ${(inputs.gauge*1000).toFixed(0)} thou`]]},
          {title:"LAYOUT",rows:[["Mold Width",`${formW}"`],["Index Length",`${usedIndex.toFixed(4)}"`],["Across × Down",`${across} × ${down}`],["Total Cavities",`${cavities}`],["C/C Horizontal",`${ctcX.toFixed(4)}"`],["C/C Vertical",`${ctcY.toFixed(4)}"`],["Spacing H",`${(layout.spH??sp).toFixed(4)}"`],["Spacing V",`${(layout.spV??sp).toFixed(4)}"`],["Edge Margin",`${marginLeft.toFixed(4)}"`]]},
          {title:"MATERIAL & COST",rows:[["Sheet Area",`${stats.sheetArea.toFixed(3)} in²`],["Parts Area",`${stats.partsArea.toFixed(3)} in²`],["Utilization",`${stats.utilPct.toFixed(1)}%`],["Sheet Weight",`${stats.sheetLbs.toFixed(4)} lbs`],["Parts Weight",`${stats.partsLbs.toFixed(4)} lbs`],["Scrap Weight",`${stats.scrapLbs.toFixed(4)} lbs`],["$/lb",stats.pricePerLb?`$${stats.pricePerLb.toFixed(3)}`:`~$${stats.estPrice.toFixed(3)}`],["Sheet Cost",`$${stats.sheetCost.toFixed(4)}`],["Cost / Part",`$${stats.costPerPart.toFixed(4)}`]]},
        ].map(({title,rows})=>(
          <div key={title}>
            <div style={{fontSize:8,fontWeight:700,letterSpacing:3,textTransform:"uppercase",borderBottom:"1px solid #000",paddingBottom:3,marginBottom:6}}>{title}</div>
            {rows.map(([l,v])=>(
              <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"3px 0",borderBottom:"1px solid #eee"}}>
                <span style={{color:"#555"}}>{l}</span><span style={{fontWeight:600}}>{v}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div style={{marginTop:12,borderTop:"1px solid #ccc",paddingTop:6,fontSize:8,color:"#888",display:"flex",justifyContent:"space-between"}}>
        <span>Thermoform Layout Optimizer</span>
        <span>Spacing H: {(layout.spH??sp).toFixed(4)}" · V: {(layout.spV??sp).toFixed(4)}" · Margin: {marginLeft.toFixed(4)}"</span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   MAIN APP
═══════════════════════════════════════════════════════════ */
export default function App() {
  const [partName,   setPartName]   = useState("");
  const [partWStr,   setPartWStr]   = useState("3");
  const [partLStr,   setPartLStr]   = useState("5");
  const [zHStr,      setZHStr]      = useState("1.5");
  const [moldW,      setMoldW]      = useState(24);
  const [gaugeIdx,   setGaugeIdx]   = useState(6);
  const [matIdx,     setMatIdx]     = useState(0);
  const [pricePerLb, setPricePerLb] = useState("");
  const [qtyInput,   setQtyInput]   = useState("");
  const [minGap,     setMinGap]     = useState(null);  // null = 1×Z default
  const [indexStr,   setIndexStr]   = useState("");         // blank = MAX_INDEX (36")
  const [modeV,      setModeV]      = useState("gaps");     // "edges" | "gaps" | "ctc"
  const [ctcVStr,    setCtcVStr]    = useState("");          // manual c/c vertical
  const [rotated,    setRotated]    = useState(false);
  const [showModal,  setShowModal]  = useState(false);
  const [isMobile,   setIsMobile]   = useState(false);
  const [openSec,    setOpenSec]    = useState({part:true,mold:true,mat:true});
  const [dxfStatus,  setDxfStatus]  = useState(null); // null | {ok, msg}
  const dxfRef = useRef(null);

  const handleDXF = useCallback(e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const result = parseDXF(ev.target.result);
        if (!result) { setDxfStatus({ok:false,msg:"Could not extract geometry from this DXF."}); return; }
        const { partW, partL, layerUsed, units, isLayout, across, down, ctcH, ctcV } = result;
        if (partW > 0) setPartWStr(String(partW));
        if (partL > 0) setPartLStr(String(partL));
        setPartName(prev => prev || file.name.replace(/\.dxf$/i,""));
        if (isLayout) {
          // Mold layout file — report the detected grid
          let msg = `✓ ${file.name}  part ${partW}" × ${partL}"  (${layerUsed}, ${units})`;
          msg += `  |  ${across}×${down} grid`;
          if (ctcH) msg += `  c/c H: ${ctcH}"`;
          if (ctcV) msg += `  V: ${ctcV}"`;
          setDxfStatus({ ok:true, msg, isLayout:true, across, down, ctcH, ctcV });
        } else {
          setDxfStatus({ ok:true, msg:`✓ ${file.name}  ${partW}" × ${partL}"  (${layerUsed}, ${units})` });
        }
      } catch(err) {
        setDxfStatus({ok:false,msg:`Parse error: ${err.message}`});
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }, []);

  useEffect(()=>{const c=()=>setIsMobile(window.innerWidth<768);c();window.addEventListener("resize",c);return()=>window.removeEventListener("resize",c);},[]);

  const gauge    = GAUGES[gaugeIdx];
  const material = MATERIALS[matIdx];

  const layout = useMemo(()=>{
    const w=parseFloat(partWStr),l=parseFloat(partLStr),z=parseFloat(zHStr);
    if(!w||!l||!z||w<=0||l<=0||z<=0) return null;
    const uq=parseInt(qtyInput,10);
    const qty = isNaN(uq)?null:uq;
    const idxVal=parseFloat(indexStr);
    const maxIdx=(!isNaN(idxVal)&&idxVal>0)?Math.min(idxVal,MAX_INDEX):MAX_INDEX;
    const [ew, el] = rotated ? [l, w] : [w, l];
    const sopts={modeV,ctcV:parseFloat(ctcVStr)||null};
    return calcLayout(ew, el, z, moldW, minGap, qty, maxIdx, sopts);
  },[partWStr,partLStr,zHStr,moldW,minGap,qtyInput,rotated,indexStr,modeV,ctcVStr]);

  // Compute both orientations for comparison badge
  const bothLayouts = useMemo(()=>{
    const w=parseFloat(partWStr),l=parseFloat(partLStr),z=parseFloat(zHStr);
    if(!w||!l||!z||w<=0||l<=0||z<=0) return null;
    const uq=parseInt(qtyInput,10); const qty=isNaN(uq)?null:uq;
    const idxVal=parseFloat(indexStr);
    const maxIdx=(!isNaN(idxVal)&&idxVal>0)?Math.min(idxVal,MAX_INDEX):MAX_INDEX;
    const sopts={modeV,ctcV:parseFloat(ctcVStr)||null};
    const normal  = calcLayout(w, l, z, moldW, minGap, qty, maxIdx, sopts);
    const flipped = calcLayout(l, w, z, moldW, minGap, qty, maxIdx, sopts);
    return { normal, flipped };
  },[partWStr,partLStr,zHStr,moldW,minGap,qtyInput,indexStr,modeV,ctcVStr]);

  const stats = useMemo(()=>{
    if(!layout) return null;
    const {formW,usedIndex,cavities,partW:pw,partL:pl}=layout;
    const sheetArea=formW*usedIndex, partsArea=cavities*pw*pl, scrapArea=sheetArea-partsArea;
    const utilPct=(partsArea/sheetArea)*100;
    const density=material.density*GCC_TO_LIN3;
    const sheetLbs=sheetArea*gauge*density, partsLbs=partsArea*gauge*density, scrapLbs=sheetLbs-partsLbs;
    const ppl=parseFloat(pricePerLb), eff=isNaN(ppl)?material.price:ppl;
    const sheetCost=sheetLbs*eff, costPerPart=sheetCost/cavities;
    return {sheetArea,partsArea,scrapArea,utilPct,sheetLbs,partsLbs,scrapLbs,sheetCost,costPerPart,pricePerLb:isNaN(ppl)?null:ppl,estPrice:eff};
  },[layout,gauge,material,pricePerLb]);

  const thumbScale = useMemo(()=>{
    if(!layout) return 3;
    return Math.min((isMobile?window.innerWidth-48:300)/(layout.formW+2*CHAIN_EACH), 360/layout.usedIndex, 8);
  },[layout,isMobile]);

  const inputs={partName,material:material.name,gauge,partW:parseFloat(partWStr)||0,partL:parseFloat(partLStr)||0,zH:parseFloat(zHStr)||0,rotated,indexOverride:indexStr||null,modeV};

  const cardStyle = (accentColor="var(--cyan-dim)") => ({
    background:"var(--bg1)",border:"1px solid var(--border)",
    borderTop:`2px solid ${accentColor}`,borderRadius:8,padding:"14px",marginBottom:12,
  });

  const sections = [
    {key:"part",title:"Part Definition",accent:"var(--cyan-dim)",content:(
      <>
        {/* DXF Upload */}
        <input ref={dxfRef} type="file" accept=".dxf" onChange={handleDXF} style={{display:"none"}}/>
        <button onClick={()=>dxfRef.current?.click()} style={{
          width:"100%",marginBottom:10,padding:"8px 12px",
          background:"var(--bg0)",border:"1px dashed var(--cyan-dim)",
          color:"var(--cyan)",borderRadius:5,cursor:"pointer",
          fontFamily:"'JetBrains Mono',monospace",fontSize:11,
          display:"flex",alignItems:"center",justifyContent:"center",gap:7,
          transition:"border-color 0.15s,background 0.15s",
        }}
          onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--cyan)";e.currentTarget.style.background="var(--cyan-glow)";}}
          onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--cyan-dim)";e.currentTarget.style.background="var(--bg0)";}}>
          ⬆ Upload DXF  <span style={{color:"var(--text2)",fontSize:10}}>(auto-fills dimensions)</span>
        </button>
        {dxfStatus && (
          <div style={{
            fontSize:10,padding:"6px 10px",borderRadius:5,marginBottom:10,
            background: dxfStatus.ok ? "rgba(0,255,157,0.08)" : "rgba(255,68,85,0.08)",
            border: `1px solid ${dxfStatus.ok ? "var(--green-dim)" : "#5a1a22"}`,
            color: dxfStatus.ok ? "var(--green)" : "var(--red)",
            fontFamily:"'JetBrains Mono',monospace",wordBreak:"break-all",
          }}>
            <div style={{display:"flex",justifyContent:"space-between",gap:6}}>
              <span>{dxfStatus.msg}</span>
              <span onClick={()=>setDxfStatus(null)} style={{cursor:"pointer",opacity:0.6,flexShrink:0}}>✕</span>
            </div>
            {dxfStatus.isLayout && (
              <div style={{marginTop:6,display:"grid",gridTemplateColumns:"1fr 1fr",gap:4}}>
                <div style={{background:"rgba(0,212,255,0.06)",borderRadius:3,padding:"3px 6px"}}>
                  <span style={{color:"var(--text2)"}}>grid </span>
                  <span style={{color:"var(--cyan)"}}>{dxfStatus.across} × {dxfStatus.down}</span>
                </div>
                {dxfStatus.ctcH&&<div style={{background:"rgba(0,212,255,0.06)",borderRadius:3,padding:"3px 6px"}}>
                  <span style={{color:"var(--text2)"}}>c/c H </span>
                  <span style={{color:"var(--cyan)"}}>{dxfStatus.ctcH}"</span>
                </div>}
                {dxfStatus.ctcV&&<div style={{background:"rgba(0,212,255,0.06)",borderRadius:3,padding:"3px 6px"}}>
                  <span style={{color:"var(--text2)"}}>c/c V </span>
                  <span style={{color:"var(--cyan)"}}>{dxfStatus.ctcV}"</span>
                </div>}
              </div>
            )}
          </div>
        )}
        <Field label="Part Name / Job #"><SInput value={partName} onChange={e=>setPartName(e.target.value)} placeholder="e.g. Tray-7 Rev2"/></Field>
        <Field label="Width (in)"><NInput value={partWStr} onChange={e=>setPartWStr(e.target.value)} step={0.0625}/></Field>
        <Field label="Length (in)"><NInput value={partLStr} onChange={e=>setPartLStr(e.target.value)} step={0.0625}/></Field>
        <Field label="Z-Height / Draw Depth (in)"><NInput value={zHStr} onChange={e=>setZHStr(e.target.value)} step={0.0625} min={0.1}/></Field>

        {/* Orientation toggle */}
        <div style={{marginBottom:12}}>
          <div style={{fontSize:9,color:"var(--text2)",letterSpacing:"0.15em",fontFamily:"'Orbitron',monospace",textTransform:"uppercase",marginBottom:6}}>Orientation</div>
          <div style={{display:"flex",gap:6}}>
            <button onClick={()=>setRotated(false)} style={{
              flex:1,padding:"8px 6px",borderRadius:5,cursor:"pointer",fontSize:10,
              fontFamily:"'JetBrains Mono',monospace",transition:"all 0.15s",
              background: !rotated ? "rgba(0,212,255,0.12)" : "var(--bg0)",
              border: !rotated ? "1px solid var(--cyan)" : "1px solid var(--border)",
              color: !rotated ? "var(--cyan)" : "var(--text2)",
              boxShadow: !rotated ? "0 0 8px var(--cyan-glow)" : "none",
            }}>
              <div style={{fontSize:14,marginBottom:2}}>▭</div>
              <div>W × L</div>
              {bothLayouts && <div style={{fontSize:9,color:!rotated?"var(--cyan)":"var(--text3)",marginTop:2}}>{bothLayouts.normal.cavities} cav</div>}
            </button>
            <button onClick={()=>setRotated(true)} style={{
              flex:1,padding:"8px 6px",borderRadius:5,cursor:"pointer",fontSize:10,
              fontFamily:"'JetBrains Mono',monospace",transition:"all 0.15s",
              background: rotated ? "rgba(0,212,255,0.12)" : "var(--bg0)",
              border: rotated ? "1px solid var(--cyan)" : "1px solid var(--border)",
              color: rotated ? "var(--cyan)" : "var(--text2)",
              boxShadow: rotated ? "0 0 8px var(--cyan-glow)" : "none",
            }}>
              <div style={{fontSize:14,marginBottom:2}}>▯</div>
              <div>L × W <span style={{fontSize:9,opacity:0.6}}>rotated</span></div>
              {bothLayouts && <div style={{fontSize:9,color:rotated?"var(--cyan)":"var(--text3)",marginTop:2}}>{bothLayouts.flipped.cavities} cav</div>}
            </button>
          </div>
          {/* Best-orientation hint */}
          {bothLayouts && bothLayouts.normal.cavities !== bothLayouts.flipped.cavities && (
            <div style={{
              marginTop:6,padding:"5px 10px",borderRadius:4,fontSize:10,
              fontFamily:"'JetBrains Mono',monospace",
              background:"rgba(0,255,157,0.06)",border:"1px solid var(--green-dim)",color:"var(--green)",
            }}>
              {bothLayouts.normal.cavities > bothLayouts.flipped.cavities
                ? `▭ W×L gives +${bothLayouts.normal.cavities - bothLayouts.flipped.cavities} more cav`
                : `▯ Rotated gives +${bothLayouts.flipped.cavities - bothLayouts.normal.cavities} more cav`}
            </div>
          )}
          {bothLayouts && bothLayouts.normal.cavities === bothLayouts.flipped.cavities && (
            <div style={{marginTop:6,padding:"5px 10px",borderRadius:4,fontSize:10,fontFamily:"'JetBrains Mono',monospace",background:"var(--bg0)",border:"1px solid var(--border)",color:"var(--text2)"}}>
              Both orientations yield {bothLayouts.normal.cavities} cav
            </div>
          )}
        </div>

      </>
    )},
    {key:"mold",title:"Mold Setup",accent:"var(--border-hi)",content:(
      <>
        <Field label="Mold Width (in)"><Sel value={moldW} onChange={e=>setMoldW(Number(e.target.value))}>{WEB_WIDTHS.map(w=><option key={w} value={w}>{w}"</option>)}</Sel></Field>
        <Field label="Index Length (in)">
          <Sel value={indexStr||"36"} onChange={e=>setIndexStr(e.target.value==="36"?"":e.target.value)}>
            {Array.from({length:21},(_,i)=>16+i).map(v=>(
              <option key={v} value={v}>{v}"{v===36?" (max)":v===16?" (min)":""}</option>
            ))}
          </Sel>
        </Field>
        <Field label="Cavity Qty (blank = max)">
          <div style={{display:"flex",gap:6}}>
            <NInput value={qtyInput} onChange={e=>setQtyInput(e.target.value)} placeholder={layout?`max ${layout.maxCavities}`:"auto"} step={1} min={1}/>
            {qtyInput&&<button onClick={()=>setQtyInput("")} style={{padding:"0 12px",background:"var(--bg0)",border:"1px solid var(--border)",color:"var(--text1)",borderRadius:5,cursor:"pointer",fontSize:13}}>✕</button>}
          </div>
          {layout&&qtyInput&&<div style={{fontSize:10,color:"var(--text2)",marginTop:4}}>max {layout.maxCavities} available</div>}
        </Field>
        <Field label={`Min Gap (in)  —  default: 1× Z = ${parseFloat(zHStr)>0?parseFloat(zHStr).toFixed(4):"Z"}`}>
          <div style={{display:"flex",gap:6}}>
            <NInput value={minGap??""} onChange={e=>{const v=parseFloat(e.target.value);setMinGap(isNaN(v)?null:v);}} step={0.0625} min={0.125} placeholder={parseFloat(zHStr)>0?parseFloat(zHStr).toFixed(4):"auto"}/>
            {minGap!=null&&<button onClick={()=>setMinGap(null)} style={{padding:"0 12px",background:"var(--bg0)",border:"1px solid var(--border)",color:"var(--text1)",borderRadius:5,cursor:"pointer",fontSize:13}}>✕</button>}
          </div>
          {minGap!=null&&<div style={{fontSize:10,color:"var(--text2)",marginTop:3}}>overriding 1× Z-height default</div>}
        </Field>

        {/* ── Vertical Spacing Mode ── */}
        <div style={{borderTop:"1px solid var(--border)",paddingTop:12,marginTop:4}}>
          <div style={{fontSize:9,color:"var(--text2)",letterSpacing:"0.12em",fontFamily:"'Orbitron',monospace",textTransform:"uppercase",marginBottom:8}}>
            Vertical — distribute extra space to
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:8}}>
            {[
              {id:"edges", label:"Edges",    desc:"gap=1×Z, surplus→top/bottom"},
              {id:"gaps",  label:"Gaps",     desc:"edge=1×Z, surplus→between rows"},
              {id:"ctc",   label:"Set C/C",  desc:"enter exact vertical c/c"},
            ].map(({id,label,desc})=>(
              <button key={id} onClick={()=>setModeV(id)} style={{
                padding:"7px 10px",borderRadius:5,cursor:"pointer",textAlign:"left",
                fontFamily:"'JetBrains Mono',monospace",fontSize:10,
                background: modeV===id ? "rgba(0,212,255,0.1)" : "var(--bg0)",
                border: modeV===id ? "1px solid var(--cyan)" : "1px solid var(--border)",
                color: modeV===id ? "var(--cyan)" : "var(--text2)",
                display:"flex",justifyContent:"space-between",alignItems:"center",
                transition:"all 0.12s",
              }}>
                <span>{label}</span>
                <span style={{fontSize:9,opacity:0.6}}>{desc}</span>
              </button>
            ))}
          </div>

          {/* C/C input — only shown in ctc mode */}
          {modeV==="ctc" && (
            <div style={{marginBottom:8}}>
              <NInput
                value={ctcVStr}
                onChange={e=>setCtcVStr(e.target.value)}
                step={0.0625} min={0.1}
                placeholder={layout ? `min ${(layout.partL + (layout.spV??layout.sp)).toFixed(4)}"` : "vertical c/c in"}
              />
              {layout && ctcVStr && (()=>{
                const ctcVal = parseFloat(ctcVStr);
                const gap = ctcVal - layout.partL;
                return !isNaN(ctcVal) ? (
                  gap > 0
                    ? <div style={{fontSize:10,color:"var(--text2)",marginTop:3}}>gap = {gap.toFixed(4)}"</div>
                    : <div style={{fontSize:10,color:"var(--red)",marginTop:3}}>c/c must exceed part length ({layout.partL}")</div>
                ) : null;
              })()}
            </div>
          )}

          {/* Live readout */}
          {layout && (
            <div style={{
              display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:4,
              fontSize:10,fontFamily:"'JetBrains Mono',monospace",
            }}>
              {[
                ["gap",  (layout.spV??layout.sp).toFixed(4)+'"',  "var(--cyan)"],
                ["edge", (layout.edgeV??layout.sp).toFixed(4)+'"',"var(--cyan)"],
                ["c/c",  layout.ctcY.toFixed(4)+'"',              "var(--green)"],
              ].map(([lbl,val,col])=>(
                <div key={lbl} style={{background:"var(--bg0)",borderRadius:4,padding:"5px 6px",border:"1px solid var(--bg4)",textAlign:"center"}}>
                  <div style={{color:"var(--text2)",fontSize:8,marginBottom:2}}>{lbl}</div>
                  <div style={{color:col,fontSize:11}}>{val}</div>
                </div>
              ))}
            </div>
          )}

          {/* Horizontal info (read-only) */}
          {layout && (
            <div style={{marginTop:8,padding:"6px 8px",background:"var(--bg0)",borderRadius:4,border:"1px solid var(--bg4)"}}>
              <div style={{fontSize:8,color:"var(--text3)",letterSpacing:"0.1em",fontFamily:"'Orbitron',monospace",textTransform:"uppercase",marginBottom:4}}>Horizontal (auto)</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:4,fontSize:10,fontFamily:"'JetBrains Mono',monospace",textAlign:"center"}}>
                <div><div style={{color:"var(--text3)",fontSize:8}}>gap</div><div style={{color:"var(--text1)"}}>{(layout.spH??layout.sp).toFixed(4)}"</div></div>
                <div><div style={{color:"var(--text3)",fontSize:8}}>edge</div><div style={{color:"var(--text1)"}}>{(layout.edgeH??layout.sp).toFixed(4)}"</div></div>
                <div><div style={{color:"var(--text3)",fontSize:8}}>c/c</div><div style={{color:"var(--text1)"}}>{layout.ctcX.toFixed(4)}"</div></div>
              </div>
            </div>
          )}
        </div>
      </>
    )},
    {key:"mat",title:"Material",accent:"var(--green-dim)",content:(
      <>
        <Field label="Material Type"><Sel value={matIdx} onChange={e=>setMatIdx(Number(e.target.value))}>{MATERIALS.map((m,i)=><option key={m.name} value={i}>{m.name} (ρ={m.density})</option>)}</Sel></Field>
        <Field label="Gauge"><Sel value={gaugeIdx} onChange={e=>setGaugeIdx(Number(e.target.value))}>{GAUGES.map((g,i)=><option key={g} value={i}>{g.toFixed(3)}" · {(g*1000).toFixed(0)} thou · {(g*25.4).toFixed(2)} mm</option>)}</Sel></Field>
        <Field label="Material Price ($/lb)"><NInput value={pricePerLb} onChange={e=>setPricePerLb(e.target.value)} step={0.01} min={0} placeholder={`est. $${material.price.toFixed(2)}/lb`}/></Field>
      </>
    )},
  ];

  return (
    <>
      <InjectCSS/>
      {layout&&stats&&<PrintReport layout={layout} inputs={inputs} stats={stats}/>}
      {showModal&&<CanvasModal layout={layout} onClose={()=>setShowModal(false)} onSpacingChange={v=>setMinGap(v)}/>}

      <div style={{display:"flex",flexDirection:"column",height:"100vh",overflow:"hidden"}}>

        {/* ── HEADER ── */}
        <header style={{height:52,flexShrink:0,background:"linear-gradient(90deg,#020912 0%,#071428 50%,#020912 100%)",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 20px",position:"relative",overflow:"hidden"}}>
          <div style={{position:"absolute",inset:0,pointerEvents:"none",backgroundImage:"repeating-linear-gradient(0deg,rgba(0,212,255,0.018) 0px,transparent 1px,transparent 3px)",backgroundSize:"100% 4px"}}/>
          <div style={{display:"flex",alignItems:"center",gap:12,zIndex:1}}>
            <div style={{width:34,height:34,background:"linear-gradient(135deg,rgba(0,212,255,0.12),rgba(0,212,255,0.25))",border:"1px solid var(--cyan-dim)",borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,color:"var(--cyan)",boxShadow:"0 0 12px var(--cyan-glow)"}}>⬡</div>
            <div>
              <div style={{fontFamily:"'Orbitron',monospace",fontWeight:700,fontSize:isMobile?11:13,letterSpacing:"0.08em",color:"var(--text0)"}}>
                THERMOFORM<span style={{color:"var(--cyan)",marginLeft:8,fontWeight:400,letterSpacing:"0.15em"}}>OPTIMIZER</span>
              </div>
              {!isMobile&&<div style={{fontSize:9,color:"var(--text3)",letterSpacing:"0.15em",fontFamily:"'JetBrains Mono',monospace"}}>CAVITY LAYOUT · MATERIAL ANALYSIS · COST ENGINE</div>}
            </div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center",zIndex:1}}>
            {layout&&<>
              <button onClick={()=>setShowModal(true)} style={{padding:"7px 14px",borderRadius:5,border:"1px solid var(--cyan-dim)",background:"var(--cyan-glow)",color:"var(--cyan)",cursor:"pointer",fontFamily:"'JetBrains Mono',monospace",fontSize:11,display:"flex",alignItems:"center",gap:5,transition:"all 0.15s"}}>
                ⊞ {isMobile?"Canvas":"Open Canvas"}
              </button>
              <button onClick={()=>window.print()} style={{padding:"7px 14px",borderRadius:5,border:"1px solid var(--border)",background:"transparent",color:"var(--text1)",cursor:"pointer",fontFamily:"'JetBrains Mono',monospace",fontSize:11}}>
                🖨{!isMobile&&" Print"}
              </button>
              <button onClick={()=>{
                if(!layout||!stats) return;
                const csv = buildCSV(layout, {partName,material:material.name,gauge,partW:parseFloat(partWStr)||0,partL:parseFloat(partLStr)||0,zH:parseFloat(zHStr)||0}, stats);
                const fname = (partName||"layout").replace(/[^a-z0-9_-]/gi,"_")+".csv";
                downloadCSV(csv, fname);
              }} style={{padding:"7px 14px",borderRadius:5,border:"1px solid var(--green-dim)",background:"rgba(0,255,157,0.06)",color:"var(--green)",cursor:"pointer",fontFamily:"'JetBrains Mono',monospace",fontSize:11}}>
                ⬇{!isMobile&&" CSV"}
              </button>
            </>}
          </div>
        </header>

        {/* ── BODY ── */}
        {isMobile ? (
          <div style={{flex:1,overflowY:"auto"}}>
            {/* Mobile: sections as accordions */}
            {sections.map(({key,title,accent,content})=>(
              <div key={key} className="mob-section">
                <div className="mob-section-header" style={{borderLeft:`3px solid ${accent}`}} onClick={()=>setOpenSec(s=>({...s,[key]:!s[key]}))}>
                  <span>{title}</span>
                  <span style={{color:"var(--text2)",fontSize:14}}>{openSec[key]?"▲":"▼"}</span>
                </div>
                {openSec[key]&&<div style={{padding:"12px 16px"}}>{content}</div>}
              </div>
            ))}

            {/* Results */}
            {layout&&stats&&(
              <div style={{padding:12}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}} className="panel-anim">
                  <LEDReadout label="Cavities" value={layout.cavities} color="var(--cyan)" large/>
                  <LEDReadout label="Index" value={layout.usedIndex.toFixed(3)} unit={`"`} color="var(--cyan)" large/>
                  <LEDReadout label="C/C Horiz" value={layout.ctcX.toFixed(4)} unit={`"`} color="var(--green)"/>
                  <LEDReadout label="C/C Vert"  value={layout.ctcY.toFixed(4)} unit={`"`} color="var(--green)"/>
                </div>
                <div style={{...cardStyle(),cursor:"pointer",marginBottom:12}} className="layout-thumb" onClick={()=>setShowModal(true)}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                    <span style={{fontFamily:"'Orbitron',monospace",fontSize:9,letterSpacing:"0.15em",color:"var(--cyan)",textTransform:"uppercase"}}>Layout</span>
                    <span style={{fontSize:10,color:"var(--text2)"}}>⊞ tap to expand</span>
                  </div>
                  <LayoutSVG layout={layout} scale={thumbScale}/>
                </div>
                <div style={{...cardStyle("var(--green-dim)"),marginBottom:12}}>
                  <div style={{fontFamily:"'Orbitron',monospace",fontSize:9,letterSpacing:"0.15em",color:"var(--green)",textTransform:"uppercase",marginBottom:12}}>Material Utilization</div>
                  <div style={{display:"flex",alignItems:"center",gap:16}}>
                    <UtilGauge pct={stats.utilPct}/>
                    <div style={{flex:1}}>
                      <WeightBar label="PARTS" value={stats.partsLbs} total={stats.sheetLbs} color="var(--green)"/>
                      <WeightBar label="SCRAP" value={stats.scrapLbs} total={stats.sheetLbs} color="var(--amber)"/>
                    </div>
                  </div>
                </div>
                <LEDReadout label="Cost / Part" value={`$${stats.costPerPart.toFixed(4)}`} color="var(--amber)" large/>
              </div>
            )}
          </div>
        ) : (
          <div style={{flex:1,display:"flex",overflow:"hidden"}}>
            {/* Desktop left panel */}
            <div style={{width:274,flexShrink:0,background:"var(--bg0)",borderRight:"1px solid var(--border)",overflowY:"auto",padding:"14px 12px"}}>
              {sections.map(({key,title,accent,content})=>(
                <div key={key} style={cardStyle(accent)}>
                  <div style={{fontFamily:"'Orbitron',monospace",fontSize:9,letterSpacing:"0.15em",color:"var(--cyan)",textTransform:"uppercase",marginBottom:12}}>{title}</div>
                  {content}
                </div>
              ))}
            </div>

            {/* Desktop right results */}
            <div style={{flex:1,overflowY:"auto",background:"var(--bg0)",padding:"16px 20px"}}>
              {!layout ? (
                <div style={{height:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12,color:"var(--text3)"}}>
                  <div style={{fontSize:48,opacity:0.15}}>⬡</div>
                  <div style={{fontFamily:"'Orbitron',monospace",fontSize:10,letterSpacing:"0.25em",textTransform:"uppercase"}}>Enter Part Dimensions</div>
                </div>
              ) : (
                <div style={{display:"flex",flexDirection:"column",gap:14}}>

                  {/* Top LED row */}
                  <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}} className="panel-anim">
                    <LEDReadout label="Cavities"  value={layout.cavities}               color="var(--cyan)"  large/>
                    <LEDReadout label="Index"     value={layout.usedIndex.toFixed(3)}  unit={`"`} color="var(--cyan)"  large/>
                    <LEDReadout label="C/C Horiz" value={layout.ctcX.toFixed(4)}        unit={`"`} color="var(--green)"/>
                    <LEDReadout label="C/C Vert"  value={layout.ctcY.toFixed(4)}        unit={`"`} color="var(--green)"/>
                  </div>

                  {/* Middle: preview + utilization */}
                  <div style={{display:"flex",gap:14,flexWrap:"nowrap",alignItems:"flex-start"}}>
                    {/* Layout preview */}
                    <div style={{...cardStyle("var(--cyan-dim)"),flexShrink:0,cursor:"pointer",transition:"border-color 0.2s,box-shadow 0.2s",padding:0,overflow:"hidden"}}
                      className="layout-thumb" onClick={()=>setShowModal(true)}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 12px"}}>
                        <span style={{fontFamily:"'Orbitron',monospace",fontSize:9,letterSpacing:"0.15em",color:"var(--cyan)",textTransform:"uppercase"}}>Layout Preview</span>
                        <span style={{fontSize:10,color:"var(--text2)"}}>⊞ click to expand</span>
                      </div>
                      <LayoutSVG layout={layout} scale={thumbScale}/>
                      <div style={{padding:"6px 12px",fontSize:9,color:"var(--text3)",textAlign:"center",fontFamily:"'JetBrains Mono',monospace"}}>
                        {layout.across} across × {layout.down} down · H:{(layout.spH??layout.sp).toFixed(3)}" V:{(layout.spV??layout.sp).toFixed(3)}" · {rotated ? "▯ rotated" : "▭ normal"}
                      </div>
                    </div>

                    {/* Utilization + weight */}
                    {stats&&(
                      <div style={{...cardStyle("var(--green-dim)"),flex:1,minWidth:220}}>
                        <div style={{fontFamily:"'Orbitron',monospace",fontSize:9,letterSpacing:"0.15em",color:"var(--green)",textTransform:"uppercase",marginBottom:12}}>Material Utilization</div>
                        <div style={{display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
                          <UtilGauge pct={stats.utilPct}/>
                          <div style={{flex:1,minWidth:140}}>
                            <WeightBar label="PARTS WEIGHT" value={stats.partsLbs} total={stats.sheetLbs} color="var(--green)"/>
                            <WeightBar label="SCRAP WEIGHT" value={stats.scrapLbs} total={stats.sheetLbs} color="var(--amber)"/>
                            <WeightBar label="SHEET TOTAL"  value={stats.sheetLbs} total={stats.sheetLbs} color="var(--cyan-dim)"/>
                          </div>
                        </div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginTop:12}}>
                          {[["Sheet",stats.sheetArea,"var(--cyan-dim)"],["Parts",stats.partsArea,"var(--green)"],["Scrap",stats.scrapArea,"var(--amber)"]].map(([l,v,c])=>(
                            <div key={l} style={{background:"var(--bg0)",borderRadius:5,padding:"8px 10px",border:`1px solid ${c}33`}}>
                              <div style={{fontSize:8,color:"var(--text2)",letterSpacing:"0.1em",marginBottom:3,fontFamily:"'Orbitron',monospace",textTransform:"uppercase"}}>{l}</div>
                              <div style={{fontSize:13,color:c,fontFamily:"'JetBrains Mono',monospace",fontWeight:500}}>{v.toFixed(1)}</div>
                              <div style={{fontSize:9,color:"var(--text2)"}}>in²</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Cost panel */}
                  {stats&&(
                    <div style={{...cardStyle("var(--amber-dim)"),display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12}} className="panel-anim">
                      <div>
                        <div style={{fontSize:9,color:"var(--text2)",letterSpacing:"0.12em",fontFamily:"'Orbitron',monospace",textTransform:"uppercase",marginBottom:5}}>Material</div>
                        <div style={{fontSize:13,color:"var(--text0)",fontFamily:"'JetBrains Mono',monospace"}}>{material.name}</div>
                        <div style={{fontSize:11,color:"var(--text1)"}}>ρ = {material.density} g/cc</div>
                      </div>
                      <div>
                        <div style={{fontSize:9,color:"var(--text2)",letterSpacing:"0.12em",fontFamily:"'Orbitron',monospace",textTransform:"uppercase",marginBottom:5}}>Gauge</div>
                        <div style={{fontSize:13,color:"var(--text0)",fontFamily:"'JetBrains Mono',monospace"}}>{gauge.toFixed(3)}"</div>
                        <div style={{fontSize:11,color:"var(--text1)"}}>{(gauge*1000).toFixed(0)} thou · {(gauge*25.4).toFixed(2)} mm</div>
                      </div>
                      <div>
                        <div style={{fontSize:9,color:"var(--text2)",letterSpacing:"0.12em",fontFamily:"'Orbitron',monospace",textTransform:"uppercase",marginBottom:5}}>Price / lb</div>
                        <div style={{fontSize:13,color:"var(--amber)",fontFamily:"'JetBrains Mono',monospace"}}>${stats.estPrice.toFixed(3)}</div>
                        <div style={{fontSize:10,color:"var(--text2)"}}>{stats.pricePerLb?"entered":"estimated"}</div>
                      </div>
                      <div>
                        <div style={{fontSize:9,color:"var(--text2)",letterSpacing:"0.12em",fontFamily:"'Orbitron',monospace",textTransform:"uppercase",marginBottom:5}}>Cost / Part</div>
                        <div style={{fontSize:22,color:"var(--amber)",fontFamily:"'Orbitron',monospace",fontWeight:700,textShadow:"0 0 10px var(--amber)"}}>${stats.costPerPart.toFixed(4)}</div>
                        <div style={{fontSize:10,color:"var(--text2)"}}>sheet: ${stats.sheetCost.toFixed(3)}</div>
                      </div>
                    </div>
                  )}

                  {/* Detail table */}
                  <div style={cardStyle()} className="panel-anim">
                    <div style={{fontFamily:"'Orbitron',monospace",fontSize:9,letterSpacing:"0.15em",color:"var(--text2)",textTransform:"uppercase",marginBottom:10}}>Layout Details</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 32px"}}>
                      {[
                        ["Mold Width",     `${layout.formW}"`,                              false],
                        ["Sheet Width",    `${(layout.formW+2*CHAIN_EACH).toFixed(3)}" (w/ chains)`,false],
                        ["Index Length",   `${layout.usedIndex.toFixed(4)}"`,               true],
                        ["Across × Down",  `${layout.across} × ${layout.down}`,             true],
                        ["Max Cavities",   `${layout.maxCavities}`,                         false],
                        ["C/C Horizontal", `${layout.ctcX.toFixed(4)}"`,                    false],
                        ["C/C Vertical",   `${layout.ctcY.toFixed(4)}"`,                    false],
                        ["Spacing H",      `${(layout.spH??layout.sp).toFixed(4)}"`,         false],
                        ["Spacing V",      `${(layout.spV??layout.sp).toFixed(4)}"`,         false],
                        ["Left Margin",    `${layout.marginLeft.toFixed(4)}"`,              false],
                        ["Right Margin",   `${layout.marginRight.toFixed(4)}"`,             false],
                      ].map(([l,v,hi])=>(
                        <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid var(--bg3)"}}>
                          <span style={{color:"var(--text2)",fontSize:11}}>{l}</span>
                          <span style={{color:hi?"var(--cyan)":"var(--text0)",fontFamily:"'JetBrains Mono',monospace",fontSize:12,fontWeight:hi?600:400}}>{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
