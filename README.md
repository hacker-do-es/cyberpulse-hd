<p align="center">
  <img src="app/public/hackerdo-logo.png" alt="Hacker-Do" height="72" />
</p>

<h1 align="center">Hacker-Do CyberPulse</h1>

<p align="center">Inteligencia de amenazas a la medida del stack tecnológico de cada cliente, entregada en Slack o Rocket.Chat.</p>

---

CyberPulse agrega más de 100 fuentes RSS de ciberseguridad (CISA, CERTs, fabricantes, medios, exploit DBs), cruza cada noticia con el stack tecnológico de cada empresa y le envía a su canal un resumen periódico, con un resumen ejecutivo escrito por Claude u OpenAI.

Es una plataforma **multiempresa**: Hacker-Do da de alta las empresas, y cada una tiene su propio stack, su propia API key de IA, sus canales de salida y sus horarios, completamente aislados.

## Funcionalidades

| | |
|---|---|
| **Multiempresa** | Superadmin de Hacker-Do crea empresas y su primer admin. Cada empresa ve solo lo suyo. Desactivar una empresa la deja sin acceso en el acto. |
| **Usuarios y roles** | `superadmin` (todas las empresas), `admin` (stack, IA, canales y usuarios de su empresa), `member` (solo lectura + generar posts). |
| **Login seguro** | Contraseñas con scrypt, cookie de sesión `HttpOnly` + `SameSite=Strict`, cabecera anti-CSRF, bloqueo tras 5 intentos fallidos, 2FA TOTP opcional (Google/Microsoft Authenticator, 1Password…). |
| **Stack por CSV** | Importación con vista previa, modo *añadir* o *reemplazar*. Acepta coma, punto y coma (Excel en español) o tabulador; cabeceras en inglés o español, en cualquier orden. Exportación a CSV protegida contra inyección de fórmulas. |
| **IA por empresa** | Claude (SDK oficial de Anthropic; Opus, Sonnet o Haiku) u OpenAI. La key se guarda cifrada y nunca vuelve al navegador. |
| **Canales** | Webhooks entrantes de Slack y Rocket.Chat, varios por empresa. Botones de *probar* y *enviar ahora*, historial de envíos. |
| **Periodicidad** | Por canal: diario, días hábiles, semanal, días a elección a una hora (HH:MM) o cada N horas. Se calcula en la zona horaria de la empresa, con cambio de horario incluido. |
| **Digest inteligente** | Solo noticias nuevas que matchean el stack, filtradas por severidad mínima, agrupadas por severidad, sin repetir nunca un artículo en el mismo canal. Si no hay nada nuevo, no se envía nada. |

## Puesta en marcha (Docker)

```bash
cd app
cp .env.example .env
# Editar .env: CYBERPULSE_SECRET=$(openssl rand -hex 32) y el primer superadmin
docker compose up -d --build
```

Abrir `http://localhost:3001`, entrar con el superadmin, y en **Companies → New company** crear la primera empresa con su admin. Después borrar `CYBERPULSE_ADMIN_PASSWORD` del `.env`.

> **Importante:** guardá una copia de `CYBERPULSE_SECRET`. Sin él no se pueden descifrar las API keys, los webhooks ni los secretos 2FA guardados.

Por defecto el puerto solo escucha en `127.0.0.1`; publicalo detrás de un reverse proxy con HTTPS (Traefik, Cloudflare Tunnel) y poné `TRUST_PROXY=1`. Para probar en una LAN por `http://IP:3001`: `CYBERPULSE_BIND=0.0.0.0` y `CYBERPULSE_PLAIN_HTTP=true`.

### CLI de operador

```bash
docker exec -it cyberpulse npx tsx server/cli.ts create-superadmin <usuario>
docker exec -it cyberpulse npx tsx server/cli.ts set-password <usuario>
docker exec -it cyberpulse npx tsx server/cli.ts reset-totp <usuario>
docker exec -it cyberpulse npx tsx server/cli.ts list-users
```

## Configurar un canal

**Slack:** *Apps → Incoming Webhooks → Add to Slack*, elegir el canal y copiar la URL `https://hooks.slack.com/services/…`.

**Rocket.Chat:** *Administración → Integraciones → Nueva → Webhook entrante*, elegir el canal, guardar y copiar la *Webhook URL* (`https://chat.ejemplo.com/hooks/…`). Si el servidor Rocket.Chat está en una red privada, activar `CYBERPULSE_ALLOW_PRIVATE_WEBHOOKS=true`.

En CyberPulse: **Channels → New channel**, pegar la URL, elegir horario y severidad mínima, y usar **Test** para verificar.

## Formato del CSV

```csv
technology,version,vendor,category
WordPress,6.4,Automattic,CMS
FortiOS,7.2,Fortinet,Firewall
PHP,8.2,,Runtime
```

Solo `technology` es obligatoria. También se aceptan las cabeceras `tecnología`, `versión`, `fabricante`/`proveedor`, `categoría`/`tipo`, o un archivo sin cabecera en ese orden. Máximo 2000 filas / 1 MB. La plantilla se descarga desde el diálogo de importación.

## Seguridad

- Secretos de empresa (API keys de IA, URLs de webhook, semillas TOTP) cifrados con AES-256-GCM; en producción el servidor no arranca sin `CYBERPULSE_SECRET`.
- Aislamiento por empresa aplicado en cada consulta del backend (`tenant_id`), cubierto por tests end-to-end.
- Webhooks con protección SSRF: solo `https`, sin redirecciones, resolución DNS propia que bloquea direcciones privadas, loopback, link-local y metadata de la nube, y conexión a la IP ya validada.
- El contenido de los feeds se trata como no confiable: se escapa en Slack/Rocket.Chat (no puede inyectar `@channel` ni enlaces), y del resumen de IA se eliminan URLs, así que los enlaces del digest salen siempre de la base de datos.
- Rate limiting en login, escrituras y envíos manuales; CSP estricta con helmet.

## Desarrollo

```bash
cd app
npm install
npm run dev              # API en :3001 + Vite en :3000
npm test                 # tests unitarios + end-to-end multiempresa
npm run typecheck:server
npm run build
```

Variables de entorno: ver [`app/.env.example`](app/.env.example).

## Créditos y licencia

Basado en [CyberPulse](https://github.com/safernandez666/CyberPulse) de **Santiago Fernández**, publicado bajo licencia MIT. Esta versión agrega la plataforma multiempresa, autenticación, canales, programación, importación CSV, integración con Claude y la identidad de Hacker-Do, y quita la integración con LinkedIn. Ver [`LICENSE`](LICENSE) y [`NOTICE`](NOTICE). La documentación original está en [`docs/upstream/`](docs/upstream/).
