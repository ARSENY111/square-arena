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
const depositBtn = document.getElementById('depositBtn'); // Исправлено: Добавлено объявление недостающей кнопки

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
let tgInitData = "test_mode"; // По умолчанию режим тестирования для ПК

const profileAvatarLargeEl = document.getElementById('profile-avatar-large');
const profileUsernameTextEl = document.getElementById('profile-username-text');

if (window.Telegram && window.Telegram.WebApp) {
    const tg = window.Telegram.WebApp;
    tg.ready();
    tg.expand();
    
    if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
        tgInitData = tg.initData; // Безопасность: отправляем валидационную строку целиком
        const user = tg.initDataUnsafe.user;
        myTelegramId = user.id;
        myUsername = user.first_name || "Игрок";
        
        if (user.photo_url) {
            myAvatarUrl = user.photo_url;
        }
    }
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
        
        // Запрашиваем баланс из базы данных при подключении с валидационными данными
        socket.send(JSON.stringify({
            action: "sync_profile",
            init_data: tgInitData
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

            case "invoice_link":
                if (window.Telegram && window.Telegram.WebApp && tgInitData !== "test_mode") {
                    // Открываем нативное окно оплаты Telegram Stars
                    Telegram.WebApp.openInvoice(data.url, function(status) {
                        if (status === 'paid') {
                            winnerDisplay.textContent = "✅ Оплата успешна! Обновляем баланс...";
                            socket.send(JSON.stringify({
                                action: "sync_profile",
                                init_data: tgInitData
                            }));
                        } else if (status === 'failed') {
                            winnerDisplay.textContent = "❌ Ошибка при оплате.";
                        } else {
                            winnerDisplay.textContent = "Ставки принимаются!";
                        }
                    });
                } else {
                    // Если тестируешь с ПК в обычном браузере
                    winnerDisplay.textContent = "Ссылка создана (см. консоль)";
                    console.log("Ссылка на оплату для ПК:", data.url);
                    alert(`Для теста на ПК перейдите по ссылке в консоли или откройте Mini App в Telegram`);
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
                launchBallFromServer(data.winner_id, data.players);
                break;
                
            case "game_over":
                // Ждем окончания показа результатов и обновляем балансы из базы
                setTimeout(() => {
                    socket.send(JSON.stringify({
                        action: "sync_profile",
                        init_data: tgInitData
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

// === АНИМАЦИЯ РУЛЕТКИ ===
let animationState = {
    active: false,
    startTime: 0,
    duration: 5000, // Анимация длится 5 секунд
    startDist: 0,
    targetDist: 0,
    winnerName: ""
};

function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}

function getInnerPerimeterPoint(distance) {
    const inset = 20; // Отступ внутрь
    const side = size - inset * 2;
    const progress = (distance % totalPerimeter) / totalPerimeter;
    const innerDist = progress * (side * 4);
    
    if (innerDist < side) return { x: inset + innerDist, y: inset };
    else if (innerDist < side * 2) return { x: inset + side, y: inset + (innerDist - side) };
    else if (innerDist < side * 3) return { x: inset + side - (innerDist - side * 2), y: inset + side };
    else return { x: inset, y: inset + side - (innerDist - side * 3) };
}

// === НОВЫЕ ФУНКЦИИ ДЛЯ РЕАЛИСТИЧНОЙ ФИЗИКИ ===

// Определяет, над сегментом какого периметра остановился шарик (от 0 до totalPerimeter)
// Определяет, над сегментом какого периметра остановился шарик
function getDistanceOfPoint(x, y) {
    let dx = x - center;
    let dy = y - center;
    let max = Math.max(Math.abs(dx), Math.abs(dy));
    if (max === 0) return 0;
    
    let Px = center + (dx / max) * center;
    let Py = center + (dy / max) * center;
    
    let eps = 0.1;
    if (Math.abs(Py - 0) < eps) return Px; 
    if (Math.abs(Px - size) < eps) return size + Py; 
    if (Math.abs(Py - size) < eps) return size * 2 + (size - Px); 
    if (Math.abs(Px - 0) < eps) return size * 3 + (size - Py); 
    return 0;
}

// Детерминированный поиск вектора (Дает АБСОЛЮТНО одинаковый результат на всех устройствах)
function findNaturalVectorForWinner(winnerId) {
    let winnerStart = 0, winnerEnd = 0, currentD = 0;
    let totalBets = 0;
    
    // Вычисляем зоны победителя и общий банк
    for (let p of players) {
        let pLength = p.share * totalPerimeter;
        totalBets += p.bet;
        if (p.id === winnerId) {
            winnerStart = currentD;
            winnerEnd = currentD + pLength;
        }
        currentD += pLength;
    }

    const inset = ball.radius + 4;
    let margin = Math.min(10, (winnerEnd - winnerStart) * 0.15);

    // Используем сумму ставок как "зерно" (seed) для угла.
    // Это гарантирует разную траекторию в разных раундах, 
    // но на 100% одинаковую для всех игроков в текущем матче.
    let startAngleDeg = totalBets % 360; 

    // Систематический перебор (Заменил Math.random)
    for (let speed = 25; speed <= 45; speed += 1) {
        for (let i = 0; i < 120; i++) { // 120 шагов по 3 градуса = 360 градусов
            let angleDeg = (startAngleDeg + i * 3) % 360;
            let angle = angleDeg * Math.PI / 180;
            
            let vx = Math.cos(angle) * speed;
            let vy = Math.sin(angle) * speed;

            let simX = center, simY = center;
            let simVx = vx, simVy = vy;
            let steps = 0;

            // Симуляция с жестко фиксированным таймингом
            while ((Math.abs(simVx) > 0.05 || Math.abs(simVy) > 0.05) && steps < 300) {
                simX += simVx;
                simY += simVy;

                if (simX <= inset) { simX = inset; simVx *= -1; }
                else if (simX >= size - inset) { simX = size - inset; simVx *= -1; }

                if (simY <= inset) { simY = inset; simVy *= -1; }
                else if (simY >= size - inset) { simY = size - inset; simVy *= -1; }

                simVx *= 0.975;
                simVy *= 0.975;
                steps++;
            }

            // Исключаем скучные броски, застревающие в центре
            if (Math.hypot(simX - center, simY - center) < size * 0.3) continue;

            let finalDist = getDistanceOfPoint(simX, simY);
            // Если шарик остановился в нужной зоне
            if (finalDist > winnerStart + margin && finalDist < winnerEnd - margin) {
                return { vx, vy }; // Вектор найден! У всех он будет одним и тем же.
            }
        }
    }
    
    // Резервный бросок (если зона победителя составляет миллиметры и идеальный вектор не найден)
    let targetDist = winnerStart + (winnerEnd - winnerStart) / 2;
    let pt = getPointOnPerimeter(targetDist);
    let fallbackAngle = Math.atan2(pt.y - center, pt.x - center);
    return { vx: Math.cos(fallbackAngle) * 30, vy: Math.sin(fallbackAngle) * 30 };
}

// === ОБНОВЛЕННАЯ АНИМАЦИЯ С ФИКСИРОВАННЫМ ШАГОМ ФИЗИКИ (FPS-НЕЗАВИСИМАЯ) ===

let physicsAccumulator = 0;
let lastRenderTime = 0;
const PHYSICS_TICK = 1000 / 60; // Физика обрабатывается строго 60 раз в секунду

function launchBallFromServer(winnerId, serverPlayers) {
    updatePlayersList(serverPlayers);
    shootBtn.disabled = true;
    winnerDisplay.textContent = "⚡️ Шарик запущен!";

    let winnerObj = players.find(p => p.id === winnerId);
    animationState.winnerName = winnerObj ? winnerObj.name : "Игрок";

    let vector = findNaturalVectorForWinner(winnerId);
    
    ball.x = center;
    ball.y = center;
    ball.vx = vector.vx;
    ball.vy = vector.vy;

    animationState.active = true;
    lastRenderTime = 0; // Обязательный сброс таймеров перед новым броском
    physicsAccumulator = 0;
    
    requestAnimationFrame(animateRoulette);
}

function animateRoulette(currentTime) {
    if (!animationState.active) return;

    // Считаем дельту (разницу времени) между кадрами
    if (lastRenderTime === 0) lastRenderTime = currentTime;
    let deltaTime = currentTime - lastRenderTime;
    lastRenderTime = currentTime;

    // Защита: если игрок свернул вкладку, не даем накопиться гигантскому времени
    if (deltaTime > 100) deltaTime = PHYSICS_TICK;

    physicsAccumulator += deltaTime;

    // Независимо от того, 144Hz у игрока или 60Hz, физика шагнет одинаково
    while (physicsAccumulator >= PHYSICS_TICK) {
        ball.x += ball.vx;
        ball.y += ball.vy;

        const inset = ball.radius + 4; 
        
        if (ball.x <= inset) { ball.x = inset; ball.vx *= -1; }
        else if (ball.x >= size - inset) { ball.x = size - inset; ball.vx *= -1; }

        if (ball.y <= inset) { ball.y = inset; ball.vy *= -1; }
        else if (ball.y >= size - inset) { ball.y = size - inset; ball.vy *= -1; }

        ball.vx *= 0.975;
        ball.vy *= 0.975;

        physicsAccumulator -= PHYSICS_TICK;
    }

    // Отрисовка
    ctx.clearRect(0, 0, size, size);
    drawArena();
    drawBall();

    // Ждем полной остановки
    if (Math.abs(ball.vx) > 0.05 || Math.abs(ball.vy) > 0.05) {
        requestAnimationFrame(animateRoulette);
    } else {
        animationState.active = false;
        winnerDisplay.textContent = `🏆 ПОБЕДА: ${animationState.winnerName}!`;
        lastRenderTime = 0; 
    }
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

    shootBtn.disabled = true;
    shootBtn.textContent = "Ставка сделана! Ожидание игры...";

    socket.send(JSON.stringify({
        action: "join_game",
        init_data: tgInitData,
        bet: currentBet,
        avatar: myAvatarUrl
    }));
});

resetBall(); 
connectWebSocket();

// === ЛОГИКА ПЕРЕКЛЮЧЕНИЯ ВКЛАДОК ===
window.switchTab = function(tabName) {
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
        btn.getAttribute('onclick') && btn.getAttribute('onclick').includes(`'${tabName}'`)
    );
    if (clickedBtn) {
        clickedBtn.classList.add('active');
    }
};

// Показ / Скрытие блока статистики
window.toggleStatsSection = function() {
    const statsPanel = document.getElementById('stats-dropdown');
    if (!statsPanel) return;

    if (statsPanel.style.display === 'block') {
        statsPanel.style.display = 'none';
    } else {
        document.getElementById('stats-total-games').textContent = totalGames;
        document.getElementById('stats-total-wins').textContent = totalWinsAmount + " AC";
        statsPanel.style.display = 'block';
    }
};

window.openProfileSection = function(section) {
    if (section === 'refs') {
        alert("👥 Реферальная система скоро появится!");
    }
};

// Находим новые элементы интерфейса
const depositModal = document.getElementById('depositModal');
const starsAmountInput = document.getElementById('starsAmountInput');
const closeDepositModal = document.getElementById('closeDepositModal');
const payStarsBtn = document.getElementById('payStarsBtn');

if (depositBtn) {
    depositBtn.addEventListener('click', () => {
        depositModal.style.display = 'flex';
    });
}

if (closeDepositModal) {
    closeDepositModal.addEventListener('click', () => {
        depositModal.style.display = 'none';
    });
}

if (payStarsBtn) {
    payStarsBtn.addEventListener('click', () => {
        const amount = parseInt(starsAmountInput.value);
        
        if (isNaN(amount) || amount <= 0) {
            alert("Пожалуйста, введите корректное число звёзд (минимум 1)");
            return;
        }

        if (!socket || socket.readyState !== WebSocket.OPEN) return;

        depositModal.style.display = 'none';
        winnerDisplay.textContent = `🔄 Создаем счет на ${amount} ★...`;
        
        socket.send(JSON.stringify({
            action: "create_stars_invoice",
            init_data: tgInitData,
            stars_amount: amount 
        }));
    });
}
