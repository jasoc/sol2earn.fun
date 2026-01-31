const FULL_ANGLE = 2 * Math.PI;

const drawRoundObject = (position, radius, graph) => {
    graph.beginPath();
    graph.arc(position.x, position.y, radius, 0, FULL_ANGLE);
    graph.closePath();
    graph.fill();
    graph.stroke();
}

// Enhanced glow effect for objects
const addGlow = (graph, color, blur) => {
    graph.shadowColor = color;
    graph.shadowBlur = blur;
};

const clearGlow = (graph) => {
    graph.shadowColor = 'transparent';
    graph.shadowBlur = 0;
};

const drawFood = (position, food, graph) => {
    const hue = food.hue;
    graph.fillStyle = `hsl(${hue}, 100%, 60%)`;
    graph.strokeStyle = `hsl(${hue}, 100%, 45%)`;
    graph.lineWidth = 0;
    addGlow(graph, `hsl(${hue}, 100%, 50%)`, 8);
    drawRoundObject(position, food.radius, graph);
    clearGlow(graph);
};

const drawVirus = (position, virus, graph) => {
    // Draw spiky virus with glow
    graph.strokeStyle = virus.stroke;
    graph.fillStyle = virus.fill;
    graph.lineWidth = virus.strokeWidth;
    
    addGlow(graph, '#00ff00', 15);
    
    const sides = 20;
    const spikeLength = virus.radius * 0.15;
    
    graph.beginPath();
    for (let i = 0; i < sides; i++) {
        const theta = (i / sides) * FULL_ANGLE;
        const nextTheta = ((i + 1) / sides) * FULL_ANGLE;
        const midTheta = (theta + nextTheta) / 2;
        
        const innerPoint = circlePoint(position, virus.radius, theta);
        const spikePoint = circlePoint(position, virus.radius + spikeLength, midTheta);
        
        if (i === 0) {
            graph.moveTo(innerPoint.x, innerPoint.y);
        } else {
            graph.lineTo(innerPoint.x, innerPoint.y);
        }
        graph.lineTo(spikePoint.x, spikePoint.y);
    }
    graph.closePath();
    graph.stroke();
    graph.fill();
    clearGlow(graph);
};

const drawFireFood = (position, mass, playerConfig, graph) => {
    const hue = mass.hue;
    graph.strokeStyle = `hsl(${hue}, 100%, 40%)`;
    graph.fillStyle = `hsl(${hue}, 100%, 55%)`;
    graph.lineWidth = playerConfig.border;
    addGlow(graph, `hsl(${hue}, 100%, 50%)`, 10);
    drawRoundObject(position, mass.radius, graph);
    clearGlow(graph);
};

const valueInRange = (min, max, value) => Math.min(max, Math.max(min, value))

const circlePoint = (origo, radius, theta) => ({
    x: origo.x + radius * Math.cos(theta),
    y: origo.y + radius * Math.sin(theta)
});

const cellTouchingBorders = (cell, borders) =>
    cell.x - cell.radius <= borders.left ||
    cell.x + cell.radius >= borders.right ||
    cell.y - cell.radius <= borders.top ||
    cell.y + cell.radius >= borders.bottom

const regulatePoint = (point, borders) => ({
    x: valueInRange(borders.left, borders.right, point.x),
    y: valueInRange(borders.top, borders.bottom, point.y)
});

const drawCellWithLines = (cell, borders, graph) => {
    let pointCount = 30 + ~~(cell.mass / 5);
    let points = [];
    for (let theta = 0; theta < FULL_ANGLE; theta += FULL_ANGLE / pointCount) {
        let point = circlePoint(cell, cell.radius, theta);
        points.push(regulatePoint(point, borders));
    }
    graph.beginPath();
    graph.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
        graph.lineTo(points[i].x, points[i].y);
    }
    graph.closePath();
    graph.fill();
    graph.stroke();
}

const drawCells = (cells, playerConfig, toggleMassState, borders, graph) => {
    for (let cell of cells) {
        // Draw cell with gradient and glow effect
        const gradient = graph.createRadialGradient(
            cell.x - cell.radius * 0.3, cell.y - cell.radius * 0.3, 0,
            cell.x, cell.y, cell.radius
        );
        gradient.addColorStop(0, cell.color.replace('50%', '65%'));
        gradient.addColorStop(1, cell.color);
        
        graph.fillStyle = gradient;
        graph.strokeStyle = cell.borderColor;
        graph.lineWidth = Math.max(4, cell.radius * 0.05);
        
        // Add glow for larger cells
        if (cell.radius > 30) {
            addGlow(graph, cell.color.replace('100%', '70%'), cell.radius * 0.15);
        }
        
        if (cellTouchingBorders(cell, borders)) {
            drawCellWithLines(cell, borders, graph);
        } else {
            drawRoundObject(cell, cell.radius, graph);
        }
        clearGlow(graph);

        // Draw the name of the player
        let fontSize = Math.max(cell.radius / 3, 12);
        graph.lineWidth = playerConfig.textBorderSize;
        graph.fillStyle = playerConfig.textColor;
        graph.strokeStyle = playerConfig.textBorder;
        graph.miterLimit = 1;
        graph.lineJoin = 'round';
        graph.textAlign = 'center';
        graph.textBaseline = 'middle';
        graph.font = 'bold ' + fontSize + 'px Inter, sans-serif';
        graph.strokeText(cell.name, cell.x, cell.y);
        graph.fillText(cell.name, cell.x, cell.y);

        // Draw the mass (if enabled)
        if (toggleMassState === 1) {
            graph.font = 'bold ' + Math.max(fontSize / 3 * 2, 10) + 'px Inter, sans-serif';
            if (cell.name.length === 0) fontSize = 0;
            graph.strokeText(Math.round(cell.mass), cell.x, cell.y + fontSize);
            graph.fillText(Math.round(cell.mass), cell.x, cell.y + fontSize);
        }
    }
};

const drawGrid = (global, player, screen, graph) => {
    graph.lineWidth = 1;
    graph.strokeStyle = global.lineColor;
    graph.globalAlpha = 0.08;
    graph.beginPath();

    const gridSize = screen.height / 14;
    
    for (let x = -player.x % gridSize; x < screen.width; x += gridSize) {
        graph.moveTo(x, 0);
        graph.lineTo(x, screen.height);
    }

    for (let y = -player.y % gridSize; y < screen.height; y += gridSize) {
        graph.moveTo(0, y);
        graph.lineTo(screen.width, y);
    }

    graph.stroke();
    graph.globalAlpha = 1;
};

const drawBorder = (borders, graph) => {
    graph.lineWidth = 4;
    graph.strokeStyle = 'rgba(0, 255, 136, 0.6)';
    addGlow(graph, '#00ff88', 20);
    graph.beginPath();
    graph.moveTo(borders.left, borders.top);
    graph.lineTo(borders.right, borders.top);
    graph.lineTo(borders.right, borders.bottom);
    graph.lineTo(borders.left, borders.bottom);
    graph.closePath();
    graph.stroke();
    clearGlow(graph);
};

const drawErrorMessage = (message, graph, screen) => {
    // Dark gradient background
    const gradient = graph.createLinearGradient(0, 0, screen.width, screen.height);
    gradient.addColorStop(0, '#0a0a1a');
    gradient.addColorStop(1, '#1a1a3a');
    graph.fillStyle = gradient;
    graph.fillRect(0, 0, screen.width, screen.height);
    
    // Glowing text
    graph.textAlign = 'center';
    graph.textBaseline = 'middle';
    graph.font = 'bold 36px Inter, sans-serif';
    
    addGlow(graph, '#ff6b6b', 20);
    graph.fillStyle = '#ff6b6b';
    graph.fillText(message, screen.width / 2, screen.height / 2);
    clearGlow(graph);
}

module.exports = {
    drawFood,
    drawVirus,
    drawFireFood,
    drawCells,
    drawErrorMessage,
    drawGrid,
    drawBorder
};