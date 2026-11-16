# Carretons — versión Vercel

Web de gestión de la Baixada de Carretons, portada de PHP a:

- **Frontend estático** (`public/`): HTML + Bootstrap, sin PHP.
- **API serverless** (`api/index.js`): las ~60 acciones de `api.php`, con la misma SQL.
- **MySQL en la nube** (ver abajo).

## Estructura

```
api/index.js          ← todo api.php (login, cursa, rankings, comissaris, reset…)
lib/                  ← conexión BD, sesión firmada, notificaciones FCM
public/               ← páginas (index, login, penyes, sortida, meta, speaker…)
public/js/            ← common.js (apiCall) y shell.js (menú/barra según rol)
schema.sql            ← tablas de la base de datos
vercel.json           ← URLs limpias + redirecciones de las antiguas .php
```

URLs: `/?mod=penyes` ahora es `/penyes`. Las antiguas (`index.php?mod=…`, `speaker.php`…) redirigen solas.

## Puesta en marcha

### 1. Base de datos (la de InfinityFree NO sirve)
InfinityFree no admite conexiones externas, así que Vercel no puede llegar a ella.
Usa un MySQL en la nube. Opciones con plan gratuito: **TiDB Cloud Starter**, **Aiven**, **Railway**.

1. Crea la base de datos y copia su cadena de conexión.
2. Ejecuta `schema.sql` en ella (consola SQL del proveedor).
   - Mejor aún: exporta el esquema real desde phpMyAdmin de InfinityFree y úsalo en lugar de `schema.sql` (este es una reconstrucción a partir del código).
   - Si quieres conservar datos, exporta solo los **datos** (INSERTs) desde phpMyAdmin e impórtalos después.

### 2. Vercel
1. Sube esta carpeta a un repositorio de GitHub e impórtalo en Vercel (Framework preset: **Other**), o ejecuta `npx vercel` desde aquí.
2. En *Settings → Environment Variables* define (ver `.env.example`):

| Variable | Qué es |
|---|---|
| `DATABASE_URL` | `mysql://usuario:contraseña@host:puerto/basedatos` |
| `SESSION_SECRET` | cadena aleatoria larga (`openssl rand -hex 32`) |
| `CODE_STANDARD` | código de acceso estándar |
| `CODE_ADMIN` | código de administrador |
| `CODE_SPEAKER` | código de speaker |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | *(opcional)* notificaciones push |
| `DB_SSL=false` / `DB_SSL_INSECURE=true` | *(opcional)* solo si tu proveedor no usa TLS / usa certificado propio |

3. Despliega. Entra en `/login` con tus códigos.

## Qué ha cambiado respecto al PHP

- **Códigos de acceso y credenciales fuera del código**: ahora viven en variables de entorno (antes estaban escritos en `login.php` y `db.php`).
- **Sesión**: cookie firmada (HttpOnly, 7 días) en vez de sesión PHP. Hay botón *Sortir* en la barra.
- **`reset.php` → `/reset`**: antes cualquiera podía abrirlo y borrar la competición; ahora exige sesión de **admin**, método POST y escribir «REINICIAR». Además recrea las filas de inspección de cada penya.
- **Notificaciones push**: la API "legacy" de FCM que usaba el PHP ya no existe. Ahora usan FCM HTTP v1 (`firebase-admin`) y solo se activan si defines `FIREBASE_SERVICE_ACCOUNT_JSON`. Se añade `firebase-messaging-sw.js`, que faltaba.
- Errores internos: la API ya no devuelve el mensaje SQL al navegador (queda en los logs de Vercel).

## Pendiente / a tener en cuenta

- Los módulos **tablet, test, comissari, direccio1 y direccio2** aparecían en el código de `index.php` pero **no venían en el zip** (en el original ya mostraban «Mòdul no trobat»). Si existen en tu servidor, pásamelos y los porto.
- Los códigos son cortos (3–4 dígitos) y se pueden adivinar por fuerza bruta; usa códigos más largos en `CODE_*`.
- Las pantallas consultan la API cada pocos segundos. En el plan Hobby de Vercel hay un límite mensual de invocaciones; vigílalo si hay muchos dispositivos conectados a la vez durante el evento.
