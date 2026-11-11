import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { Observable, Subject, delay, of } from 'rxjs';
import { Db, Dish, DishVersion, Id, Patient, SmaeFood } from '../../shared/models/domain';
import { FoodView, fromCustom, fromSmae } from '../nutrition/engine';
import { DB_SCHEMA, buildSeed } from './seed';
import { uid } from '../../shared/utils/format';
import { isApiMode } from '../api/api-client';

const KEY = 'nutri-demo-db';

/** En modo API se conserva el catálogo y los platillos de ejemplo, pero ningún paciente simulado. */
function withoutDemoPatients(db: Db): Db {
  return { ...db, patients: [], plans: [], tracking: [], consentAcceptances: [], templates: db.templates.filter((t) => t.scope === 'global'), sessions: [], audit: [] };
}

/**
 * Base de datos simulada del cliente. Hace el papel del backend REST + SSE hasta
 * que exista la API Go: los datos son SINTÉTICOS (sin información real de
 * pacientes) y por eso pueden vivir en localStorage. Los tokens de sesión
 * NUNCA se guardan aquí (§5.1).
 */
@Injectable({ providedIn: 'root' })
export class DbService {
  private readonly state = signal<Db>(this.load());
  readonly db = this.state.asReadonly();
  /** Se incrementa en cada mutación: las consultas lo leen para re-ejecutarse. */
  readonly version = signal(0);
  /** Quién ejecuta las mutaciones (para auditoría y autoría). */
  readonly actor = signal('Sistema');
  /** Simula SSE (§21.7): se emite cuando otra pestaña modifica los datos. */
  readonly external$ = new Subject<void>();
  readonly online = signal(typeof navigator === 'undefined' ? true : navigator.onLine);
  /** Conexión forzada a "sin red" desde las herramientas de demostración. */
  readonly forcedOffline = signal(false);
  readonly isOnline = computed(() => this.online() && !this.forcedOffline());

  private saveTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    const destroyRef = inject(DestroyRef);
    const onStorage = (e: StorageEvent): void => {
      if (!isApiMode() && e.key === KEY && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue) as Db;
          if (parsed.schema === DB_SCHEMA) {
            this.state.set(parsed);
            this.version.update((v) => v + 1);
            this.external$.next();
          }
        } catch {
          /* se ignora un valor corrupto de otra pestaña */
        }
      }
    };
    const setOnline = (): void => this.online.set(navigator.onLine);
    window.addEventListener('storage', onStorage);
    window.addEventListener('online', setOnline);
    window.addEventListener('offline', setOnline);
    destroyRef.onDestroy(() => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('online', setOnline);
      window.removeEventListener('offline', setOnline);
    });
  }

  private load(): Db {
    // Modo API: los datos clínicos viven en el servidor. Nunca se leen ni se guardan en el navegador (§4.2).
    if (isApiMode()) return withoutDemoPatients(buildSeed());
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Db;
        if (parsed.schema === DB_SCHEMA) return parsed;
      }
    } catch {
      /* almacenamiento no disponible: se usa el seed en memoria */
    }
    return buildSeed();
  }

  private persist(): void {
    if (isApiMode()) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify(this.state()));
      } catch {
        /* cuota llena o modo privado: la app sigue funcionando en memoria */
      }
    }, 300);
  }

  /** Aplica un cambio sobre una copia y publica el nuevo estado. */
  mutate<T = void>(fn: (draft: Db) => T): T {
    const draft = structuredClone(this.state());
    const result = fn(draft);
    this.state.set(draft);
    this.version.update((v) => v + 1);
    this.persist();
    return result;
  }

  audit(draft: Db, action: string, resourceType: string, resourceId: string, summary: string): void {
    draft.audit.unshift({
      id: uid('au'),
      at: new Date().toISOString(),
      actor: this.actor(),
      action,
      resourceType,
      resourceId,
      summary,
      requestId: `req-${uid().slice(0, 6)}`,
    });
    draft.audit.length = Math.min(draft.audit.length, 500);
  }

  reset(): void {
    if (isApiMode()) return;
    this.state.set(buildSeed());
    this.version.update((v) => v + 1);
    try {
      localStorage.setItem(KEY, JSON.stringify(this.state()));
    } catch {
      /* ignorado */
    }
  }

  /** Respuesta con latencia simulada, para que existan estados de carga reales (§20.2). */
  respond<T>(compute: () => T, ms = 220): Observable<T> {
    return new Observable<T>((sub) => {
      try {
        sub.next(compute());
        sub.complete();
      } catch (e) {
        sub.error(e);
      }
    }).pipe(delay(ms));
  }

  asObservable<T>(value: T, ms = 120): Observable<T> {
    return of(value).pipe(delay(ms));
  }

  // ---------- Lecturas derivadas ----------
  readonly activeEdition = computed(() => this.state().editions.find((e) => e.status === 'active') ?? this.state().editions[0]);

  readonly activeGroups = computed(() => {
    const ed = this.activeEdition().id;
    return this.state().groups.filter((g) => g.editionId === ed).sort((a, b) => a.sortOrder - b.sortOrder);
  });

  readonly activeSubgroups = computed(() => {
    const ids = new Set(this.activeGroups().map((g) => g.id));
    return this.state().subgroups.filter((s) => ids.has(s.groupId));
  });

  subgroupName = (code: string): string => this.activeSubgroups().find((s) => s.code === code)?.name ?? code;

  groupOfSubgroup = (code: string) => {
    const sg = this.activeSubgroups().find((s) => s.code === code);
    return this.activeGroups().find((g) => g.id === sg?.groupId);
  };

  readonly activeFoods = computed<FoodView[]>(() => {
    const ed = this.activeEdition().id;
    const smae = this.state().foods.filter((f) => f.editionId === ed).map(fromSmae);
    const custom = this.state().customFoods.filter((f) => f.status === 'active').map(fromCustom);
    return [...smae, ...custom];
  });

  foodsOfEdition(editionId: Id): SmaeFood[] {
    return this.state().foods.filter((f) => f.editionId === editionId);
  }

  resolveFood = (ref: { kind: 'smae' | 'custom'; id: Id }): FoodView | undefined => {
    const s = this.state();
    if (ref.kind === 'custom') {
      const c = s.customFoods.find((f) => f.id === ref.id);
      return c ? fromCustom(c) : undefined;
    }
    const f = s.foods.find((x) => x.id === ref.id);
    return f ? fromSmae(f) : undefined;
  };

  patient = (id: Id): Patient | undefined => this.state().patients.find((p) => p.id === id);
  dish = (id: Id): Dish | undefined => this.state().dishes.find((d) => d.id === id);

  dishVersion = (id: Id, version: number): DishVersion | undefined =>
    this.dish(id)?.versions.find((v) => v.versionNumber === version);

  /** Modo API: nombres de pacientes que llegan en listados (planes, seguimiento) sin cargar su expediente. */
  private readonly names = signal<Record<string, string>>({});
  rememberNames(m: Record<string, string>): void {
    const clean = Object.fromEntries(Object.entries(m).filter(([, v]) => v));
    if (Object.keys(clean).length) this.names.update((n) => ({ ...n, ...clean }));
  }

  patientName = (id: Id): string => {
    const p = this.patient(id);
    return p ? `${p.profile.firstName} ${p.profile.lastName}` : (this.names()[id] ?? 'Paciente eliminado');
  };
}
