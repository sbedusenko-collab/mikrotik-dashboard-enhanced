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

1. Отредактируй `server.js`:
```js
const CFG = {
  host: '192.168.1.1',  // IP роутера
  user: 'MCP-User',     // пользователь RouterOS
  pass: 'password',     // пароль
  port: 8080,
};
```

2. Запусти:
```bash
node server.js
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

- Node.js 16+
- MikroTik RouterOS 7.x
- REST API включён: `/ip/service` → `www` или `www-ssl`
- Пользователь `MCP-User` с паролем (группа `full` или `read`)

## Структура проекта

```
mikrotik-dashboard/
├── server.js       # Веб-дашборд (HTTP сервер + RouterOS REST клиент)
├── mcp-server.js   # MCP сервер (53 инструмента, stdio JSON-RPC)
└── index.html      # SPA фронтенд (Vanilla JS, Canvas 2D)
```
