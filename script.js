const canvas = document.getElementById('view');
const ctx = canvas.getContext('2d');

const width = canvas.width;
const height = canvas.height;

// まずは単純な 2D 異方性ガウシアンを 3 個だけ固定配置
// x, y: 中心
// sx, sy: 標準偏差スケール
// theta: 回転角 [rad]
// amp: 振幅
let gaussians = [
  { x: 260, y: 250, sx: 80, sy: 45, theta: 0.35, amp: 1.0 },
  { x: 470, y: 360, sx: 70, sy: 110, theta: -0.5, amp: 0.95 },
  { x: 650, y: 240, sx: 95, sy: 55, theta: 0.9, amp: 0.85 },
];

// 等値線レベル数
let contourLevels = 10;
// 等値線の間隔（固定間隔モード）
let contourStep = 0.5;
// サンプリング間隔（小さいほどきれい・重い）
let gridStep = 4;

// フィールドタイプの選択
let fieldType = 'gaussian'; // 'gaussian', 'ellipsoidSum', 'ellipsoidMin', 'ellipsoidLogSumExp'
let ellipsoidS = 2.0; // スケールパラメータ（全モード共通、デフォルトで2σに対応）
let logSumExpK = 0.5; // log-sum-expのkパラメータ

// ドラッグ操作用の変数
let draggedGaussian = null;
let isDragging = false;

// 個別のGaussian値を計算
function gaussianValue(x, y, g) {
  const dx = x - g.x;
  const dy = y - g.y;

  const c = Math.cos(g.theta);
  const s = Math.sin(g.theta);

  // 回転してローカル座標へ
  const lx =  c * dx + s * dy;
  const ly = -s * dx + c * dy;

  const q = (lx * lx) / (g.sx * g.sx) + (ly * ly) / (g.sy * g.sy);
  return g.amp * Math.exp(-0.5 * q);
}

// sから対応するτを計算（同じMahalanobis半径sに対応する等値面）
function computeTauFromS(s) {
  return Math.exp(-0.5 * s * s);
}

// Gaussian和のimplicit形式（F(x) = 0が等値面）
function gaussianSumField(x, y, s = 1.0) {
  const tau = computeTauFromS(s);

  let sum = 0;
  for (const g of gaussians) {
    sum += gaussianValue(x, y, g);
  }

  return - sum + tau;
}

// 楕円体の implicit 関数
function ellipsoidValue(x, y, g, s = 1.0) {
  const dx = x - g.x;
  const dy = y - g.y;
  const c = Math.cos(g.theta);
  const sn = Math.sin(g.theta);

  // world -> local
  const lx =  c * dx + sn * dy;
  const ly = -sn * dx + c * dy;

  // v_i(x) = d^T Sigma^{-1} d - s^2
  return (lx * lx) / (g.sx * g.sx) + (ly * ly) / (g.sy * g.sy) - s * s;
}

// 楕円体関数の単純和
function ellipsoidSumField(x, y, s = 1.0) {
  let sum = 0;
  for (const g of gaussians) {
    sum += ellipsoidValue(x, y, g, s);
  }
  return sum;
}

// 楕円体 hard min
function ellipsoidMinField(x, y, s = 1.0) {
  let minV = Infinity;
  for (const g of gaussians) {
    const v = ellipsoidValue(x, y, g, s);
    if (v < minV) minV = v;
  }
  return minV;
}

// 楕円体 soft-min (log-sum-exp)
function ellipsoidLogSumExpField(x, y, s = 1.0, k = 5.0) {
  let vmin = Infinity;
  const vs = [];

  for (const g of gaussians) {
    const v = ellipsoidValue(x, y, g, s);
    vs.push({ v, a: g.amp });
    if (v < vmin) vmin = v;
  }

  let S = 0;
  for (const item of vs) {
    S += item.a * Math.exp(-k * (item.v - vmin));
  }

  return vmin - (1.0 / k) * Math.log(S);
}

function fieldValue(x, y) {
  switch (fieldType) {
    case 'gaussian':
      return gaussianSumField(x, y, ellipsoidS);
    case 'ellipsoidSum':
      return ellipsoidSumField(x, y, ellipsoidS);
    case 'ellipsoidMin':
      return ellipsoidMinField(x, y, ellipsoidS);
    case 'ellipsoidLogSumExp':
      return ellipsoidLogSumExpField(x, y, ellipsoidS, logSumExpK);
    default:
      return 0;
  }
}

function computeFieldGrid() {
  const cols = Math.floor(width / gridStep) + 1;
  const rows = Math.floor(height / gridStep) + 1;
  const values = new Array(rows);

  let minV = Infinity;
  let maxV = -Infinity;

  for (let j = 0; j < rows; j++) {
    values[j] = new Array(cols);
    for (let i = 0; i < cols; i++) {
      const x = i * gridStep;
      const y = j * gridStep;
      const v = fieldValue(x, y);
      values[j][i] = v;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
  }

  return { values, cols, rows, minV, maxV };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function interpPoint(x1, y1, v1, x2, y2, v2, iso) {
  const denom = (v2 - v1);
  const t = Math.abs(denom) < 1e-12 ? 0.5 : (iso - v1) / denom;
  return {
    x: lerp(x1, x2, t),
    y: lerp(y1, y2, t),
  };
}

// marching squares の簡易実装
function drawContours(grid) {
  const { values, cols, rows, minV, maxV } = grid;

  // 背景に軽く濃淡も入れておく
  drawHeatmap(grid);

  // 固定レベルの等高線を描画（0を中心に、固定間隔で負と正の両側に描画）
  const levels = [];
  if (contourLevels === 1) {
    // 1本だけなら0のレベルを描画（境界線）
    levels.push(0);
  } else {
    // 複数本なら0を中心に固定間隔（contourStep）で配置
    const halfLevels = Math.floor(contourLevels / 2);
    for (let i = -halfLevels; i <= halfLevels; i++) {
      levels.push(i * contourStep);
    }
  }

  for (let levelIdx = 0; levelIdx < levels.length; levelIdx++) {
    const iso = levels[levelIdx];

    ctx.beginPath();
    ctx.lineWidth = iso === 0 ? 2.5 : 1.2;
    
    // 0のレベルは黄色で強調、それ以外は白系
    if (iso === 0) {
      ctx.strokeStyle = '#ffff00';
    } else {
      const tone = Math.floor(180 + 40 * (levelIdx / levels.length));
      ctx.strokeStyle = `rgb(${tone}, ${tone}, ${tone})`;
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

function drawHeatmap(grid) {
  const { values, cols, rows, minV, maxV } = grid;
  const image = ctx.createImageData(width, height);
  const data = image.data;

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const gx = Math.min(cols - 1, Math.floor(px / gridStep));
      const gy = Math.min(rows - 1, Math.floor(py / gridStep));
      const v = values[gy][gx];
      
      // グレースケール
      const t = (v - minV) / Math.max(1e-12, maxV - minV);
      const c = Math.floor(20 + 90 * t);
      
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

function drawGaussianCenters() {
  for (const g of gaussians) {
    ctx.beginPath();
    ctx.arc(g.x, g.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ff8844';
    ctx.fill();
  }
}

function render() {
  ctx.clearRect(0, 0, width, height);
  const grid = computeFieldGrid();
  drawContours(grid);
  drawGaussianCenters();
}

// マウス座標を取得（キャンバス相対）
function getMousePos(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  };
}

// マウス位置に近いガウシアンを探す
function findGaussianAt(mx, my) {
  const threshold = 15; // クリック判定の距離（ピクセル）
  for (const g of gaussians) {
    const dx = mx - g.x;
    const dy = my - g.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < threshold) {
      return g;
    }
  }
  return null;
}

// マウスダウン時
canvas.addEventListener('mousedown', (e) => {
  const pos = getMousePos(e);
  const g = findGaussianAt(pos.x, pos.y);
  if (g) {
    draggedGaussian = g;
    isDragging = true;
    canvas.style.cursor = 'grabbing';
  }
});

// マウスムーブ時
canvas.addEventListener('mousemove', (e) => {
  const pos = getMousePos(e);
  
  if (isDragging && draggedGaussian) {
    // ドラッグ中：ガウシアンの位置を更新
    draggedGaussian.x = pos.x;
    draggedGaussian.y = pos.y;
    render();
  } else {
    // ホバー時：カーソルを変更
    const g = findGaussianAt(pos.x, pos.y);
    canvas.style.cursor = g ? 'grab' : 'default';
  }
});

// マウスアップ時
canvas.addEventListener('mouseup', () => {
  if (isDragging) {
    isDragging = false;
    draggedGaussian = null;
    canvas.style.cursor = 'default';
  }
});

// キャンバス外でマウスアップした場合
canvas.addEventListener('mouseleave', () => {
  if (isDragging) {
    isDragging = false;
    draggedGaussian = null;
    canvas.style.cursor = 'default';
  }
});

// フィールドタイプの切り替え
const fieldTypeRadios = document.querySelectorAll('input[name="fieldType"]');
const ellipsoidSSlider = document.getElementById('ellipsoidSSlider');
const ellipsoidSValue = document.getElementById('ellipsoidSValue');
const ellipsoidSControl = document.getElementById('ellipsoidSControl');
const logSumExpKSlider = document.getElementById('logSumExpKSlider');
const logSumExpKValue = document.getElementById('logSumExpKValue');
const logSumExpKControl = document.getElementById('logSumExpKControl');

// スライダーの有効/無効を切り替える関数
function updateSliderState() {
  const isLogSumExpMode = fieldType === 'ellipsoidLogSumExp';
  
  // sスライダーは常に有効（全モード共通）
  ellipsoidSSlider.disabled = false;
  if (ellipsoidSControl) {
    ellipsoidSControl.style.opacity = '1';
  }
  
  // log-sum-expモードでkスライダーを有効化
  logSumExpKSlider.disabled = !isLogSumExpMode;
  if (logSumExpKControl) {
    logSumExpKControl.style.opacity = isLogSumExpMode ? '1' : '0.5';
  }
}

// ラジオボタンのイベントリスナー
fieldTypeRadios.forEach(radio => {
  radio.addEventListener('change', (e) => {
    fieldType = e.target.value;
    updateSliderState();
    render();
  });
});

// 半径 s パラメータの調整（全モード共通）
ellipsoidSSlider.addEventListener('input', (e) => {
  ellipsoidS = parseFloat(e.target.value);
  ellipsoidSValue.textContent = ellipsoidS.toFixed(2);
  render();
});

// log-sum-exp k パラメータの調整
logSumExpKSlider.addEventListener('input', (e) => {
  logSumExpK = parseFloat(e.target.value);
  logSumExpKValue.textContent = logSumExpK.toFixed(2);
  render();
});

// 等値線レベル数の調整
const contourLevelsSlider = document.getElementById('contourLevelsSlider');
const contourLevelsValue = document.getElementById('contourLevelsValue');
contourLevelsSlider.addEventListener('input', (e) => {
  contourLevels = parseInt(e.target.value);
  contourLevelsValue.textContent = contourLevels;
  render();
});

// 等値線間隔の調整
const contourStepSlider = document.getElementById('contourStepSlider');
const contourStepValue = document.getElementById('contourStepValue');
contourStepSlider.addEventListener('input', (e) => {
  contourStep = parseFloat(e.target.value);
  contourStepValue.textContent = contourStep.toFixed(2);
  render();
});

// サンプリング間隔の調整
const gridStepSlider = document.getElementById('gridStepSlider');
const gridStepValue = document.getElementById('gridStepValue');
gridStepSlider.addEventListener('input', (e) => {
  gridStep = parseInt(e.target.value);
  gridStepValue.textContent = gridStep;
  render();
});

// ガウシアンをランダム化
const randomizeButton = document.getElementById('randomizeButton');
randomizeButton.addEventListener('click', () => {
  gaussians = gaussians.map(() => ({
    x: width * 0.2 + Math.random() * width * 0.6,  // 中心6割の範囲
    y: height * 0.2 + Math.random() * height * 0.6,  // 中心6割の範囲
    sx: 40 + Math.random() * 80,  // 40-120
    sy: 40 + Math.random() * 80,  // 40-120
    theta: (Math.random() - 0.5) * Math.PI,  // -π/2 to π/2
    amp: 0.8 + Math.random() * 0.4  // 0.8-1.2
  }));
  render();
});

// スケールを拡大（+10%）
const scaleUpButton = document.getElementById('scaleUpButton');
scaleUpButton.addEventListener('click', () => {
  gaussians = gaussians.map(g => ({
    ...g,
    sx: g.sx * 1.1,
    sy: g.sy * 1.1
  }));
  render();
});

// スケールを縮小（-10%）
const scaleDownButton = document.getElementById('scaleDownButton');
scaleDownButton.addEventListener('click', () => {
  gaussians = gaussians.map(g => ({
    ...g,
    sx: g.sx * 0.9,
    sy: g.sy * 0.9
  }));
  render();
});

// 初期状態を設定
updateSliderState();

render();
