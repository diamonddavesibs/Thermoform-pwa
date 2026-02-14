import { useState, useMemo, useRef, useEffect } from "react";

const MATERIALS = [
  { name: "rPET", density: 1.38, color: "#4EA8DE", price: 0.55 },
  { name: "PET (Virgin)", density: 1.38, color: "#48BFE3", price: 0.65 },
  { name: "PETG", density: 1.27, color: "#56CFE1", price: 0.95 },
  { name: "HIPS", density: 1.05, color: "#64DFDF", price: 0.85 },
  { name: "PP", density: 0.91, color: "#72EFDD", price: 0.70 },
  { name: "PVC", density: 1.40, color: "#80FFDB", price: 0.55 },
  { name: "ABS", density: 1.05, color: "#5E60CE", price: 1.05 },
  { name: "Polycarbonate", density: 1.20, color: "#7400B8", price: 1.75 },
  { name: "PLA", density: 1.24, color: "#6930C3", price: 0.95 },
  { name: "Polystyrene (GPPS)", density: 1.05, color: "#5390D9", price: 0.80 },
];

const MOLD_WIDTHS = [18, 20, 22, 24, 26, 28, 30];
const COMMON_GAUGES = [0.010, 0.012, 0.015, 0.018, 0.020, 0.024, 0.030, 0.033, 0.040, 0.048, 0.060, 0.080, 0.100, 0.120];
const MAX_INDEX = 36;
const CHAIN_TOTAL = 1.5;
const CHAIN_EACH = 0.75;
const GCC_TO_LBIN3 = 0.0361273;

// FRED PPI: Plastics Material & Resins Mfg (PCU325211325211)
// Source: BLS via FRED / ycharts — last updated Feb 6, 2026
const FRED_PPI = [
  { date: "Dec 2024", value: 315.19 },
  { date: "Jan 2025", value: 315.01 },
  { date: "Feb 2025", value: 321.45 },
  { date: "Mar 2025", value: 325.55 },
  { date: "Apr 2025", value: 322.85 },
  { date: "May 2025", value: 319.54 },
  { date: "Jun 2025", value: 317.43 },
  { date: "Jul 2025", value: 315.62 },
  { date: "Aug 2025", value: 313.88 },
  { date: "Sep 2025", value: 312.49 },
  { date: "Oct 2025", value: 309.28 },
  { date: "Nov 2025", value: 307.15 },
  { date: "Dec 2025", value: 302.41 },
];

/* ── Responsive hook ── */
function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(window.innerWidth < breakpoint);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < breakpoint);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [breakpoint]);
  return isMobile;
}

/* ── DXF Parser ── */
function parseDXF(text) {
  const lines = text.split(/\r?\n/);
  const entities = [];
  let i = 0;
  while (i < lines.length) { if (lines[i].trim() === "ENTITIES") { i++; break; } i++; }
  while (i < lines.length) {
    const code = lines[i]?.trim(), val = lines[i + 1]?.trim();
    if (code === "0" && val === "ENDSEC") break;
    if (code === "0" && (val === "LINE" || val === "ARC")) {
      const ent = { type: val, layer: "", props: {} }; i += 2;
      while (i < lines.length) {
        const c = parseInt(lines[i]?.trim()), v = lines[i + 1]?.trim();
        if (isNaN(c)) { i++; continue; } if (c === 0) break;
        if (c === 8) ent.layer = v;
        else if (c === 10) ent.props.x1 = parseFloat(v);
        else if (c === 20) ent.props.y1 = parseFloat(v);
        else if (c === 11) ent.props.x2 = parseFloat(v);
        else if (c === 21) ent.props.y2 = parseFloat(v);
        else if (c === 40) ent.props.radius = parseFloat(v);
        else if (c === 50) ent.props.startAngle = parseFloat(v);
        else if (c === 51) ent.props.endAngle = parseFloat(v);
        i += 2;
      }
      entities.push(ent);
    } else { i++; }
  }
  const dieCut = entities.filter(e => e.layer.toLowerCase().includes("die") || e.layer.toLowerCase().includes("cut"));
  const used = dieCut.length > 4 ? dieCut : entities.filter(e => e.layer !== "Plate" && e.layer !== "0");
  const fallback = used.length > 4 ? used : entities;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const e of fallback) {
    const p = e.props;
    if (e.type === "LINE") {
      [p.x1, p.x2].forEach(v => { if (v !== undefined) { minX = Math.min(minX, v); maxX = Math.max(maxX, v); }});
      [p.y1, p.y2].forEach(v => { if (v !== undefined) { minY = Math.min(minY, v); maxY = Math.max(maxY, v); }});
    } else if (e.type === "ARC" && p.radius) {
      const cx = p.x1 || 0, cy = p.y1 || 0, r = p.radius;
      minX = Math.min(minX, cx - r); maxX = Math.max(maxX, cx + r);
      minY = Math.min(minY, cy - r); maxY = Math.max(maxY, cy + r);
    }
  }
  if (!isFinite(minX)) return null;
  const totalW = maxX - minX, totalH = maxY - minY;
  const arcs = fallback.filter(e => e.type === "ARC" && e.props.radius);
  const cornerR = arcs.length > 0 ? Math.min(...[...new Set(arcs.map(a => +a.props.radius.toFixed(4)))]) : 0;
  return { totalW: +totalW.toFixed(4), totalH: +totalH.toFixed(4), entityCount: fallback.length, arcCount: arcs.length, cornerR: +cornerR.toFixed(4) };
}

function groupVals(values, tol) {
  if (!values.length) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const groups = []; let curr = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] < tol) curr.push(sorted[i]);
    else { groups.push(curr.reduce((s, v) => s + v, 0) / curr.length); curr = [sorted[i]]; }
  }
  groups.push(curr.reduce((s, v) => s + v, 0) / curr.length);
  return groups;
}

/* ── Layout Engine (centered on web) ── */
function calcLayout(partW, partL, zHeight, moldWidth, maxIndex) {
  const spacing = zHeight;
  const edgeMin = zHeight / 2;
  const formW = moldWidth, formL = maxIndex;

  function tryFit(cW, cL) {
    // Web direction: fit parts with exact z spacing and z/2 edges
    let across = spacing > 0 ? Math.floor(formW / (cW + spacing)) : Math.floor(formW / cW);
    while (across > 0) {
      const needed = across * cW + (across - 1) * spacing + 2 * edgeMin;
      if (needed <= formW + 0.001) break;
      across--;
    }
    if (across <= 0) return { across: 0, down: 0, count: 0, marginW: 0, marginL: 0, moldPlateW: 0, moldPlateL: 0, usedIndex: 0, cellW: cW, cellL: cL };
    const blockW = across * cW + (across - 1) * spacing;
    const marginW = (formW - blockW) / 2; // center block on web
    const moldPlateW = blockW + 2 * edgeMin; // minimum mold plate

    // Index direction: fit rows with exact z spacing and z/2 ends, round up to whole inch
    let down = spacing > 0 ? Math.floor(formL / (cL + spacing)) : Math.floor(formL / cL);
    while (down > 0) {
      const needed = down * cL + (down - 1) * spacing + 2 * edgeMin;
      if (needed <= formL + 0.001) break;
      down--;
    }
    if (down <= 0) return { across: 0, down: 0, count: 0, marginW, marginL: 0, moldPlateW, moldPlateL: 0, usedIndex: 0, cellW: cW, cellL: cL };
    const blockL = down * cL + (down - 1) * spacing;
    const moldPlateL = blockL + 2 * edgeMin;
    const usedIndex = Math.ceil(moldPlateL);
    const marginL = (usedIndex - blockL) / 2; // center block in rounded index
    return { across, down, count: across * down, marginW, marginL, moldPlateW, moldPlateL, usedIndex, cellW: cW, cellL: cL };
  }
  const A = tryFit(partW, partL), B = tryFit(partL, partW);
  return { orientationA: A, orientationB: B, best: A.count >= B.count ? "A" : "B", spacing, edgeMin, formW };
}

/* ── SVG Layout ── */
function LayoutSVG({ layout, orientation, moldWidth, materialColor }) {
  const ori = orientation === "A" ? layout.orientationA : layout.orientationB;
  const { across, down, cellW, cellL, usedIndex, marginW, marginL } = ori;
  const { spacing, edgeMin } = layout;
  if (!across || !down) return <div style={{ padding: 30, textAlign: "center", color: "#94a3b8", fontFamily: "'DM Mono', monospace", fontSize: 13 }}>Part does not fit this configuration.</div>;

  const sheetW = moldWidth + CHAIN_TOTAL, sheetL = usedIndex;
  const pad = 12;
  const scale = Math.min(540 / (sheetW + pad * 2), 400 / (Math.max(sheetL, 4) + pad * 2));
  const svgW = (sheetW + pad * 2) * scale, svgH = (sheetL + pad * 2) * scale;
  const ox = pad * scale, oy = pad * scale;
  const fS = Math.max(8, Math.min(11, scale * 0.95));

  const parts = [];
  for (let r = 0; r < down; r++)
    for (let c = 0; c < across; c++)
      parts.push({ x: CHAIN_EACH + marginW + c * (cellW + spacing), y: marginL + r * (cellL + spacing), w: cellW, h: cellL, key: `${r}-${c}` });

  return (
    <svg width="100%" viewBox={`0 0 ${svgW} ${svgH}`} style={{ display: "block", maxHeight: 460 }}>
      <defs>
        <pattern id="gP" width={scale} height={scale} patternUnits="userSpaceOnUse"><path d={`M ${scale} 0 L 0 0 0 ${scale}`} fill="none" stroke="#1e293b" strokeWidth="0.4" opacity="0.25" /></pattern>
        <pattern id="hP" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" stroke="#334155" strokeWidth="0.8" opacity="0.35" /></pattern>
      </defs>
      <rect width={svgW} height={svgH} fill="#0c1222" rx="4" />
      <rect width={svgW} height={svgH} fill="url(#gP)" />
      <rect x={ox} y={oy} width={sheetW * scale} height={sheetL * scale} fill="#1a2744" stroke="#475569" strokeWidth="1" strokeDasharray="4,3" />
      <rect x={ox} y={oy} width={CHAIN_EACH * scale} height={sheetL * scale} fill="url(#hP)" stroke="#3b4c6b" strokeWidth="0.5" />
      <rect x={ox + (sheetW - CHAIN_EACH) * scale} y={oy} width={CHAIN_EACH * scale} height={sheetL * scale} fill="url(#hP)" stroke="#3b4c6b" strokeWidth="0.5" />
      <rect x={ox + CHAIN_EACH * scale} y={oy} width={moldWidth * scale} height={sheetL * scale} fill="none" stroke="#64748b" strokeWidth="1.5" />
      {parts.map(p => <rect key={p.key} x={ox + p.x * scale} y={oy + p.y * scale} width={p.w * scale} height={p.h * scale} fill={materialColor} fillOpacity="0.22" stroke={materialColor} strokeWidth="1.5" rx="2" />)}

      {marginW * scale > 16 && parts.length > 0 && (() => {
        const fl = ox + CHAIN_EACH * scale, pr = ox + parts[0].x * scale, my = oy + sheetL * 0.5 * scale;
        return <g><line x1={fl} y1={my - 6} x2={fl} y2={my + 6} stroke="#f59e0b" strokeWidth="0.5" /><line x1={pr} y1={my - 6} x2={pr} y2={my + 6} stroke="#f59e0b" strokeWidth="0.5" /><line x1={fl} y1={my} x2={pr} y2={my} stroke="#f59e0b" strokeWidth="0.8" strokeDasharray="2,2" /><text x={(fl + pr) / 2} y={my - 4} textAnchor="middle" fill="#f59e0b" fontSize={fS * 0.8} fontFamily="'DM Mono', monospace">{marginW.toFixed(2)}"</text></g>;
      })()}

      {across >= 2 && spacing * scale > 10 && (() => {
        const r0 = ox + (parts[0].x + parts[0].w) * scale, l1 = ox + parts[1].x * scale, my = oy + (parts[0].y + parts[0].h * 0.5) * scale;
        return <g><line x1={r0} y1={my - 5} x2={r0} y2={my + 5} stroke="#22d3ee" strokeWidth="0.5" /><line x1={l1} y1={my - 5} x2={l1} y2={my + 5} stroke="#22d3ee" strokeWidth="0.5" /><line x1={r0} y1={my} x2={l1} y2={my} stroke="#22d3ee" strokeWidth="0.8" strokeDasharray="2,2" /><text x={(r0 + l1) / 2} y={my - 4} textAnchor="middle" fill="#22d3ee" fontSize={fS * 0.8} fontFamily="'DM Mono', monospace">{spacing.toFixed(2)}"</text></g>;
      })()}

      {(() => { const dy = oy + sheetL * scale + 5 * scale, x1 = ox + CHAIN_EACH * scale, x2 = ox + (CHAIN_EACH + moldWidth) * scale; return <g><line x1={x1} y1={dy - 2 * scale} x2={x1} y2={dy + 1 * scale} stroke="#94a3b8" strokeWidth="0.5" /><line x1={x2} y1={dy - 2 * scale} x2={x2} y2={dy + 1 * scale} stroke="#94a3b8" strokeWidth="0.5" /><line x1={x1} y1={dy} x2={x2} y2={dy} stroke="#94a3b8" strokeWidth="0.8" /><text x={(x1 + x2) / 2} y={dy + 3 * scale} textAnchor="middle" fill="#cbd5e1" fontSize={fS} fontFamily="'DM Mono', monospace">{moldWidth}" web</text></g>; })()}

      {(() => { const dx = ox - 3.5 * scale, y1 = oy, y2 = oy + sheetL * scale; return <g><line x1={dx} y1={y1} x2={dx} y2={y2} stroke="#94a3b8" strokeWidth="0.8" /><line x1={dx - 1 * scale} y1={y1} x2={dx + 1 * scale} y2={y1} stroke="#94a3b8" strokeWidth="0.5" /><line x1={dx - 1 * scale} y1={y2} x2={dx + 1 * scale} y2={y2} stroke="#94a3b8" strokeWidth="0.5" /><text x={dx - 1.8 * scale} y={(y1 + y2) / 2} textAnchor="middle" fill="#cbd5e1" fontSize={fS} fontFamily="'DM Mono', monospace" transform={`rotate(-90, ${dx - 1.8 * scale}, ${(y1 + y2) / 2})`}>{usedIndex}" index</text></g>; })()}

      <text x={ox + CHAIN_EACH * 0.5 * scale} y={oy + sheetL * 0.5 * scale} textAnchor="middle" fill="#4b5c7a" fontSize={fS * 0.8} fontFamily="'DM Mono', monospace" transform={`rotate(-90, ${ox + CHAIN_EACH * 0.5 * scale}, ${oy + sheetL * 0.5 * scale})`}>CHAIN</text>
      <text x={ox + (sheetW - CHAIN_EACH * 0.5) * scale} y={oy + sheetL * 0.5 * scale} textAnchor="middle" fill="#4b5c7a" fontSize={fS * 0.8} fontFamily="'DM Mono', monospace" transform={`rotate(-90, ${ox + (sheetW - CHAIN_EACH * 0.5) * scale}, ${oy + sheetL * 0.5 * scale})`}>CHAIN</text>
    </svg>
  );
}

/* ── FRED PPI Panel ── */
function FredPanel() {
  const [fredData, setFredData] = useState(null);
  const [fredLoading, setFredLoading] = useState(true);
  const [fredError, setFredError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/fred")
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(data => {
        if (cancelled) return;
        const obs = data.observations;
        if (!obs || !obs.length) throw new Error();
        const parsed = obs
          .filter(o => o.value !== ".")
          .map(o => {
            const d = new Date(o.date);
            const label = d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
            return { date: label, value: parseFloat(o.value) };
          })
          .reverse();
        if (parsed.length >= 2) setFredData(parsed);
        else throw new Error();
        setFredLoading(false);
      })
      .catch(() => { if (!cancelled) { setFredError(true); setFredLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  const source = fredData || FRED_PPI;
  const isLive = !!fredData;

  const latest = source[source.length - 1];
  const prev = source[source.length - 2];
  const yearAgo = source[0];
  const moChange = latest.value - prev.value;
  const moPct = (moChange / prev.value) * 100;
  const yrChange = latest.value - yearAgo.value;
  const yrPct = (yrChange / yearAgo.value) * 100;
  const vals = source.map(d => d.value);
  const mn = Math.min(...vals), mx = Math.max(...vals), rng = mx - mn || 1;
  const w = 230, h = 34;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - ((v - mn) / rng) * h}`).join(" ");

  return (
    <div style={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: 9.5, fontWeight: 600, color: "#64748b", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
        Plastics & Resins PPI (FRED)
        {!fredLoading && (
          <span style={{
            fontSize: 8, fontWeight: 700, padding: "1px 5px", borderRadius: 3, letterSpacing: 0.5,
            background: isLive ? "#064e3b" : "#1e293b",
            color: isLive ? "#34d399" : "#94a3b8",
            border: `1px solid ${isLive ? "#065f46" : "#334155"}`,
          }}>
            {isLive ? "LIVE" : "CACHED"}
          </span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 3 }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: "#e2e8f0", fontFamily: "'Space Grotesk', sans-serif" }}>{latest.value.toFixed(1)}</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: moChange <= 0 ? "#ef4444" : "#22c55e", fontFamily: "'DM Mono', monospace" }}>
          {moChange <= 0 ? "▼" : "▲"} {Math.abs(moChange).toFixed(1)} ({moPct >= 0 ? "+" : ""}{moPct.toFixed(1)}%)
        </span>
      </div>
      <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: "'DM Mono', monospace", marginBottom: 6 }}>
        {latest.date} | YoY: {yrPct >= 0 ? "+" : ""}{yrPct.toFixed(1)}% | Index (Dec 1980 = 100)
      </div>
      <svg width="100%" viewBox={`0 0 ${w} ${h + 2}`} style={{ display: "block", marginBottom: 4, maxWidth: w }}>
        <polyline points={pts} fill="none" stroke="#4EA8DE" strokeWidth="1.5" strokeLinejoin="round" />
        {vals.map((v, i) => <circle key={i} cx={(i / (vals.length - 1)) * w} cy={h - ((v - mn) / rng) * h} r={i === vals.length - 1 ? 2.5 : 1.5} fill={i === vals.length - 1 ? "#4EA8DE" : "#1e293b"} stroke="#4EA8DE" strokeWidth="0.5" />)}
      </svg>
      <div style={{ fontSize: 8.5, color: "#475569", fontFamily: "'DM Mono', monospace" }}>
        13-mo trend | BLS via FRED{isLive ? "" : " | Cached fallback"}
      </div>
    </div>
  );
}

/* ── Cost Summary Card ── */
function CostSummary({ hasCost, costLb, sheetWeight, scrapWeight, costPerPart, count }) {
  if (!hasCost) {
    return (
      <div style={{ background: "#111827", border: "1px dashed #1e293b", borderRadius: 8, padding: "10px 14px", marginBottom: 10, textAlign: "center" }}>
        <span style={{ fontSize: 11, color: "#475569", fontFamily: "'DM Mono', monospace" }}>Enter material $/lb for cost analysis</span>
      </div>
    );
  }
  const sheetCost = sheetWeight * costLb;
  const scrapCost = scrapWeight * costLb;
  const rowStyle = { display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 11, fontFamily: "'DM Mono', monospace" };
  return (
    <div style={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 8, padding: 14, marginBottom: 10 }}>
      <div style={{ fontSize: 9.5, fontWeight: 600, color: "#64748b", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 8 }}>Cost Summary</div>
      <div style={rowStyle}><span style={{ color: "#94a3b8" }}>Material $/lb</span><span style={{ color: "#cbd5e1" }}>${costLb.toFixed(2)}</span></div>
      <div style={rowStyle}><span style={{ color: "#94a3b8" }}>Sheet Cost</span><span style={{ color: "#cbd5e1" }}>${sheetCost.toFixed(4)}</span></div>
      <div style={rowStyle}><span style={{ color: "#94a3b8" }}>Scrap Cost</span><span style={{ color: "#cbd5e1" }}>${scrapCost.toFixed(4)}</span></div>
      <div style={{ borderTop: "1px solid #1e293b", marginTop: 6, paddingTop: 8, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "#93c5fd", fontFamily: "'DM Mono', monospace", textTransform: "uppercase" }}>Cost / Part</span>
        <span style={{ fontSize: 22, fontWeight: 700, color: "#22c55e", fontFamily: "'Space Grotesk', sans-serif" }}>${costPerPart.toFixed(4)}</span>
      </div>
      <div style={{ fontSize: 9, color: "#475569", fontFamily: "'DM Mono', monospace", textAlign: "right", marginTop: 2 }}>{count} cavities per index</div>
    </div>
  );
}

/* ── Stat Card ── */
function StatCard({ label, value, unit, accent }) {
  return (
    <div style={{ background: "#111827", border: `1px solid ${accent || "#1e293b"}`, borderRadius: 6, padding: "9px 13px", minWidth: 90, flex: "1 1 90px" }}>
      <div style={{ fontSize: 9.5, color: "#64748b", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: "#e2e8f0", fontFamily: "'Space Grotesk', sans-serif" }}>
        {value}<span style={{ fontSize: 10, color: "#94a3b8", marginLeft: 2 }}>{unit}</span>
      </div>
    </div>
  );
}

/* ── Main App ── */
export default function App() {
  const [partW, setPartW] = useState(3.0);
  const [partL, setPartL] = useState(4.0);
  const [zHeight, setZHeight] = useState(1.0);
  const [materialIdx, setMaterialIdx] = useState(0);
  const [gauge, setGauge] = useState(0.033);
  const [gaugeText, setGaugeText] = useState("0.033");
  const [moldWidth, setMoldWidth] = useState(24);
  const [selectedOri, setSelectedOri] = useState("best");
  const [costPerLb, setCostPerLb] = useState(MATERIALS[0].price.toString());
  const [dxfInfo, setDxfInfo] = useState(null);
  const [showInputs, setShowInputs] = useState(true);
  const fileRef = useRef();
  const isMobile = useIsMobile();

  const material = MATERIALS[materialIdx];
  const densityLbIn3 = material.density * GCC_TO_LBIN3;
  const layout = useMemo(() => calcLayout(partW, partL, zHeight, moldWidth, MAX_INDEX), [partW, partL, zHeight, moldWidth]);
  const activeOri = selectedOri === "best" ? layout.best : selectedOri;
  const ori = activeOri === "A" ? layout.orientationA : layout.orientationB;

  const formingArea = moldWidth * ori.usedIndex;
  const totalSheetW = moldWidth + CHAIN_TOTAL;
  const totalSheetArea = totalSheetW * ori.usedIndex;
  const partArea = ori.cellW * ori.cellL;
  const totalPartsArea = ori.count * partArea;
  const scrapArea = formingArea - totalPartsArea;
  const utilization = formingArea > 0 ? (totalPartsArea / formingArea) * 100 : 0;
  const sheetWeight = totalSheetArea * gauge * densityLbIn3;
  const partsWeight = totalPartsArea * gauge * densityLbIn3;
  const scrapWeight = sheetWeight - partsWeight;
  const hasCost = costPerLb !== "" && parseFloat(costPerLb) > 0;
  const costLb = parseFloat(costPerLb) || 0;
  const sheetCost = hasCost ? sheetWeight * costLb : 0;
  const costPerPart = hasCost && ori.count > 0 ? sheetCost / ori.count : 0;

  const handleGaugePreset = (v) => { setGauge(v); setGaugeText(v.toString()); };
  const handleGaugeInput = (e) => { const v = e.target.value; setGaugeText(v); const n = parseFloat(v); if (!isNaN(n) && n > 0 && n < 1) setGauge(n); };

  const handleDXF = (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text !== "string") return;
      const info = parseDXF(text);
      if (info) { setDxfInfo({ ...info, fileName: file.name }); setPartL(info.totalW); setPartW(info.totalH); }
      else setDxfInfo({ error: "Could not parse geometry from file" });
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const mobileToggle = isMobile ? (
    <button onClick={() => setShowInputs(!showInputs)}
      style={{ padding: "8px 14px", fontSize: 12, fontWeight: 600, fontFamily: "'DM Mono', monospace", background: showInputs ? "#334155" : "#1e3a5f", border: `1px solid ${showInputs ? "#64748b" : "#4EA8DE"}`, color: showInputs ? "#e2e8f0" : "#93c5fd", borderRadius: 6, cursor: "pointer" }}>
      {showInputs ? "▼ Hide Inputs" : "▶ Show Inputs"}
    </button>
  ) : null;

  return (
    <div style={{ minHeight: "100vh", background: "#080d19", color: "#e2e8f0", fontFamily: "'Space Grotesk', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; }
        body { margin: 0; padding: 0; background: #080d19; -webkit-tap-highlight-color: transparent; }
        input[type=number]::-webkit-inner-spin-button { opacity: 1; }
      `}</style>

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)", borderBottom: "1px solid #1e293b", padding: isMobile ? "12px 14px" : "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: isMobile ? 15 : 17, fontWeight: 700, letterSpacing: -0.5, color: "#f1f5f9" }}>THERMOFORM LAYOUT</div>
          <div style={{ fontSize: 10, color: "#64748b", fontFamily: "'DM Mono', monospace", marginTop: 1 }}>Cavity layout • material • cost</div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {mobileToggle}
          <button onClick={() => fileRef.current?.click()} style={{ padding: "8px 14px", fontSize: 11, fontWeight: 600, fontFamily: "'DM Mono', monospace", background: "#1e3a5f", border: "1px solid #4EA8DE", color: "#93c5fd", borderRadius: 6, cursor: "pointer" }}>
            ⬆ DXF
          </button>
        </div>
        <input ref={fileRef} type="file" accept=".dxf" onChange={handleDXF} style={{ display: "none" }} />
      </div>

      {/* DXF banner */}
      {dxfInfo && !dxfInfo.error && (
        <div style={{ background: "#0f2b1a", borderBottom: "1px solid #166534", padding: "6px 14px", fontSize: 10, fontFamily: "'DM Mono', monospace", color: "#86efac", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span>✓ {dxfInfo.fileName || "DXF"}</span>
          <span>X: {dxfInfo.totalW}" → Length</span>
          <span>Y: {dxfInfo.totalH}" → Width</span>
          <span style={{ color: "#4ade80", cursor: "pointer", marginLeft: "auto" }} onClick={() => setDxfInfo(null)}>✕</span>
        </div>
      )}
      {dxfInfo?.error && (
        <div style={{ background: "#2b0f0f", borderBottom: "1px solid #7f1d1d", padding: "6px 14px", fontSize: 10, fontFamily: "'DM Mono', monospace", color: "#fca5a5" }}>✕ {dxfInfo.error}</div>
      )}

      <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row" }}>
        {/* INPUT PANEL */}
        {(!isMobile || showInputs) && (
          <div style={{
            width: isMobile ? "100%" : 300,
            minWidth: isMobile ? "auto" : 260,
            flexShrink: 0,
            background: "#0f172a",
            borderRight: isMobile ? "none" : "1px solid #1e293b",
            borderBottom: isMobile ? "1px solid #1e293b" : "none",
            padding: isMobile ? "12px 14px" : "14px 16px",
            overflowY: isMobile ? "visible" : "auto",
            maxHeight: isMobile ? "none" : "calc(100vh - 56px)",
          }}>
            <SL>Part Cut Size</SL>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 6 }}>
              <IF label="Width" value={partW} onChange={setPartW} suffix='"' step={0.0625} min={0.25} />
              <IF label="Length" value={partL} onChange={setPartL} suffix='"' step={0.0625} min={0.25} />
              <IF label="Z-Height" value={zHeight} onChange={setZHeight} suffix='"' step={0.125} min={0} />
            </div>
            <div style={{ fontSize: 9, color: "#475569", fontFamily: "'DM Mono', monospace", margin: "2px 0 10px" }}>
              Spacing: {zHeight.toFixed(3)}" | Edge/End: {(zHeight / 2).toFixed(3)}"
            </div>

            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr", gap: isMobile ? 12 : 0 }}>
              <div>
                <SL>Material</SL>
                <select value={materialIdx} onChange={e => { const i = parseInt(e.target.value); setMaterialIdx(i); setCostPerLb(MATERIALS[i].price.toString()); }} style={selS}>
                  {MATERIALS.map((m, i) => <option key={m.name} value={i}>{m.name} ({m.density})</option>)}
                </select>
              </div>
              <div>
                <SL>Gauge</SL>
                <input type="text" value={gaugeText} onChange={handleGaugeInput} style={{ ...inpS, marginBottom: 5 }} />
              </div>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 10 }}>
              {COMMON_GAUGES.map(g => (
                <button key={g} onClick={() => handleGaugePreset(g)} style={{ padding: "4px 7px", fontSize: 10, fontFamily: "'DM Mono', monospace", background: Math.abs(gauge - g) < 0.0001 ? "#334155" : "#1e293b", border: `1px solid ${Math.abs(gauge - g) < 0.0001 ? "#4EA8DE" : "#334155"}`, color: Math.abs(gauge - g) < 0.0001 ? "#4EA8DE" : "#94a3b8", borderRadius: 3, cursor: "pointer" }}>
                  .{String(g).split(".")[1]}
                </button>
              ))}
            </div>

            <SL>Mold Width (Web)</SL>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 10 }}>
              {MOLD_WIDTHS.map(w => (
                <button key={w} onClick={() => setMoldWidth(w)} style={{ padding: "6px 10px", fontSize: 13, fontWeight: 600, fontFamily: "'DM Mono', monospace", background: moldWidth === w ? "#1e3a5f" : "#1e293b", border: `1px solid ${moldWidth === w ? "#4EA8DE" : "#334155"}`, color: moldWidth === w ? "#4EA8DE" : "#94a3b8", borderRadius: 4, cursor: "pointer" }}>
                  {w}"
                </button>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr", gap: isMobile ? 12 : 0 }}>
              <div>
                <SL>Orientation</SL>
                <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 10 }}>
                  {[
                    { key: "best", label: `Best — ${Math.max(layout.orientationA.count, layout.orientationB.count)} cav` },
                    { key: "A", label: `As entered — ${layout.orientationA.count}` },
                    { key: "B", label: `Rotated 90° — ${layout.orientationB.count}` },
                  ].map(o => (
                    <button key={o.key} onClick={() => setSelectedOri(o.key)} style={{ padding: "6px 9px", fontSize: 10.5, textAlign: "left", fontFamily: "'DM Mono', monospace", background: selectedOri === o.key ? "#1e3a5f" : "#111827", border: `1px solid ${selectedOri === o.key ? "#4EA8DE" : "#1e293b"}`, color: selectedOri === o.key ? "#93c5fd" : "#94a3b8", borderRadius: 4, cursor: "pointer" }}>
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <SL>Material Cost (opt.)</SL>
                <div style={{ position: "relative", marginBottom: 10 }}>
                  <span style={{ position: "absolute", left: 9, top: 8, color: "#64748b", fontSize: 13, fontFamily: "'DM Mono', monospace" }}>$</span>
                  <input type="number" placeholder="per lb" value={costPerLb} onChange={e => setCostPerLb(e.target.value)} style={{ ...inpS, paddingLeft: 20 }} step={0.01} min={0} />
                </div>
                <FredPanel />
              </div>
            </div>
          </div>
        )}

        {/* RESULTS PANEL */}
        <div style={{ flex: 1, padding: isMobile ? "10px 12px" : "14px 18px", minWidth: 0 }}>
          {/* Stats */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(3, 1fr)" : "repeat(auto-fit, minmax(105px, 1fr))", gap: 6, marginBottom: 10 }}>
            <StatCard label="Cavities" value={ori.count} unit="pcs" accent={material.color} />
            <StatCard label="Index" value={ori.usedIndex} unit='"' />
            <StatCard label="Util" value={utilization.toFixed(1)} unit="%" accent={utilization > 60 ? "#22c55e" : utilization > 40 ? "#eab308" : "#ef4444"} />
            <StatCard label="Sheet" value={sheetWeight.toFixed(3)} unit="lb" />
            <StatCard label="Scrap" value={scrapWeight.toFixed(3)} unit="lb" />
            {hasCost && <StatCard label="$/Part" value={costPerPart.toFixed(4)} unit="" accent="#22c55e" />}
          </div>

          {/* Cost Summary */}
          <CostSummary hasCost={hasCost} costLb={costLb} sheetWeight={sheetWeight} scrapWeight={scrapWeight} costPerPart={costPerPart} count={ori.count} />

          {/* Layout SVG */}
          <div style={{ background: "#0c1222", border: "1px solid #1e293b", borderRadius: 8, padding: isMobile ? 8 : 12, marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: "#64748b", fontFamily: "'DM Mono', monospace", marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 }}>
              {ori.across}×{ori.down} — {activeOri === "A" ? "as entered" : "rotated"} — centered on {moldWidth}" web
            </div>
            <LayoutSVG layout={layout} orientation={activeOri} moldWidth={moldWidth} materialColor={material.color} />
          </div>

          {/* Detail Table */}
          <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'DM Mono', monospace", fontSize: isMobile ? 10.5 : 11 }}>
              <thead><tr style={{ background: "#1e293b" }}><th style={thS}>Parameter</th><th style={{ ...thS, textAlign: "right" }}>Value</th></tr></thead>
              <tbody>
                <DR l="Part Cut Size" v={`${ori.cellW}" × ${ori.cellL}"`} />
                <DR l="Z-Height" v={`${zHeight}"`} />
                <DR l="Part Spacing" v={`${layout.spacing.toFixed(3)}" (z)`} />
                <DR l="Edge / End Margin" v={`${layout.edgeMin.toFixed(3)}" (z/2)`} />
                <DR l="Min Mold Plate" v={`${ori.moldPlateW.toFixed(3)}" × ${ori.moldPlateL.toFixed(3)}"`} />
                <DR l="Web (Mold Width)" v={`${moldWidth}"`} />
                <DR l="Sheet Width (w/ Chains)" v={`${totalSheetW}"`} />
                <DR l="Index Length" v={`${ori.usedIndex}" / ${MAX_INDEX}" max`} />
                <DR l="Cavities" v={`${ori.count} (${ori.across} × ${ori.down})`} h />
                <DR l="Material" v={`${material.name} @ .${String(gauge).split(".")[1]}" ga.`} />
                <DR /><DR l="Forming Area" v={`${formingArea.toFixed(2)} sq in`} />
                <DR l="Total Parts Area" v={`${totalPartsArea.toFixed(2)} sq in`} />
                <DR l="Scrap Area" v={`${scrapArea.toFixed(2)} sq in`} />
                <DR l="Utilization" v={`${utilization.toFixed(1)}%`} h />
                <DR /><DR l="Sheet Weight" v={`${sheetWeight.toFixed(4)} lbs`} />
                <DR l="Parts Weight" v={`${partsWeight.toFixed(4)} lbs`} />
                <DR l="Scrap Weight" v={`${scrapWeight.toFixed(4)} lbs`} />
                {hasCost && <><DR /><DR l="Material $/lb" v={`$${costLb.toFixed(2)}`} /><DR l="Sheet Cost" v={`$${sheetCost.toFixed(4)}`} /><DR l="Material $/Part" v={`$${costPerPart.toFixed(4)}`} h /></>}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div style={{ textAlign: "center", padding: "16px 0 8px", fontSize: 9, color: "#334155", fontFamily: "'DM Mono', monospace" }}>
            Louis A. Nelson, Inc. — Thermoform Layout Optimizer v1.0
          </div>
        </div>
      </div>
    </div>
  );
}

function SL({ children }) { return <div style={{ fontSize: 9.5, fontWeight: 600, color: "#64748b", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 4, marginTop: 2 }}>{children}</div>; }
function IF({ label, value, onChange, suffix = "", step = 0.125, min = 0 }) {
  return <div style={{ marginBottom: 3 }}><div style={{ fontSize: 9.5, color: "#64748b", fontFamily: "'DM Mono', monospace", marginBottom: 2 }}>{label}</div><div style={{ position: "relative" }}><input type="number" value={value} onChange={e => onChange(parseFloat(e.target.value) || 0)} step={step} min={min} style={inpS} />{suffix && <span style={{ position: "absolute", right: 9, top: 8, color: "#475569", fontSize: 12, fontFamily: "'DM Mono', monospace" }}>{suffix}</span>}</div></div>;
}
function DR({ l, v, h }) {
  if (!l && !v) return <tr><td colSpan={2} style={{ height: 3, borderBottom: "1px solid #1e293b" }}></td></tr>;
  return <tr style={{ borderBottom: "1px solid #1e293b" }}><td style={{ padding: "5px 10px", color: h ? "#93c5fd" : "#94a3b8" }}>{l}</td><td style={{ padding: "5px 10px", textAlign: "right", color: h ? "#e2e8f0" : "#cbd5e1", fontWeight: h ? 600 : 400 }}>{v}</td></tr>;
}

const inpS = { width: "100%", padding: "8px 10px", fontSize: 14, fontFamily: "'DM Mono', monospace", background: "#111827", border: "1px solid #334155", color: "#e2e8f0", borderRadius: 4, outline: "none", boxSizing: "border-box" };
const selS = { ...inpS, marginBottom: 10, cursor: "pointer", appearance: "auto" };
const thS = { padding: "6px 10px", textAlign: "left", color: "#94a3b8", fontSize: 9.5, textTransform: "uppercase", letterSpacing: 1 };
