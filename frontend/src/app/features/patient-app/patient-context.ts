import { Injectable, computed, inject } from '@angular/core';
import { AuthService } from '../../core/auth/auth.service';
import { DbService } from '../../core/data/db.service';
import { PlansService } from '../../core/services/plans.service';
import { computeCompliance } from '../../core/services/tracking.service';
import { Totals, itemTotals } from '../../core/nutrition/engine';
import { Dish, DishVersion, MealPlan, Patient, PlanDay, PlanItem, PlanSlot, TrackingEntry } from '../../shared/models/domain';
import { todayIso } from '../../shared/utils/format';

export interface PatientItemVM {
  plan: MealPlan;
  date: string;
  slot: PlanSlot;
  item: PlanItem;
  dish: Dish | undefined;
  version: DishVersion | undefined;
  totals: Totals;
  entry: TrackingEntry | undefined;
  unreadReplies: number;
}

/**
 * Contexto de la paciente autenticada. Solo expone SUS datos y planes publicados
 * (el aislamiento real lo valida el backend en cada petición, §2.2).
 */
@Injectable({ providedIn: 'root' })
export class PatientContext {
  private readonly auth = inject(AuthService);
  private readonly data = inject(DbService);
  private readonly plans = inject(PlansService);

  readonly patient = computed<Patient | undefined>(() => {
    this.data.version();
    const id = this.auth.patientId();
    return id ? this.data.patient(id) : undefined;
  });

  readonly plan = computed<MealPlan | undefined>(() => {
    this.data.version();
    const id = this.auth.patientId();
    return id ? this.plans.currentFor(id) : undefined;
  });

  readonly today = todayIso();

  day(date: string): PlanDay | undefined {
    return this.plan()?.days.find((d) => d.date === date);
  }

  items(date: string): { slot: PlanSlot; items: PatientItemVM[] }[] {
    const plan = this.plan();
    const day = this.day(date);
    if (!plan || !day) return [];
    const tracking = this.data.db().tracking;
    return day.slots
      .filter((s) => s.items.length)
      .map((slot) => ({
        slot,
        items: slot.items.map((item): PatientItemVM => {
          const dish = this.data.dish(item.dishId);
          const version = this.data.dishVersion(item.dishId, item.dishVersion);
          const entry = tracking.find((t) => t.planId === plan.id && t.itemId === item.id);
          return {
            plan, date, slot, item, dish, version, totals: itemTotals(version, item.servings), entry,
            unreadReplies: entry ? entry.thread.filter((c) => c.authorRole === 'nutritionist').length : 0,
          };
        }),
      }));
  }

  findItem(date: string, itemId: string): PatientItemVM | undefined {
    for (const g of this.items(date)) {
      const f = g.items.find((i) => i.item.id === itemId);
      if (f) return f;
    }
    return undefined;
  }

  compliance(from?: string, to?: string) {
    const plan = this.plan();
    const id = this.auth.patientId();
    if (!plan || !id) return computeCompliance([], []);
    return computeCompliance([plan], this.data.db().tracking.filter((t) => t.patientId === id), from, to);
  }
}
