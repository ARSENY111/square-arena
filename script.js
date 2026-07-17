const canvas = document.getElementById('squareCanvas');
const ctx = canvas.getContext('2d');
const shootBtn = document.getElementById('shootBtn');
const winnerDisplay = document.getElementById('winner-display');

const balanceValueEl = document.getElementById('balance-value');
const currentBetValueEl = document.getElementById('current-bet-value');
const betMinusBtn = document.getElementById('bet-minus');
const betPlusBtn = document.getElementById('bet-plus');
const playersListEl = document.getElementById('players-list');
const usernameTagEl = document.getElementById('username-tag');

const size = canvas.width; 
const center = size / 2;
const borderWidth = 6; // Сделаем рамку тоньше, так как красим само поле

const SERVER_URL = "ws://localhost:8000/ws"; 
let socket;

// === ТЕСТОВЫЙ БАЛАНС И СТАВКА ===
let balance = parseInt(localStorage.getItem('arena_balance')) || 1000;
let currentBet = 100;

function updateUIBalance() {
    balanceValueEl.textContent = balance;
    localStorage.setItem('arena_balance', balance);
}
updateUIBalance();

betMinusBtn.addEventListener('click', () => {
    if (currentBet > 25) {
        currentBet -= 25;
        currentBetValueEl.textContent = currentBet;
    }
});

betPlusBtn.addEventListener('click', () => {
    if (currentBet + 25 <= balance) {
        currentBet += 25;
        currentBetValueEl.textContent = currentBet;
    }
});

let myTelegramId = 99999; 
let myUsername = "Игрок";

if (window.Telegram && window.Telegram.WebApp) {
    const tg = window.Telegram.WebApp;
    tg.ready();
    tg.expand();
    
    if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
        myTelegramId = tg.initDataUnsafe.user.id;
        myUsername = tg.initDataUnsafe.user.first_name || "Игрок";
    }
    usernameTagEl.textContent = `🎮 ${myUsername}`;
}

// === ФИЗИКА ИГРЫ ===
let players = [];
let ball = { 
    x: center, 
    y: center, 
    vx: 0, 
    vy: 0, 
    radius: 12, 
    friction: 0.9943, 
    active: false 
};

function connectWebSocket() {
    socket = new WebSocket(SERVER_URL);

    socket.onopen = () => {
        winnerDisplay.textContent = "Подключено! Сделайте ставку.";
        shootBtn.textContent = "ПОСТАВИТЬ СТАВКУ";
        shootBtn.disabled = false;
    };

    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);

        switch (data.type) {
            case "init":
                updatePlayersList(data.game_state.players);
                break;

            case "players_update":
                updatePlayersList(data.players);
                break;

            case "start_spin":
                launchBallFromServer(data.angle, data.players);
                break;

            case "reset":
                winnerDisplay.textContent = data.reason || "Игра сброшена";
                shootBtn.disabled = false;
                resetBall();
                break;
                
            case "game_over":
                setTimeout(() => {
                    winnerDisplay.textContent = "Ожидание ставок...";
                    shootBtn.disabled = false;
                    resetBall();
                }, 4000);
                break;
        }
    };

    socket.onclose = () => {
        winnerDisplay.textContent = "🔌 Переподключение к серверу...";
        shootBtn.disabled = true;
        setTimeout(connectWebSocket, 3000);
    };
}

function updatePlayersList(serverPlayers) {
    const playerArray = Object.values(serverPlayers);
    
    if (playerArray.length === 0) {
        players = [];
        playersListEl.innerHTML = '<div class="empty-lobby-text">Лобби пусто. Сделайте ставку первым!</div>';
        drawArena();
        return;
    }

    const totalBets = playerArray.reduce((sum, p) => sum + p.bet, 0);
    
    players = playerArray.map(p => ({
        id: p.id || p.name,
        name: p.name,
        bet: p.bet,
        share: p.bet / totalBets,
        color: p.color
    }));

    playersListEl.innerHTML = "";
    players.forEach(p => {
        const percent = Math.round(p.share * 100);
        const row = document.createElement('div');
        row.className = "player-row";
        row.style.borderLeftColor = p.color;

        row.innerHTML = `
            <div class="player-name-wrapper">
                <span class="player-color-indicator" style="background-color: ${p.color};"></span>
                <span class="player-name">${p.name}</span>
            </div>
            <div class="player-stats">
                <span class="player-bet">🪙 ${p.bet}</span>
                <span class="player-chance">${percent}%</span>
            </div>
        `;
        playersListEl.appendChild(row);
    });

    drawArena();
}

const totalPerimeter = size * 4;

// Находим координаты точки на периметре квадрата
function getPointOnPerimeter(distance) {
    distance = distance % totalPerimeter;
    if (distance < size) {
        return { x: distance, y: 0 };
    } else if (distance < size * 2) {
        return { x: size, y: distance - size };
    } else if (distance < size * 3) {
        return { x: size - (distance - size * 2), y: size };
    } else {
        return { x: 0, y: size - (distance - size * 3) };
    }
}

// НОВАЯ ОТРИСОВКА: Красим само поле секторами
function drawArena() {
    ctx.clearRect(0, 0, size, size);
    
    if (players.length === 0) {
        // Если игроков нет, поле просто темно-серое
        ctx.fillStyle = "#11161d";
        ctx.fillRect(0, 0, size, size);
        
        ctx.strokeStyle = "#232d3b";
        ctx.lineWidth = borderWidth;
        ctx.strokeRect(0, 0, size, size);
        return;
    }

    let currentDist = 0;
    players.forEach(player => {
        const playerLength = player.share * totalPerimeter;
        const steps = 60; // Количество сегментов для скругления углов внутри сектора
        
        ctx.beginPath();
        // Начинаем отрисовку из центра квадрата
        ctx.moveTo(center, center);

        // Рисуем внешнюю линию по периметру квадрата для этого игрока
        for (let i = 0; i <= steps; i++) {
            let pt = getPointOnPerimeter(currentDist + (playerLength * (i / steps)));
            ctx.lineTo(pt.x, pt.y);
        }

        // Замыкаем сектор обратно в центр
        ctx.closePath();

        // Заливаем сектор полупрозрачным цветом игрока
        ctx.fillStyle = hexToRgba(player.color, 0.25);
        ctx.fill();

        // Рисуем яркую разделительную линию на стыке секторов
        ctx.strokeStyle = player.color;
        ctx.lineWidth = 2;
        ctx.stroke();

        currentDist += playerLength;
    });

    // Рисуем аккуратную внешнюю рамку поверх всего поля
    ctx.strokeStyle = "#232d3b";
    ctx.lineWidth = borderWidth;
    ctx.strokeRect(0, 0, size, size);
}

// Утилита для конвертации HEX цветов в RGBA (чтобы залить поле полупрозрачным)
function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function drawBall() {
    ctx.save();
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
    
    ctx.shadowBlur = 15;
    ctx.shadowColor = "#ffffff";
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.restore();
}

function getWinnerAtPoint(x, y) {
    let dist = 0;
    const dTop = y;
    const dBottom = size - y;
    const dLeft = x;
    const dRight = size - x;
    const minDist = Math.min(dTop, dBottom, dLeft, dRight);

    if (minDist === dTop) dist = x;
    else if (minDist === dRight) dist = size + y;
    else if (minDist === dBottom) dist = size * 3 - x;
    else if (minDist === dLeft) dist = size * 4 - y;

    let accumulated = 0;
    for (let player of players) {
        accumulated += player.share * totalPerimeter;
        if (dist <= accumulated) {
            return player;
        }
    }
    return players[players.length - 1];
}

function updatePhysics() {
    if (!ball.active) return;

    ball.vx *= ball.friction;
    ball.vy *= ball.friction;

    ball.x += ball.vx;
    ball.y += ball.vy;

    const minCoord = borderWidth / 2 + ball.radius;
    const maxCoord = size - borderWidth / 2 - ball.radius;

    if (ball.x <= minCoord) { ball.x = minCoord; ball.vx = -ball.vx; }
    else if (ball.x >= maxCoord) { ball.x = maxCoord; ball.vx = -ball.vx; }

    if (ball.y <= minCoord) { ball.y = minCoord; ball.vy = -ball.vy; }
    else if (ball.y >= maxCoord) { ball.y = maxCoord; ball.vy = -ball.vy; }

    const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
    if (speed < 0.15) {
        ball.active = false;
        ball.vx = 0;
        ball.vy = 0;

        const winner = getWinnerAtPoint(ball.x, ball.y);
        winnerDisplay.textContent = `🏆 ПОБЕДА: ${winner.name}!`;

        if (winner.name === myUsername) {
            const totalBank = players.reduce((sum, p) => sum + p.bet, 0);
            balance += totalBank;
            updateUIBalance();
            winnerDisplay.textContent += ` (+🪙${totalBank})`;
        }
    }
}

function gameLoop() {
    ctx.clearRect(0, 0, size, size);
    drawArena();
    drawBall();
    updatePhysics();

    if (ball.active) {
        requestAnimationFrame(gameLoop);
    }
}

function launchBallFromServer(angle, serverPlayers) {
    updatePlayersList(serverPlayers);

    shootBtn.disabled = true;
    winnerDisplay.textContent = "⚡️ Мяч запущен!";
    
    ball.x = center;
    ball.y = center;
    ball.active = true;

    const startSpeed = 15; 
    ball.vx = Math.cos(angle) * startSpeed;
    ball.vy = Math.sin(angle) * startSpeed;

    gameLoop();
}

function resetBall() {
    ball.x = center;
    ball.y = center;
    ball.active = false;
    ball.vx = 0;
    ball.vy = 0;
    drawArena();
    drawBall();
}

shootBtn.addEventListener('click', () => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (balance < currentBet) {
        winnerDisplay.textContent = "❌ Недостаточно монет!";
        return;
    }

    balance -= currentBet;
    updateUIBalance();

    socket.send(JSON.stringify({
        action: "join_game",
        user_id: myTelegramId,
        username: myUsername,
        bet: currentBet
    }));

    shootBtn.disabled = true;
    winnerDisplay.textContent = "Ставка сделана! Ожидание игры...";
});

drawArena();
drawBall();
connectWebSocket();
