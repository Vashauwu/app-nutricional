import { Injectable, inject } from '@angular/core';
import { Observable, catchError, forkJoin, map, of, switchMap, tap } from 'rxjs';
import { Dish, DishVersion, Goal, Measurement, Patient, PatientDocument } from '../../shared/models/domain';
import { DbService } from '../data/db.service';
import { ApiClient, ApiError } from './api-client';
import { ApiNutrients, toNutrients } from './catalog-api';
import { PlansApi } from './plans-api';
import { TrackingApi } from './tracking-api';

// ---------- Formas de la API ----------
interface ApiMe { id: string; first_name: string; last_name: string; email: string; goal: Goal; goal_notes: string; measurements_visible: boolean; consent_complete: boolean }
interface ApiMeasurement { id: string; measured_at: string; weight_kg: string; height_cm: string; bmi: string; waist_cm: string | null; hip_cm: string | null; body_fat_pct: string | null; notes: string }
interface ApiDoc { id: string; name: string; category: PatientDocument['category']; description: string; document_date: string; size_bytes: number; uploaded_at: string; url: string }
interface ApiPatientDish {
  id: string; name: string; category: string; version: number; description: string; recipe_mode: 'structured' | 'free'; instructions_text: string; steps: string[] | null; servings: string;
  prep_time_minutes: number; recommendations: string; ingredients: { name: string; quantity: string; unit: string }[] | null; per_serving: ApiNutrients; equivalents: Record<string, string> | null;
  alternatives: { label: string; diff: ApiNutrients | null }[] | null;
}

const opt = (v: string | null | undefined): string | undefined => (v ? v : undefined);

/** Todo lo que necesita la app de la paciente, desde `/me/*`. Nunca recibe un id de paciente del cliente. */
@Injectable({ providedIn: 'root' })
export class PatientAppApi {
  private readonly api = inject(ApiClient);
  private readonly data = inject(DbService);
  private readonly plans = inject(PlansApi);
  private readonly tracking = inject(TrackingApi);

  load(): Observable<void> {
    const soft = <T>(o: Observable<T>, fallback: T) => o.pipe(catchError((e: unknown) => (e instanceof ApiError && [403, 404, 423].includes(e.status) ? of(fallback) : of(fallback))));
    return forkJoin({
      me: this.api.get<ApiMe>('/me/patient'),
      plan: soft(this.api.get<Record<string, unknown>>('/me/plan'), null),
      measurements: soft(this.api.get<{ items: ApiMeasurement[] }>('/me/measurements'), { items: [] as ApiMeasurement[] }),
      docs: soft(this.api.get<{ items: ApiDoc[] }>('/me/documents'), { items: [] as ApiDoc[] }),
    }).pipe(
      tap(({ me, plan, measurements, docs }) => {
        this.data.mutate((d) => {
          const patient: Patient = {
            id: me.id, status: 'active', profile: { firstName: me.first_name, lastName: me.last_name, birthDate: '', sex: 'F', email: me.email, phone: '' },
            goal: me.goal, goalNotes: me.goal_notes, clinicalIndications: '', measurementsVisibleToPatient: me.measurements_visible, usedBytes: 0,
            conditions: [], allergies: [], medications: [], preferences: [], notes: [],
            documents: docs.items.map(
              (x): PatientDocument => ({
                id: x.id, name: x.name, category: x.category, documentDate: x.document_date, description: x.description, sizeBytes: x.size_bytes, visibleToPatient: true, uploadedBy: '', uploadedAt: x.uploaded_at, scanStatus: 'clean', url: x.url,
              }),
            ),
            measurements: measurements.items.map(
              (m): Measurement => ({ id: m.id, measuredAt: m.measured_at.slice(0, 10), weightKg: m.weight_kg, heightCm: m.height_cm, bmi: m.bmi, waistCm: opt(m.waist_cm), hipCm: opt(m.hip_cm), bodyFatPct: opt(m.body_fat_pct), notes: opt(m.notes), createdBy: '' }),
            ),
            createdAt: '', createdBy: '', consentComplete: me.consent_complete,
          };
          const at = d.patients.findIndex((p) => p.id === me.id);
          if (at >= 0) d.patients[at] = patient;
          else d.patients.push(patient);
        });
        if (plan && plan['id']) {
          // /me/plan no trae objetivos ni datos internos: se completan con ceros para reutilizar el mismo modelo.
          this.plans.mirrorForPatient({ ...plan, patient_id: me.id, status: 'published', revision: 1, targets_version: 1, updated_at: '', created_at: '', targets: { energy_kcal: '0', protein_g: '0', carbohydrates_g: '0', lipids_g: '0', equivalents: {} } } as never);
        }
      }),
      switchMap(() => this.tracking.mine().pipe(catchError(() => of(void 0)))),
    );
  }

  /** Detalle de un platillo de MI plan: ingredientes, pasos y alternativas autorizadas. */
  dish(dishId: string, version: number): Observable<void> {
    return this.api.get<ApiPatientDish>(`/me/dishes/${dishId}/versions/${version}`).pipe(
      tap((r) =>
        this.data.mutate((d) => {
          let dish: Dish | undefined = d.dishes.find((x) => x.id === r.id);
          if (!dish) {
            dish = { id: r.id, name: r.name, category: r.category, tags: [], status: 'active', currentVersion: r.version, versions: [], createdAt: '' };
            d.dishes.push(dish);
          }
          const v: DishVersion = {
            id: `${r.id}-v${r.version}`, versionNumber: r.version, description: r.description, recipeMode: r.recipe_mode, instructionsText: r.instructions_text, steps: r.steps ?? [], servings: r.servings,
            prepTimeMinutes: r.prep_time_minutes, recommendations: r.recommendations,
            ingredients: (r.ingredients ?? []).map((i, n) => ({
              id: `i${n}`, food: { kind: 'smae', id: '' }, nameSnapshot: i.name, quantity: i.quantity, unit: i.unit, grams: '0', nutrients: { energy: '0', protein: '0', carbs: '0', lipids: '0', fiber: '0' }, official: true,
            })),
            nutrition: { totals: toNutrients(r.per_serving), perServing: toNutrients(r.per_serving), equivalents: r.equivalents ?? {}, hasCustomFoods: false, smaeEditionId: '', engineVersion: '', calculatedAt: '' },
            substitutions: (r.alternatives ?? []).map((a, n) => ({ id: `a${n}`, type: 'dish', label: a.label, note: '', rule: '', diff: a.diff ? toNutrients(a.diff) : { energy: '0', protein: '0', carbs: '0', lipids: '0', fiber: '0' }, approvedBy: '', approvedAt: '' })),
            changeReason: '', createdBy: '', createdAt: '',
          };
          dish.versions = [...dish.versions.filter((x) => x.versionNumber !== v.versionNumber), v].sort((a, b) => a.versionNumber - b.versionNumber);
        }),
      ),
      map(() => void 0),
    );
  }
}
