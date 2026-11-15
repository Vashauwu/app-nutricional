# Rendimiento: qué se hizo y qué queda para infraestructura

Referencia: `recomendaciones_optimizacion_web.md`. Estado de cada punto tras el escaneo del proyecto.

| # | Recomendación | Estado | Dónde |
|---|---|---|---|
| 1 | Skeleton loading | Hecho | Tablero y «Hoy» de la paciente (nuevos); listados ya lo tenían |
| 2 | WebP / AVIF | Parcial | El cliente convierte a WebP; el servidor guarda JPEG (WebP/AVIF en servidor requiere cgo, ver `storage/service.go`) |
| 3 | Llamadas API duplicadas | Hecho | `ApiClient.get` comparte GET idénticos en curso |
| 4 | Debounce | Ya existía | Listados y catálogo (200–250 ms); el selector de alimentos filtra en memoria |
| 5 | Archivos estáticos | Hecho | Caddy: hashes inmutables 1 año, imágenes 7 días |
| 6 | Tareas lentas en segundo plano | Hecho | Finalizar planes vencidos (ticker) y correos de recuperación |
| 7 | Consultas N+1 | Hecho | `alerts.Published` (tablero): antes ~8 consultas × hasta 200 planes |
| 8 | Caché de datos frecuentes | Hecho | ETag/304 en todo GET JSON de `/api/v1` (`middleware/etag.go`) |
| 9 | Código sin usar | Hecho | `staticcheck` (Go) y `knip` (Angular): se eliminaron `authGuard`, `NUTRIENT_LABEL`, `NUTRIENT_UNIT`, `dishLabel`, `itemKey`, `conditionReq` y 2 ayudantes de pruebas |
| 10 | Timeouts de APIs externas | Hecho | SMTP ya tenía; ahora el servidor HTTP también (lectura, escritura, inactividad) |
| 11 | Respuestas en streaming | No aplica | Sin respuestas largas ni incrementales; las descargas pasan directo por ETag |
| 12 | UI optimista | Hecho | Marcar/desmarcar comida en la app de la paciente, con reversión si falla |
| 13 | Imágenes diferidas | Hecho | `loading="lazy"` + `decoding="async"` en todas las imágenes bajo el pliegue |
| 14 | Índices | Hecho | Migración `000010_performance_indexes` |
| 15 | OpenTelemetry | Hecho | `internal/telemetry`; trazas HTTP y SQL; se activa con `OTEL_EXPORTER_OTLP_ENDPOINT` |
| 16 | Servidores cerca | Infra | Elegir región cercana a México (p. ej. Querétaro / Virginia con CDN) |
| 17 | SSR | Descartado | App autenticada tras login; SSR no mejora la carga útil y complica cookies/CSRF |
| 18 | Scripts de terceros | Hecho | No hay terceros; se eliminó Google Fonts |
| 19 | Dividir bundles | Ya existía | Todas las rutas son lazy; inicial 153 kB transferidos |
| 20 | Seleccionar solo columnas | Hecho | `ListPlans`, `ListTemplates` (cuenta días en SQL, sin traer el JSON), `GetPatientName` y `GetPatientIndications` (alertas y agenda); sqlc regenerado. Los `SELECT *` restantes devuelven la fila completa que el código sí usa |
| 21 | Pool de conexiones | Hecho | `DB_MAX_CONNS`, `DB_MIN_CONNS`, vida y espera máximas |
| 22 | Caché del navegador | Hecho | Caddy + service worker |
| 23 | Balanceo de carga | Infra | El límite de intentos es en memoria: antes de varias réplicas, moverlo a Redis |
| 24 | Fuentes locales | Hecho | `@fontsource/inter` y `@fontsource/playfair-display` |
| 25 | Velocidad real | Hecho | Web Vitals → `POST /api/v1/client-metrics` → registro `web_vital` |
| 26 | Teléfonos lentos | Pospuesto | No hay módulo móvil todavía |

## Cómo ver los resultados

- **Peticiones lentas:** buscar `slow_request` en los registros de la API (umbral `SLOW_REQUEST_THRESHOLD`).
- **Velocidad real:** buscar `web_vital` (LCP, CLS, INP, FCP, TTFB con su calificación y la conexión del dispositivo).
- **Trazas:** definir `OTEL_EXPORTER_OTLP_ENDPOINT` apuntando a Jaeger/Tempo/Grafana; cada consulta SQL aparece como un tramo.
