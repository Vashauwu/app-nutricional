# Cobro y «Plan y facturación» (M4)

Documento interno. Qué hace el cobro, cómo probarlo en staging y qué falta para conectar Conekta real.

## Estado

El ciclo completo está construido y probado contra una **pasarela simulada** (`PAYMENTS_PROVIDER=sim`). **No hay adaptador
de Conekta todavía**: su esquema de firma de webhooks no está claro en su documentación pública y no se debe escribir a
ciegas un verificador de firmas. Se agrega cuando haya llaves de su sandbox (ver «Para conectar Conekta»).

## Flujo (lo que ve la persona)

1. **Facturación** (`/facturacion`): planes con precio mensual y anual. Con cobro activo, el botón de cada plan dice
   «Probar 14 días gratis» (primera vez) o «Contratar».
2. **Tarjeta**: se captura en el navegador. El número y el código **nunca llegan a nuestro servidor**: el navegador los
   convierte en un *token* con el proveedor y la API solo recibe el token. (Con la simulación el token se arma en el
   navegador con los 4 últimos dígitos.)
3. **Prueba de 14 días con tarjeta**, una por consulta (`subscriptions.trial_used`). No se cobra durante la prueba. Se
   avisa por correo **3 días antes** del primer cobro (tarea cada hora, una sola vez por prueba).
4. **Cobro**: al terminar la prueba (o de inmediato si ya se usó) el proveedor cobra y avisa. Cada cobro queda en el
   **historial** (`payments`) con su estado: pagado, fallido, reembolsado, contracargo.
5. **Cobro fallido** → `past_due` con **7 días de gracia** (plan completo, aviso en pantalla); el plazo corre desde el
   primer fallo y no se renueva con cada reintento. Vencida la gracia, la consulta opera como Gratuito sin borrar nada.
6. **Cambiar de plan**: subir es inmediato (cobra el nuevo plan); bajar se programa para el siguiente periodo
   (`pending_plan`) y surte efecto al renovar.
7. **Cancelar**: conserva el plan hasta el fin del periodo pagado (o de la prueba); un cobro tardío no reactiva una cuenta
   cancelada.
8. **Cambiar tarjeta** y ver la tarjeta registrada (marca, últimos 4, vigencia).

Las cuentas con plan **concedido sin cobro** (fundadora, cortesía) no pueden contratar, cambiar ni cancelar desde la pantalla.

## Reglas de seguridad

- El estado de la suscripción cambia **solo** por la respuesta server-a-server del proveedor al contratar/cambiar, o por
  **eventos firmados** (`POST /api/v1/webhooks/billing`): sin firma válida → 401 y no cambia nada.
- Los eventos son **idempotentes** (`payment_events`): un reintento no repite el efecto. Un evento de una suscripción
  desconocida se acusa de recibo (200) para que no reintenten; un fallo interno responde 500 para que sí lo hagan.
- Las consultas de suscripción filtran **por consulta de forma explícita** (`practice_id = app_practice_id()`), además de la
  seguridad por filas: la CLI de administración se conecta como propietario y se salta esa seguridad. (Corrige un defecto
  previo: `admin set-plan` cambiaba el plan de **todas** las consultas cuando se corría como propietario.)
- `PAYMENTS_PROVIDER=sim` se rechaza en producción real (la API no arranca): una pasarela simulada dejaría «pagar» sin pagar.
  Solo se permite en desarrollo o con `ALLOW_DEMO_ACCOUNTS=true` (staging).

## Probarlo en staging (pasarela simulada)

El despliegue a staging escribe `PAYMENTS_PROVIDER=sim` y un `PAYMENTS_SIM_SECRET` aleatorio la primera vez. En `/facturacion`:

| Tarjeta | Resultado |
|---|---|
| `4242 4242 4242 4242` | Aprobada |
| `4000 0000 0000 0002` | Rechazada al registrarla |
| `4000 0000 0000 9995` | Se registra, pero el primer cobro falla (solo cuando la prueba ya se usó) |

Eventos del proveedor (cobro, fallo, cancelación, contracargo) por la CLI, que sigue el mismo camino que un aviso real:

```bash
./dc.sh staging exec api /app/admin billing-sim -email a@b.mx -event payment_succeeded   # renueva
./dc.sh staging exec api /app/admin billing-sim -email a@b.mx -event payment_failed      # entra a gracia
./dc.sh staging exec api /app/admin billing-sim -email a@b.mx -event canceled            # baja al Gratuito
./dc.sh staging exec api /app/admin billing-sim -email a@b.mx -event chargeback
```

Para volver a probar la prueba gratuita en una cuenta: `UPDATE subscriptions SET trial_used = false` de esa consulta.

## Para conectar Conekta (pendiente)

Se implementa `payments.Provider` para Conekta (`internal/payments/conekta.go`) y se prueba en su sandbox. Hay que verificar con
llaves de prueba, no suponer:

1. **Firma de webhooks**: encabezado, algoritmo y llave pública para verificarla. La documentación pública no lo deja claro.
2. **Planes y suscripciones**: crear los planes (estándar/pro, mensual/anual) en Conekta, el flujo de cliente → fuente de pago
   → suscripción, la prueba gratuita (`trial`) y qué eventos emite en cada cobro, fallo y cancelación.
3. **Tokenización en el navegador** con Conekta.js (llave pública): hoy `CardTokenizer` solo implementa la simulación.
4. **3-D Secure** y antifraude; **una prueba por tarjeta** si Conekta ofrece huella de la tarjeta.
5. Llaves en secretos del ambiente (`PAYMENTS_PROVIDER=conekta` + sus llaves), nunca en el repositorio.

Además, antes de cobrar de verdad: precios y límites aprobados, textos legales, facturación CFDI (M5) y reembolsos desde el
CRM (M6).
