const canvas = document.getElementById('squareCanvas');
const ctx = canvas.getContext('2d');
const shootBtn = document.getElementById('shootBtn');
const winnerDisplay = document.getElementById('winner-display');

// Новые элементы интерфейса
const balanceValueEl = document.getElementById('balance-value');
const currentBetValueEl = document.getElementById('current-bet-value');
const betMinusBtn = document.getElementById('bet-minus');
const betPlusBtn = document.getElementById('bet-plus');
const playersListEl = document.getElementById('players-list');
const usernameTagEl = document.getElementById('username-tag');

const size = canvas.width; 
const center = size / 2;
const borderWidth = 16;

const SERVER_URL = "ws://localhost:8000/ws"; 
let socket;

// === ТЕСТОВЫЙ БАЛАНС И СТАВКА ===
let balance = parseInt(localStorage.getItem('arena_balance')) || 1000;
let currentBet = 100;

// Обновляем баланс на экране
function updateUIBalance() {
    balanceValueEl.textContent = balance;
    localStorage.setItem('arena_balance', balance);
}
updateUIBalance();

// Настройка кнопок изменения ставки
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

// Данные текущего игрока Telegram
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

            case "countdown":
                winnerDisplay.textContent = `⏱ Старт раунда через ${data.seconds} сек...`;
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
                    winnerDisplay.textContent = "Сделайте ставку для участия!";
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

// Обновление отображения игроков и их долей (шансов) на интерфейсе
function updatePlayersList(serverPlayers) {
    const playerArray = Object.values(serverPlayers);
    
    if (playerArray.length === 0) {
        players = [];
        playersListEl.innerHTML = '<div class="empty-lobby-text">Лобби пусто. Сделайте ставку первым!</div>';
        drawBorders();
        return;
    }

    const totalBets = playerArray.reduce((sum, p) => sum + p.bet, 0);
    
    players = playerArray.map(p => ({
        id: p.id || p.name, // Используем уникальный ключ
        name: p.name,
        bet: p.bet,
        share: p.bet / totalBets,
        color: p.color
    }));

    // Перерисовываем список участников под ареной
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

    drawBorders();
}

const totalPerimeter = size * 4;

function getPointOnPerimeter(distance) {
    distance = distance % totalPerimeter;
    const offset = borderWidth / 2;
    const innerSize = size - offset;

    if (distance < size) {
        return { x: distance, y: offset };
    } else if (distance < size * 2) {
        return { x: innerSize, y: distance - size };
    } else if (distance < size * 3) {
        return { x: size - (distance - size * 2), y: innerSize };
    } else {
        return { x: offset, y: size - (distance - size * 3) };
    }
}

function drawBorders() {
    ctx.clearRect(0, 0, size, size);
    
    if (players.length === 0) {
        ctx.strokeStyle = "#232d3b";
        ctx.lineWidth = borderWidth;
        ctx.strokeRect(borderWidth / 2, borderWidth / 2, size - borderWidth, size - borderWidth);
        return;
    }

    let currentDist = 0;
    players.forEach(player => {
        const playerLength = player.share * totalPerimeter;
        const steps = 100;
        
        ctx.beginPath();
        let startPt = getPointOnPerimeter(currentDist);
        ctx.moveTo(startPt.x, startPt.y);

        for (let i = 1; i <= steps; i++) {
            let pt = getPointOnPerimeter(currentDist + (playerLength * (i / steps)));
            ctx.lineTo(pt.x, pt.y);
        }

        ctx.strokeStyle = player.color;
        ctx.lineWidth = borderWidth;
        ctx.lineCap = "square";
        ctx.stroke();

        currentDist += playerLength;
    });
}

function drawBall() {
    ctx.save();
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
    
    ctx.shadowBlur = 12;
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

    const minCoord = borderWidth + ball.radius;
    const maxCoord = size - borderWidth - ball.radius;

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

        // Логика начисления монет на клиенте (для тестов)
        if (winner.name === myUsername) {
            // Наш игрок выиграл общий банк!
            const totalBank = players.reduce((sum, p) => sum + p.bet, 0);
            balance += totalBank;
            updateUIBalance();
            winnerDisplay.textContent += ` (+🪙${totalBank})`;
        }
    }
}

function gameLoop() {
    ctx.clearRect(0, 0, size, size);
    drawBorders();
    drawBall();
    updatePhysics();

    if (ball.active) {
        requestAnimationFrame(gameLoop);
    }
}

function launchBallFromServer(angle, serverPlayers) {
    updatePlayersList(serverPlayers);

    shootBtn.disabled = true;
    winnerDisplay.textContent = "⚡️ Мяч на арене!";
    
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
    drawBorders();
    drawBall();
}

// Нажатие на кнопку сделать ставку
shootBtn.addEventListener('click', () => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (balance < currentBet) {
        winnerDisplay.textContent = "❌ Недостаточно монет!";
        return;
    }

    // Списываем ставку из баланса
    balance -= currentBet;
    updateUIBalance();

    // Отправляем ставку на бэкенд
    socket.send(JSON.stringify({
        action: "join_game",
        user_id: myTelegramId,
        username: myUsername,
        bet: currentBet
    }));

    shootBtn.disabled = true;
    winnerDisplay.textContent = "Ставка сделана! Ожидание других участников...";
});

// Стартовый рендер
drawBorders();
drawBall();
connectWebSocket();