# blendf

An interactive 2D implicit field blending visualizer running in the browser.

**Live Demo:** https://sasekazu.github.io/blendf/

**Repository:** https://github.com/sasekazu/blendf

## Overview

blendf visualizes how multiple 2D implicit fields (Gaussian or ellipsoid-based) are combined using various blending operators. You can drag the ellipses on the canvas and tweak parameters in real time to observe how the resulting field and its iso-contour change.

## Blending Methods

| Method | Description |
|---|---|
| **Gaussian Sum** | Sum of anisotropic Gaussian kernels |
| **Ellipsoid Log-Sum-Exp** | Smooth approximation of the minimum via Log-Sum-Exp |

## Usage

Open `index.html` directly in a browser, or visit the GitHub Pages link above.

- **Drag** an ellipse to reposition it.
- Select a **Field Type** from the radio buttons.
- Adjust blending parameters (k, s) with the sliders.

## Files

| File | Role |
|---|---|
| `index.html` | UI layout and controls |
| `style.css` | Styling |
| `main.js` | Canvas rendering and mouse interaction |
| `renderer.js` | Heatmap and contour drawing |
| `field-math.js` | Mathematical field functions |

## License

See [LICENSE](LICENSE).
