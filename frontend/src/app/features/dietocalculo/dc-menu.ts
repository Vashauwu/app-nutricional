import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TuiButton } from '@taiga-ui/core';
import { DbService } from '../../core/data/db.service';
import { calcIngredient } from '../../core/nutrition/engine';
import { CatalogService } from '../../core/services/catalog.service';
import { DishesService } from '../../core/services/dishes.service';
import { ToastService } from '../../core/services/ui.services';
import { Dish } from '../../shared/models/domain';
import { Icon } from '../../shared/components/icon';
import { Modal } from '../../shared/components/modal';
import { normalizeText } from '../../shared/utils/format';
import { MenuItem, group } from './engine';
import { DietoStore, numVal } from './dieto-store';
import { fmtTime, slotIcon } from './dc-dist';

const n = (v: string | number | undefined): number => { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; };
const r1 = (x: number): number => Math.round(x * 10) / 10;
const CATS: Record<string, string[]> = { desayuno: ['Desayuno'], colaci: ['Colación'], comida: ['Comida', 'Guarnición'], cena: ['Cena', 'Guarnición'] };

/** Pestaña «Dieta»: arma cada tiempo de comida con platillos y alimentos reales y compara lo servido contra los equivalentes. */
@Component({
  selector: 'app-dc-menu',
  imports: [TuiButton, Icon, Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .layout { display: grid; gap: var(--space-5); grid-template-columns: minmax(0, 1fr); align-items: start; }
    @media (min-width: 64rem) { .layout { grid-template-columns: minmax(0, 1fr) 22rem; } }
    .slots { display: flex; gap: var(--space-2); overflow-x: auto; padding-block-end: .25rem; }
    .slots button { flex: none; display: inline-flex; align-items: center; gap: var(--space-2); min-block-size: var(--tap); padding: 0 var(--space-4); border: 1px solid var(--line); border-radius: var(--radius-m); background: var(--surface); color: inherit; font: inherit; cursor: pointer; }
    .slots button[aria-selected='true'] { background: var(--brand-ink); border-color: var(--brand-ink); color: var(--surface); font-weight: 600; }
    .item { display: grid; grid-template-columns: minmax(0, 1fr) auto auto auto; gap: var(--space-3); align-items: center; padding: var(--space-3) var(--space-4); border-block-end: 1px solid var(--line); }
    @media (max-width: 40rem) { .item { grid-template-columns: 1fr auto; } }
    .item .nm { display: grid; gap: .125rem; min-inline-size: 0; }
    .chips-pend { display: flex; flex-wrap: wrap; gap: var(--space-2); }
    .pend { display: inline-flex; align-items: center; gap: .375rem; min-block-size: 2.5rem; padding: 0 var(--space-3); border: 1px dashed var(--brand-ink); border-radius: 999px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
    .pend b { font-variant-numeric: tabular-nums; }
    .pend.done { border-style: solid; border-color: var(--line); color: var(--muted); cursor: default; }
    .pend.over { border-color: var(--warn, #b45309); color: var(--nutri-texto); }
    .list-pick { display: grid; gap: var(--space-2); max-block-size: 22rem; overflow: auto; margin: 0; padding: 0; list-style: none; }
    .list-pick button { inline-size: 100%; display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); min-block-size: var(--tap); padding: var(--space-2) var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-m); background: var(--surface); color: inherit; font: inherit; text-align: start; cursor: pointer; }
    .list-pick button:hover { border-color: var(--brand-ink); }
    .prog { display: grid; gap: .25rem; }
    .prog .t-row { display: flex; justify-content: space-between; gap: var(--space-3); font-size: .9375rem; }
    .prog .dc-bar .ok { background: var(--brand-ink); }
  `,
  template: `
    @let res = s.r();
    <div class="slots no-print" role="tablist" aria-label="Tiempos de comida" (keydown)="onKey($event)">
      @for (sl of res.distribution; track $index) {
        <button type="button" role="tab" [id]="'mt-' + $index" [attr.aria-selected]="idx() === $index" [attr.tabindex]="idx() === $index ? 0 : -1" (click)="idx.set($index)">
          <app-icon [name]="icon(sl.name)" [size]="18" /> {{ sl.name }} <span>{{ time(sl.time) }}</span>
        </button>
      }
    </div>

    <div class="layout">
      <section class="panel panel--flush" role="tabpanel" [attr.aria-labelledby]="'mt-' + idx()">
        @let sl = cur();
        <div class="panel-head"><h2 class="m-0 u-h2-ui">{{ sl.name }} <span class="dc-sub">{{ time(sl.time) }} · meta {{ sl.target_kcal }} kcal</span></h2></div>
        @if (items().length) {
          @for (it of items(); track it.id) {
            <div class="item">
              <span class="nm"><b>{{ it.name }}</b><span class="dc-sub">{{ eqText(it) }}</span></span>
              <span class="dc-sub">{{ r1(it.kcal * it.qty_n) }} kcal</span>
              <span class="row"><input class="input dc-num-in" type="number" min="0.5" max="100" step="0.5" [value]="it.qty_n" [attr.aria-label]="'Cantidad de ' + it.name" (change)="setQty(it, $event)" /><span class="dc-sub">{{ it.qty || 'porción' }}</span></span>
              <button type="button" class="icon-btn no-print" [attr.aria-label]="'Quitar ' + it.name" (click)="remove(it)"><app-icon name="trash" [size]="18" /></button>
            </div>
          }
        } @else {
          <p class="empty u-pad-3-4"><app-icon name="dish" [size]="28" /> Agrega un platillo o un alimento a este tiempo.</p>
        }
        <div class="row u-pad-3-4 no-print">
          <button tuiButton type="button" size="m" appearance="secondary" (click)="openDish()"><app-icon name="dish" [size]="18" /> Platillo</button>
          <button tuiButton type="button" size="m" appearance="secondary" (click)="openFood('')"><app-icon name="apple" [size]="18" /> Alimento</button>
          <button tuiButton type="button" size="m" appearance="secondary" (click)="suggest()"><app-icon name="sparkles" [size]="18" /> Sugerir platillos</button>
          @if (items().length) { <button type="button" class="link-btn" (click)="clearSlot()">Vaciar tiempo</button> }
        </div>
        <div class="u-pad-b-4 px-5 stack--s">
          <h3 class="m-0 t-sm">Equivalentes pendientes</h3>
          <div class="chips-pend">
            @for (p of pending(); track p.code) {
              @if (p.left > 0) { <button type="button" class="pend no-print" (click)="openFood(p.code)" [attr.aria-label]="'Faltan ' + p.left + ' de ' + p.name + '. Elegir un alimento'"><span>{{ p.short }}</span><b>{{ p.left }}</b><app-icon name="plus" [size]="14" /></button> }
              @else if (p.left < 0) { <span class="pend done over"><span>{{ p.short }}</span><b>{{ p.left }}</b><span class="dc-sub">de más</span></span> }
              @else { <span class="pend done"><span>{{ p.short }}</span><app-icon name="check" [size]="14" /></span> }
            } @empty { <span class="dc-sub">Este tiempo no tiene equivalentes asignados.</span> }
          </div>
        </div>
      </section>

      <aside class="stack" aria-label="Resumen nutrimental">
        <div class="dc-seg no-print" role="radiogroup" aria-label="Vista del resumen">
          <button type="button" role="radio" [attr.aria-checked]="view() === 'nutr'" (click)="view.set('nutr')"><app-icon name="activity" [size]="16" /> Nutrimentos</button>
          <button type="button" role="radio" [attr.aria-checked]="view() === 'eq'" (click)="view.set('eq')"><app-icon name="pie" [size]="16" /> Equivalentes</button>
        </div>
        <div class="dc-seg no-print" role="radiogroup" aria-label="Alcance">
          <button type="button" role="radio" [attr.aria-checked]="scope() === 'slot'" (click)="scope.set('slot')">{{ cur().name }}</button>
          <button type="button" role="radio" [attr.aria-checked]="scope() === 'total'" (click)="scope.set('total')">Total</button>
        </div>
        @if (view() === 'nutr') {
          <section class="panel stack" aria-label="Nutrimentos">
            <div class="row row--between"><span class="dc-sub">Energía</span><b class="dc-num">{{ nut().kcal }} <small class="dc-sub">kcal</small></b></div>
            <div class="dc-bar" role="img" [attr.aria-label]="'Proteína ' + share(nut().p * 4) + ' %, lípidos ' + share(nut().l * 9) + ' %, hidratos ' + share(nut().c * 4) + ' %'"><i class="b-p" [style.inline-size.%]="share(nut().p * 4)"></i><i class="b-l" [style.inline-size.%]="share(nut().l * 9)"></i><i class="b-c" [style.inline-size.%]="share(nut().c * 4)"></i></div>
            <dl class="dc-kv">
              <dt>Hidratos de carbono</dt><dd>{{ nut().c }} g</dd>
              <dt>Fibra</dt><dd>{{ nut().f }} g</dd>
              <dt>Lípidos</dt><dd>{{ nut().l }} g</dd>
              <dt>Proteínas</dt><dd>{{ nut().p }} g</dd>
            </dl>
            <dl class="dc-kv">
              <dt>Meta de energía</dt><dd>{{ goal().kcal }} kcal</dd>
              <dt>Diferencia</dt><dd>{{ r1(nut().kcal - goal().kcal) }} kcal</dd>
            </dl>
            <p class="dc-sub m-0">El catálogo SMAE de ejemplo no incluye vitaminas, minerales ni índice glucémico: aquí solo se muestran energía, macros y fibra.</p>
          </section>
        } @else {
          <section class="panel stack" aria-label="Equivalentes servidos contra la meta">
            @for (p of eqProgress(); track p.code) {
              <div class="prog">
                <div class="t-row"><span>{{ p.name }}</span><b>{{ p.have }} / {{ p.want }}</b></div>
                <div class="dc-bar" role="img" [attr.aria-label]="p.name + ': ' + p.have + ' de ' + p.want"><i [class.ok]="true" [style.inline-size.%]="p.pct"></i></div>
              </div>
            } @empty { <p class="dc-sub m-0">Sin equivalentes asignados.</p> }
          </section>
        }
        <p class="dc-sub m-0"><app-icon name="book" [size]="14" /> Sistema: SMAE (edición activa del catálogo)</p>
      </aside>
    </div>

    <app-modal [(open)]="dishOpen" title="Agregar un platillo" size="normal">
      <div class="stack">
        <div class="field"><label for="dq">Buscar platillo</label><input id="dq" class="input" type="search" placeholder="Nombre o etiqueta" [value]="dq()" (input)="dq.set(str($event))" /></div>
        <ul class="list-pick">
          @for (d of dishList(); track d.dish.id) {
            <li><button type="button" (click)="addDish(d.dish)"><span><b>{{ d.dish.name }}</b><br /><span class="dc-sub">{{ d.dish.category }} · {{ d.eqText }}</span></span><span class="dc-sub">{{ d.kcal }} kcal</span></button></li>
          } @empty { <li class="dc-sub">No hay platillos que coincidan.</li> }
        </ul>
      </div>
    </app-modal>

    <app-modal [(open)]="foodOpen" title="Agregar un alimento" size="normal">
      <div class="stack">
        <div class="field"><label for="fq">Buscar alimento</label><input id="fq" class="input" type="search" placeholder="Nombre o etiqueta" [value]="fq()" (input)="fq.set(str($event))" /></div>
        @if (foodGroup()) { <p class="small m-0">Grupo: <b>{{ groupName(foodGroup()) }}</b> <button type="button" class="link-btn" (click)="foodGroup.set('')">Ver todos</button></p> }
        <ul class="list-pick">
          @for (f of foodList(); track f.id) {
            <li><button type="button" (click)="addFood(f.view)"><span><b>{{ f.view.name }}</b><br /><span class="dc-sub">{{ f.group }} · 1 {{ f.unit }}</span></span><span class="dc-sub">{{ f.kcal }} kcal</span></button></li>
          } @empty { <li class="dc-sub">No hay alimentos que coincidan.</li> }
        </ul>
      </div>
    </app-modal>
  `,
})
export class DcMenu {
  protected readonly s = inject(DietoStore);
  private readonly data = inject(DbService);
  private readonly dishes = inject(DishesService);
  private readonly catalog = inject(CatalogService);
  private readonly toast = inject(ToastService);

  protected readonly idx = signal(0);
  protected readonly view = signal<'nutr' | 'eq'>('nutr');
  protected readonly scope = signal<'slot' | 'total'>('slot');
  protected readonly dishOpen = signal(false);
  protected readonly foodOpen = signal(false);
  protected readonly dq = signal('');
  protected readonly fq = signal('');
  protected readonly foodGroup = signal('');
  protected readonly icon = slotIcon;
  protected readonly time = fmtTime;
  protected readonly num = numVal;
  protected readonly r1 = r1;

  protected readonly cur = computed(() => { const d = this.s.r().distribution; return d[Math.min(this.idx(), d.length - 1)]; });
  protected readonly items = computed<MenuItem[]>(() => this.s.inp().menu?.[this.cur().name] ?? []);

  /** Equivalentes de la meta de un tiempo contra lo servido por los platillos y alimentos. */
  protected readonly pending = computed(() => {
    const sl = this.cur();
    const have: Record<string, number> = {};
    for (const it of this.items()) for (const [c, v] of Object.entries(it.eq ?? {})) have[c] = (have[c] ?? 0) + v * it.qty_n;
    const codes = new Set([...Object.keys(sl.equivalents), ...Object.keys(have)]);
    return [...codes].map((code) => {
      const g = group(code);
      return { code, name: g?.name ?? code, short: code, left: r1((sl.equivalents[code] ?? 0) - (have[code] ?? 0)) };
    }).sort((a, b) => a.code.localeCompare(b.code));
  });

  private sumItems(list: MenuItem[]): { kcal: number; p: number; c: number; l: number; f: number } {
    const t = { kcal: 0, p: 0, c: 0, l: 0, f: 0 };
    for (const it of list) { t.kcal += it.kcal * it.qty_n; t.p += it.protein_g * it.qty_n; t.c += it.carbs_g * it.qty_n; t.l += it.lipids_g * it.qty_n; t.f += it.fiber_g * it.qty_n; }
    return { kcal: Math.round(t.kcal), p: r1(t.p), c: r1(t.c), l: r1(t.l), f: r1(t.f) };
  }
  protected readonly nut = computed(() => {
    const menu = this.s.inp().menu ?? {};
    return this.sumItems(this.scope() === 'slot' ? this.items() : Object.values(menu).flat());
  });
  protected readonly goal = computed(() => ({ kcal: this.scope() === 'slot' ? this.cur().target_kcal : this.s.r().dietosintetico.target.kcal }));
  protected share(kcal: number): number { const t = this.nut().kcal; return t > 0 ? Math.round((kcal / t) * 1000) / 10 : 0; }

  protected readonly eqProgress = computed(() => {
    const dist = this.s.r().distribution;
    const menu = this.s.inp().menu ?? {};
    const want: Record<string, number> = {};
    const have: Record<string, number> = {};
    const slots = this.scope() === 'slot' ? [this.cur()] : dist;
    for (const sl of slots) {
      for (const [c, v] of Object.entries(sl.equivalents)) want[c] = (want[c] ?? 0) + v;
      for (const it of menu[sl.name] ?? []) for (const [c, v] of Object.entries(it.eq ?? {})) have[c] = (have[c] ?? 0) + v * it.qty_n;
    }
    return Object.keys(want).map((code) => ({ code, name: group(code)?.name ?? code, want: want[code], have: r1(have[code] ?? 0), pct: Math.min(100, want[code] > 0 ? ((have[code] ?? 0) / want[code]) * 100 : 0) }));
  });

  // ---------- Platillos ----------
  private currentOf(d: Dish): Dish['versions'][number] { return this.dishes.current(d); }
  protected readonly dishList = computed(() => {
    const q = normalizeText(this.dq().trim());
    return this.data.db().dishes
      .filter((d) => !d.deletedAt && d.status === 'active' && (!q || normalizeText(`${d.name} ${d.tags.join(' ')}`).includes(q)))
      .slice(0, 60)
      .map((dish) => {
        const v = this.currentOf(dish);
        const eq = Object.entries(v.nutrition.equivalents).filter(([, x]) => n(x) > 0).map(([c, x]) => `${c} ${r1(n(x))}`).join(' · ');
        return { dish, kcal: Math.round(n(v.nutrition.perServing.energy)), eqText: eq || 'sin equivalentes' };
      });
  });

  protected openDish(): void { this.dq.set(''); this.dishOpen.set(true); }

  private dishItem(d: Dish): MenuItem {
    const v = this.currentOf(d);
    const per = v.nutrition.perServing;
    const eq: Record<string, number> = {};
    for (const [c, x] of Object.entries(v.nutrition.equivalents)) if (n(x) > 0) eq[c] = r1(n(x));
    return {
      id: `mi-${Math.random().toString(36).slice(2, 9)}`, kind: 'dish', ref_id: d.id, name: d.name, qty: 'porción', qty_n: 1,
      kcal: r1(n(per.energy)), protein_g: r1(n(per.protein)), carbs_g: r1(n(per.carbs)), lipids_g: r1(n(per.lipids)), fiber_g: r1(n(per.fiber)), eq,
    };
  }
  protected addDish(d: Dish): void { this.append(this.dishItem(d)); this.dishOpen.set(false); }

  // ---------- Alimentos ----------
  protected openFood(code: string): void {
    this.fq.set(''); this.foodGroup.set(code);
    this.catalog.hydrate().subscribe({ error: () => undefined });
    this.foodOpen.set(true);
  }
  protected groupName(code: string): string { return group(code)?.name ?? code; }
  protected readonly foodList = computed(() => {
    const q = normalizeText(this.fq().trim());
    const gc = this.foodGroup();
    const out: { id: string; view: ReturnType<DbService['activeFoods']>[number]; group: string; unit: string; kcal: number }[] = [];
    for (const f of this.data.activeFoods()) {
      const code = f.equivalence?.subgroupCode ?? '';
      if (gc && code !== gc) continue;
      if (q && !normalizeText(`${f.name} ${f.tags.join(' ')}`).includes(q)) continue;
      const p = f.portions[0];
      if (!p) continue;
      try {
        const ing = calcIngredient(f, '1', p.unit);
        out.push({ id: `${f.ref.kind}-${f.ref.id}`, view: f, group: code || 'Sin grupo', unit: p.unit, kcal: Math.round(n(ing.nutrients.energy)) });
      } catch { /* alimento sin conversión: no se ofrece */ }
      if (out.length >= 60) break;
    }
    return out;
  });
  protected addFood(f: ReturnType<DbService['activeFoods']>[number]): void {
    const p = f.portions[0];
    try {
      const ing = calcIngredient(f, '1', p.unit);
      const eq: Record<string, number> = {};
      if (ing.equivalent && n(ing.equivalent.value) > 0) eq[ing.equivalent.subgroupCode] = r1(n(ing.equivalent.value));
      this.append({
        id: `mi-${Math.random().toString(36).slice(2, 9)}`, kind: 'food', ref_id: f.ref.id, name: f.name, qty: `${p.name.toLowerCase()}`, qty_n: 1,
        kcal: r1(n(ing.nutrients.energy)), protein_g: r1(n(ing.nutrients.protein)), carbs_g: r1(n(ing.nutrients.carbs)), lipids_g: r1(n(ing.nutrients.lipids)), fiber_g: r1(n(ing.nutrients.fiber)), eq,
      });
      this.foodOpen.set(false);
    } catch (e) { this.toast.error(e instanceof Error ? e.message : 'No se pudo calcular el alimento.'); }
  }

  // ---------- Edición del tiempo ----------
  private write(list: MenuItem[]): void {
    const menu = { ...(this.s.inp().menu ?? {}) };
    if (list.length) menu[this.cur().name] = list; else delete menu[this.cur().name];
    this.s.patch({ menu: Object.keys(menu).length ? menu : undefined });
  }
  private append(it: MenuItem): void { this.write([...this.items(), it]); }
  protected remove(it: MenuItem): void { this.write(this.items().filter((x) => x.id !== it.id)); }
  protected clearSlot(): void { this.write([]); }
  protected setQty(it: MenuItem, e: Event): void {
    const v = numVal(e);
    this.write(this.items().map((x) => (x.id === it.id ? { ...x, qty_n: Number.isFinite(v) && v > 0 ? Math.min(100, v) : 1 } : x)));
  }
  protected eqText(it: MenuItem): string {
    const e = Object.entries(it.eq ?? {}).map(([c, v]) => `${c} ${r1(v * it.qty_n)}`).join(' · ');
    return `${it.kind === 'dish' ? 'Platillo' : 'Alimento'}${e ? ' · ' + e : ''}`;
  }
  protected str(e: Event): string { return (e.target as HTMLInputElement).value; }

  /** Asistente: agrega hasta 3 platillos activos de la categoría del tiempo cuyos equivalentes caben en lo pendiente. */
  protected suggest(): void {
    const key = Object.keys(CATS).find((k) => this.cur().name.toLowerCase().includes(k));
    const cats = key ? CATS[key] : null;
    const left: Record<string, number> = {};
    for (const p of this.pending()) if (p.left > 0) left[p.code] = p.left;
    const picked: MenuItem[] = [];
    const pool = this.data.db().dishes.filter((d) => !d.deletedAt && d.status === 'active' && (!cats || cats.includes(d.category)));
    for (let round = 0; round < 3; round++) {
      let best: { item: MenuItem; score: number } | null = null;
      for (const d of pool) {
        const it = this.dishItem(d);
        const codes = Object.keys(it.eq ?? {});
        if (!codes.length) continue;
        // Cubre lo pendiente y se pasa poco: sirve aunque un grupo exceda ligeramente.
        let covered = 0, over = 0;
        for (const c of codes) { const e = it.eq?.[c] ?? 0, p = Math.max(0, left[c] ?? 0); covered += Math.min(e, p); over += Math.max(0, e - p); }
        if (covered < 1 || over > 1.5) continue;
        const score = covered - over / 2;
        if (!best || score > best.score) best = { item: it, score };
      }
      if (!best) break;
      picked.push(best.item);
      for (const [c, v] of Object.entries(best.item.eq ?? {})) left[c] = Math.max(0, r1((left[c] ?? 0) - v));
    }
    if (!picked.length) { this.toast.info('No hay platillos que quepan en lo pendiente de este tiempo.'); return; }
    this.write([...this.items(), ...picked]);
    this.toast.ok(`Se agregaron ${picked.length} platillo${picked.length === 1 ? '' : 's'}. Revisa las cantidades.`);
  }

  protected onKey(e: KeyboardEvent): void {
    const len = this.s.r().distribution.length;
    const next = e.key === 'ArrowRight' ? (this.idx() + 1) % len : e.key === 'ArrowLeft' ? (this.idx() - 1 + len) % len : -1;
    if (next < 0) return;
    e.preventDefault();
    this.idx.set(next);
    queueMicrotask(() => document.getElementById('mt-' + next)?.focus());
  }
}
