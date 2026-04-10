// ============ RENDERING FUNCTIONS ============
// Functions for drawing contours, heatmaps, and visual elements

// 線形補間
function lerp(a, b, t) {
  return a + (b - a) * t;
}

// 等値線上の補間点を計算
function interpPoint(x1, y1, v1, x2, y2, v2, iso) {
  const denom = (v2 - v1);
  const t = Math.abs(denom) < 1e-12 ? 0.5 : (iso - v1) / denom;
  return {
    x: lerp(x1, x2, t),
    y: lerp(y1, y2, t),
  };
}

// 合成場の等高線を描画
function drawCombinedContours(grid) {
  // tauを中心に固定間隔で等高線を配置
  const tau = gaussianDirectTau;
  const levels = [];
  if (contourLevels === 1) {
    levels.push(tau);
  } else {
    const halfLevels = Math.floor(contourLevels / 2);
    for (let i = -halfLevels; i <= halfLevels; i++) {
      levels.push(tau + i * contourStep);
    }
  }

  drawContoursAtLevels(grid, levels, false, tau, '#ffff00', '#ffffff');
}

// 個別の等高線を描画（常にiso=0: 個別フィールドのゼロ等値面）
function drawIndividualContours() {
  const individualColors = [
    'rgba(100, 150, 255, 0.6)',  // 青系
    'rgba(100, 255, 150, 0.6)',  // 緑系
    'rgba(255, 100, 150, 0.6)',  // ピンク系
  ];

  // 個別楕円はS_i(x)=0（tauと無関係）
  const levels = [0];

  for (let gIdx = 0; gIdx < gaussians.length; gIdx++) {
    const grid = computeSingleFieldGrid(gIdx);
    const color = individualColors[gIdx % individualColors.length];
    drawContoursAtLevels(grid, levels, true, 0, color, color);
  }
}

// 指定されたレベルで等高線を描画（実線または破線）
function drawContoursAtLevels(grid, levels, dashed, highlightLevel, zeroColor, otherColor) {
  const { values, cols, rows } = grid;

  for (let levelIdx = 0; levelIdx < levels.length; levelIdx++) {
    const iso = levels[levelIdx];

    ctx.beginPath();
    
    if (dashed) {
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 0.8;
      ctx.strokeStyle = zeroColor;  // 個別の場合は全て同じ色
    } else {
      ctx.setLineDash([]);
      ctx.lineWidth = iso === highlightLevel ? 2.5 : 1.2;
      
      // highlightLevelは黄色で強調、それ以外は白系
      if (iso === highlightLevel) {
        ctx.strokeStyle = zeroColor;
      } else {
        const tone = Math.floor(180 + 40 * (levelIdx / levels.length));
        ctx.strokeStyle = otherColor === '#ffffff' ? `rgb(${tone}, ${tone}, ${tone})` : otherColor;
      }
    }

    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const x = i * gridStep;
        const y = j * gridStep;

        const v0 = values[j][i];
        const v1 = values[j][i + 1];
        const v2 = values[j + 1][i + 1];
        const v3 = values[j + 1][i];

        const p0 = { x: x, y: y };
        const p1 = { x: x + gridStep, y: y };
        const p2 = { x: x + gridStep, y: y + gridStep };
        const p3 = { x: x, y: y + gridStep };

        const pts = [];

        if ((v0 < iso) !== (v1 < iso)) pts.push(interpPoint(p0.x, p0.y, v0, p1.x, p1.y, v1, iso));
        if ((v1 < iso) !== (v2 < iso)) pts.push(interpPoint(p1.x, p1.y, v1, p2.x, p2.y, v2, iso));
        if ((v2 < iso) !== (v3 < iso)) pts.push(interpPoint(p2.x, p2.y, v2, p3.x, p3.y, v3, iso));
        if ((v3 < iso) !== (v0 < iso)) pts.push(interpPoint(p3.x, p3.y, v3, p0.x, p0.y, v0, iso));

        if (pts.length === 2) {
          ctx.moveTo(pts[0].x, pts[0].y);
          ctx.lineTo(pts[1].x, pts[1].y);
        } else if (pts.length === 4) {
          ctx.moveTo(pts[0].x, pts[0].y);
          ctx.lineTo(pts[1].x, pts[1].y);
          ctx.moveTo(pts[2].x, pts[2].y);
          ctx.lineTo(pts[3].x, pts[3].y);
        }
      }
    }

    ctx.stroke();
  }
}

// ヒートマップを描画
function drawHeatmap(grid) {
  const { values, cols, rows, minV, maxV } = grid;
  const image = ctx.createImageData(width, height);
  const data = image.data;

  // フィールドタイプに応じてクリッピング範囲を調整
  let clampMin, clampMax;
  if (fieldType === 'gaussian') {
    // Gaussianは実際の値の範囲を使用
    clampMin = minV;
    clampMax = maxV;
  } else {
    // Ellipsoidは固定範囲でクリッピング
    clampMin = -5;
    clampMax = 5;
  }

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const gx = Math.min(cols - 1, Math.floor(px / gridStep));
      const gy = Math.min(rows - 1, Math.floor(py / gridStep));
      const v = values[gy][gx];
      
      // 値をクリッピングしてから正規化
      const clampedV = Math.max(clampMin, Math.min(clampMax, v));
      const t = (clampedV - clampMin) / Math.max(1e-12, clampMax - clampMin);
      
      // グレースケール：Gaussianは値が大きいほど明るく、LogSumExpは逆（内側が負）
      const tDisplay = fieldType === 'ellipsoidLogSumExp' ? 1 - t : t;
      const c = Math.floor(20 + 90 * tDisplay);
      
      const r = c;
      const g = c;
      const b = c;

      const idx = (py * width + px) * 4;
      data[idx + 0] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
}

// ガウシアンの中心点を描画
function drawGaussianCenters() {
  const isMobile = window.innerWidth <= 768;
  const baseRadius = isMobile ? 8 : 6;
  
  for (const g of gaussians) {
    const pos = getActualPos(g);
    const isDragged = g === draggedGaussian;
    const isHovered = g === hoveredGaussian;
    
    // ガウシアンの中心点（大きめに）
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, baseRadius, 0, Math.PI * 2);
    
    // 状態によって色を変える
    if (isDragged) {
      ctx.fillStyle = '#ffaa66';
      ctx.strokeStyle = '#ff6622';
      ctx.lineWidth = 3;
    } else if (isHovered) {
      ctx.fillStyle = '#ff9955';
      ctx.strokeStyle = '#ff8844';
      ctx.lineWidth = 2;
    } else {
      ctx.fillStyle = '#ff8844';
      ctx.strokeStyle = '#cc6633';
      ctx.lineWidth = 1;
    }
    
    ctx.fill();
    ctx.stroke();
    
    // 内側の白い点でより目立たせる
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, baseRadius * 0.4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.fill();
  }
}

// メイン描画関数
function render() {
  ctx.clearRect(0, 0, width, height);
  const grid = computeFieldGrid();
  
  // 合成場の色描画（ヒートマップ）
  if (showHeatmap) {
    drawHeatmap(grid);
  }
  
  // 合成場の等高線
  if (showCombinedContours) {
    drawCombinedContours(grid);
  }
  
  // 個別の等高線を表示
  if (showIndividualContours) {
    drawIndividualContours();
  }
  
  drawGaussianCenters();
}
