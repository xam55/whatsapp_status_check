# WhatsApp Status Auto-Viewer

Серверная версия бота для запуска через Docker Compose. Локальная Windows-версия
находится отдельно в соседней папке `local` и не должна попадать в этот репозиторий.

## Схема запуска

```text
Internet -> Nginx :443 -> 127.0.0.1:3000 -> Docker container :3000
```

Compose публикует Node.js только на loopback-интерфейсе сервера. Порт `3000`
не должен быть открыт в firewall. Наружу открываются только `22`, `80` и `443`.

## Настройка

Создайте рабочий `.env`:

```bash
cp .env.example .env
```

Обязательно замените значения:

```env
PUBLIC_URL=https://status.example.com
UI_USER=admin
UI_PASSWORD=CHANGE_ME_BEFORE_START
JWT_SECRET=CHANGE_ME_TO_A_RANDOM_SECRET_AT_LEAST_32_CHARS
JWT_EXPIRES_SECONDS=43200
COOKIE_SECURE=true
```

Пароль должен содержать минимум 12 символов. Секрет можно создать командой:

```bash
openssl rand -hex 32
```

JWT подписывается только алгоритмом `HS256` и хранится в `HttpOnly`,
`Secure`, `SameSite=Strict` cookie. Placeholder-значения блокируют запуск.

## Запуск

Установите Docker Engine, Compose plugin, Nginx и Certbot. Затем:

```bash
mkdir -p auth_session data
sudo chown -R 1000:1000 auth_session data
docker compose build
docker compose up -d
docker compose ps
docker compose logs -f bot
```

Проверка приложения непосредственно на сервере:

```bash
curl http://127.0.0.1:3000/healthz
```

Ожидаемый ответ:

```json
{"ok":true}
```

## Nginx и HTTPS

Замените `status.example.com` в
`deploy/nginx-whatsapp-status-bot.conf` на реальный домен:

```bash
sudo cp deploy/nginx-whatsapp-status-bot.conf /etc/nginx/sites-available/whatsapp-status-bot
sudo ln -s /etc/nginx/sites-available/whatsapp-status-bot /etc/nginx/sites-enabled/whatsapp-status-bot
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d status.example.com
```

Certbot добавит HTTPS на `443` и перенаправление с `80`. После этого откройте
домен, войдите по данным из `.env` и отсканируйте WhatsApp QR.

## Управление

```bash
docker compose up -d
docker compose restart bot
docker compose stop
docker compose down
docker compose logs --tail=200 bot
git pull
docker compose build --pull
docker compose up -d
```

Команда `docker compose down` не удаляет bind-mounted данные в
`auth_session` и `data`. Не используйте ручное удаление этих каталогов, если
нужно сохранить WhatsApp-сессию и SQLite-базу.

## GitHub

Репозиторием должна быть именно папка `server`:

```bash
cd server
git init
git add .
git commit -m "Initial server deployment"
```

Файл `.env`, WhatsApp-сессия, SQLite-база и `node_modules` игнорируются Git.

Готовый запрос для генерации нового интерфейса в Figma находится в
`DESIGN_PROMPT.md`.
