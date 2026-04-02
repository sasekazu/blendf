// ============ CONFIGURATION & STATE ============

const canvas = document.getElementById('view');
const ctx = canvas.getContext('2d');

const width = canvas.width;
const height = canvas.height;

// ガウシアン/楕円のデータ
// x, y: 中心
// sx, sy: 標準偏差スケール
// theta: 回転角 [rad]
// amp: 振幅
let gaussians = [
  { x: 260, y: 250, sx: 80, sy: 45, theta: 0.35, amp: 1.0 },
  { x: 470, y: 360, sx: 70, sy: 110, theta: -0.5, amp: 0.95 },
  { x: 650, y: 240, sx: 95, sy: 55, theta: 0.9, amp: 0.85 },
];

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
let polyBlendH = 0.5;
let ricciN = 4.0;
let ricciT = 0.3;

// ドラッグ操作用
let draggedGaussian = null;
let isDragging = false;


// ============ MOUSE INTERACTION ============

function getMousePos(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  };
}

function findGaussianAt(mx, my) {
  const threshold = 15;
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

canvas.addEventListener('mousedown', (e) => {
  const pos = getMousePos(e);
  const g = findGaussianAt(pos.x, pos.y);
  if (g) {
    draggedGaussian = g;
    isDragging = true;
    canvas.style.cursor = 'grabbing';
  }
});

canvas.addEventListener('mousemove', (e) => {
  const pos = getMousePos(e);
  
  if (isDragging && draggedGaussian) {
    draggedGaussian.x = pos.x;
    draggedGaussian.y = pos.y;
    render();
  } else {
    const g = findGaussianAt(pos.x, pos.y);
    canvas.style.cursor = g ? 'grab' : 'default';
  }
});

canvas.addEventListener('mouseup', () => {
  if (isDragging) {
    isDragging = false;
    draggedGaussian = null;
    canvas.style.cursor = 'default';
  }
});

canvas.addEventListener('mouseleave', () => {
  if (isDragging) {
    isDragging = false;
    draggedGaussian = null;
    canvas.style.cursor = 'default';
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
const polyBlendHSlider = document.getElementById('polyBlendHSlider');
const polyBlendHValue = document.getElementById('polyBlendHValue');
const polyBlendHControl = document.getElementById('polyBlendHControl');

function updateSliderState() {
  const isLogSumExpMode = fieldType === 'ellipsoidLogSumExp';
  const isPolyMinMode = fieldType === 'ellipsoidPolyMin';
  const isRicciMode = fieldType === 'ellipsoidRicci';
  
  ellipsoidSSlider.disabled = false;
  if (ellipsoidSControl) {
    ellipsoidSControl.style.opacity = '1';
  }
  
  logSumExpKSlider.disabled = !isLogSumExpMode;
  if (logSumExpKControl) {
    logSumExpKControl.style.opacity = isLogSumExpMode ? '1' : '0.5';
  }
  
  polyBlendHSlider.disabled = !isPolyMinMode;
  if (polyBlendHControl) {
    polyBlendHControl.style.opacity = isPolyMinMode ? '1' : '0.5';
  }
  
  ricciNSlider.disabled = !isRicciMode;
  if (ricciNControl) {
    ricciNControl.style.opacity = isRicciMode ? '1' : '0.5';
  }
  
  ricciTSlider.disabled = !isRicciMode;
  if (ricciTControl) {
    ricciTControl.style.opacity = isRicciMode ? '1' : '0.5';
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

// Ricci n パラメータ
const ricciNSlider = document.getElementById('ricciNSlider');
const ricciNValue = document.getElementById('ricciNValue');
const ricciNControl = document.getElementById('ricciNControl');
ricciNSlider.addEventListener('input', (e) => {
  ricciN = parseFloat(e.target.value);
  ricciNValue.textContent = ricciN.toFixed(1);
  render();
});

// Ricci T パラメータ
const ricciTSlider = document.getElementById('ricciTSlider');
const ricciTValue = document.getElementById('ricciTValue');
const ricciTControl = document.getElementById('ricciTControl');
ricciTSlider.addEventListener('input', (e) => {
  ricciT = parseFloat(e.target.value);
  ricciTValue.textContent = ricciT.toFixed(2);
  render();
});

// 半径 s パラメータ
ellipsoidSSlider.addEventListener('input', (e) => {
  ellipsoidS = parseFloat(e.target.value);
  ellipsoidSValue.textContent = ellipsoidS.toFixed(2);
  render();
});

// log-sum-exp k パラメータ
logSumExpKSlider.addEventListener('input', (e) => {
  logSumExpK = parseFloat(e.target.value);
  logSumExpKValue.textContent = logSumExpK.toFixed(2);
  render();
});

// polynomial blend h パラメータ
polyBlendHSlider.addEventListener('input', (e) => {
  polyBlendH = parseFloat(e.target.value);
  polyBlendHValue.textContent = polyBlendH.toFixed(2);
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

// ガウシアンをランダム化
const randomizeButton = document.getElementById('randomizeButton');
randomizeButton.addEventListener('click', () => {
  gaussians = gaussians.map(() => ({
    x: width * 0.2 + Math.random() * width * 0.6,
    y: height * 0.2 + Math.random() * height * 0.6,
    sx: 40 + Math.random() * 80,
    sy: 40 + Math.random() * 80,
    theta: (Math.random() - 0.5) * Math.PI,
    amp: 0.8 + Math.random() * 0.4
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


// ============ INITIALIZATION ============

// ページロード時に明示的にガウシアンを選択（ブラウザの自動復元を上書き）
const gaussianRadio = document.querySelector('input[name="fieldType"][value="gaussian"]');
if (gaussianRadio) {
  gaussianRadio.checked = true;
  fieldType = 'gaussian';
}

updateSliderState();

// スライダーの初期値を明示的に設定
ellipsoidSSlider.value = ellipsoidS;
ellipsoidSValue.textContent = ellipsoidS.toFixed(2);

ricciNSlider.value = ricciN;
ricciNValue.textContent = ricciN.toFixed(1);

ricciTSlider.value = ricciT;
ricciTValue.textContent = ricciT.toFixed(2);

logSumExpKSlider.value = logSumExpK;
logSumExpKValue.textContent = logSumExpK.toFixed(2);

polyBlendHSlider.value = polyBlendH;
polyBlendHValue.textContent = polyBlendH.toFixed(2);

contourLevelsSlider.value = contourLevels;
contourLevelsValue.textContent = contourLevels;

contourStepSlider.value = contourStep;
contourStepValue.textContent = contourStep.toFixed(2);

gridStepSlider.value = gridStep;
gridStepValue.textContent = gridStep;

render();
