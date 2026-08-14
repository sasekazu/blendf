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

// 評価点P（ガウシアンの中心と同様にドラッグで移動可能）
let pointP = { x: 0.5, y: 0.7 };

// 点Pから探索されたスカラー場表面上の点Q（実座標）。render()内で毎回更新される。
let pointQ = null;

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
let showSurfaceSearch = true;

// フィールド設定
let fieldType = 'gaussian';
let ellipsoidS = 2.0;
let logSumExpK = 0.5;
let gaussianDirectTau = computeTauFromS(2.0);

// ドラッグ操作用
let draggedPoint = null;
let isDragging = false;
let hoveredPoint = null;


// ============ MOUSE INTERACTION ============

function getMousePos(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  };
}

function findPointAt(mx, my) {
  // モバイルではタップ領域を大きく（44px）、デスクトップでは小さく（20px）
  const isMobile = window.innerWidth <= 1024;
  const threshold = isMobile ? 44 : 20;

  for (const g of [...gaussians, pointP]) {
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
  const g = findPointAt(pos.x, pos.y);
  if (g) {
    draggedPoint = g;
    isDragging = true;
    canvas.style.cursor = 'grabbing';
  }
});

canvas.addEventListener('mousemove', (e) => {
  const pos = getMousePos(e);
  
  if (isDragging && draggedPoint) {
    setActualPos(draggedPoint, pos.x, pos.y);
    render();
  } else {
    const g = findPointAt(pos.x, pos.y);
    const wasHovered = hoveredPoint !== null;
    const isHovered = g !== null;
    
    if (wasHovered !== isHovered || hoveredPoint !== g) {
      hoveredPoint = g;
      render();
    }
    
    canvas.style.cursor = g ? 'grab' : 'default';
  }
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
  const g = findPointAt(pos.x, pos.y);
  if (g) {
    draggedPoint = g;
    isDragging = true;
    render();
  }
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

const showSurfaceSearchCheckbox = document.getElementById('showSurfaceSearchCheckbox');
showSurfaceSearchCheckbox.addEventListener('change', (e) => {
  showSurfaceSearch = e.target.checked;
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

render();
