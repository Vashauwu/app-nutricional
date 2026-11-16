# Dietocálculo

Sección independiente del panel de la nutrióloga (`/dietocalculo`) que calcula una dieta completa y puede enlazarse con un paciente.

## Pestañas
1. **Cálculos**: datos del paciente (con interruptores de deportista, hospitalizado, amputación, embarazo y lactancia) y cinco subpestañas:
   - *Gasto y prescripción*: compara **8 ecuaciones** lado a lado (Valencia, Mifflin-St Jeor, Harris-Benedict 1919, Roza y Shizgal, FAO/OMS/UNU, Owen, Katch-McArdle, Cunningham), nivel de actividad, objetivo (déficit/superávit), ETA y prescripción final con macros.
   - *Antropometría e IMC*: IMC (NOM-008), ICC, ICT, superficie corporal (Mosteller, Du Bois), estatura por altura de rodilla (Chumlea), complexión (Grant) y **pesos ideales** (Hamwi, Robinson, Miller, Lorentz, Devine, promedio y peso ajustado).
   - *Composición corporal*: pliegues cutáneos, **Durnin-Womersley (Siri)**, Faulkner, US Navy, Deurenberg y % capturado (se elige el método), masa magra y grasa, FFMI, cAMA, AGB, agua corporal (Watson).
   - *Macronutrimentos*: proteína en g/kg + lípidos en %, hidratos por diferencia.
   - *Embarazo y lactancia*: ganancia de peso recomendada y energía adicional (IOM).
2. **Dietocálculo**: **17 grupos SMAE** con deslizador y valor numérico, meta calórica, presets de macros, resumen de adecuación (meta contra suma) y configuración (paso y máximo por grupo). Lo que se mueve queda «fijo» y el resto se reajusta.
3. **Distribución**: tabla **editable** de equivalentes por tiempo de comida con «Restante», 3/5 tiempos o agregar/quitar, horarios y metas, y balance por tiempo (kcal, macros, meta contra real).
4. **Dieta**: arma cada tiempo con **platillos y alimentos reales** de la biblioteca y el catálogo SMAE, cantidades editables, equivalentes pendientes (con acceso directo al alimento), «Sugerir platillos», nutrimentos o equivalentes por tiempo y total.

Encabezado: **Vista previa**, **Exportar** (imprimir/PDF y CSV) y **Guardar**. Una dieta puede guardarse suelta o enlazada a un paciente («Traer datos del expediente»).

## Lo que NO está (y por qué)
- **Ecuación de Valencia**: solo el tramo de mujeres de 18 a 29 años (verificado contra la referencia). Los demás tramos quedan «no disponibles» hasta validar los coeficientes con la publicación.
- **Mendoza-Núñez, Hirani, Arango y Frisancho (codo)**: no se cargaron; no hay coeficientes verificados.
- **Schofield con talla**, **Metropolitan**, **alcohol como grupo** y **fibra por equivalente**: sin datos confiables.
- **Vitaminas, minerales, índice/carga glucémica, colesterol y ácidos grasos**: el catálogo SMAE de ejemplo solo trae energía, macros y fibra. Se mostrarán cuando el catálogo los incluya.
- **«Motor nuevo»** y **«+ Evaluación clínica»** de la referencia: no se replicaron (no se sabe qué calculan).

## Arquitectura
- Go: `backend/internal/dietocalculo` (motor puro + servicio + rutas `/api/v1/diet-calculations`, permiso `patients:manage`, auditoría). Migración `000011_diet_calculations`.
- Angular: `frontend/src/app/features/dietocalculo` (motor espejo en TypeScript + una pestaña por componente y un almacén de estado compartido).
- **Paridad**: ambos motores se prueban contra `testdata/golden.json` (copia en `engine.golden.json`, 10 casos). Si cambias una fórmula: edítala en los dos y regenera con `UPDATE_GOLDEN=1 go test ./internal/dietocalculo`.
- El servidor recalcula siempre al guardar; el resultado guardado es el del motor del servidor. Los platillos y alimentos de la dieta se guardan como copia (no cambian si luego se edita el platillo).

## Origen de las fórmulas
Todas son fórmulas y tablas publicadas (citadas en el código). Se escribieron desde esas fuentes; no se copió código de otra aplicación. Los valores de una persona de referencia (27 años, 55 kg, 173 cm) coinciden con los de las capturas de la aplicación de referencia (Harris-Benedict, Katch-McArdle, Cunningham, Owen, FAO) y están como pruebas. Es una herramienta de apoyo y no sustituye el criterio clínico.

## Inteligencia de equivalentes (auditoría empírica)

Botón «Auditoría empírica» en la pestaña Dietocálculo ([audit.ts](../frontend/src/app/features/dietocalculo/audit.ts), [dc-audit.ts](../frontend/src/app/features/dietocalculo/dc-audit.ts)).

- **Objetivos:** salud general, pérdida de peso, control glucémico, masa muscular, dislipidemias e hipertensión. Cada uno define un reparto HCO-LIP-PRO, equivalentes fijos y criterios de revisión basados en recomendaciones generales de alimentación (orientativas, editables en `OBJECTIVES`).
- **Empírico:** corre el mismo motor del cuadro con el reparto del objetivo y muestra Actual → Sugerido por grupo. «Aplicar propuesta» escribe macros y equivalentes; «Aplicar solo desvíos» toca únicamente los grupos que se alejan 1.5 eq o más.
- **Auditar:** revisa el reparto actual contra los criterios del objetivo sin proponer cambios.
- **Índice de practicidad culinaria:** criterio propio (0–100) que descuenta porciones fuera de lo habitual, demasiados o muy pocos grupos, varios tipos de AOA y desvíos contra la propuesta; el modal explica cada descuento. No es un índice validado clínicamente.
- Solo vive en el frontend: lo que se aplica son entradas del motor, que el servidor recalcula al guardar, así que no hay paridad Go/TS que mantener.
