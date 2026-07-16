import asyncio
import json
import random
import math
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

app = FastAPI()

# Разрешаем CORS (чтобы Mini App мог подключаться с любого хостинга)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Хранилище активных WebSocket-подключений клиентов
class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        # Отправка сообщения всем подключенным Mini Apps
        payload = json.dumps(message)
        for connection in self.active_connections:
            try:
                await connection.send_text(payload)
            except Exception:
                # Если клиент отвалился, убираем его позже при дисконнекте
                pass

manager = ConnectionManager()

# Состояние игровой комнаты
game_state = {
    "is_active": False,
    "players": {},  # { "user_id": {"name": "Имя", "bet": 100, "color": "#ff0000"} }
    "countdown": 0,
}

# Список ярких цветов для игроков
COLORS = ["#1e90ff", "#2ed573", "#ffa502", "#ff4757", "#9b59b6", "#1abc9c"]

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    
    # Сразу отправляем новому игроку текущее состояние комнаты
    await websocket.send_text(json.dumps({
        "type": "init",
        "game_state": game_state
    }))

    try:
        while True:
            # Ждем сообщений от клиента (если они понадобятся)
            data = await websocket.receive_text()
            message = json.loads(data)
            
            # Например, игрок нажимает "Готов" прямо в Mini App
            if message.get("action") == "join_game":
                await handle_join(message["user_id"], message["username"], message["bet"])

    except WebSocketDisconnect:
        manager.disconnect(websocket)


async def handle_join(user_id, username, bet):
    """Добавление игрока и запуск таймера"""
    if game_state["is_active"]:
        return # Игра уже запущена

    # Регистрируем игрока
    if user_id not in game_state["players"]:
        color = COLORS[len(game_state["players"]) % len(COLORS)]
        game_state["players"][user_id] = {
            "name": username,
            "bet": int(bet),
            "color": color
        }
    else:
        game_state["players"][user_id]["bet"] += int(bet)

    # Рассылаем всем обновленный список участников
    await manager.broadcast({
        "type": "players_update",
        "players": list(game_state["players"].values())
    })

    # Если это первый игрок, запускаем обратный отсчет до старта
    if len(game_state["players"]) == 1:
        asyncio.create_task(start_game_countdown())


async def start_game_countdown():
    game_state["countdown"] = 15 # 15 секунд на сбор ставок
    
    while game_state["countdown"] > 0:
        await manager.broadcast({
            "type": "countdown",
            "seconds": game_state["countdown"]
        })
        await asyncio.sleep(1)
        game_state["countdown"] -= 1

    # Запускаем игру, если игроков больше одного
    if len(game_state["players"]) >= 2:
        await run_game_round()
    else:
        # Сброс, если никто больше не зашел
        game_state["players"] = {}
        await manager.broadcast({"type": "reset", "reason": "Недостаточно игроков"})


async def run_game_round():
    game_state["is_active"] = True
    
    # Генерируем случайный угол для шарика (в радианах: от 0 до 2*PI)
    random_angle = random.uniform(0, 2 * math.pi)

    # Отправляем ВСЕМ клиентам команду на старт с ОДНИМ И ТЕМ ЖЕ углом
    await manager.broadcast({
        "type": "start_spin",
        "angle": random_angle,
        "players": list(game_state["players"].values())
    })

    # Ждем 16 секунд (15 секунд идет анимация + 1 секунда буфер)
    await asyncio.sleep(16)

    # Игра завершена, очищаем лобби
    game_state["is_active"] = False
    game_state["players"] = {}
    
    await manager.broadcast({"type": "game_over"})


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)