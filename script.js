const canvas = document.getElementById('simCanvas');
const ctx = canvas.getContext('2d');

let width;
let height;
let cx;
let cy;

function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
    cx = width / 2;
    cy = height / 2;
}
window.addEventListener('resize', resize);
resize();

const G = 1.0;
const PHYSICS_SUBSTEPS = 10;
const DEFAULT_TRAIL_LENGTH = 180;
const SOFTENING = 120;

let bodies = [];
let animationId;
let draggedBody = null;
let dragOffset = { x: 0, y: 0 };
let dragHistory = [];
let paused = false;
let drawTrails = true;
let timeScale = 1;
let trailLength = DEFAULT_TRAIL_LENGTH;
let previousTimestamp = performance.now();
let fps = 0;
let viewMode = '2d'; // '2d' or '3d'
let camera = {
    x: 0,
    y: 0,
    z: 0,
    angleX: 0.3,
    angleY: 0.3,
    distance: 1000,
    zoom: 1
};

class Body {
    constructor(x, y, vx, vy, mass, color, z = 0, vz = 0) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.vx = vx;
        this.vy = vy;
        this.vz = vz;
        this.mass = mass;
        this.color = color;
        this.radius = Math.max(4, Math.sqrt(this.mass) * 1.5);
        this.history = [];
    }

    update(dt) {
        if (this === draggedBody) return;
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.z += this.vz * dt;
    }

    recordHistory() {
        if (!drawTrails) return;
        this.history.push({ x: this.x, y: this.y, z: this.z });
        if (this.history.length > trailLength) this.history.shift();
    }

    draw() {
        if (drawTrails && this.history.length > 1) {
            ctx.beginPath();
            ctx.strokeStyle = this.color;
            ctx.lineWidth = 1.8;
            ctx.globalAlpha = 0.45;
            ctx.moveTo(this.history[0].x, this.history[0].y);
            for (let i = 1; i < this.history.length; i++) {
                ctx.lineTo(this.history[i].x, this.history[i].y);
            }
            ctx.stroke();
            ctx.globalAlpha = 1;
        }

        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.shadowBlur = 14;
        ctx.shadowColor = this.color;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.closePath();
    }

    draw3D(projected) {
        // Projected contains {x, y, scale}
        const r = this.radius * projected.scale;

        // Simple trail in 3D (projected)
        if (drawTrails && this.history.length > 1) {
            ctx.beginPath();
            ctx.strokeStyle = this.color;
            ctx.lineWidth = 1.8 * projected.scale;
            ctx.globalAlpha = 0.45;

            // We need to project history points. This is expensive, so maybe skip or simplify.
            // For now, let's just not draw trails in 3D or draw them simply.
            // Let's try projecting the last few points.
            let started = false;
            // Iterate backwards
            const historyLimit = 20; // limit trail complexity in 3D
            const step = Math.ceil(this.history.length / historyLimit) || 1;

            for (let i = 0; i < this.history.length; i+=step) {
                const p = project(this.history[i].x, this.history[i].y, this.history[i].z);
                if (p.scale <= 0) continue; // Behind camera

                if (!started) {
                    ctx.moveTo(p.x, p.y);
                    started = true;
                } else {
                    ctx.lineTo(p.x, p.y);
                }
            }
            // Connect to current pos
            ctx.lineTo(projected.x, projected.y);

            ctx.stroke();
            ctx.globalAlpha = 1;
        }

        ctx.beginPath();
        ctx.arc(projected.x, projected.y, Math.max(0.5, r), 0, Math.PI * 2);
        ctx.fillStyle = this.color;

        // Fake lighting/shading
        const grad = ctx.createRadialGradient(
            projected.x - r*0.3, projected.y - r*0.3, r * 0.2,
            projected.x, projected.y, r
        );
        grad.addColorStop(0, '#fff');
        grad.addColorStop(1, this.color);
        ctx.fillStyle = grad;

        ctx.fill();
        ctx.closePath();
    }
}

function project(x, y, z) {
    // Relative to center of mass or origin? Let's use origin (cx, cy) as 0,0,0 reference
    // But bodies use screen coords (cx + ...).
    // Let's shift so (cx, cy) is origin.
    const wx = x - cx;
    const wy = y - cy;
    const wz = z;

    // Rotate Y (Yaw)
    const cosY = Math.cos(camera.angleY);
    const sinY = Math.sin(camera.angleY);
    const x1 = wx * cosY - wz * sinY;
    const z1 = wz * cosY + wx * sinY;

    // Rotate X (Pitch)
    const cosX = Math.cos(camera.angleX);
    const sinX = Math.sin(camera.angleX);
    const y2 = wy * cosX - z1 * sinX;
    const z2 = z1 * cosX + wy * sinX;

    // Perspective
    // Camera looks at 0,0,0 from distance
    // Let's assume camera is at [0, 0, camera.distance] relative to rotated world
    const dist = camera.distance;
    const scale = dist / (dist - z2);

    // If behind camera
    if (dist - z2 <= 0) return { x: 0, y: 0, scale: -1, z: z2 };

    const sx = x1 * scale + cx;
    const sy = y2 * scale + cy;

    return { x: sx, y: sy, scale: scale, z: z2 };
}

function randomColor() {
    return `hsl(${Math.random() * 360}, 95%, 72%)`;
}

function clearTrails() {
    for (const body of bodies) body.history = [];
}

function calculateForces(dt) {
    for (let i = 0; i < bodies.length; i++) {
        if (bodies[i] === draggedBody) continue;

        let fx = 0;
        let fy = 0;
        let fz = 0;

        for (let j = 0; j < bodies.length; j++) {
            if (i === j) continue;
            const dx = bodies[j].x - bodies[i].x;
            const dy = bodies[j].y - bodies[i].y;
            const dz = bodies[j].z - bodies[i].z;
            const distSq = dx * dx + dy * dy + dz * dz;

            // Corrected softening logic
            const softenedDistSq = distSq + SOFTENING;
            const dist = Math.sqrt(softenedDistSq);
            const f = (G * bodies[i].mass * bodies[j].mass) / softenedDistSq;

            fx += f * (dx / dist);
            fy += f * (dy / dist);
            fz += f * (dz / dist);
        }

        bodies[i].vx += (fx / bodies[i].mass) * dt;
        bodies[i].vy += (fy / bodies[i].mass) * dt;
        bodies[i].vz += (fz / bodies[i].mass) * dt;
    }
}

function physicsStep(totalDt) {
    const dt = totalDt / PHYSICS_SUBSTEPS;
    for (let s = 0; s < PHYSICS_SUBSTEPS; s++) {
        calculateForces(dt);
        for (const body of bodies) body.update(dt);
    }

    for (const body of bodies) body.recordHistory();
}

function totalEnergy() {
    let kinetic = 0;
    let potential = 0;

    for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i];
        kinetic += 0.5 * b.mass * (b.vx * b.vx + b.vy * b.vy + b.vz * b.vz);
        for (let j = i + 1; j < bodies.length; j++) {
            const other = bodies[j];
            const dx = other.x - b.x;
            const dy = other.y - b.y;
            const dz = other.z - b.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz + SOFTENING);
            potential -= (G * b.mass * other.mass) / dist;
        }
    }

    return kinetic + potential;
}

function totalMomentumMagnitude() {
    let px = 0;
    let py = 0;
    let pz = 0;
    for (const body of bodies) {
        px += body.mass * body.vx;
        py += body.mass * body.vy;
        pz += body.mass * body.vz;
    }
    return Math.sqrt(px * px + py * py + pz * pz);
}

function centerOfMass() {
    let totalMass = 0;
    let x = 0;
    let y = 0;
    for (const body of bodies) {
        totalMass += body.mass;
        x += body.x * body.mass;
        y += body.y * body.mass;
    }

    if (totalMass === 0) return { x: cx, y: cy };
    return { x: x / totalMass, y: y / totalMass };
}

function centerSystem() {
    const com = centerOfMass();
    const dx = cx - com.x;
    const dy = cy - com.y;
    for (const body of bodies) {
        body.x += dx;
        body.y += dy;
    }
    clearTrails();
}

function initScenario(type) {
    bodies = [];
    const select = document.getElementById('scenarioSelect');
    if (type) {
        select.value = type;
    } else {
        type = select.value;
    }

    if (type === 'figure8') {
        const scalePos = 150;
        const scaleVel = 1.2;

        const p1 = { x: 0.97000436 * scalePos, y: -0.24308753 * scalePos };
        const v3 = { x: 0.93247281 * scaleVel, y: 0.86473146 * scaleVel };
        const v1 = { x: -v3.x / 2, y: -v3.y / 2 };
        const m = 100;

        bodies.push(new Body(cx + p1.x, cy + p1.y, v1.x, v1.y, m, '#ff0055'));
        bodies.push(new Body(cx - p1.x, cy - p1.y, v1.x, v1.y, m, '#00ccff'));
        bodies.push(new Body(cx, cy, v3.x, v3.y, m, '#ccff00'));
    } else if (type === 'starSystem') {
        // Add a slight tilt in 3D for star system to look cool
        bodies.push(new Body(cx, cy, 0, 0, 1000, '#ffcc00'));
        bodies.push(new Body(cx + 200, cy, 0, 2.2, 50, '#00ccff', 0, 0.2));
        bodies.push(new Body(cx + 350, cy, 0, 1.6, 80, '#ff5555', 0, -0.1));
        bodies.push(new Body(cx - 400, cy - 100, 1.0, -0.5, 20, '#ffffff', 50, 0));
    } else {
        for (let i = 0; i < 4; i++) {
            addRandomBody(false);
        }
    }

    updateStats();
}

function addRandomBody(shouldUpdate = true) {
    const m = Math.random() * 90 + 30;
    const x = cx + (Math.random() - 0.5) * 420;
    const y = cy + (Math.random() - 0.5) * 320;
    let z = 0;

    const vx = (Math.random() - 0.5) * 2.6;
    const vy = (Math.random() - 0.5) * 2.6;
    let vz = 0;

    if (viewMode === '3d') {
        z = (Math.random() - 0.5) * 320;
        vz = (Math.random() - 0.5) * 2.6;
    }

    bodies.push(new Body(x, y, vx, vy, m, randomColor(), z, vz));
    if (shouldUpdate) updateStats();
}

function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

let isDraggingCamera = false;
let lastMousePos = { x: 0, y: 0 };

canvas.addEventListener('mousedown', (e) => {
    const m = getMousePos(e);
    if (viewMode === '2d') {
        for (const body of bodies) {
            const dx = m.x - body.x;
            const dy = m.y - body.y;
            if (dx * dx + dy * dy < (body.radius + 10) ** 2) {
                draggedBody = body;
                body.vx = 0;
                body.vy = 0;
                dragOffset.x = body.x - m.x;
                dragOffset.y = body.y - m.y;
                dragHistory = [];
                break;
            }
        }
    } else {
        // 3D Mode: Start camera drag
        isDraggingCamera = true;
        lastMousePos = m;
    }
});

canvas.addEventListener('mousemove', (e) => {
    const m = getMousePos(e);

    if (viewMode === '2d') {
        if (!draggedBody) return;
        const newX = m.x + dragOffset.x;
        const newY = m.y + dragOffset.y;

        draggedBody.x = newX;
        draggedBody.y = newY;

        // Record history for throwing
        const now = performance.now();
        dragHistory.push({ x: newX, y: newY, t: now });
        // Keep last 150ms
        while (dragHistory.length > 0 && now - dragHistory[0].t > 150) {
            dragHistory.shift();
        }
    } else {
        // 3D Mode
        if (isDraggingCamera) {
            const dx = m.x - lastMousePos.x;
            const dy = m.y - lastMousePos.y;

            camera.angleY += dx * 0.01;
            camera.angleX += dy * 0.01;

            // Clamp X angle to avoid flipping
            camera.angleX = Math.max(-Math.PI/2 + 0.1, Math.min(Math.PI/2 - 0.1, camera.angleX));

            lastMousePos = m;
        }
    }
});

window.addEventListener('mouseup', () => {
    if (viewMode === '2d') {
        if (draggedBody && dragHistory.length >= 2) {
            const first = dragHistory[0];
            const last = dragHistory[dragHistory.length - 1];
            const dtReal = (last.t - first.t) / 1000;

            if (dtReal > 0.02) {
                // Adjust velocity to simulation speed units
                // Simulation time = real time * SIM_SPEED
                // Velocity = dx / dt_sim = dx / (dt_real * SIM_SPEED)
                const SIM_SPEED = 30;
                draggedBody.vx = (last.x - first.x) / (dtReal * SIM_SPEED);
                draggedBody.vy = (last.y - first.y) / (dtReal * SIM_SPEED);
            }
        }
        draggedBody = null;
        dragHistory = [];
    } else {
        isDraggingCamera = false;
    }
});

canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomSpeed = 0.001 * camera.distance;
    camera.distance += e.deltaY * zoomSpeed;
    camera.distance = Math.max(100, Math.min(5000, camera.distance));
}, { passive: false });

window.toggleViewMode = () => {
    const select = document.getElementById('viewModeSelect');
    viewMode = select.value;

    const hint = document.getElementById('interactionHint');
    if (viewMode === '3d') {
        hint.textContent = 'Tip: Drag to rotate camera. Scroll to zoom.';
    } else {
        hint.textContent = 'Tip: Click & drag bodies to throw them.';
        // Reset rotation? No, keep it.
        // Maybe reset scenario z?
    }
};

function updateStats() {
    document.getElementById('statusText').textContent = paused ? 'Paused' : 'Running';
    document.getElementById('bodyCount').textContent = String(bodies.length);
    document.getElementById('energyValue').textContent = totalEnergy().toFixed(2);
    document.getElementById('momentumValue').textContent = totalMomentumMagnitude().toFixed(2);
    document.getElementById('fpsValue').textContent = fps.toFixed(0);
    document.getElementById('speedLabel').textContent = `${timeScale.toFixed(2)}x`;
    document.getElementById('pauseBtn').textContent = paused ? 'Resume' : 'Pause';
}

function animate(now = performance.now()) {
    const frameDtMs = now - previousTimestamp;
    fps = 1000 / (frameDtMs || 16);
    previousTimestamp = now;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.fillRect(0, 0, width, height);

    if (!paused) {
        // Base speed: 30 simulation units per real second
        const SIM_SPEED = 30;
        let dt = frameDtMs / 1000;
        dt = Math.min(dt, 0.1); // Clamp dt to max 100ms to avoid explosion

        physicsStep(dt * SIM_SPEED * timeScale);
    }

    if (viewMode === '2d') {
        for (const body of bodies) body.draw();
    } else {
        // 3D Draw
        // 1. Project all bodies
        const projectedBodies = bodies.map(b => {
            const p = project(b.x, b.y, b.z);
            return { body: b, p: p };
        });

        // 2. Sort by Z depth (furthest first)
        // z2 is the transformed Z. Larger Z is closer to camera in our logic?
        // Wait, z2 = z1 * cosX + ...
        // scale = dist / (dist - z2).
        // If z2 is positive and large, it approaches dist.
        // So larger z2 is closer to camera.
        // Painter's algo: draw furthest (smallest z2) first.
        projectedBodies.sort((a, b) => a.p.z - b.p.z);

        // 3. Draw
        for (const item of projectedBodies) {
            if (item.p.scale > 0) {
                item.body.draw3D(item.p);
            }
        }
    }
    updateStats();

    animationId = requestAnimationFrame(animate);
}

window.resetSim = () => initScenario(null);
window.changeScenario = () => initScenario(null);
window.togglePause = () => {
    paused = !paused;
    updateStats();
};
window.stepFrame = () => {
    if (!paused) paused = true;
    // Step by a fixed amount (equivalent to 1/60th of a second at 1x speed)
    physicsStep(0.5);
    updateStats();
};
window.setTimeScale = (value) => {
    timeScale = Number(value);
    updateStats();
};
window.addRandomBody = addRandomBody;
window.clearTrails = clearTrails;
window.centerSystem = centerSystem;
window.toggleTrails = (enabled) => {
    drawTrails = enabled;
    if (!enabled) clearTrails();
};

initScenario('figure8');
animate();
