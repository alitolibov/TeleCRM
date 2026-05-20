# Deployment guide

Деплой одной VPS-машины через Docker Compose + Caddy (автоматический HTTPS).

## 0. Чего тебе понадобится

- **VPS** с Ubuntu 22.04+ и минимум 2 GB RAM. Рекомендую **Hetzner Cloud CPX21**
  (~€5/мес, Германия) или **DigitalOcean Droplet** (4$/мес).
- **Домен.** Любой регистратор (Namecheap, Cloudflare, Reg.ru). Тебе нужно два
  A-record:
  - `app.твой-домен.ru   →  IP сервера`
  - `api.твой-домен.ru   →  IP сервера`
  Подождать ~5-30 минут чтобы DNS разошёлся.
- **Telegram API credentials** на https://my.telegram.org/apps (`api_id`, `api_hash`).
  Лучше отдельный TG-аккаунт под бота (тот, чьим именем менеджеры будут
  общаться). Сейчас у тебя в `.env` уже есть рабочая пара — используй её.

## 1. Установить Docker на VPS

SSH-ишься на сервер (`ssh root@IP_сервера`) и выполняешь:

```bash
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
docker --version    # должна выдать что-то вроде Docker version 27.x
```

## 2. Залить код

С локальной машины:

```bash
# Из корня проекта TeleCRM
ssh root@IP_сервера "mkdir -p /opt/telecrm"
rsync -avz --exclude node_modules --exclude .nuxt --exclude .output \
            --exclude .git --exclude data --exclude '.env' \
            ./ root@IP_сервера:/opt/telecrm/
```

Альтернатива: запушить проект на GitHub, на сервере `git clone`.

## 3. Перенести TDLib-сессию (чтобы не вводить SMS-код заново)

У тебя локально в `data/tdlib/` лежит уже авторизованная сессия TDLib —
бинлог с access-токеном к твоему Telegram-аккаунту. Если его перенести,
воркер на сервере подключится без повторного логина.

```bash
# С локальной машины
rsync -avz ./data/ root@IP_сервера:/opt/telecrm/data/

# На сервере — отдадим TDLib-данные docker-volume
ssh root@IP_сервера
cd /opt/telecrm
docker volume create telecrm_tdlib_data
docker run --rm -v telecrm_tdlib_data:/dst -v "$(pwd)/data":/src alpine \
  sh -c "cp -r /src/tdlib/* /dst/"
```

> Если делаешь с нуля без переноса — воркер при первом запуске попросит
> SMS-код. Тогда после `docker compose up` подключайся через
> `docker compose attach tg-worker` и вводи код прямо в терминал.

## 4. Заполнить env-файл

На сервере:

```bash
cd /opt/telecrm
cp deploy/.env.production.example .env
nano .env
```

Что **обязательно** поменять:
- `WEB_DOMAIN` и `API_DOMAIN` — твои реальные домены
- `WEB_URL`, `PUBLIC_API_URL`, `PUBLIC_WS_URL` — должны строго совпадать с
  доменами выше, со схемой `https://`
- `POSTGRES_PASSWORD` — придумай длинный пароль
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` — сгенерируй:
  ```bash
  openssl rand -base64 48
  ```
  и вставь в файл (каждый секрет — свой)
- `TG_API_ID`, `TG_API_HASH`, `TG_PHONE_NUMBER` — из твоего локального
  `.env`

## 5. Поднять стек

```bash
cd /opt/telecrm
docker compose -f docker-compose.prod.yml up -d --build
```

Первая сборка займёт **5-10 минут** (надо собрать 3 приложения).

После сборки:

```bash
docker compose -f docker-compose.prod.yml ps
# должны быть в Up: postgres, redis, api, tg-worker, web, caddy
```

## 6. Проверка

> Миграции и сид (создание admin-пользователя) запускаются **автоматически**
> при старте API-контейнера. Отдельные команды накатывать не нужно.

Открываешь `https://app.твой-домен.ru` — Caddy сам выпустит Let's Encrypt
сертификат за ~10 секунд, дальше браузер откроет логин-форму.

Логин: `admin` / `admin123` (из дев-сида), **сразу поменяй пароль** через БД
если оставляешь сервер «в проде».

## Полезные команды (на сервере)

```bash
# Логи всех сервисов
docker compose -f docker-compose.prod.yml logs -f

# Логи конкретного сервиса
docker compose -f docker-compose.prod.yml logs -f tg-worker

# Привязаться к воркеру (для ввода SMS-кода если без переноса сессии)
docker compose -f docker-compose.prod.yml attach tg-worker

# Перезапустить один сервис
docker compose -f docker-compose.prod.yml restart api

# Обновить код после правок
cd /opt/telecrm
git pull               # или повторить rsync с локалки
docker compose -f docker-compose.prod.yml up -d --build

# Полный wipe (БД, TDLib-сессия — всё)
docker compose -f docker-compose.prod.yml down -v
```

## Troubleshooting

**Caddy ругается «no acme account / TLS fails»**
DNS ещё не разошёлся. Подожди 10-20 минут и `docker compose restart caddy`.

**tg-worker крашится «Can't lock binlog»**
Старый процесс не отпустил volume. `docker compose restart tg-worker`.

**Web показывает 502**
Подожди ~30 сек после старта — Nuxt билдит first-request bundle. Если не
проходит — `docker compose logs web`.

**Login: «CORS error»**
В `.env`: `WEB_URL` обязан совпадать с тем что отдаёт браузер
(`https://`, без слеша в конце).
