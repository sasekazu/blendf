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
