(function () {
  const appleStops = [
    { at: 0, color: "#147ce5" },
    { at: 0.2, color: "#5e5ce6" },
    { at: 0.38, color: "#ff2d55" },
    { at: 0.56, color: "#ff8a00" },
    { at: 0.76, color: "#ffd60a" },
    { at: 1, color: "#34c759" },
  ];

  const defaultOptions = {
    text: "hello",
    background: "gradient",
    strokeWidth: 2,
    overlap: 0.02,
    duration: 2,
    easing: "easeInOut",
    mode: "full",
    previewScale: 1,
  };

  const handwritingFontFamily = '"Playwrite TZ", "Bradley Hand", "Segoe Script", cursive';
  const handwritingFontSize = 96;

  const easings = {
    linear: (t) => t,
    easeInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    easeOut: (t) => 1 - Math.pow(1 - t, 3),
  };

  const appleHelloPath =
    "M7 70 " +
    "C12 38 18 4 31 5 " +
    "C45 6 27 48 24 76 " +
    "C30 49 48 47 55 64 " +
    "C62 82 86 72 84 57 " +
    "C82 43 65 47 68 62 " +
    "C72 80 96 76 101 57 " +
    "C106 39 112 18 121 16 " +
    "C130 14 122 49 115 75 " +
    "C126 76 138 67 144 56 " +
    "C150 39 156 18 165 16 " +
    "C174 14 166 49 159 75 " +
    "C171 77 183 67 190 59 " +
    "C199 44 222 44 223 61 " +
    "C224 78 200 80 197 64 " +
    "C194 47 218 47 227 60 " +
    "C233 69 245 65 253 57";

  const glyphs = {
    a: { width: 54, d: "M7 64 C14 42 42 42 44 62 C46 79 22 82 18 64 C14 46 43 44 45 62 C47 72 53 70 56 61" },
    b: { width: 50, d: "M10 75 C14 48 19 16 29 9 C38 3 39 22 28 47 C45 38 54 51 48 66 C42 82 18 78 20 61" },
    c: { width: 45, d: "M40 52 C30 42 13 48 10 63 C7 78 28 82 43 67" },
    d: { width: 54, d: "M47 10 C42 34 37 57 35 73 C27 84 8 77 11 61 C14 43 42 42 43 62 C44 72 50 70 55 61" },
    e: { width: 46, d: "M12 63 C26 61 39 54 34 47 C27 38 10 49 10 65 C10 81 32 81 45 66" },
    f: { width: 38, d: "M31 13 C19 12 18 30 20 48 C22 65 20 81 8 88 M8 50 C20 48 30 47 38 46" },
    g: { width: 52, d: "M42 49 C27 39 10 50 11 66 C12 82 36 80 39 61 C38 80 32 96 14 94 C5 93 3 85 10 80" },
    h: { width: 55, d: "M8 75 C12 45 18 9 30 8 C42 8 23 47 18 75 C27 48 50 42 48 68 C47 78 55 72 58 62" },
    i: { width: 26, d: "M14 45 C13 55 10 70 11 76 C13 82 23 74 25 66 M20 26 C20 24 22 24 22 26 C22 29 19 29 19 26" },
    j: { width: 32, d: "M23 45 C20 62 18 83 9 91 C1 98 -6 88 3 81 M27 26 C27 24 29 24 29 26 C29 29 26 29 26 26" },
    k: { width: 50, d: "M9 75 C13 45 18 10 30 9 C42 8 23 48 18 75 M45 45 C33 52 25 60 18 67 M28 58 C33 70 43 76 52 65" },
    l: { width: 32, d: "M7 74 C13 42 19 12 30 10 C38 9 29 45 20 72 C24 78 31 73 35 64" },
    m: { width: 76, d: "M7 76 C10 62 12 51 13 45 C18 59 16 69 15 76 C23 47 42 43 39 75 C47 48 67 43 65 69 C64 80 74 72 78 62" },
    n: { width: 55, d: "M8 76 C11 61 13 51 14 45 C19 58 17 69 16 76 C25 48 50 42 48 69 C47 80 56 72 59 62" },
    o: { width: 52, d: "M28 45 C12 45 8 64 15 74 C24 87 47 79 45 61 C43 46 25 43 19 58 C15 70 29 78 43 67" },
    p: { width: 52, d: "M10 93 C14 74 17 58 19 45 C24 58 21 70 19 78 C26 49 50 42 50 61 C50 79 25 82 20 65" },
    q: { width: 53, d: "M42 49 C27 39 10 50 11 66 C12 82 36 80 39 61 C38 72 36 83 34 94 M35 78 C42 75 49 70 53 62" },
    r: { width: 42, d: "M9 76 C12 61 14 51 15 45 C20 57 18 68 17 76 C23 55 33 42 43 47" },
    s: { width: 42, d: "M38 51 C29 41 10 46 11 58 C12 69 37 63 36 75 C35 86 13 82 6 72" },
    t: { width: 38, d: "M24 26 C20 43 16 62 16 72 C17 82 31 76 37 64 M7 47 C20 46 30 45 39 44" },
    u: { width: 55, d: "M11 46 C7 62 8 78 20 78 C31 78 39 58 41 46 C38 62 38 77 49 76 C54 75 57 68 59 62" },
    v: { width: 50, d: "M9 47 C12 64 16 77 26 77 C37 77 45 59 48 47" },
    w: { width: 75, d: "M8 47 C10 65 15 77 25 77 C35 77 38 59 41 47 C42 65 48 77 58 77 C68 77 73 59 77 47" },
    x: { width: 48, d: "M10 48 C24 58 34 67 45 78 M45 48 C33 60 22 70 9 79" },
    y: { width: 50, d: "M10 47 C13 64 18 77 29 76 C38 75 45 59 48 47 C42 74 34 95 17 95 C6 95 5 86 14 80" },
    z: { width: 45, d: "M10 50 C22 48 34 48 43 49 C31 60 21 69 10 79 C23 77 35 77 45 78" },
  };

  const pathCache = new Map();

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function sanitizeEnglishText(value) {
    return String(value || "")
      .replace(/[^a-zA-Z ]+/g, "")
      .replace(/\s+/g, " ")
      .slice(0, 24)
      .toLowerCase();
  }

  function hexToRgb(hex) {
    const clean = hex.replace("#", "");
    return {
      r: parseInt(clean.slice(0, 2), 16),
      g: parseInt(clean.slice(2, 4), 16),
      b: parseInt(clean.slice(4, 6), 16),
    };
  }

  function mixColor(a, b, amount) {
    const ca = hexToRgb(a);
    const cb = hexToRgb(b);
    const r = Math.round(ca.r + (cb.r - ca.r) * amount);
    const g = Math.round(ca.g + (cb.g - ca.g) * amount);
    const bValue = Math.round(ca.b + (cb.b - ca.b) * amount);
    return `rgb(${r}, ${g}, ${bValue})`;
  }

  function colorAt(progress) {
    const t = clamp(progress, 0, 1);
    for (let index = 0; index < appleStops.length - 1; index += 1) {
      const current = appleStops[index];
      const next = appleStops[index + 1];
      if (t >= current.at && t <= next.at) {
        return mixColor(current.color, next.color, (t - current.at) / (next.at - current.at));
      }
    }
    return appleStops[appleStops.length - 1].color;
  }

  function getFontWeight(strokeWidth) {
    return Math.round(clamp(190 + strokeWidth * 28, 220, 400));
  }

  function getHandwritingFont(strokeWidth, size = handwritingFontSize) {
    return `${getFontWeight(strokeWidth)} ${size}px ${handwritingFontFamily}`;
  }

  function buildFontTextSource(ctx, text, strokeWidth) {
    const clean = sanitizeEnglishText(text) || "hello";
    ctx.save();
    ctx.font = getHandwritingFont(strokeWidth);
    ctx.textBaseline = "alphabetic";
    const metrics = ctx.measureText(clean);
    const left = Math.min(0, metrics.actualBoundingBoxLeft || 0);
    const right = Math.max(metrics.width, metrics.actualBoundingBoxRight || metrics.width);
    const ascent = metrics.actualBoundingBoxAscent || handwritingFontSize * 0.78;
    const descent = metrics.actualBoundingBoxDescent || handwritingFontSize * 0.24;
    ctx.restore();

    const padding = handwritingFontSize * 0.16;
    return {
      type: "fontText",
      text: clean,
      font: getHandwritingFont(strokeWidth),
      width: right - left + padding * 2,
      height: ascent + descent + padding * 2,
      baseline: padding + ascent,
      textX: padding - left,
      revealWidth: right - left + padding * 1.2,
      total: right - left + padding * 1.2,
    };
  }

  function cubicPoint(p0, p1, p2, p3, t) {
    const mt = 1 - t;
    return {
      x: mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x,
      y: mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y,
    };
  }

  function addCubic(points, p0, p1, p2, p3, steps) {
    for (let step = 1; step <= steps; step += 1) {
      points.push(cubicPoint(p0, p1, p2, p3, step / steps));
    }
  }

  // Parse SVG path (M and C only) into typed command objects, offset x by offsetX
  function parseCmds(d, offsetX) {
    const result = [];
    let cx = 0, cy = 0;
    const parts = d.trim().match(/[MC][^MC]*/g) || [];
    for (const part of parts) {
      const cmd = part[0];
      const nums = part.slice(1).trim().split(/[\s,]+/).filter(Boolean).map(Number);
      if (cmd === "M") {
        cx = nums[0]; cy = nums[1];
        result.push({ type: "M", x: offsetX + cx, y: cy });
      } else if (cmd === "C") {
        for (let i = 0; i + 6 <= nums.length; i += 6) {
          result.push({
            type: "C",
            p0: { x: offsetX + cx, y: cy },
            p1: { x: offsetX + nums[i], y: nums[i + 1] },
            p2: { x: offsetX + nums[i + 2], y: nums[i + 3] },
            p3: { x: offsetX + nums[i + 4], y: nums[i + 5] },
          });
          cx = nums[i + 4]; cy = nums[i + 5];
        }
      }
    }
    return result;
  }

  // Approximate arc length of a cubic Bezier using 20 linear steps
  function cubicLen(p0, p1, p2, p3) {
    const N = 20;
    let len = 0, prev = p0;
    for (let i = 1; i <= N; i += 1) {
      const pt = cubicPoint(p0, p1, p2, p3, i / N);
      len += Math.hypot(pt.x - prev.x, pt.y - prev.y);
      prev = pt;
    }
    return len;
  }

  // De Casteljau — return control points for first t portion of a cubic
  function splitCubic(p0, p1, p2, p3, t) {
    const lp = (a, b) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    const ab = lp(p0, p1), bc = lp(p1, p2), cd = lp(p2, p3);
    const abc = lp(ab, bc), bcd = lp(bc, cd);
    return [p0, ab, abc, lp(abc, bcd)];
  }

  // Find parameter t on a cubic such that arc length from 0 to t equals target
  function tForLen(p0, p1, p2, p3, target, totalLen) {
    if (target <= 0) return 0;
    if (target >= totalLen) return 1;
    const N = 32;
    let arc = 0, prev = p0;
    for (let i = 1; i <= N; i += 1) {
      const t = i / N;
      const pt = cubicPoint(p0, p1, p2, p3, t);
      const dl = Math.hypot(pt.x - prev.x, pt.y - prev.y);
      if (arc + dl >= target) {
        return (i - 1 + (target - arc) / Math.max(dl, 0.001)) / N;
      }
      arc += dl;
      prev = pt;
    }
    return 1;
  }

  // Build a word as an array of cubic Bezier segments with cumulative arc lengths.
  // Letters connect with a smooth curved connector; secondary strokes (dot on i, etc.) get a gap.
  function buildWordSegments(text, overlap) {
    const clean = sanitizeEnglishText(text) || "hello";
    const segs = [];
    let cursor = 0;
    const tracking = 3 - clamp(overlap, 0, 0.12) * 18;
    let arc = 0;
    let tail = null; // { x, y, tx, ty } — last drawn point + normalised exit tangent
    let wordStart = true;

    for (const char of clean) {
      if (char === " ") {
        cursor += 34;
        tail = null;
        wordStart = true;
        continue;
      }
      const glyph = glyphs[char];
      if (!glyph) continue;

      const cmds = parseCmds(glyph.d, cursor);
      let glyphFirst = true;

      for (const cmd of cmds) {
        if (cmd.type === "M") {
          if (tail && !glyphFirst) {
            // Secondary stroke within the same letter (dot on i, crossbar on f…) — lift pen
            segs.push({ type: "gap" });
          } else if (tail && glyphFirst && !wordStart) {
            // First stroke of next letter — draw a smooth curved connector
            const dx = cmd.x - tail.x, dy = cmd.y - tail.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 0.5) {
              const tension = clamp(dist * 0.33, 4, 22);
              const p0c = { x: tail.x, y: tail.y };
              const p1c = { x: tail.x + tail.tx * tension, y: tail.y + tail.ty * tension };
              const p2c = { x: cmd.x - tension * 0.35, y: cmd.y };
              const p3c = { x: cmd.x, y: cmd.y };
              const len = cubicLen(p0c, p1c, p2c, p3c);
              segs.push({ type: "C", p0: p0c, p1: p1c, p2: p2c, p3: p3c, arc0: arc, arc1: arc + len, len });
              arc += len;
            }
          }
          tail = { x: cmd.x, y: cmd.y, tx: 1, ty: 0 };
          glyphFirst = false;
          wordStart = false;
        } else if (cmd.type === "C") {
          const len = cubicLen(cmd.p0, cmd.p1, cmd.p2, cmd.p3);
          segs.push({ type: "C", p0: cmd.p0, p1: cmd.p1, p2: cmd.p2, p3: cmd.p3, arc0: arc, arc1: arc + len, len });
          arc += len;
          const exDx = cmd.p3.x - cmd.p2.x, exDy = cmd.p3.y - cmd.p2.y;
          const exLen = Math.hypot(exDx, exDy);
          tail = {
            x: cmd.p3.x, y: cmd.p3.y,
            tx: exLen > 0.01 ? exDx / exLen : 1,
            ty: exLen > 0.01 ? exDy / exLen : 0,
          };
        }
      }

      cursor += glyph.width + tracking;
    }

    return { segments: segs, total: Math.max(arc, 1), width: Math.max(cursor, 1), height: 100 };
  }

  function buildHelloPoints(overlap) {
    const points = [{ x: 6, y: 70 }];
    const lean = overlap * 38;
    const curves = [
      [{ x: 6, y: 70 }, { x: 10, y: 35 }, { x: 18, y: 3 }, { x: 31, y: 5 }],
      [{ x: 31, y: 5 }, { x: 45, y: 8 }, { x: 25, y: 49 }, { x: 22, y: 78 }],
      [{ x: 22, y: 78 }, { x: 29, y: 51 }, { x: 48, y: 48 }, { x: 54 + lean, y: 64 }],
      [{ x: 54 + lean, y: 64 }, { x: 61, y: 82 }, { x: 84, y: 73 }, { x: 84, y: 58 }],
      [{ x: 84, y: 58 }, { x: 84, y: 47 }, { x: 67, y: 47 }, { x: 68, y: 61 }],
      [{ x: 68, y: 61 }, { x: 69, y: 78 }, { x: 92, y: 77 }, { x: 101 - lean, y: 58 }],
      [{ x: 101 - lean, y: 58 }, { x: 108, y: 42 }, { x: 111, y: 20 }, { x: 119, y: 12 }],
      [{ x: 119, y: 12 }, { x: 128, y: 4 }, { x: 121, y: 46 }, { x: 112, y: 74 }],
      [{ x: 112, y: 74 }, { x: 123, y: 77 }, { x: 136, y: 68 }, { x: 144 - lean, y: 56 }],
      [{ x: 144 - lean, y: 56 }, { x: 151, y: 42 }, { x: 154, y: 20 }, { x: 162, y: 12 }],
      [{ x: 162, y: 12 }, { x: 171, y: 4 }, { x: 164, y: 46 }, { x: 155, y: 74 }],
      [{ x: 155, y: 74 }, { x: 168, y: 77 }, { x: 181, y: 68 }, { x: 190 - lean, y: 60 }],
      [{ x: 190 - lean, y: 60 }, { x: 199, y: 43 }, { x: 221, y: 44 }, { x: 222, y: 61 }],
      [{ x: 222, y: 61 }, { x: 223, y: 78 }, { x: 199, y: 80 }, { x: 197, y: 63 }],
      [{ x: 197, y: 63 }, { x: 196, y: 46 }, { x: 219, y: 47 }, { x: 227, y: 60 }],
      [{ x: 227, y: 60 }, { x: 232, y: 70 }, { x: 244, y: 65 }, { x: 253, y: 58 }],
    ];
    curves.forEach(([p0, p1, p2, p3]) => addCubic(points, p0, p1, p2, p3, 32));
    return points;
  }

  function withDistances(points) {
    let total = 0;
    const mapped = points.map((point, index) => {
      if (index > 0) {
        const previous = points[index - 1];
        total += Math.hypot(point.x - previous.x, point.y - previous.y);
      }
      return { ...point, distance: total };
    });
    return { points: mapped, total };
  }

  function createSvgPathSampler(pathData) {
    if (pathCache.has(pathData)) return pathCache.get(pathData);
    if (!document.createElementNS) return null;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    svg.setAttribute("aria-hidden", "true");
    svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;";
    path.setAttribute("d", pathData);
    svg.appendChild(path);
    document.body.appendChild(svg);
    const sampler = { path, total: path.getTotalLength() };
    pathCache.set(pathData, sampler);
    return sampler;
  }

  function sampleAppleHello(overlap) {
    const sampler = createSvgPathSampler(appleHelloPath);
    if (!sampler) return withDistances(buildHelloPoints(overlap));
    const points = [];
    const steps = 520;
    const squeeze = 1 - clamp(overlap, 0, 0.12) * 0.8;
    for (let index = 0; index <= steps; index += 1) {
      const distance = (sampler.total * index) / steps;
      const point = sampler.path.getPointAtLength(distance);
      points.push({
        x: 130 + (point.x - 130) * squeeze,
        y: point.y,
        distance,
      });
    }
    return { points, total: sampler.total, width: 258, height: 84 };
  }

  // Build a linear gradient for a segment, including all intermediate appleStops that fall within the arc range
  function segGradient(ctx, x0, y0, x1, y1, arc0, arc1, total) {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    if (dist < 0.5) return colorAt(arc0 / total);
    const t0 = arc0 / total;
    const t1 = arc1 / total;
    const span = t1 - t0;
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, colorAt(t0));
    for (const stop of appleStops) {
      if (stop.at > t0 && stop.at < t1) {
        g.addColorStop((stop.at - t0) / span, stop.color);
      }
    }
    g.addColorStop(1, colorAt(t1));
    return g;
  }

  function drawBackground(ctx, width, height, type) {
    ctx.clearRect(0, 0, width, height);
    if (type === "photo") {
      const base = ctx.createLinearGradient(0, 0, width, height);
      base.addColorStop(0, "#3d91d9");
      base.addColorStop(0.22, "#d4d4bd");
      base.addColorStop(0.48, "#0f61d5");
      base.addColorStop(0.72, "#001eb4");
      base.addColorStop(1, "#dce5e5");
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = 0.58;
      ctx.fillStyle = "#e9eee7";
      ctx.beginPath();
      ctx.ellipse(width * 0.74, height * 0.2, width * 0.44, height * 0.2, -0.14, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.42;
      ctx.fillStyle = "#7ad4c8";
      ctx.beginPath();
      ctx.ellipse(width * 0.68, height * 0.16, width * 0.37, height * 0.09, -0.08, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = "#e8f0ef";
      ctx.beginPath();
      ctx.ellipse(width * 0.96, height * 0.8, width * 0.2, height * 0.48, 0.24, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = "#e6f6f2";
      ctx.lineWidth = Math.max(1, width * 0.002);
      ctx.beginPath();
      ctx.moveTo(-width * 0.08, height * 0.84);
      ctx.bezierCurveTo(width * 0.22, height * 0.72, width * 0.5, height * 0.1, width * 1.05, height * 0.02);
      ctx.stroke();
      ctx.globalAlpha = 1;
      return;
    }
    const bg = ctx.createLinearGradient(0, 0, width, height);
    bg.addColorStop(0, "#ffffff");
    bg.addColorStop(0.5, "#f7f7f7");
    bg.addColorStop(1, "#f1f1ef");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
  }

  function drawHello(ctx, width, height, state) {
    drawBackground(ctx, width, height, state.background);
    const text = sanitizeEnglishText(state.text) || "hello";
    const eased = easings[state.easing](state.progress);
    const source = text.toLowerCase() === "hello" ? sampleAppleHello(state.overlap) : buildFontTextSource(ctx, text, state.strokeWidth);
    const sourceWidth = source.width;
    const sourceHeight = source.height;
    const previewScale = state.previewScale || 1;
    const widthRatio = source.type === "fontText" ? 0.38 : 0.31;
    const heightRatio = source.type === "fontText" ? 0.36 : 0.32;
    const scale = Math.min((width * widthRatio * previewScale) / sourceWidth, (height * heightRatio * previewScale) / sourceHeight);
    const wordWidth = sourceWidth * scale;
    const wordHeight = sourceHeight * scale;
    const offsetX = (width - wordWidth) / 2;
    const offsetY = (height - wordHeight) / 2 + height * 0.005;
    const revealDistance = source.total * eased;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(1, state.strokeWidth * scale * 1.72);

    let tipX = null;
    let tipY = null;
    let tipColor = null;

    const sx = (x) => offsetX + x * scale;
    const sy = (y) => offsetY + y * scale;

    if (source.type === "fontText") {
      const revealWidth = source.revealWidth * eased * scale;
      const textX = sx(source.textX);
      const baseline = sy(source.baseline);
      const isPhoto = state.background === "photo";
      ctx.save();
      ctx.beginPath();
      ctx.rect(offsetX, offsetY, revealWidth, wordHeight);
      ctx.clip();
      ctx.font = `${getFontWeight(state.strokeWidth)} ${handwritingFontSize * scale}px ${handwritingFontFamily}`;
      ctx.textBaseline = "alphabetic";
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(0.35, state.strokeWidth * scale * 0.16);
      if (isPhoto) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.96)";
        ctx.strokeStyle = "rgba(255, 255, 255, 0.96)";
      } else {
        const gradient = ctx.createLinearGradient(offsetX, 0, offsetX + wordWidth, 0);
        appleStops.forEach((stop) => gradient.addColorStop(stop.at, stop.color));
        ctx.fillStyle = gradient;
        ctx.strokeStyle = gradient;
      }
      ctx.strokeText(source.text, textX, baseline);
      ctx.fillText(source.text, textX, baseline);
      ctx.restore();
      if (state.progress > 0 && state.progress < 1) {
        tipX = offsetX + revealWidth;
        tipY = baseline - wordHeight * 0.4;
        tipColor = isPhoto ? "rgba(255, 255, 255, 0.96)" : colorAt(eased);
      }
    } else if (source.segments) {
      // Bezier path drawing — smooth native canvas curves
      for (const seg of source.segments) {
        if (seg.type === "gap") continue;
        if (seg.arc0 >= revealDistance) break;
        const isPhoto = state.background === "photo";
        ctx.beginPath();
        if (seg.arc1 <= revealDistance) {
          ctx.moveTo(sx(seg.p0.x), sy(seg.p0.y));
          ctx.bezierCurveTo(sx(seg.p1.x), sy(seg.p1.y), sx(seg.p2.x), sy(seg.p2.y), sx(seg.p3.x), sy(seg.p3.y));
          ctx.strokeStyle = isPhoto ? "rgba(255,255,255,0.96)" : segGradient(ctx, sx(seg.p0.x), sy(seg.p0.y), sx(seg.p3.x), sy(seg.p3.y), seg.arc0, seg.arc1, source.total);
          tipX = sx(seg.p3.x); tipY = sy(seg.p3.y); tipColor = colorAt(seg.arc1 / source.total);
        } else {
          const t = tForLen(seg.p0, seg.p1, seg.p2, seg.p3, revealDistance - seg.arc0, seg.len);
          const [q0, q1, q2, q3] = splitCubic(seg.p0, seg.p1, seg.p2, seg.p3, t);
          ctx.moveTo(sx(q0.x), sy(q0.y));
          ctx.bezierCurveTo(sx(q1.x), sy(q1.y), sx(q2.x), sy(q2.y), sx(q3.x), sy(q3.y));
          ctx.strokeStyle = isPhoto ? "rgba(255,255,255,0.96)" : segGradient(ctx, sx(q0.x), sy(q0.y), sx(q3.x), sy(q3.y), seg.arc0, revealDistance, source.total);
          tipX = sx(q3.x); tipY = sy(q3.y); tipColor = colorAt(revealDistance / source.total);
        }
        ctx.stroke();
      }
    } else {
      // Sampled-points drawing — used for the appleHello special path
      for (let index = 1; index < source.points.length; index += 1) {
        const a = source.points[index - 1];
        const b = source.points[index];
        if (b.move) continue;
        if (a.distance > revealDistance) break;
        const segmentEnd = Math.min(b.distance, revealDistance);
        const ratio = b.distance === a.distance ? 1 : (segmentEnd - a.distance) / (b.distance - a.distance);
        const x1 = sx(a.x); const y1 = sy(a.y);
        const x2 = sx(a.x + (b.x - a.x) * ratio); const y2 = sy(a.y + (b.y - a.y) * ratio);
        const strokeColor = state.background === "photo" ? "rgba(255, 255, 255, 0.96)" : colorAt(a.distance / source.total);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = strokeColor;
        ctx.stroke();
        tipX = x2; tipY = y2; tipColor = strokeColor;
      }
    }

    if (tipX !== null && state.progress > 0 && state.progress < 1) {
      const dotRadius = Math.max(2, ctx.lineWidth * 0.5);
      ctx.beginPath();
      ctx.arc(tipX, tipY, dotRadius, 0, Math.PI * 2);
      ctx.fillStyle = tipColor;
      ctx.fill();
    }
  }

  function createTemplate(options) {
    const canSaveVideo = options.saveVideo;
    return `
      <div class="hello-preview">
        <canvas class="hello-canvas" aria-label="Animated hello preview"></canvas>
      </div>
      <div class="hello-timeline">
        <button class="hello-play" type="button" aria-label="Play animation"></button>
        <input class="hello-progress" type="range" min="0" max="1000" value="1000" aria-label="Animation progress" />
      </div>
      <div class="hello-controls">
        <div class="hello-controls-top">
          <label class="hello-field">
            <span class="hello-label-row">Text</span>
            <input class="hello-input" data-role="text" type="text" value="hello" pattern="[A-Za-z ]*" aria-describedby="helloTextNote" />
          </label>
          <div class="hello-field">
            <span class="hello-label-row">Background</span>
            <div class="hello-segment" role="group" aria-label="Background type">
              <button type="button" data-background="photo">Photo</button>
              <button type="button" data-background="gradient" class="is-active">Gradient</button>
            </div>
          </div>
        </div>
        <div class="hello-range-grid">
          <label class="hello-range-field">
            <span class="hello-label-row">Stroke width <span class="hello-value" data-value="strokeWidth">2.0</span></span>
            <input class="hello-range" data-role="strokeWidth" type="range" min="1" max="8" step="0.1" value="2" />
          </label>
          <label class="hello-range-field">
            <span class="hello-label-row">Overlap <span class="hello-value" data-value="overlap">0.02</span></span>
            <input class="hello-range" data-role="overlap" type="range" min="0" max="0.12" step="0.01" value="0.02" />
          </label>
          <label class="hello-range-field">
            <span class="hello-label-row">Duration <span class="hello-value" data-value="duration">2.00s</span></span>
            <input class="hello-range" data-role="duration" type="range" min="0.8" max="6" step="0.1" value="2" />
          </label>
        </div>
        <div class="hello-bottom-row">
          <label class="hello-select-field">
            <span class="hello-label-row">Easing</span>
            <select class="hello-select" data-role="easing">
              <option value="easeInOut">Ease In Out</option>
              <option value="easeOut">Ease Out</option>
              <option value="linear">Linear</option>
            </select>
          </label>
          <div class="hello-actions">
            <button class="hello-action hello-action--primary" data-action="save-image" type="button">Save image</button>
            ${canSaveVideo ? '<button class="hello-action" data-action="save-video" type="button">Save video</button>' : ""}
            <a class="hello-action" href="showcase/hello/hello.html" data-action="read-more">Read more</a>
          </div>
        </div>
        <p class="hello-note" id="helloTextNote">English letters only. Words are rendered as handwriting.</p>
      </div>
    `;
  }

  function downloadDataUrl(dataUrl, filename) {
    const link = document.createElement("a");
    link.download = filename;
    link.href = dataUrl;
    link.click();
  }

  function mountHelloMaker(root, overrides = {}) {
    const options = {
      mode: root.dataset.mode || overrides.mode || defaultOptions.mode,
      saveVideo: root.dataset.saveVideo === "true" || overrides.saveVideo,
    };
    const defaultPreviewScale = options.mode === "widget" ? 1.28 : 1.22;
    const state = {
      ...defaultOptions,
      ...overrides,
      mode: options.mode,
      previewScale: defaultPreviewScale,
      progress: 1,
    };
    root.classList.add("hello-maker");
    root.classList.toggle("hello-maker--widget", options.mode === "widget");
    root.innerHTML = createTemplate(options);

    const canvas = root.querySelector(".hello-canvas");
    const ctx = canvas.getContext("2d");
    const playBtn = root.querySelector(".hello-play");
    const progressInput = root.querySelector(".hello-progress");
    const textInput = root.querySelector('[data-role="text"]');
    const easingSelect = root.querySelector('[data-role="easing"]');
    const rangeInputs = root.querySelectorAll(".hello-range");
    const backgroundButtons = root.querySelectorAll("[data-background]");
    const readMore = root.querySelector('[data-action="read-more"]');
    const saveImage = root.querySelector('[data-action="save-image"]');
    const saveVideo = root.querySelector('[data-action="save-video"]');

    function getPreviewScale() {
      const value = Number.parseFloat(getComputedStyle(root).getPropertyValue("--hello-preview-scale"));
      return Number.isFinite(value) && value > 0 ? value : defaultPreviewScale;
    }
    let animationFrame = 0;
    let startedAt = 0;

    if (options.mode !== "widget" && readMore) {
      readMore.href = "hello.html";
      readMore.textContent = "Restart";
      readMore.addEventListener("click", (event) => {
        event.preventDefault();
        state.progress = 0;
        play();
      });
    }

    if (options.mode === "widget") {
      root.querySelectorAll("button, input, select").forEach((control) => {
        ["click", "pointerdown", "touchstart", "keydown"].forEach((eventName) => {
          control.addEventListener(eventName, (event) => {
            event.stopPropagation();
          });
        });
      });
    }

    function resize() {
      state.previewScale = getPreviewScale();
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(320, Math.round(rect.width * ratio));
      const height = Math.max(220, Math.round(rect.height * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      drawHello(ctx, canvas.width, canvas.height, state);
    }

    function setProgress(value) {
      state.progress = clamp(value, 0, 1);
      progressInput.value = String(Math.round(state.progress * 1000));
      drawHello(ctx, canvas.width, canvas.height, state);
    }

    function updateValues() {
      root.querySelector('[data-value="strokeWidth"]').textContent = state.strokeWidth.toFixed(1);
      root.querySelector('[data-value="overlap"]').textContent = state.overlap.toFixed(2);
      root.querySelector('[data-value="duration"]').textContent = `${state.duration.toFixed(2)}s`;
    }

    function stop() {
      cancelAnimationFrame(animationFrame);
      playBtn.classList.remove("is-playing");
      playBtn.setAttribute("aria-label", "Play animation");
    }

    function tick(now) {
      const elapsed = (now - startedAt) / 1000;
      const raw = elapsed / state.duration;
      setProgress(raw);
      if (raw < 1) {
        animationFrame = requestAnimationFrame(tick);
        return;
      }
      stop();
    }

    function play() {
      stop();
      state.progress = 0;
      startedAt = performance.now();
      playBtn.classList.add("is-playing");
      playBtn.setAttribute("aria-label", "Pause animation");
      animationFrame = requestAnimationFrame(tick);
    }

    function saveCanvasImage() {
      drawHello(ctx, canvas.width, canvas.height, { ...state, progress: 1 });
      downloadDataUrl(canvas.toDataURL("image/png"), "openme-hello.png");
      setProgress(state.progress);
    }

    async function saveCanvasVideo() {
      if (!canvas.captureStream || typeof MediaRecorder === "undefined") {
        saveCanvasImage();
        return;
      }
      stop();
      const stream = canvas.captureStream(60);
      const chunks = [];
      const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size) chunks.push(event.data);
      });
      recorder.addEventListener("stop", () => {
        const blob = new Blob(chunks, { type: "video/webm" });
        const url = URL.createObjectURL(blob);
        downloadDataUrl(url, "openme-hello.webm");
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
      recorder.start();
      play();
      setTimeout(() => recorder.stop(), Math.ceil(state.duration * 1000) + 180);
    }

    playBtn.addEventListener("click", () => {
      if (playBtn.classList.contains("is-playing")) {
        stop();
        return;
      }
      play();
    });

    progressInput.addEventListener("input", (event) => {
      stop();
      setProgress(Number(event.target.value) / 1000);
    });

    textInput.addEventListener("input", (event) => {
      const clean = sanitizeEnglishText(event.target.value);
      if (event.target.value !== clean) {
        event.target.value = clean;
      }
      state.text = clean;
      drawHello(ctx, canvas.width, canvas.height, state);
    });

    easingSelect.addEventListener("change", (event) => {
      state.easing = event.target.value;
      drawHello(ctx, canvas.width, canvas.height, state);
    });

    rangeInputs.forEach((input) => {
      input.addEventListener("input", (event) => {
        state[event.target.dataset.role] = Number(event.target.value);
        updateValues();
        drawHello(ctx, canvas.width, canvas.height, state);
      });
    });

    backgroundButtons.forEach((button) => {
      button.addEventListener("click", () => {
        state.background = button.dataset.background;
        backgroundButtons.forEach((item) => item.classList.toggle("is-active", item === button));
        drawHello(ctx, canvas.width, canvas.height, state);
      });
    });

    saveImage.addEventListener("click", saveCanvasImage);
    saveVideo?.addEventListener("click", saveCanvasVideo);

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    if (document.fonts?.ready) {
      document.fonts.ready.then(resize).catch(() => {});
      document.fonts.load(getHandwritingFont(state.strokeWidth)).then(resize).catch(() => {});
    }
    updateValues();
    resize();
  }

  window.OpenmeHello = { mount: mountHelloMaker };

  document.querySelectorAll("[data-hello-maker]").forEach((root) => {
    mountHelloMaker(root);
  });
})();
