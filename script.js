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

            // === ДОБАВЬ ЭТОТ БЛОК СЮДА ===
        case "invoice_link":
            if (window.Telegram && window.Telegram.WebApp) {
                // Открываем нативное окно оплаты Telegram Stars
                Telegram.WebApp.openInvoice(data.url, function(status) {
                    if (status === 'paid') {
                        winnerDisplay.textContent = "✅ Оплата успешна! Обновляем баланс...";
                        socket.send(JSON.stringify({
                            action: "sync_profile",
                            user_id: myTelegramId,
                            username: myUsername
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
        // =================================
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
                // Было: launchBallFromServer(data.angle, data.players);
                launchBallFromServer(data.winner_id, data.players);
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

// === АНИМАЦИЯ РУЛЕТКИ ===
let animationState = {
    active: false,
    startTime: 0,
    duration: 5000, // Анимация длится 5 секунд
    startDist: 0,
    targetDist: 0,
    winnerName: ""
};

// Функция плавного замедления (Ease Out Cubic)
function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}

// Вычисляет координаты мячика с отступом от краев, чтобы он не вылетал за Canvas
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

// Новая функция запуска: задает начальный бросок и вычисляет точку остановки
function launchBallFromServer(winnerId, serverPlayers) {
    updatePlayersList(serverPlayers);
    shootBtn.disabled = true;
    winnerDisplay.textContent = "⚡️ Шарик запущен!";

    // 1. Находим целевую точку победителя (середину его сектора на периметре)
    let accumulated = 0;
    let targetWinnerDist = 0;

    for (let p of players) {
        let playerLength = p.share * totalPerimeter;
        if (p.id === winnerId) {
            // Берем ровно середину сектора игрока
            targetWinnerDist = accumulated + (playerLength / 2);
            animationState.winnerName = p.name;
            break;
        }
        accumulated += playerLength;
    }

    // Получаем точку на периметре
    let pt = getPointOnPerimeter(targetWinnerDist);

    // 2. Рассчитываем финальную цель остановки
    // Ставим точку на 60% расстояния от центра к краю, чтобы шарик четко лежал в секторе
    animationState.targetX = center + (pt.x - center) * 0.6;
    animationState.targetY = center + (pt.y - center) * 0.6;

    // 3. Задаем шарику сильный случайный импульс для полета по арене
    let angle = Math.random() * Math.PI * 2;
    let speed = 25 + Math.random() * 10; // Случайная начальная скорость
    ball.vx = Math.cos(angle) * speed;
    ball.vy = Math.sin(angle) * speed;
    
    // Бросок всегда начинается с центра поля
    ball.x = center;
    ball.y = center;

    animationState.active = true;
    animationState.startTime = performance.now();
    animationState.duration = 5000; // 5 секунд анимации

    requestAnimationFrame(animateRoulette);
}

// Главный цикл физики и отрисовки анимации
function animateRoulette(currentTime) {
    if (!animationState.active) return;

    let elapsed = currentTime - animationState.startTime;
    let progress = Math.min(elapsed / animationState.duration, 1);

    // --- 1. ФИЗИКА ДВИЖЕНИЯ И ОТСКОКОВ ---
    ball.x += ball.vx;
    ball.y += ball.vy;

    const inset = ball.radius + 4; // Границы стен с учетом радиуса
    
    // Отскок от левой и правой стены
    if (ball.x <= inset) {
        ball.x = inset;
        ball.vx *= -1;
    } else if (ball.x >= size - inset) {
        ball.x = size - inset;
        ball.vx *= -1;
    }

    // Отскок от верхней и нижней стены
    if (ball.y <= inset) {
        ball.y = inset;
        ball.vy *= -1;
    } else if (ball.y >= size - inset) {
        ball.y = size - inset;
        ball.vy *= -1;
    }

    // Естественное трение (замедление об лед/поле)
    ball.vx *= 0.985;
    ball.vy *= 0.985;

    if (progress > 0.4) { // Начинаем корректировку только после 40% времени
        let strength = (progress - 0.4) / 0.6; // Плавно нарастает от 0 до 1
        
        // Вместо резкого притягивания, мы плавно "подруливаем" вектор скорости
        let dx = animationState.targetX - ball.x;
        let dy = animationState.targetY - ball.y;
        
        // Добавляем микро-импульс в сторону цели, который становится слабее по мере приближения
        ball.vx += dx * 0.005 * strength; 
        ball.vy += dy * 0.005 * strength;

        // Усиливаем трение, чтобы шарик плавно терял энергию и "успокаивался"
        let drag = 0.95 + (0.04 * strength); 
        ball.vx *= drag;
        ball.vy *= drag;
    }

    ball.active = true;

    // --- 3. ОТРИСОВКА ---
    ctx.clearRect(0, 0, size, size);
    drawArena();
    drawBall();

    if (progress < 1) {
        requestAnimationFrame(animateRoulette);
    } else {
        // Конец анимации
        animationState.active = false;
        winnerDisplay.textContent = `🏆 ПОБЕДА: ${animationState.winnerName}!`;
        
        // Финально ставим шарик ровно в рассчитанную точку сектора победителя
        ball.x = animationState.targetX;
        ball.y = animationState.targetY;
        drawArena();
        drawBall();
    }
}

// Сброс шарика перед новым раундом
function resetBall() {
    // Возвращаем шарик в центр для следующего вбрасывания
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

resetBall(); // Вместо раздельных drawArena и drawBall
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

// Находим новые элементы интерфейса
const depositModal = document.getElementById('depositModal');
const starsAmountInput = document.getElementById('starsAmountInput');
const closeDepositModal = document.getElementById('closeDepositModal');
const payStarsBtn = document.getElementById('payStarsBtn');

if (depositBtn) {
    // При клике на "+ Пополнить" показываем модалку
    depositBtn.addEventListener('click', () => {
        depositModal.style.display = 'flex';
    });
}

if (closeDepositModal) {
    // Закрытие модалки при клике на "Отмена"
    closeDepositModal.addEventListener('click', () => {
        depositModal.style.display = 'none';
    });
}

if (payStarsBtn) {
    // Отправка кастомной суммы на сервер
    payStarsBtn.addEventListener('click', () => {
        const amount = parseInt(starsAmountInput.value);
        
        if (isNaN(amount) || amount <= 0) {
            alert("Пожалуйста, введите корректное число звёзд (минимум 1)");
            return;
        }

        if (!socket || socket.readyState !== WebSocket.OPEN) return;

        // Закрываем модалку и показываем статус
        depositModal.style.display = 'none';
        winnerDisplay.textContent = `🔄 Создаем счет на ${amount} ★...`;
        
        // Отправляем на бэкенд именно то число, которое ввёл пользователь
        socket.send(JSON.stringify({
            action: "create_stars_invoice",
            user_id: myTelegramId,
            stars_amount: amount 
        }));
    });
}
