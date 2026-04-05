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
    draggedGaussian = g;
    isDragging = true;
    canvas.style.cursor = 'grabbing';
  }
});

canvas.addEventListener('mousemove', (e) => {
  const pos = getMousePos(e);
  
  if (isDragging && draggedGaussian) {
    setActualPos(draggedGaussian, pos.x, pos.y);
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
    draggedGaussian = g;
    isDragging = true;
  }
});

canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  if (isDragging && draggedGaussian) {
    const pos = getTouchPos(e);
    setActualPos(draggedGaussian, pos.x, pos.y);
    render();
  }
});

canvas.addEventListener('touchend', (e) => {
  e.preventDefault();
  if (isDragging) {
    isDragging = false;
    draggedGaussian = null;
  }
});

canvas.addEventListener('touchcancel', (e) => {
  e.preventDefault();
  if (isDragging) {
    isDragging = false;
    draggedGaussian = null;
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
  const baseSize = Math.min(width, height);
  gaussians = gaussians.map(() => ({
    x: 0.2 + Math.random() * 0.6,
    y: 0.2 + Math.random() * 0.6,
    sx: (40 + Math.random() * 80) / baseSize,
    sy: (40 + Math.random() * 80) / baseSize,
    theta: (Math.random() - 0.5) * Math.PI,
    amp: 0.8 + Math.random() * 0.4
  }));
  render();
});

// スケールを拡大（+10%）
const scaleUpButton = document.getElementById('scaleUpButton');
scaleUpButton.addEventListener('click', () => {
  gaussians.forEach(g => {
    g.sx *= 1.1;
    g.sy *= 1.1;
  });
  render();
});

// スケールを縮小（-10%）
const scaleDownButton = document.getElementById('scaleDownButton');
scaleDownButton.addEventListener('click', () => {
  gaussians.forEach(g => {
    g.sx *= 0.9;
    g.sy *= 0.9;
  });
  render();
});


// ============ MOBILE CONTROLS TOGGLE ============

const toggleControlsButton = document.getElementById('toggleControlsButton');
const controlsPanel = document.getElementById('controls');

if (toggleControlsButton && controlsPanel) {
  toggleControlsButton.addEventListener('click', () => {
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
  
  // コントロールパネル外をタップで閉じる（モバイルのみ）
  document.addEventListener('click', (e) => {
    if (window.innerWidth <= 768) {
      const isControlsClick = controlsPanel.contains(e.target);
      const isButtonClick = toggleControlsButton.contains(e.target);
      const isExpanded = controlsPanel.classList.contains('expanded');
      
      if (isExpanded && !isControlsClick && !isButtonClick) {
        controlsPanel.classList.remove('expanded');
        toggleControlsButton.classList.remove('hidden');
        toggleControlsButton.textContent = '⚙️ Settings';
      }
    }
  });
}


// ============ RESPONSIVE CANVAS ============

function resizeCanvas() {
  const isMobile = window.innerWidth <= 768;
  const isSmallMobile = window.innerWidth <= 480;
  
  if (isMobile) {
    // モバイル: 画面幅いっぱい
    canvas.width = window.innerWidth;
    if (isSmallMobile) {
      // 小さい画面: 60vh
      canvas.height = window.innerHeight * 0.6;
    } else {
      // タブレット: 65vh
      canvas.height = window.innerHeight * 0.65;
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

// 初期キャンバスサイズを設定
resizeCanvas();

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
