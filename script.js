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
let paused = false;
let drawTrails = true;
let timeScale = 1;
let trailLength = DEFAULT_TRAIL_LENGTH;
let previousTimestamp = performance.now();
let fps = 0;

class Body {
    constructor(x, y, vx, vy, mass, color) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.mass = mass;
        this.color = color;
        this.radius = Math.max(4, Math.sqrt(this.mass) * 1.5);
        this.history = [];
    }

    update(dt) {
        if (this === draggedBody) return;
        this.x += this.vx * dt;
        this.y += this.vy * dt;
    }

    recordHistory() {
        if (!drawTrails) return;
        this.history.push({ x: this.x, y: this.y });
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

        for (let j = 0; j < bodies.length; j++) {
            if (i === j) continue;
            const dx = bodies[j].x - bodies[i].x;
            const dy = bodies[j].y - bodies[i].y;
            const distSq = dx * dx + dy * dy;
            const dist = Math.sqrt(distSq) + 1e-6;
            const f = (G * bodies[i].mass * bodies[j].mass) / (distSq + SOFTENING);
            fx += f * (dx / dist);
            fy += f * (dy / dist);
        }

        bodies[i].vx += (fx / bodies[i].mass) * dt;
        bodies[i].vy += (fy / bodies[i].mass) * dt;
    }
}

function physicsStep(multiplier = 1) {
    const dt = (0.5 * timeScale * multiplier) / PHYSICS_SUBSTEPS;
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
        kinetic += 0.5 * b.mass * (b.vx * b.vx + b.vy * b.vy);
        for (let j = i + 1; j < bodies.length; j++) {
            const other = bodies[j];
            const dx = other.x - b.x;
            const dy = other.y - b.y;
            const dist = Math.sqrt(dx * dx + dy * dy + SOFTENING);
            potential -= (G * b.mass * other.mass) / dist;
        }
    }

    return kinetic + potential;
}

function totalMomentumMagnitude() {
    let px = 0;
    let py = 0;
    for (const body of bodies) {
        px += body.mass * body.vx;
        py += body.mass * body.vy;
    }
    return Math.sqrt(px * px + py * py);
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
    if (type) select.value = type;
    else type = select.value;

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
        bodies.push(new Body(cx, cy, 0, 0, 1000, '#ffcc00'));
        bodies.push(new Body(cx + 200, cy, 0, 2.2, 50, '#00ccff'));
        bodies.push(new Body(cx + 350, cy, 0, 1.6, 80, '#ff5555'));
        bodies.push(new Body(cx - 400, cy - 100, 1.0, -0.5, 20, '#ffffff'));
    } else {
        for (let i = 0; i < 4; i++) {
            addRandomBody();
        }
    }

    updateStats();
}

function addRandomBody() {
    const m = Math.random() * 90 + 30;
    const x = cx + (Math.random() - 0.5) * 420;
    const y = cy + (Math.random() - 0.5) * 320;
    const vx = (Math.random() - 0.5) * 2.6;
    const vy = (Math.random() - 0.5) * 2.6;
    bodies.push(new Body(x, y, vx, vy, m, randomColor()));
    updateStats();
}

function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

canvas.addEventListener('mousedown', (e) => {
    const m = getMousePos(e);
    for (const body of bodies) {
        const dx = m.x - body.x;
        const dy = m.y - body.y;
        if (dx * dx + dy * dy < (body.radius + 10) ** 2) {
            draggedBody = body;
            body.vx = 0;
            body.vy = 0;
            dragOffset.x = body.x - m.x;
            dragOffset.y = body.y - m.y;
            break;
        }
    }
});

canvas.addEventListener('mousemove', (e) => {
    if (!draggedBody) return;
    const m = getMousePos(e);
    const newX = m.x + dragOffset.x;
    const newY = m.y + dragOffset.y;

    draggedBody.vx = (newX - draggedBody.x) * 0.5;
    draggedBody.vy = (newY - draggedBody.y) * 0.5;
    draggedBody.x = newX;
    draggedBody.y = newY;
});

window.addEventListener('mouseup', () => {
    draggedBody = null;
});

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
    fps = 1000 / Math.max(16, now - previousTimestamp);
    previousTimestamp = now;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.fillRect(0, 0, width, height);

    if (!paused) {
        physicsStep();
    }

    for (const body of bodies) body.draw();
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
    physicsStep();
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
