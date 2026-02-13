# 3-Body Problem Simulation

Interactive browser-based simulation of gravitational 3-body dynamics with draggable bodies and scenario presets.

## Features

- Presets: **Stable Figure-8**, **Star System**, and **Random Chaos**.
- Real-time controls: pause/resume, single-step frame advance, reset.
- Runtime utilities: add random body, clear trails, recenter system on center of mass.
- Adjustable simulation speed with live status indicators.
- Live diagnostics panel with body count, total energy, momentum magnitude, and FPS.
- Click-and-drag throwing interaction for bodies.

## Run locally

Because this is a static app, any basic static server works:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000` in your browser.

## Deployed demo

https://ewre324.github.io/3-body-problem/
