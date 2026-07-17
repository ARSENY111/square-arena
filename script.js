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
const userAvatarImgEl = document.getElementById('user-avatar-img');

const size = canvas.width; 
const center = size / 2;
const borderWidth = 6; 

// Переменные статистики (в будущем их можно загружать из Базы Данных)
let totalGames = 0;
let totalWinsAmount = 0;

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

// === ДАННЫЕ ИГРОКА И АВАТАРКА ===

let myTelegramId = 99999; 
let myUsername = "Игрок";
let myAvatarUrl = "https://img.icons8.com/isometric-line/100/user.png"; // Дефолтная заглушка

// Находим элементы на странице
const profileAvatarLargeEl = document.getElementById('profile-avatar-large');
const profileUsernameTextEl = document.getElementById('profile-username-text');

if (window.Telegram && window.Telegram.WebApp) {
    const tg = window.Telegram.WebApp;
    tg.ready();
    tg.expand();
    
    if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
        const user = tg.initDataUnsafe.user;
        myTelegramId = user.id;
        myUsername = user.first_name || "Игрок";
        
        if (user.photo_url) {
            myAvatarUrl = user.photo_url;
        }
    }
} else {
    myUsername = "Тест-Игрок";
}

// Записываем данные в верхнюю шапку
usernameTagEl.textContent = myUsername;
userAvatarImgEl.src = myAvatarUrl;

// Записываем эти же данные в профиль (крупный формат)
if (profileUsernameTextEl) {
    profileUsernameTextEl.textContent = myUsername;
}
if (profileAvatarLargeEl) {
    profileAvatarLargeEl.src = myAvatarUrl;
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
        color: p.color,
        avatar: p.avatar || "https://img.icons8.com/isometric-line/100/user.png" // Ссылка на аватарку
    }));

    playersListEl.innerHTML = "";
    players.forEach(p => {
        const percent = Math.round(p.share * 100);
        const row = document.createElement('div');
        row.className = "player-row";
        row.style.borderLeftColor = p.color;

        row.innerHTML = `
            <div class="player-name-wrapper">
                <img class="lobby-avatar" src="${p.avatar}" alt="pfp">
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

// ОТРИСОВКА: Плотные цвета и абсолютно черный фон
function drawArena() {
    // Очищаем и заливаем фон полностью черным цветом
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, size, size);
    
    if (players.length === 0) {
        ctx.strokeStyle = "#1a2332";
        ctx.lineWidth = borderWidth;
        ctx.strokeRect(0, 0, size, size);
        return;
    }

    let currentDist = 0;
    players.forEach(player => {
        const playerLength = player.share * totalPerimeter;
        const steps = 60; 
        
        ctx.beginPath();
        ctx.moveTo(center, center);

        for (let i = 0; i <= steps; i++) {
            let pt = getPointOnPerimeter(currentDist + (playerLength * (i / steps)));
            ctx.lineTo(pt.x, pt.y);
        }

        ctx.closePath();

        // Сплошной (непрозрачный) цвет сектора
        ctx.fillStyle = player.color;
        ctx.fill();

        // Тонкие черные границы между секторами для аккуратности
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 3;
        ctx.stroke();

        currentDist += playerLength;
    });

    // Внешняя рамка
    ctx.strokeStyle = "#1a2332";
    ctx.lineWidth = borderWidth;
    ctx.strokeRect(0, 0, size, size);
}

function drawBall() {
    ctx.save();
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
    
    // Свечение шарика
    ctx.shadowBlur = 15;
    ctx.shadowColor = "#ffffff";
    ctx.fillStyle = "#ffffff";
    ctx.fill();

    // Добавим тонкую черную обводку шарику, чтобы он контрастно выделялся на сплошных цветах
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2;
    ctx.stroke();
    
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
        bet: currentBet,
        avatar: myAvatarUrl // Отправляем серверу ссылку на аватарку
    }));

    shootBtn.disabled = true;
    winnerDisplay.textContent = "Ставка сделана! Ожидание игры...";
});

drawArena();
drawBall();
connectWebSocket();

// === ЛОГИКА ПЕРЕКЛЮЧЕНИЯ ВКЛАДОК ===
function switchTab(tabName) {
    // Скрываем все экраны
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });

    // Деактивируем все кнопки в меню
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });

    // Показываем нужный экран
    const targetTab = document.getElementById(`tab-${tabName}`);
    if (targetTab) {
        targetTab.classList.add('active');
    }

    // Подсвечиваем нужную кнопку меню
    // Находим кнопку по атрибуту onclick
    const clickedBtn = Array.from(document.querySelectorAll('.nav-item')).find(btn => 
        btn.getAttribute('onclick').includes(`'${tabName}'`)
    );
    if (clickedBtn) {
        clickedBtn.classList.add('active');
    }
}

// Показ / Скрытие блока статистики
function toggleStatsSection() {
    const statsPanel = document.getElementById('stats-dropdown');
    if (!statsPanel) return;

    // Переключаем видимость
    if (statsPanel.style.display === 'block') {
        statsPanel.style.display = 'none';
    } else {
        // Перед открытием обновляем цифры на экране
        document.getElementById('stats-total-games').textContent = totalGames;
        document.getElementById('stats-total-wins').textContent = totalWinsAmount + " AC";

        statsPanel.style.display = 'block';
    }
}

// Обработка остальных кнопок профиля
function openProfileSection(section) {
    if (section === 'refs') {
        alert("👥 Реферальная система скоро появится!");
    }
}
