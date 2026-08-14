// ============ FIELD MATH FUNCTIONS ============
// Mathematical functions for Gaussian and Ellipsoid implicit fields

// ガウシアンの実座標と実サイズを取得（main.jsから参照）
function getActualGaussian(g) {
  const baseSize = Math.min(width, height);
  return {
    x: g.x * width,
    y: g.y * height,
    sx: g.sx * baseSize,
    sy: g.sy * baseSize,
    theta: g.theta,
    amp: g.amp
  };
}

// 個別のGaussian値を計算
function gaussianValue(x, y, g) {
  const actual = getActualGaussian(g);
  const dx = x - actual.x;
  const dy = y - actual.y;

  const c = Math.cos(actual.theta);
  const s = Math.sin(actual.theta);

  // 回転してローカル座標へ
  const lx =  c * dx + s * dy;
  const ly = -s * dx + c * dy;

  const q = (lx * lx) / (actual.sx * actual.sx) + (ly * ly) / (actual.sy * actual.sy);
  return actual.amp * Math.exp(-0.5 * q);
}

// sから対応するτを計算（同じMahalanobis半径sに対応する等値面）
function computeTauFromS(s) {
  return Math.exp(-0.5 * s * s);
}

// Gaussian和の生の値
function gaussianSumField(x, y) {
  let sum = 0;
  for (const g of gaussians) {
    sum += gaussianValue(x, y, g);
  }
  return sum;
}

// 楕円体の implicit 関数
function ellipsoidValue(x, y, g, s = 1.0) {
  const actual = getActualGaussian(g);
  const dx = x - actual.x;
  const dy = y - actual.y;
  const c = Math.cos(actual.theta);
  const sn = Math.sin(actual.theta);

  // world -> local
  const lx =  c * dx + sn * dy;
  const ly = -sn * dx + c * dy;

  // v_i(x) = d^T Sigma^{-1} d - s^2
  return (lx * lx) / (actual.sx * actual.sx) + (ly * ly) / (actual.sy * actual.sy) - s * s;
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

// 合成フィールド値を計算
function fieldValue(x, y) {
  switch (fieldType) {
    case 'gaussian':
      return gaussianSumField(x, y);
    case 'ellipsoidLogSumExp':
      return ellipsoidLogSumExpField(x, y, ellipsoidS, logSumExpK);
    default:
      return 0;
  }
}

// 個別のガウシアン/楕円のフィールド値（単体）
function singleFieldValue(x, y, gaussianIndex) {
  const g = gaussians[gaussianIndex];
  
  switch (fieldType) {
    case 'gaussian':
      return gaussianValue(x, y, g);
    case 'ellipsoidLogSumExp':
      return ellipsoidValue(x, y, g, ellipsoidS);
    default:
      return 0;
  }
}

// 合成フィールドのグリッドを計算
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

// ============ SURFACE SEARCH (点Pから表面上の点Qを探索) ============
// GaussianViewHaptics.cpp の findSurfaceFromSeed / calcValueAndGrad を参考にした2D版

// 単一Gaussianの勾配 (∂val/∂x, ∂val/∂y)
function gaussianGradient(x, y, g) {
  const actual = getActualGaussian(g);
  const dx = x - actual.x;
  const dy = y - actual.y;

  const c = Math.cos(actual.theta);
  const s = Math.sin(actual.theta);

  const lx =  c * dx + s * dy;
  const ly = -s * dx + c * dy;

  const q = (lx * lx) / (actual.sx * actual.sx) + (ly * ly) / (actual.sy * actual.sy);
  const val = actual.amp * Math.exp(-0.5 * q);

  const dqdx = 2 * lx * c / (actual.sx * actual.sx) - 2 * ly * s / (actual.sy * actual.sy);
  const dqdy = 2 * lx * s / (actual.sx * actual.sx) + 2 * ly * c / (actual.sy * actual.sy);

  return {
    gx: -0.5 * val * dqdx,
    gy: -0.5 * val * dqdy,
  };
}

// Gaussian和の勾配
function gaussianSumGradient(x, y) {
  let gx = 0, gy = 0;
  for (const g of gaussians) {
    const grad = gaussianGradient(x, y, g);
    gx += grad.gx;
    gy += grad.gy;
  }
  return { gx, gy };
}

// 楕円体 implicit 関数 v_i(x) = d^T Sigma^-1 d - s^2 の勾配
function ellipsoidGradient(x, y, g, s = 1.0) {
  const actual = getActualGaussian(g);
  const dx = x - actual.x;
  const dy = y - actual.y;
  const c = Math.cos(actual.theta);
  const sn = Math.sin(actual.theta);

  const lx =  c * dx + sn * dy;
  const ly = -sn * dx + c * dy;

  const gx = 2 * lx * c / (actual.sx * actual.sx) - 2 * ly * sn / (actual.sy * actual.sy);
  const gy = 2 * lx * sn / (actual.sx * actual.sx) + 2 * ly * c / (actual.sy * actual.sy);

  return { gx, gy };
}

// 楕円体 soft-min (log-sum-exp) の値と勾配を同時に計算
// F = vmin - (1/k)log(S), ∇F = Σ w_i∇v_i / S  (w_i = a_i * exp(-k(v_i - vmin)))
function ellipsoidLogSumExpValueAndGrad(x, y, s = 1.0, k = 5.0) {
  let vmin = Infinity;
  const items = [];

  for (const g of gaussians) {
    const v = ellipsoidValue(x, y, g, s);
    items.push({ v, a: g.amp, g });
    if (v < vmin) vmin = v;
  }

  let S = 0;
  let sumGx = 0, sumGy = 0;
  for (const item of items) {
    const w = item.a * Math.exp(-k * (item.v - vmin));
    S += w;
    const grad = ellipsoidGradient(x, y, item.g, s);
    sumGx += w * grad.gx;
    sumGy += w * grad.gy;
  }

  const val = vmin - (1.0 / k) * Math.log(S);
  const gx = S > 1e-30 ? sumGx / S : 0;
  const gy = S > 1e-30 ? sumGy / S : 0;

  return { val, gx, gy };
}

// 点(x,y)における合成スカラー場の値と勾配を計算（tauをオフセットとして減算し、
// 表面 = val=0 となるよう調整。GaussianView::calcValueAndGrad に対応）
function calcValueAndGrad(x, y) {
  let val, gx, gy;

  if (fieldType === 'gaussian') {
    val = gaussianSumField(x, y);
    const grad = gaussianSumGradient(x, y);
    gx = grad.gx;
    gy = grad.gy;
  } else if (fieldType === 'ellipsoidLogSumExp') {
    const r = ellipsoidLogSumExpValueAndGrad(x, y, ellipsoidS, logSumExpK);
    val = r.val;
    gx = r.gx;
    gy = r.gy;
  } else {
    val = 0;
    gx = 0;
    gy = 0;
  }

  val -= gaussianDirectTau;
  return { val, gx, gy };
}

// 点(seedX, seedY)を起点に、ニュートン法的な勾配降下でスカラー場表面(val=0)上の
// 点を探索する。GaussianViewHaptics.cpp の findSurfaceFromSeed ラムダに対応。
function findSurfaceFromSeed(seedX, seedY) {
  let x = seedX;
  let y = seedY;
  const maxIter = 20;

  for (let i = 0; i < maxIter; i++) {
    const { val, gx, gy } = calcValueAndGrad(x, y);

    if (!Number.isFinite(val) || !Number.isFinite(gx) || !Number.isFinite(gy)) {
      // 非有限値が出た場合はseedにフォールバックしてNaNの伝播を防ぐ
      return { x: seedX, y: seedY, found: false };
    }

    const gNormSq = gx * gx + gy * gy;
    if (gNormSq < 1e-10) break;

    const dx = -val * gx / gNormSq;
    const dy = -val * gy / gNormSq;
    x += dx;
    y += dy;

    if (Math.sqrt(dx * dx + dy * dy) < 1e-5) break;
  }

  return { x, y, found: true };
}

// 個別のガウシアン/楕円のグリッドを計算
function computeSingleFieldGrid(gaussianIndex) {
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
      const v = singleFieldValue(x, y, gaussianIndex);
      values[j][i] = v;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
  }

  return { values, cols, rows, minV, maxV };
}
