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

// Переменные статистики (синхронизируются с сервером)
let totalGames = 0;
let totalWinsAmount = 0;

const SERVER_URL = "ws://localhost:8000/ws"; 
let socket;

// === БАЛАНС И СТАВКА ===
let balance = 0; // Загружается с сервера
let currentBet = 100;

function updateUIBalance() {
    balanceValueEl.textContent = balance;
}

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

// === ДАННЫЕ ИГРОКА И АВАТАРКА ИЗ TELEGRAM ===
let myTelegramId = 99999; 
let myUsername = "Игрок";
let myAvatarUrl = "https://img.icons8.com/isometric-line/100/user.png";

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

// Заполняем интерфейс данными
usernameTagEl.textContent = myUsername;
userAvatarImgEl.src = myAvatarUrl;

if (profileUsernameTextEl) profileUsernameTextEl.textContent = myUsername;
if (profileAvatarLargeEl) profileAvatarLargeEl.src = myAvatarUrl;


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
        winnerDisplay.textContent = "Синхронизация профиля...";
        
        // Запрашиваем баланс из базы данных при подключении
        socket.send(JSON.stringify({
            action: "sync_profile",
            user_id: myTelegramId,
            username: myUsername
        }));
    };

    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);

        switch (data.type) {
            case "profile_data":
                // Обновляем данные из БД сервера
                balance = data.balance;
                totalGames = data.games_played;
                totalWinsAmount = data.wins_amount;
                updateUIBalance();
                
                // Подтягиваем текущее состояние лобби
                updatePlayersList(data.game_state.players);
                
                if (!ball.active) {
                    winnerDisplay.textContent = "Ставки принимаются!";
                    shootBtn.textContent = "ПОСТАВИТЬ СТАВКУ";
                    shootBtn.disabled = false;
                }
                break;

            case "players_update":
                updatePlayersList(data.players);
                break;

            case "countdown_update":
                winnerDisplay.textContent = `⏳ Игра начнется через: ${data.seconds_left} сек`;
                // Если кнопка не в режиме "Ставка сделана", держим её активной для других
                if (shootBtn.textContent !== "Ставка сделана! Ожидание игры...") {
                    shootBtn.disabled = false;
                }
                break;

            case "start_spin":
                launchBallFromServer(data.angle, data.players);
                break;
                
            case "game_over":
                // Ждем окончания показа результатов и обновляем балансы из базы
                setTimeout(() => {
                    socket.send(JSON.stringify({
                        action: "sync_profile",
                        user_id: myTelegramId,
                        username: myUsername
                    }));
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
        avatar: p.avatar || "https://img.icons8.com/isometric-line/100/user.png"
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

function drawArena() {
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
        ctx.fillStyle = player.color;
        ctx.fill();

        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 3;
        ctx.stroke();

        currentDist += playerLength;
    });

    ctx.strokeStyle = "#1a2332";
    ctx.lineWidth = borderWidth;
    ctx.strokeRect(0, 0, size, size);
}

function drawBall() {
    ctx.save();
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
    
    ctx.shadowBlur = 15;
    ctx.shadowColor = "#ffffff";
    ctx.fillStyle = "#ffffff";
    ctx.fill();

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

    // Визуально фиксируем кнопку, списание баланса подтвердит сервер
    shootBtn.disabled = true;
    shootBtn.textContent = "Ставка сделана! Ожидание игры...";

    socket.send(JSON.stringify({
        action: "join_game",
        user_id: myTelegramId,
        username: myUsername,
        bet: currentBet,
        avatar: myAvatarUrl
    }));
});

drawArena();
drawBall();
connectWebSocket();

// === ЛОГИКА ПЕРЕКЛЮЧЕНИЯ ВКЛАДОК ===
function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });

    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });

    const targetTab = document.getElementById(`tab-${tabName}`);
    if (targetTab) {
        targetTab.classList.add('active');
    }

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

    if (statsPanel.style.display === 'block') {
        statsPanel.style.display = 'none';
    } else {
        // Заполняем данными, которые пришли из бэкенда
        document.getElementById('stats-total-games').textContent = totalGames;
        document.getElementById('stats-total-wins').textContent = totalWinsAmount + " AC";
        statsPanel.style.display = 'block';
    }
}

function openProfileSection(section) {
    if (section === 'refs') {
        alert("👥 Реферальная система скоро появится!");
    }
}
