# WhatsApp Status Auto-Viewer

Серверная версия бота для автоматического просмотра WhatsApp Status. Бот работает
через Baileys/WebSocket без браузерной автоматизации, сохраняет WhatsApp-сессию и
SQLite-базу на сервере, а управление доступно через защищенную JWT-авторизацией
веб-панель.

## Архитектура

```text
Internet
   |
   |  HTTP :80 / HTTPS :443
   v
Nginx на сервере
   |
   |  http://127.0.0.1:3000
   v
Docker Compose -> Node.js + Baileys + SQLite
```

Nginx работает как системная служба хоста, а приложение запускается в Docker.
Compose публикует порт приложения только на `127.0.0.1:3000`. Поэтому адрес
`http://SERVER_IP:3000` с другого компьютера открываться не должен. Внешний вход
выполняется через Nginx на портах `80` и `443`.

После перезагрузки сервера:

- Docker запускается через `systemd`;
- контейнер восстанавливается благодаря `restart: unless-stopped`;
- Nginx запускается через `systemd`;
- WhatsApp-сессия и база остаются в bind-mounted каталогах на сервере.

## Требования

- Ubuntu Server;
- не менее 1 ГБ RAM;
- Docker Engine;
- Docker Compose plugin;
- Nginx;
- Certbot для HTTPS;
- домен для постоянной production-установки.

В firewall достаточно открыть:

```text
22/tcp   SSH
80/tcp   HTTP и проверка Certbot
443/tcp  HTTPS
```

Порт `3000` наружу открывать не нужно.

## 1. Подготовка сервера

Подключитесь по SSH:

```bash
ssh root@SERVER_IP
```

Установите необходимые пакеты:

```bash
apt update
apt install -y git docker.io docker-compose-v2 nginx certbot python3-certbot-nginx
systemctl enable --now docker nginx
```

Проверьте установку:

```bash
docker --version
docker compose version
nginx -v
systemctl is-active docker
systemctl is-active nginx
```

## 2. Загрузка проекта

Рекомендуемый каталог:

```bash
cd /opt
git clone https://github.com/xam55/whatsapp_status_check.git whatsapp-status-bot
cd /opt/whatsapp-status-bot
```

Создайте постоянные каталоги и выдайте права пользователю контейнера:

```bash
mkdir -p auth_session data
chown -R 1000:1000 auth_session data
```

## 3. Настройка `.env`

Создайте конфигурацию:

```bash
cp .env.example .env
nano .env
```

Пример production-конфигурации:

```env
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
PUBLIC_URL=https://status.example.com

UI_USER=admin
UI_PASSWORD=CHANGE_ME_BEFORE_START
JWT_SECRET=CHANGE_ME_TO_A_RANDOM_SECRET_AT_LEAST_32_CHARS
JWT_EXPIRES_SECONDS=43200
COOKIE_SECURE=true

WATCH_ALL=false
BAILEYS_LOG_LEVEL=warn
LOG_STATUS_DEBUG=false
LOG_ALL_UPSERTS=false
```

Обязательные параметры:

| Переменная | Назначение |
| --- | --- |
| `UI_USER` | Логин администратора |
| `UI_PASSWORD` | Пароль длиной не менее 12 символов |
| `JWT_SECRET` | Секрет подписи JWT длиной не менее 32 символов |
| `JWT_EXPIRES_SECONDS` | Время жизни авторизации, по умолчанию 12 часов |
| `COOKIE_SECURE` | `true` для HTTPS, `false` только для временного HTTP |
| `WATCH_ALL` | Если `true`, просматривать все статусы; пустой список целей также включает просмотр всех |

Сгенерируйте надежный JWT-секрет:

```bash
openssl rand -hex 32
```

Вставьте полученное значение в `JWT_SECRET`. JWT подписывается только алгоритмом
`HS256` и хранится в `HttpOnly`, `SameSite=Strict` cookie. Placeholder-значения,
короткий пароль или короткий секрет блокируют запуск приложения.

## 4. Сборка и запуск

Находясь в `/opt/whatsapp-status-bot`, выполните:

```bash
docker compose build
docker compose up -d
```

Проверьте контейнер:

```bash
docker compose ps
docker compose logs --tail=100 bot
```

В колонке `STATUS` контейнер должен перейти в состояние `healthy`.

Проверьте приложение непосредственно на сервере:

```bash
curl http://127.0.0.1:3000/healthz
```

Ожидаемый ответ:

```json
{"ok":true}
```

Если контейнер перезапускается:

```bash
docker compose logs --tail=200 bot
```

Частые причины:

- не заменен `UI_PASSWORD`;
- пароль короче 12 символов;
- `JWT_SECRET` короче 32 символов;
- нет прав записи в `auth_session` или `data`.

## 5. Временный доступ по IP через HTTP

Этот режим подходит только для первичной проверки. В `.env` установите:

```env
PUBLIC_URL=http://SERVER_IP
COOKIE_SECURE=false
```

Создайте Nginx-конфигурацию:

```bash
nano /etc/nginx/sites-available/whatsapp-status-bot
```

Содержимое:

```nginx
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name SERVER_IP;

    client_max_body_size 1m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

Активируйте конфигурацию:

```bash
rm -f /etc/nginx/sites-enabled/default
ln -sfn /etc/nginx/sites-available/whatsapp-status-bot \
  /etc/nginx/sites-enabled/whatsapp-status-bot
nginx -t
systemctl reload nginx
```

Перезапустите контейнер после изменения `.env`:

```bash
cd /opt/whatsapp-status-bot
docker compose up -d --force-recreate
```

Проверка:

```bash
curl http://SERVER_IP/healthz
```

Веб-панель:

```text
http://SERVER_IP
```

Не используйте `http://SERVER_IP:3000`: этот порт намеренно доступен только
внутри сервера.

## 6. Production: домен и HTTPS

Создайте DNS-запись типа `A`:

```text
status.example.com -> SERVER_IP
```

Дождитесь обновления DNS и проверьте:

```bash
getent hosts status.example.com
```

В `.env` установите:

```env
PUBLIC_URL=https://status.example.com
COOKIE_SECURE=true
```

Скопируйте готовый Nginx-шаблон и замените домен:

```bash
cd /opt/whatsapp-status-bot
cp deploy/nginx-whatsapp-status-bot.conf \
  /etc/nginx/sites-available/whatsapp-status-bot
sed -i 's/status\.example\.com/ВАШ_ДОМЕН/g' \
  /etc/nginx/sites-available/whatsapp-status-bot
```

Активируйте конфигурацию:

```bash
rm -f /etc/nginx/sites-enabled/default
ln -sfn /etc/nginx/sites-available/whatsapp-status-bot \
  /etc/nginx/sites-enabled/whatsapp-status-bot
nginx -t
systemctl reload nginx
```

Получите сертификат:

```bash
certbot --nginx -d ВАШ_ДОМЕН
```

Certbot добавит HTTPS на `443` и перенаправление с HTTP на HTTPS. Проверьте
автоматическое продление:

```bash
certbot renew --dry-run
systemctl status certbot.timer
```

Примените production-настройки приложения:

```bash
cd /opt/whatsapp-status-bot
docker compose up -d --force-recreate
```

Проверка:

```bash
curl https://ВАШ_ДОМЕН/healthz
```

После включения HTTPS не оставляйте `COOKIE_SECURE=false`.

## 7. Первое подключение WhatsApp

1. Откройте адрес панели в браузере.
2. Войдите с помощью `UI_USER` и `UI_PASSWORD`.
3. Откройте WhatsApp на телефоне.
4. Перейдите в раздел связанных устройств.
5. Отсканируйте QR-код из панели.
6. Дождитесь состояния `Connected` или `Monitoring active`.
7. Добавьте номер или точный `@lid` контакта в список целей.

После подключения файлы авторизации появятся в `auth_session`. Не публикуйте и
не передавайте содержимое этого каталога.

## 8. Управление проектом

Запуск:

```bash
cd /opt/whatsapp-status-bot
docker compose up -d
```

Статус:

```bash
docker compose ps
```

Логи:

```bash
docker compose logs -f bot
docker compose logs --tail=200 bot
```

Перезапуск:

```bash
docker compose restart bot
```

Остановка:

```bash
docker compose stop
```

Удаление контейнера без удаления сессии и базы:

```bash
docker compose down
```

## 9. Обновление из GitHub

```bash
cd /opt/whatsapp-status-bot
git pull --ff-only
docker compose build --pull
docker compose up -d
docker compose ps
docker compose logs --tail=100 bot
```

Файл `.env`, WhatsApp-сессия и SQLite-база не отслеживаются Git и не
перезаписываются командой `git pull`.

## 10. Автозапуск

Проверьте системные службы:

```bash
systemctl is-enabled docker
systemctl is-enabled nginx
```

Ожидается:

```text
enabled
enabled
```

Проверьте политику контейнера:

```bash
docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' whatsapp-status-bot
```

Ожидается:

```text
unless-stopped
```

## 11. Данные и резервное копирование

Постоянные данные:

```text
/opt/whatsapp-status-bot/auth_session  WhatsApp-сессия
/opt/whatsapp-status-bot/data          SQLite-база
/opt/whatsapp-status-bot/.env          логин, пароль и JWT-секрет
```

Создание резервной копии:

```bash
cd /opt/whatsapp-status-bot
docker compose stop
tar -czf /root/whatsapp-status-backup-$(date +%F).tar.gz \
  auth_session data .env
docker compose up -d
```

Не добавляйте `.env`, `auth_session`, файлы SQLite и `node_modules` в Git.

## 12. Диагностика

Проверка портов:

```bash
ss -lntp | grep -E ':80|:443|:3000'
```

Ожидается, что Nginx слушает `0.0.0.0:80`/`443`, а Docker публикует приложение
только на `127.0.0.1:3000`.

Проверка Nginx:

```bash
nginx -t
systemctl status nginx
journalctl -u nginx --since "10 minutes ago"
```

Проверка контейнера:

```bash
cd /opt/whatsapp-status-bot
docker compose ps
docker compose logs --tail=200 bot
docker inspect whatsapp-status-bot --format '{{json .State.Health}}'
```

Проверка маршрута:

```bash
curl http://127.0.0.1:3000/healthz
curl http://SERVER_IP/healthz
curl https://ВАШ_ДОМЕН/healthz
```

Если первый запрос работает, а второй или третий нет, проблема находится в
Nginx, DNS, сертификате или firewall, а не в Node.js-контейнере.
