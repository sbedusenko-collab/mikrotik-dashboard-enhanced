# MikroTik Dashboard + MCP Server

Два инструмента для работы с MikroTik RouterOS — без внешних зависимостей, только Node.js.

| Компонент | Описание |
|-----------|----------|
| `server.js` | Веб-дашборд — мониторинг в браузере |
| `mcp-server.js` | MCP сервер — управление через Claude AI |

---

## Веб-дашборд (`server.js`)

Легковесный SPA для мониторинга RouterOS.

**Возможности:**
- Системные ресурсы — CPU, память, диск, температура (drag-and-drop плитки)
- Интерфейсы — статус, RX/TX, перетаскиваемые карточки
- Трафик — графики Canvas 2D в реальном времени, sparklines по интерфейсам
- WireGuard VPN — пиры, handshake, трафик
- DHCP — аренды IP, drag-and-drop строк
- Маршруты — активная таблица маршрутизации
- Health — сводка системных показателей

**Запуск:**

1. Скопируйте `.env.example` в рабочий файл `.env`:
```bash
cp .env.example .env
```

2. Отредактируйте `.env`, указав свои данные:
```env
ROUTER_HOST=192.168.1.1
ROUTER_USER=MCP-User
ROUTER_PASS=password

ROUTER_TLS=1
ROUTER_API_PORT=443
ALLOW_INSECURE_TLS=0

PORT=8080
HOST=127.0.0.1
DASHBOARD_TOKEN=change-me

# optional
CORS_ORIGIN=http://127.0.0.1:8080
SSL_KEY=/path/to/key.pem
SSL_CERT=/path/to/cert.pem
```

3. Запустите дашборд:
```bash
npm start
```

3. Открой [http://127.0.0.1:8080](http://127.0.0.1:8080)

---

## MCP сервер (`mcp-server.js`)

53 инструмента для управления RouterOS через Claude AI (или любой MCP-совместимый клиент).

**Категории инструментов:**

| Категория | Инструменты |
|-----------|-------------|
| Подключение | `routeros_connect`, `routeros_disconnect`, `routeros_list_connections` |
| Система | `routeros_system_info`, `routeros_health_check`, `routeros_firmware_status` |
| CRUD | `routeros_list`, `routeros_get`, `routeros_set`, `routeros_add`, `routeros_remove` |
| Файрвол | `routeros_firewall_analyze`, `routeros_firewall_move`, `routeros_security_audit` |
| DHCP / DNS | `routeros_dhcp_report`, `routeros_pool_status`, `routeros_dns_*` |
| VPN / WiFi | `routeros_vpn_status`, `routeros_wireguard_client_config`, `routeros_wifi_status` |
| Диагностика | `routeros_ping`, `routeros_traceroute`, `routeros_monitor_traffic`, `routeros_top_talkers` |
| Логи | `routeros_log_search`, `routeros_log_stats`, `routeros_audit_log` |
| Шаблоны | `routeros_apply_template`, `routeros_list_templates` |
| Утилиты | `routeros_backup`, `routeros_export`, `routeros_watch`, `routeros_open_ui` |

**Настройка в Claude Code:**

Добавь в `~/.claude/settings.json` (или `settings.local.json`):

```json
{
  "mcpServers": {
    "mikrotik": {
      "command": "node",
      "args": ["/path/to/mikrotik-dashboard/mcp-server.js"]
    }
  }
}
```

**Использование в Claude:**

```
routeros_connect(address="192.168.1.1", password="secret")
routeros_system_info()
routeros_health_check()
routeros_security_audit()
routeros_open_ui(page="dashboard")
```

---

## Требования

- Node.js 18+
- MikroTik RouterOS 7.x
- REST API включён: `/ip/service` → `www` или `www-ssl`
- Пользователь `MCP-User` с паролем (группа `full` или `read`)

## Security notes

- `DASHBOARD_TOKEN` — это только аутентификация UI/API, он **не заменяет TLS**.
- Для RouterOS в продакшене предпочтительно использовать `www-ssl`.
- Не используйте `ALLOW_INSECURE_TLS=1` в production.
- Разрушающие MCP-tools (`routeros_set`, `routeros_remove`, `routeros_upgrade`, `routeros_apply_template`) требуют `confirm=true` для применения.

## Структура проекта

```
mikrotik-dashboard/
├── server.js       # Веб-дашборд (HTTP сервер + RouterOS REST клиент)
├── mcp-server.js   # MCP сервер (53 инструмента, stdio JSON-RPC)
├── public/
│   ├── index.html  # SPA разметка
│   ├── styles.css  # CSS
│   ├── app.js      # Фронтенд-логика
│   └── utils.js    # Фронтенд утилиты
├── utils.js        # Общие утилиты форматирования
├── config.js       # Загрузка env
├── routeros-client.js # RouterOS REST helper
├── package.json    # Скрипты запуска
└── .env.example    # Шаблон конфига
```
