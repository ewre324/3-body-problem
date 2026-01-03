const canvas = document.getElementById('simCanvas');
const ctx = canvas.getContext('2d');

let width, height;
let cx, cy;

// Handle window resizing
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

// --- Configuration ---
const G = 1.0; 
const PHYSICS_SUBSTEPS = 10; // More steps = higher precision
const TRAIL_LENGTH = 150;

// State
let bodies = [];
let animationId;
let draggedBody = null;
let dragOffset = { x: 0, y: 0 };

class Body {
    constructor(x, y, vx, vy, mass, color) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.mass = mass;
        this.color = color;
        this.radius = Math.sqrt(this.mass) * 1.5; // Radius based on mass
        this.history = [];
    }

    update(dt) {
        // If being dragged, don't update physics position
        if (this === draggedBody) return;

        this.x += this.vx * dt;
        this.y += this.vy * dt;
    }

    recordHistory() {
        // Only record history every few frames to save performance
        this.history.push({ x: this.x, y: this.y });
        if (this.history.length > TRAIL_LENGTH) {
            this.history.shift();
        }
    }

    draw() {
        // Draw Trail
        if (this.history.length > 1) {
            ctx.beginPath();
            ctx.strokeStyle = this.color;
            ctx.lineWidth = 2;
            ctx.globalAlpha = 0.5; // Transparent trails
            for (let i = 0; i < this.history.length - 1; i++) {
                ctx.moveTo(this.history[i].x, this.history[i].y);
                ctx.lineTo(this.history[i+1].x, this.history[i+1].y);
            }
            ctx.stroke();
            ctx.globalAlpha = 1.0;
        }

        // Draw Body
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        
        // Glow effect
        ctx.shadowBlur = 15;
        ctx.shadowColor = this.color;
        
        ctx.fill();
        ctx.shadowBlur = 0; // Reset shadow
        ctx.closePath();
    }
}

// --- Physics Engine ---

function calculateForces(dt) {
    for (let i = 0; i < bodies.length; i++) {
        // Dragged bodies don't react to forces (you are the god force)
        if (bodies[i] === draggedBody) continue;

        let fx = 0;
        let fy = 0;

        for (let j = 0; j < bodies.length; j++) {
            if (i === j) continue;

            const dx = bodies[j].x - bodies[i].x;
            const dy = bodies[j].y - bodies[i].y;
            const distSq = dx * dx + dy * dy;
            const dist = Math.sqrt(distSq);

            // Softening prevents division by zero/extreme forces on collision
            const softening = 100; 
            const f = (G * bodies[i].mass * bodies[j].mass) / (distSq + softening);

            fx += f * (dx / dist);
            fy += f * (dy / dist);
        }

        bodies[i].vx += (fx / bodies[i].mass) * dt;
        bodies[i].vy += (fy / bodies[i].mass) * dt;
    }
}

function physicsStep() {
    // We break 1 frame of time (approx 16ms) into smaller chunks
    // This keeps the Figure-8 stable.
    const dt = 0.5 / PHYSICS_SUBSTEPS; 

    for (let s = 0; s < PHYSICS_SUBSTEPS; s++) {
        calculateForces(dt);
        for (let b of bodies) {
            b.update(dt);
        }
    }

    for (let b of bodies) {
        b.recordHistory();
    }
}

// --- Scenarios ---

function initScenario(type) {
    bodies = [];
    const select = document.getElementById('scenarioSelect');
    if(type) select.value = type;
    else type = select.value;

    if (type === 'figure8') {
        // Famous stable "Figure-8" solution (Chenciner & Montgomery)
        // Scaled for visual fit on screen
        const scalePos = 150;
        const scaleVel = 1.2;
        
        const p1 = { x: 0.97000436 * scalePos, y: -0.24308753 * scalePos };
        const v3 = { x: 0.93247281 * scaleVel, y: 0.86473146 * scaleVel };
        const v1 = { x: -v3.x / 2, y: -v3.y / 2 };

        // Mass must be equal for this solution
        const m = 100; 

        bodies.push(new Body(cx + p1.x, cy + p1.y, v1.x, v1.y, m, '#ff0055'));
        bodies.push(new Body(cx - p1.x, cy - p1.y, v1.x, v1.y, m, '#00ccff'));
        bodies.push(new Body(cx, cy, v3.x, v3.y, m, '#ccff00'));
    
    } else if (type === 'starSystem') {
        // Sun
        bodies.push(new Body(cx, cy, 0, 0, 1000, '#ffcc00')); // Huge mass, stationary
        
        // Planet 1
        bodies.push(new Body(cx + 200, cy, 0, 2.2, 50, '#00ccff'));
        
        // Planet 2
        bodies.push(new Body(cx + 350, cy, 0, 1.6, 80, '#ff5555'));
        
        // Comet (irregular)
        bodies.push(new Body(cx - 400, cy - 100, 1.0, -0.5, 20, '#ffffff'));

    } else {
        // Chaos / Random
        for (let i = 0; i < 3; i++) {
            const m = Math.random() * 100 + 50;
            const x = cx + (Math.random() - 0.5) * 400;
            const y = cy + (Math.random() - 0.5) * 400;
            const vx = (Math.random() - 0.5) * 2;
            const vy = (Math.random() - 0.5) * 2;
            const color = `hsl(${Math.random() * 360}, 100%, 70%)`;
            bodies.push(new Body(x, y, vx, vy, m, color));
        }
    }
}

// --- Interaction ---

function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
    };
}

canvas.addEventListener('mousedown', (e) => {
    const m = getMousePos(e);
    for (let b of bodies) {
        const dx = m.x - b.x;
        const dy = m.y - b.y;
        if (dx*dx + dy*dy < (b.radius + 10)**2) { // Click tolerance
            draggedBody = b;
            // Stop velocity while dragging
            b.vx = 0; 
            b.vy = 0;
            dragOffset.x = b.x - m.x;
            dragOffset.y = b.y - m.y;
            break;
        }
    }
});

canvas.addEventListener('mousemove', (e) => {
    if (draggedBody) {
        const m = getMousePos(e);
        // Simple "throw" mechanic: calculate velocity based on movement
        // We update velocity here just so if you let go, it has momentum
        const newX = m.x + dragOffset.x;
        const newY = m.y + dragOffset.y;
        
        draggedBody.vx = (newX - draggedBody.x) * 0.5; // Sensitivity
        draggedBody.vy = (newY - draggedBody.y) * 0.5;
        
        draggedBody.x = newX;
        draggedBody.y = newY;
    }
});

window.addEventListener('mouseup', () => {
    draggedBody = null;
});

// --- Main Loop ---

function animate() {
    // Clear with trail fade effect
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fillRect(0, 0, width, height);

    physicsStep();

    for (let b of bodies) {
        b.draw();
    }

    animationId = requestAnimationFrame(animate);
}

// Global functions for HTML access
window.resetSim = () => initScenario(null);
window.changeScenario = () => initScenario(null);

// Start
initScenario('figure8');
animate();
