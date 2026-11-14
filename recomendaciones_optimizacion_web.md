# Recomendaciones de optimización web del Reel

> **Nota:** El Reel presenta recomendaciones de optimización, no comandos de terminal. Esta lista contiene los 26 puntos que se pudieron identificar en la revisión del vídeo. Algunas pantallas no permitieron leer con suficiente claridad el texto; por eso no se completan los puntos restantes por inferencia.

## Lista de recomendaciones

1. **Add skeleton loading states** — Agregar estados de carga Skeleton.
2. **Serve images in WebP or AVIF** — Servir imágenes en formatos WebP o AVIF.
3. **Prevent duplicate API calls** — Evitar llamadas API duplicadas.
4. **Debounce search and autocomplete inputs** — Aplicar debounce a búsquedas y autocompletado.
5. **Serve static files** — Servir archivos estáticos.
6. **Move slow tasks to a background** — Mover tareas lentas al procesamiento en segundo plano.
7. **Fix N+1 queries** — Corregir consultas N+1.
8. **Cache frequently accessed data** — Almacenar en caché los datos consultados frecuentemente.
9. **Remove unused code** — Eliminar código que no se utiliza.
10. **Set timeouts for external APIs** — Configurar tiempos de espera para API externas.
11. **Stream API responses** — Transmitir respuestas de API por streaming.
12. **Update the UI before the server responds** — Actualizar la interfaz antes de recibir la respuesta del servidor.
13. **Lazy-load images below the screen** — Cargar imágenes bajo demanda.
14. **Add database indexes** — Agregar índices a las bases de datos.
15. **Trace slow backend requests with OpenTelemetry** — Rastrear solicitudes lentas con OpenTelemetry.
16. **Place servers close** — Ubicar servidores cerca de los usuarios.
17. **Render pages on the server** — Renderizar páginas desde el servidor.
18. **Load third-party scripts after the page** — Cargar scripts de terceros después.
19. **Split JavaScript bundles** — Dividir los paquetes JavaScript.
20. **Select only the columns** — Seleccionar únicamente las columnas necesarias.
21. **Use connection pooling** — Utilizar agrupación de conexiones.
22. **Enable browser caching** — Habilitar caché del navegador.
23. **Load-balance traffic across servers** — Distribuir el tráfico entre servidores.
24. **Self-host fonts** — Alojar las fuentes localmente.
25. **Track real-time web speed** — Monitorizar el rendimiento web en tiempo real.
26. **Test on slow phones** — Probar en teléfonos de bajo rendimiento.

## Priorización sugerida para Nutrintegral (Angular + Go)

| Prioridad | Técnica |
|---|---|
| Alta | Lazy loading |
| Alta | WebP / AVIF |
| Alta | Database indexes |
| Alta | N+1 queries |
| Alta | API caching |
| Alta | Debounce |
| Media | OpenTelemetry |
| Media | Connection pooling |
| Media | JavaScript bundle splitting |
| Media | Skeleton loading |

## Estado de implementación

El detalle punto por punto está en [docs/rendimiento.md](docs/rendimiento.md). El punto 26 (probar en teléfonos de bajo rendimiento) queda pospuesto hasta que exista un módulo móvil.

## Aplicación

Estas optimizaciones pueden ayudar a mejorar:

- Los tiempos de carga de la aplicación.
- La velocidad de respuesta de las API.
- El uso de recursos del navegador y del servidor.
- La experiencia de usuario, especialmente en dispositivos de bajo rendimiento.

