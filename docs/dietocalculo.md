# Dietocálculo

Sección independiente del panel de la nutrióloga (`/dietocalculo`) que calcula una dieta completa y puede enlazarse con un paciente.

## Qué calcula
1. **Cálculos**: IMC (NOM-008, con puntos de corte de estatura baja), peso ideal (Devine), superficie corporal (Mosteller y Du Bois), ICC, ICT, cintura, complexión (muñeca), estatura por altura de rodilla (Chumlea), composición corporal (capturada, método de la marina o Deurenberg), gasto basal (Mifflin-St Jeor, Harris-Benedict, FAO/OMS, Katch-McArdle, Cunningham), actividad, efecto térmico, amputaciones (Osterkamp), hospitalización (factor de estrés), embarazo (IOM 2009/2005) y lactancia.
2. **Dietocálculo**: reparto de macronutrimentos y **cuadro dietosintético** con equivalentes SMAE (VER, FRU, CER, LEG, AOA, LEC-D, GRA, AZU). Los grupos se calculan solos; si la nutrióloga cambia uno queda «fijo» y el resto se reajusta. Margen de ±5 %.
3. **Distribución**: equivalentes por tiempo de comida (método del mayor residuo, medios equivalentes).
4. **Dieta**: resumen imprimible por tiempo de comida.

## Enlace con pacientes
Una dieta puede guardarse suelta o enlazada. Al enlazar, «Traer datos del expediente» copia edad, sexo, peso, talla, cintura, cadera, % de grasa, muñeca y el embarazo vigente. Desde el expediente: «Más → Nueva dieta / Dietas guardadas».

## Arquitectura
- Go: `backend/internal/dietocalculo` (motor puro + servicio + rutas `/api/v1/diet-calculations`, permiso `patients:manage`, auditoría). Migración `000011_diet_calculations`.
- Angular: `frontend/src/app/features/dietocalculo` (motor espejo en TypeScript para resultados al instante).
- **Paridad**: ambos motores se prueban contra `testdata/golden.json` (copia en `engine.golden.json`). Si cambias una fórmula: edítala en los dos y regenera con `UPDATE_GOLDEN=1 go test ./internal/dietocalculo`.
- El servidor recalcula siempre al guardar; el resultado guardado es el del motor del servidor.

## Origen de las fórmulas
Todas son fórmulas y tablas publicadas (citadas en el código). Este motor se escribió desde esas fuentes; no se copió código de otra aplicación. Es una herramienta de apoyo y no sustituye el criterio clínico.
