// ============ CONFIGURATION & STATE ============

const canvas = document.getElementById('view');
const ctx = canvas.getContext('2d');

let width = canvas.width;
let height = canvas.height;

// ガウシアン/楕円のデータ
// x, y: 中心（相対座標0-1として保存し、実座標に変換して使用）
// sx, sy: 標準偏差スケール（基準サイズに対する比率）
// theta: 回転角 [rad]
// amp: 振幅
let gaussians = [
  { x: 0.289, y: 0.357, sx: 0.089, sy: 0.064, theta: 0.35, amp: 1.0 },
  { x: 0.522, y: 0.514, sx: 0.078, sy: 0.157, theta: -0.5, amp: 0.95 },
  { x: 0.722, y: 0.343, sx: 0.106, sy: 0.079, theta: 0.9, amp: 0.85 },
];

// ガウシアンの相対座標を実座標に変換
function getActualPos(g) {
  return {
    x: g.x * width,
    y: g.y * height
  };
}

// ガウシアンの相対サイズを実サイズに変換
function getActualSize(g) {
  const baseSize = Math.min(width, height);
  return {
    sx: g.sx * baseSize,
    sy: g.sy * baseSize
  };
}

// 実座標を相対座標に変換して保存
function setActualPos(g, actualX, actualY) {
  g.x = actualX / width;
  g.y = actualY / height;
}

// パラメータ
let contourLevels = 1;
let contourStep = 0.1;
let gridStep = 4;

// 表示制御
let showIndividualContours = false;
let showCombinedContours = true;
let showHeatmap = true;

// フィールド設定
let fieldType = 'gaussian';
let ellipsoidS = 2.0;
let logSumExpK = 0.5;
let gaussianDirectTau = computeTauFromS(2.0);

// ドラッグ操作用
let draggedPoint = null;
let isDragging = false;
let hoveredPoint = null;

// 選択中のガウシアン（クリックで選択。x/X, y/Y, r/Rキーで変形操作の対象になる）
let selectedGaussian = null;

// gキーでの追加用（canvas上でのマウス位置を追跡）
let lastMousePos = null;
let isMouseOverCanvas = false;

// 表面探査の接触状態（GaussianViewHaptics.cpp の hapticRenderLoop を参考）
// 最初は非接触から開始し、Pが物体内部に侵入したかどうかで接触に切り替える。
let colliding = false;
let contactPoint = null;   // Q（実座標）。接触中のみ有効
let contactTangent = null; // Qでの法線・接線（{nx,ny,tx,ty}）。接触中のみ有効
let contactSeed = null;    // 今回Qを探索した種（初回接触時はP自身、以降は垂線の足R）
let contactFoot = null;    // 垂線の足R（初回接触時はnullのまま）

// リミットサイクル対策（GaussianViewHaptics.cppのAdaptation1/Adaptation2に対応）
// 'normal': 対策なし（垂線の足Rをそのまま種にする）
// 'adaptation1': Rが表面の外側なら、Rを前回の接触点Qとの中点まで引き戻す
// 'adaptation2': Rから探索・再投影を繰り返し、収束するまでRをQへ徐々に引き戻す
let contactAdaptationMode = 'normal';

// Adaptation2の1反復あたりの引き戻し量（0=まったく引き戻さない=通常探索と同等、
// 1=毎回Qへ完全にスナップ=最も強い貼り付き）。C++元コードの0.5f固定値に対応。
let adaptation2DampingFactor = 0.5;

// 表面探査ステップの更新間隔[ms]。マウスが動いていなくても一定間隔でステップを進める
// （GaussianViewHaptics.cppのhapticRenderLoopが一定周期で回り続けるのと同じ考え方）。
let updateIntervalMs = 100;
let updateTimerId = null;


// ============ SURFACE SEARCH (接触状態の更新) ============

// フィールドタイプにより「val>0」が物体の内部/外部どちらを意味するかが異なる
// （drawHeatmapの極性反転と同じ理由）:
// - ellipsoidLogSumExp: 中心ほど値が小さいC++と同じ極性 → val<0が内部
// - gaussian（直接和）: 中心ほど値が大きい山型 → val>0が内部
function isInsideObject(val) {
  return fieldType === 'ellipsoidLogSumExp' ? val < 0 : val > 0;
}

// 現在のP（実座標）を元に接触状態を更新する。
// 非接触時: 陰関数の符号からPが内部に侵入したかを判定し、侵入していればPを種として
//           表面探査を行いQを決定、接触状態に切り替える。
// 接触時: 前ステップのQ・接線を使ってまず接触が外れていないか判定する
//         （GaussianViewHaptics.cppの (p - c)·n > 0 と同等の条件。極性はフィールド
//         タイプに応じて反転させる）。外れていなければ、前のQの接線にPから垂線を
//         下ろした足Rを種として新しいQを探索する（step-by-stepのR_i/Q_iと同じ手順）。
function updateSurfaceSearch(p) {
  if (!colliding) {
    contactFoot = null;

    const { val } = calcValueAndGrad(p.x, p.y);
    if (Number.isFinite(val) && isInsideObject(val)) {
      const q = findSurfaceFromSeed(p.x, p.y);
      colliding = true;
      contactPoint = q;
      contactTangent = getNormalAndTangent(q.x, q.y);
      contactSeed = p;
    } else {
      contactPoint = null;
      contactTangent = null;
      contactSeed = null;
    }
    return;
  }

  if (!contactTangent) {
    // 接線が定義できない（勾配ほぼ0）場合は接触状態を維持できないため解除
    colliding = false;
    contactPoint = null;
    contactTangent = null;
    contactSeed = null;
    contactFoot = null;
    return;
  }

  const outwardSign = fieldType === 'ellipsoidLogSumExp' ? 1 : -1;
  const distanceFromSurface =
    (p.x - contactPoint.x) * contactTangent.nx +
    (p.y - contactPoint.y) * contactTangent.ny;

  if (outwardSign * distanceFromSurface > 0) {
    colliding = false;
    contactPoint = null;
    contactTangent = null;
    contactSeed = null;
    contactFoot = null;
    return;
  }

  let r = projectPointOntoLine(p.x, p.y, contactPoint.x, contactPoint.y, contactTangent.tx, contactTangent.ty);

  if (contactAdaptationMode === 'adaptation1') {
    // Rが表面の外側なら、Qとの中点まで引き戻す
    const { val } = calcValueAndGrad(r.x, r.y);
    if (Number.isFinite(val) && !isInsideObject(val)) {
      r = { x: 0.5 * (r.x + contactPoint.x), y: 0.5 * (r.y + contactPoint.y) };
    }
  } else if (contactAdaptationMode === 'adaptation2') {
    // Rから探索・再投影した結果とQとの距離が安定するまで、Rを徐々にQへ引き戻す
    const maxDist = Math.hypot(r.x - contactPoint.x, r.y - contactPoint.y);
    let curDist = maxDist;
    const maxIter = 10;
    const k = adaptation2DampingFactor;
    for (let i = 0; i < maxIter; i++) {
      const p1tmp = findSurfaceFromSeed(r.x, r.y);
      const tangentTmp = getNormalAndTangent(p1tmp.x, p1tmp.y);
      if (!tangentTmp) break;
      const p2 = projectPointOntoLine(p.x, p.y, p1tmp.x, p1tmp.y, tangentTmp.tx, tangentTmp.ty);
      curDist = Math.hypot(p2.x - contactPoint.x, p2.y - contactPoint.y);
      r = { x: r.x + (contactPoint.x - r.x) * k, y: r.y + (contactPoint.y - r.y) * k };
      if (Math.abs(curDist - maxDist) < 1e-4) break;
    }
  }

  const q = findSurfaceFromSeed(r.x, r.y);

  contactFoot = r;
  contactSeed = r;
  contactPoint = q;
  contactTangent = getNormalAndTangent(q.x, q.y);
}


// ============ RENDERING FUNCTIONS ============

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
  const isMobile = window.innerWidth <= 1024;
  const baseRadius = isMobile ? 8 : 6;

  for (const g of gaussians) {
    const pos = getActualPos(g);
    const isDragged = g === draggedPoint;
    const isHovered = g === hoveredPoint;
    const isSelected = g === selectedGaussian;

    // 選択中のガウシアンには外側に白い破線リングを表示
    // （x/X, y/Y, r/Rキーによる変形操作の対象であることを示す）
    if (isSelected) {
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, baseRadius + 5, 0, Math.PI * 2);
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.setLineDash([]);
    }

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

// 現在のマウス位置に評価点Pを表示する
// （マウスがcanvas上にあるときだけ描画。ドラッグ/追加操作は持たない、単なる現在位置の表示）
function drawMouseP() {
  if (!isMouseOverCanvas || !lastMousePos) return;

  const isMobile = window.innerWidth <= 1024;
  const baseRadius = isMobile ? 8 : 6;
  const pos = lastMousePos;

  ctx.beginPath();
  ctx.arc(pos.x, pos.y, baseRadius, 0, Math.PI * 2);
  ctx.fillStyle = '#44aaff';
  ctx.strokeStyle = '#3388cc';
  ctx.lineWidth = 1;
  ctx.fill();
  ctx.stroke();

  // 内側の白い点
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, baseRadius * 0.4, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.fill();

  // ラベル「P」
  ctx.font = 'bold 12px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('P', pos.x, pos.y - baseRadius - 2);
}

// 接触中のQでの接線を描画
function drawContactTangent() {
  if (!contactPoint || !contactTangent) return;

  const { tx, ty } = contactTangent;
  const halfLen = 40;

  ctx.beginPath();
  ctx.setLineDash([]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffcc00';
  ctx.moveTo(contactPoint.x - tx * halfLen, contactPoint.y - ty * halfLen);
  ctx.lineTo(contactPoint.x + tx * halfLen, contactPoint.y + ty * halfLen);
  ctx.stroke();
}

// P → R（垂線の足）を薄いグレーの点線で描画
function drawContactPerpendicular(p) {
  if (!contactFoot) return;

  ctx.beginPath();
  ctx.setLineDash([2, 3]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(200, 200, 200, 0.6)';
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(contactFoot.x, contactFoot.y);
  ctx.stroke();
  ctx.setLineDash([]);

  const baseRadius = 4;
  ctx.beginPath();
  ctx.arc(contactFoot.x, contactFoot.y, baseRadius, 0, Math.PI * 2);
  ctx.fillStyle = '#cc66ff';
  ctx.strokeStyle = '#9933cc';
  ctx.lineWidth = 1.5;
  ctx.fill();
  ctx.stroke();
}

// 探索の種（初回接触時はP、以降はR）→ Q の破線を描画
function drawContactSeedToQ() {
  if (!contactSeed || !contactPoint) return;

  ctx.beginPath();
  ctx.setLineDash([5, 3]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(120, 255, 150, 0.8)';
  ctx.moveTo(contactSeed.x, contactSeed.y);
  ctx.lineTo(contactPoint.x, contactPoint.y);
  ctx.stroke();
  ctx.setLineDash([]);
}

// 接触点Qのマーカーを描画
function drawContactPoint() {
  if (!contactPoint) return;

  const isMobile = window.innerWidth <= 1024;
  const baseRadius = isMobile ? 7 : 5;

  ctx.beginPath();
  ctx.arc(contactPoint.x, contactPoint.y, baseRadius, 0, Math.PI * 2);
  ctx.fillStyle = '#55ff88';
  ctx.strokeStyle = '#22cc55';
  ctx.lineWidth = 2;
  ctx.fill();
  ctx.stroke();

  ctx.font = 'bold 12px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('Q', contactPoint.x, contactPoint.y - baseRadius - 2);
}

// メイン描画関数（現在の状態を描画するだけで、表面探査のステップ自体は進めない。
// ステップの実行はstepSurfaceSearch()が一定時間間隔のタイマーから行う）
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

  drawContactTangent();
  if (lastMousePos) {
    drawContactPerpendicular(lastMousePos);
  }
  drawContactSeedToQ();
  drawContactPoint();

  drawMouseP();
}

// 表面探査を1ステップ進めてから再描画する。
// マウスが動いていなくても一定時間間隔のタイマーから呼ばれ続けることで、
// 静止中も接触状態の更新が継続する。
function stepSurfaceSearch() {
  if (isMouseOverCanvas && lastMousePos) {
    updateSurfaceSearch(lastMousePos);
  } else {
    colliding = false;
    contactPoint = null;
    contactTangent = null;
    contactSeed = null;
    contactFoot = null;
  }
  render();
}

// 表面探査ステップの更新タイマーを（再）起動する。間隔変更時に呼び直す。
function restartUpdateTimer() {
  if (updateTimerId !== null) {
    clearInterval(updateTimerId);
  }
  updateTimerId = setInterval(stepSurfaceSearch, updateIntervalMs);
}


// ============ MOUSE INTERACTION ============

function getMousePos(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  };
}

function findGaussianAt(mx, my) {
  // モバイルではタップ領域を大きく（44px）、デスクトップでは小さく（20px）
  const isMobile = window.innerWidth <= 1024;
  const threshold = isMobile ? 44 : 20;

  for (const g of gaussians) {
    const pos = getActualPos(g);
    const dx = mx - pos.x;
    const dy = my - pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < threshold) {
      return g;
    }
  }
  return null;
}

canvas.addEventListener('mousedown', (e) => {
  const pos = getMousePos(e);
  const g = findGaussianAt(pos.x, pos.y);
  if (g) {
    draggedPoint = g;
    isDragging = true;
    canvas.style.cursor = 'grabbing';
  }
  selectedGaussian = g;
  render();
});

canvas.addEventListener('mouseenter', (e) => {
  isMouseOverCanvas = true;
  lastMousePos = getMousePos(e);
  render();
});

canvas.addEventListener('mousemove', (e) => {
  const pos = getMousePos(e);
  lastMousePos = pos;

  if (isDragging && draggedPoint) {
    setActualPos(draggedPoint, pos.x, pos.y);
  } else {
    const g = findGaussianAt(pos.x, pos.y);
    hoveredPoint = g;
    canvas.style.cursor = g ? 'grab' : 'default';
  }

  // 点Pは常にマウス位置を追従するため毎回再描画する
  render();
});

canvas.addEventListener('mouseup', () => {
  if (isDragging) {
    isDragging = false;
    draggedPoint = null;
    canvas.style.cursor = 'default';
    render();
  }
});

canvas.addEventListener('mouseleave', () => {
  if (isDragging) {
    isDragging = false;
    draggedPoint = null;
    canvas.style.cursor = 'default';
  }
  hoveredPoint = null;
  isMouseOverCanvas = false;
  lastMousePos = null;

  // マウスがcanvas外に出たら次のタイマー更新を待たずに接触状態を即座に解除する
  colliding = false;
  contactPoint = null;
  contactTangent = null;
  contactSeed = null;
  contactFoot = null;

  render();
});


// ============ KEYBOARD INTERACTION ============

// テキスト入力中かどうか（ラジオ/チェックボックス/レンジは対象外。
// クリック後もフォーカスが残るため、tagNameだけで判定するとそれらまで誤ってブロックしてしまう）
function isTypingIntoField() {
  const el = document.activeElement;
  if (!el) return false;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName === 'INPUT') {
    const textTypes = ['text', 'search', 'email', 'url', 'tel', 'password', 'number'];
    return textTypes.includes(el.type);
  }
  return false;
}

// canvas上にマウスがある状態でgキーを押すと、その位置に新しいガウシアンを追加する
window.addEventListener('keydown', (e) => {
  if (e.key !== 'g' && e.key !== 'G') return;
  if (!isMouseOverCanvas || !lastMousePos) return;
  if (isTypingIntoField()) return;

  const newGaussian = { x: 0, y: 0, sx: 0.08, sy: 0.08, theta: 0, amp: 1.0 };
  setActualPos(newGaussian, lastMousePos.x, lastMousePos.y);
  gaussians.push(newGaussian);
  render();
});

// 選択中のガウシアンをキー入力で変形する
// x/X: x方向スケールの拡大・縮小、y/Y: y方向スケールの拡大・縮小、r/R: 正回転・逆回転
window.addEventListener('keydown', (e) => {
  if (!selectedGaussian) return;
  if (isTypingIntoField()) return;

  const scaleFactor = 1.05;
  const rotateStep = Math.PI / 36; // 5度

  switch (e.key) {
    case 'x':
      selectedGaussian.sx *= scaleFactor;
      break;
    case 'X':
      selectedGaussian.sx /= scaleFactor;
      break;
    case 'y':
      selectedGaussian.sy *= scaleFactor;
      break;
    case 'Y':
      selectedGaussian.sy /= scaleFactor;
      break;
    case 'r':
      selectedGaussian.theta += rotateStep;
      break;
    case 'R':
      selectedGaussian.theta -= rotateStep;
      break;
    default:
      return;
  }
  render();
});

// 選択中のガウシアンをeキーで削除する
window.addEventListener('keydown', (e) => {
  if (e.key !== 'e' && e.key !== 'E') return;
  if (!selectedGaussian) return;
  if (isTypingIntoField()) return;

  const idx = gaussians.indexOf(selectedGaussian);
  if (idx !== -1) gaussians.splice(idx, 1);

  if (draggedPoint === selectedGaussian) {
    draggedPoint = null;
    isDragging = false;
  }
  if (hoveredPoint === selectedGaussian) {
    hoveredPoint = null;
  }
  selectedGaussian = null;
  render();
});


// ============ TOUCH INTERACTION ============

function getTouchPos(e) {
  const rect = canvas.getBoundingClientRect();
  const touch = e.touches[0] || e.changedTouches[0];
  return {
    x: touch.clientX - rect.left,
    y: touch.clientY - rect.top,
  };
}

canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  const pos = getTouchPos(e);
  const g = findGaussianAt(pos.x, pos.y);
  if (g) {
    draggedPoint = g;
    isDragging = true;
  }
  selectedGaussian = g;
  render();
});

canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  if (isDragging && draggedPoint) {
    const pos = getTouchPos(e);
    setActualPos(draggedPoint, pos.x, pos.y);
    render();
  }
});

canvas.addEventListener('touchend', (e) => {
  e.preventDefault();
  if (isDragging) {
    isDragging = false;
    draggedPoint = null;
    render();
  }
});

canvas.addEventListener('touchcancel', (e) => {
  e.preventDefault();
  if (isDragging) {
    isDragging = false;
    draggedPoint = null;
    render();
  }
});


// ============ UI CONTROLS ============

const fieldTypeRadios = document.querySelectorAll('input[name="fieldType"]');
const ellipsoidSSlider = document.getElementById('ellipsoidSSlider');
const ellipsoidSValue = document.getElementById('ellipsoidSValue');
const ellipsoidSControl = document.getElementById('ellipsoidSControl');
const logSumExpKSlider = document.getElementById('logSumExpKSlider');
const logSumExpKValue = document.getElementById('logSumExpKValue');
const logSumExpKControl = document.getElementById('logSumExpKControl');
const gaussianTauSlider = document.getElementById('gaussianTauSlider');
const gaussianTauValue = document.getElementById('gaussianTauValue');
const gaussianTauControl = document.getElementById('gaussianTauControl');
function updateSliderState() {
  const isLogSumExpMode = fieldType === 'ellipsoidLogSumExp';
  const isGaussianMode = fieldType === 'gaussian';

  // s スライダーはLogSumExpモード時のみ有効
  ellipsoidSSlider.disabled = isGaussianMode;
  if (ellipsoidSControl) {
    ellipsoidSControl.style.opacity = isGaussianMode ? '0.5' : '1';
  }

  // τスライダーの範囲をモードに応じて切り替え
  if (gaussianTauSlider) {
    if (isLogSumExpMode) {
      gaussianTauSlider.min = '-30';
      gaussianTauSlider.max = '30';
      gaussianTauSlider.step = '0.01';
    } else {
      gaussianTauSlider.min = '0.001';
      gaussianTauSlider.max = '5';
      gaussianTauSlider.step = '0.001';
      if (gaussianDirectTau < 0.001) {
        gaussianDirectTau = 0.001;
        gaussianTauSlider.value = gaussianDirectTau;
        if (gaussianTauValue) gaussianTauValue.textContent = gaussianDirectTau.toFixed(3);
      }
    }
  }

  logSumExpKSlider.disabled = !isLogSumExpMode;
  if (logSumExpKControl) {
    logSumExpKControl.style.opacity = isLogSumExpMode ? '1' : '0.5';
  }
}

const adaptation2DampingSlider = document.getElementById('adaptation2DampingSlider');
const adaptation2DampingValue = document.getElementById('adaptation2DampingValue');
const adaptation2DampingControl = document.getElementById('adaptation2DampingControl');
function updateAdaptationControlState() {
  const isAdaptation2 = contactAdaptationMode === 'adaptation2';
  adaptation2DampingSlider.disabled = !isAdaptation2;
  if (adaptation2DampingControl) {
    adaptation2DampingControl.style.opacity = isAdaptation2 ? '1' : '0.5';
  }
}

// フィールドタイプ切り替え
fieldTypeRadios.forEach(radio => {
  radio.addEventListener('change', (e) => {
    fieldType = e.target.value;

    if (fieldType === 'gaussian') {
      contourStep = 0.1;
    } else {
      contourStep = 1.0;
    }

    const contourStepSlider = document.getElementById('contourStepSlider');
    const contourStepValue = document.getElementById('contourStepValue');
    contourStepSlider.value = contourStep;
    contourStepValue.textContent = contourStep.toFixed(2);

    updateSliderState();
    render();
  });
});

// 接触適応モード切り替え（Normal / Adaptation1 / Adaptation2）
const contactAdaptationRadios = document.querySelectorAll('input[name="contactAdaptation"]');
contactAdaptationRadios.forEach(radio => {
  radio.addEventListener('change', (e) => {
    contactAdaptationMode = e.target.value;
    updateAdaptationControlState();
    render();
  });
});

// Adaptation2の引き戻し量パラメータ
adaptation2DampingSlider.addEventListener('input', (e) => {
  adaptation2DampingFactor = parseFloat(e.target.value);
  adaptation2DampingValue.textContent = adaptation2DampingFactor.toFixed(2);
  render();
});

// 表面探査ステップの更新間隔
const updateIntervalSlider = document.getElementById('updateIntervalSlider');
const updateIntervalValue = document.getElementById('updateIntervalValue');
updateIntervalSlider.addEventListener('input', (e) => {
  updateIntervalMs = parseInt(e.target.value);
  updateIntervalValue.textContent = updateIntervalMs;
  restartUpdateTimer();
});

// 半径 s パラメータ
ellipsoidSSlider.addEventListener('input', (e) => {
  ellipsoidS = parseFloat(e.target.value);
  ellipsoidSValue.textContent = ellipsoidS.toFixed(2);
  render();
});

// τ 直接設定
gaussianTauSlider.addEventListener('input', (e) => {
  gaussianDirectTau = parseFloat(e.target.value);
  gaussianTauValue.textContent = gaussianDirectTau.toFixed(3);
  render();
});

// log-sum-exp k パラメータ
logSumExpKSlider.addEventListener('input', (e) => {
  logSumExpK = parseFloat(e.target.value);
  logSumExpKValue.textContent = logSumExpK.toFixed(2);
  render();
});

// 等値線レベル数
const contourLevelsSlider = document.getElementById('contourLevelsSlider');
const contourLevelsValue = document.getElementById('contourLevelsValue');
contourLevelsSlider.addEventListener('input', (e) => {
  contourLevels = parseInt(e.target.value);
  contourLevelsValue.textContent = contourLevels;
  render();
});

// 等値線間隔
const contourStepSlider = document.getElementById('contourStepSlider');
const contourStepValue = document.getElementById('contourStepValue');
contourStepSlider.addEventListener('input', (e) => {
  contourStep = parseFloat(e.target.value);
  contourStepValue.textContent = contourStep.toFixed(2);
  render();
});

// サンプリング間隔
const gridStepSlider = document.getElementById('gridStepSlider');
const gridStepValue = document.getElementById('gridStepValue');
gridStepSlider.addEventListener('input', (e) => {
  gridStep = parseInt(e.target.value);
  gridStepValue.textContent = gridStep;
  render();
});

// 表示オプション
const showHeatmapCheckbox = document.getElementById('showHeatmapCheckbox');
showHeatmapCheckbox.addEventListener('change', (e) => {
  showHeatmap = e.target.checked;
  render();
});

const showCombinedContoursCheckbox = document.getElementById('showCombinedContoursCheckbox');
showCombinedContoursCheckbox.addEventListener('change', (e) => {
  showCombinedContours = e.target.checked;
  render();
});

const showIndividualCheckbox = document.getElementById('showIndividualCheckbox');
showIndividualCheckbox.addEventListener('change', (e) => {
  showIndividualContours = e.target.checked;
  render();
});


// ============ MOBILE CONTROLS TOGGLE ============

const toggleControlsButton = document.getElementById('toggleControlsButton');
const controlsPanel = document.getElementById('controls');

if (toggleControlsButton && controlsPanel) {
  toggleControlsButton.addEventListener('click', () => {
    // タブレット・スマホ（1024px以下）では何もしない
    if (window.innerWidth <= 1024) {
      return;
    }

    const isExpanded = controlsPanel.classList.contains('expanded');

    if (isExpanded) {
      controlsPanel.classList.remove('expanded');
      toggleControlsButton.classList.remove('hidden');
      toggleControlsButton.textContent = '⚙️ Settings';
    } else {
      controlsPanel.classList.add('expanded');
      toggleControlsButton.textContent = '✕ Close';
    }
  });

  // タブレット・スマホでは外側タップイベントを無効化
  document.addEventListener('click', (e) => {
    // 1024px以下では何もしない
    if (window.innerWidth <= 1024) {
      return;
    }

    const isControlsClick = controlsPanel.contains(e.target);
    const isButtonClick = toggleControlsButton.contains(e.target);
    const isExpanded = controlsPanel.classList.contains('expanded');

    if (isExpanded && !isControlsClick && !isButtonClick) {
      controlsPanel.classList.remove('expanded');
      toggleControlsButton.classList.remove('hidden');
      toggleControlsButton.textContent = '⚙️ Settings';
    }
  });
}


// ============ RESPONSIVE CANVAS ============

function resizeCanvas() {
  const isMobile = window.innerWidth <= 1024;
  const isSmallMobile = window.innerWidth <= 480;

  if (isMobile) {
    // モバイル: 画面幅いっぱい
    canvas.width = window.innerWidth;
    if (isSmallMobile) {
      // スマホ: 45vh（UIを常に表示）
      canvas.height = window.innerHeight * 0.45;
    } else {
      // タブレット: 50vh（UIを常に表示）
      canvas.height = window.innerHeight * 0.5;
    }
    // タブレット・スマホではコントロールを常に展開
    if (controlsPanel) {
      controlsPanel.classList.add('expanded');
    }
  } else {
    // デスクトップ: 固定サイズ
    canvas.width = 900;
    canvas.height = 700;
  }

  // グローバル変数を更新
  width = canvas.width;
  height = canvas.height;

  render();
}

// ウィンドウリサイズ時にキャンバスをリサイズ
let resizeTimeout;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(resizeCanvas, 250);
});


// ============ INITIALIZATION ============

// ページロード時に明示的にガウシアンを選択（ブラウザの自動復元を上書き）
const gaussianRadio = document.querySelector('input[name="fieldType"][value="gaussian"]');
if (gaussianRadio) {
  gaussianRadio.checked = true;
  fieldType = 'gaussian';
}

updateSliderState();
updateAdaptationControlState();

// 初期キャンバスサイズを設定
resizeCanvas();

// タブレット・スマホでは初期状態でコントロールを表示し、トグルボタンを非表示
if (window.innerWidth <= 1024) {
  if (controlsPanel) {
    controlsPanel.classList.add('expanded');
    if (window.innerWidth <= 480) {
      controlsPanel.style.maxHeight = '55vh';
    } else {
      controlsPanel.style.maxHeight = '50vh';
    }
    controlsPanel.style.padding = '15px';
  }
  if (toggleControlsButton) {
    toggleControlsButton.style.display = 'none';
  }
}

// スライダーの初期値を明示的に設定
ellipsoidSSlider.value = ellipsoidS;
ellipsoidSValue.textContent = ellipsoidS.toFixed(2);

logSumExpKSlider.value = logSumExpK;
logSumExpKValue.textContent = logSumExpK.toFixed(2);

contourLevelsSlider.value = contourLevels;
contourLevelsValue.textContent = contourLevels;

contourStepSlider.value = contourStep;
contourStepValue.textContent = contourStep.toFixed(2);

gridStepSlider.value = gridStep;
gridStepValue.textContent = gridStep;

adaptation2DampingSlider.value = adaptation2DampingFactor;
adaptation2DampingValue.textContent = adaptation2DampingFactor.toFixed(2);

updateIntervalSlider.value = updateIntervalMs;
updateIntervalValue.textContent = updateIntervalMs;

// 表面探査ステップの定期更新を開始（マウスが静止していても継続する）
restartUpdateTimer();

render();
