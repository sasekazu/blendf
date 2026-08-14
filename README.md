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

Open `index.html` directly in a browser, or visit the GitHub Pages link above. It's a top page linking to the visualizations; the main one is `step-by-step.html`.

- **Drag** an ellipse to reposition it.
- Select a **Field Type** from the radio buttons.
- Adjust blending parameters (k, s) with the sliders.

## Files

| File | Role |
|---|---|
| `index.html` | Top page, links to the visualization pages |
| `step-by-step.html` | Step by Step Visualization UI layout and controls |
| `main.js` | Step by Step: canvas rendering and interaction |
| `renderer.js` | Step by Step: heatmap and contour drawing |
| `mouse-interaction.html` | Mouse Interaction UI layout and controls |
| `mouse-interaction.js` | Mouse Interaction: canvas rendering and interaction |
| `style.css` | Shared styling |
| `field-math.js` | Shared mathematical field functions |

## License

See [LICENSE](LICENSE).
