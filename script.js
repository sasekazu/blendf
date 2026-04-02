const canvas = document.getElementById('view');
const ctx = canvas.getContext('2d');

const width = canvas.width;
const height = canvas.height;

// まずは単純な 2D 異方性ガウシアンを 3 個だけ固定配置
// x, y: 中心
// sx, sy: 標準偏差スケール
// theta: 回転角 [rad]
// amp: 振幅
const gaussians = [
  { x: 260, y: 250, sx: 80, sy: 45, theta: 0.35, amp: 1.0 },
  { x: 470, y: 360, sx: 70, sy: 110, theta: -0.5, amp: 0.95 },
  { x: 650, y: 240, sx: 95, sy: 55, theta: 0.9, amp: 0.85 },
];

// 等値線レベル数
const contourLevels = 1;
// サンプリング間隔（小さいほどきれい・重い）
const gridStep = 4;

// フィールドタイプの選択
let fieldType = 'gaussian'; // 'gaussian', 'ellipsoidSum', 'ellipsoidMin', 'ellipsoidLogSumExp'
let ellipsoidS = 2.0; // 楕円体のスケールパラメータ（デフォルトで2σに対応）
let gaussianTau = 0.2; // Gaussian等値面レベル
let logSumExpK = 5.0; // log-sum-expのkパラメータ

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

// Gaussian和のimplicit形式（F(x) = 0が等値面）
function gaussianSumField(x, y, tau = 0.2) {
  let sum = 0;
  for (const g of gaussians) {
    sum += gaussianValue(x, y, g);
  }
  return sum - tau;
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
      return gaussianSumField(x, y, gaussianTau);
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

  // 固定レベルの等高線を描画（0を中心に、負と正の両側に描画）
  const levels = [];
  if (contourLevels === 1) {
    // 1本だけなら0のレベルを描画（境界線）
    levels.push(0);
  } else {
    // 複数本なら0を中心に等間隔で配置
    const maxAbsValue = Math.max(Math.abs(minV), Math.abs(maxV));
    const step = maxAbsValue / Math.ceil(contourLevels / 2);
    for (let i = -Math.floor(contourLevels / 2); i <= Math.floor(contourLevels / 2); i++) {
      levels.push(i * step);
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
      
      // 0を中心としたdivergingカラーマップ: 負=青、0=白、正=赤
      const absMax = Math.max(Math.abs(minV), Math.abs(maxV));
      const normalized = v / Math.max(1e-12, absMax); // -1 ~ 1 の範囲に正規化
      
      let r, g, b;
      if (normalized < 0) {
        // 負の値: 青から白へ
        const t = Math.abs(normalized); // 0 (白) ~ 1 (青)
        r = Math.floor(255 * (1 - t * 0.8)); // 255 -> 51
        g = Math.floor(255 * (1 - t * 0.8)); // 255 -> 51
        b = 255; // 常に青成分は最大
      } else {
        // 正の値: 白から赤へ
        const t = normalized; // 0 (白) ~ 1 (赤)
        r = 255; // 常に赤成分は最大
        g = Math.floor(255 * (1 - t * 0.8)); // 255 -> 51
        b = Math.floor(255 * (1 - t * 0.8)); // 255 -> 51
      }

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
const fieldTypeSelect = document.getElementById('fieldTypeSelect');
const gaussianTauSlider = document.getElementById('gaussianTauSlider');
const gaussianTauValue = document.getElementById('gaussianTauValue');
const gaussianTauControl = document.getElementById('gaussianTauControl');
const ellipsoidSSlider = document.getElementById('ellipsoidSSlider');
const ellipsoidSValue = document.getElementById('ellipsoidSValue');
const ellipsoidSControl = document.getElementById('ellipsoidSControl');
const logSumExpKSlider = document.getElementById('logSumExpKSlider');
const logSumExpKValue = document.getElementById('logSumExpKValue');
const logSumExpKControl = document.getElementById('logSumExpKControl');

// スライダーの有効/無効を切り替える関数
function updateSliderState() {
  const isGaussianMode = fieldType === 'gaussian';
  const isEllipsoidMode = fieldType !== 'gaussian';
  const isLogSumExpMode = fieldType === 'ellipsoidLogSumExp';
  
  // Gaussianモードでτスライダーを有効化
  gaussianTauSlider.disabled = !isGaussianMode;
  if (gaussianTauControl) {
    gaussianTauControl.style.opacity = isGaussianMode ? '1' : '0.5';
  }
  
  // 楕円体モードでsスライダーを有効化
  ellipsoidSSlider.disabled = !isEllipsoidMode;
  if (ellipsoidSControl) {
    ellipsoidSControl.style.opacity = isEllipsoidMode ? '1' : '0.5';
  }
  
  // log-sum-expモードでkスライダーを有効化
  logSumExpKSlider.disabled = !isLogSumExpMode;
  if (logSumExpKControl) {
    logSumExpKControl.style.opacity = isLogSumExpMode ? '1' : '0.5';
  }
}

fieldTypeSelect.addEventListener('change', (e) => {
  fieldType = e.target.value;
  updateSliderState();
  render();
});

// Gaussian τ パラメータの調整
gaussianTauSlider.addEventListener('input', (e) => {
  gaussianTau = parseFloat(e.target.value);
  gaussianTauValue.textContent = gaussianTau.toFixed(2);
  render();
});

// 楕円体 s パラメータの調整
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

// 初期状態を設定
updateSliderState();

render();
