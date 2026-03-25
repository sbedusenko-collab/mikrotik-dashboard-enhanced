# MikroTik Dashboard

Легковесный веб-дашборд для мониторинга MikroTik RouterOS — без внешних зависимостей.

## Возможности

- **Системные ресурсы** — CPU, память, диск, температура (с drag-and-drop перестановкой плиток)
- **Интерфейсы** — статус, RX/TX трафик, перетаскиваемые плитки
- **Трафик** — графики в реальном времени, sparklines по каждому интерфейсу
- **WireGuard VPN** — список пиров, статус handshake, RX/TX
- **DHCP** — список аренд с фильтрацией
- **Маршруты** — активная таблица маршрутизации
- **Health** — сводка системных показателей

## Технологии

- **Backend**: Node.js (без зависимостей) — подключается к RouterOS REST API
- **Frontend**: Vanilla JS, Canvas 2D для графиков, HTML5 Drag and Drop
- **Нет**: npm, webpack, React, Chart.js — ничего лишнего

## Установка

```bash
git clone https://github.com/sbedusenko-collab/mikrotik-dashboard.git
cd mikrotik-dashboard
```

Отредактируй параметры подключения в `server.js`:

```js
const CFG = {
  host: '192.168.1.1',   // IP адрес роутера
  user: 'admin',          // пользователь RouterOS
  pass: 'password',       // пароль
  port: 8080,             // порт дашборда
};
```

## Запуск

```bash
node server.js
```

Открой в браузере: [http://127.0.0.1:8080](http://127.0.0.1:8080)

## Требования

- Node.js 16+
- MikroTik RouterOS 7.x с включённым REST API (`/ip/service` → `www` или `www-ssl`)
