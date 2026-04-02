// ============ FIELD MATH FUNCTIONS ============
// Mathematical functions for Gaussian and Ellipsoid implicit fields

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

// Polynomial smooth min (pairwise)
function sminPoly(a, b, h) {
  const t = Math.max(h - Math.abs(a - b), 0.0) / h;
  return Math.min(a, b) - 0.25 * h * t * t;
}

// 楕円体 polynomial smooth min
function ellipsoidPolyMinField(x, y, s = 1.0, h = 0.5) {
  let f = ellipsoidValue(x, y, gaussians[0], s);
  for (let i = 1; i < gaussians.length; i++) {
    f = sminPoly(f, ellipsoidValue(x, y, gaussians[i], s), h);
  }
  return f;
}

// R-function (R-union)
function rUnion(a, b) {
  return a + b - Math.sqrt(a * a + b * b);
}

// 楕円体 R-union
function ellipsoidRUnionField(x, y, s = 1.0) {
  let f = ellipsoidValue(x, y, gaussians[0], s);
  for (let i = 1; i < gaussians.length; i++) {
    const v = ellipsoidValue(x, y, gaussians[i], s);
    f = rUnion(f, v);
  }
  return f;
}

// Ricci blending
function ricciField(x, y, s = 1.0, n = 4.0, T = 0.3) {
  let sum = 0;

  for (const g of gaussians) {
    const v = ellipsoidValue(x, y, g, s);
    const phi = Math.max(-v, 0.0); // inside contribution only
    sum += Math.pow(phi, n);
  }

  const Phi = Math.pow(sum, 1.0 / n);
  return T - Phi;   // 0-level set
}

// 合成フィールド値を計算
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
    case 'ellipsoidPolyMin':
      return ellipsoidPolyMinField(x, y, ellipsoidS, polyBlendH);
    case 'ellipsoidRUnion':
      return ellipsoidRUnionField(x, y, ellipsoidS);
    case 'ellipsoidRicci':
      return ricciField(x, y, ellipsoidS, ricciN, ricciT);
    default:
      return 0;
  }
}

// 個別のガウシアン/楕円のフィールド値（単体）
function singleFieldValue(x, y, gaussianIndex) {
  const g = gaussians[gaussianIndex];
  
  switch (fieldType) {
    case 'gaussian':
      const tau = computeTauFromS(ellipsoidS);
      return -gaussianValue(x, y, g) + tau;
    case 'ellipsoidSum':
    case 'ellipsoidMin':
    case 'ellipsoidLogSumExp':
    case 'ellipsoidPolyMin':
    case 'ellipsoidRUnion':
    case 'ellipsoidRicci':
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
