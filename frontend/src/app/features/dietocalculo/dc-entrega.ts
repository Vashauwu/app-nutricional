import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TuiButton } from '@taiga-ui/core';
import { DbService } from '../../core/data/db.service';
import { BRAND_PALETTES } from '../../core/data/brand-palettes';
import { AgendaService } from '../../core/services/agenda.service';
import { Entitlements } from '../../core/services/entitlements.service';
import { ToastService } from '../../core/services/ui.services';
import { Icon } from '../../shared/components/icon';
import { AppointmentMode } from '../../shared/models/domain';
import { Supplement } from './engine';
import { DietoStore } from './dieto-store';
import { HANDOUT_STYLES, Handout, HandoutStyle } from './handout';

const KEY = 'nutri-handout';
const SLOTS = Array.from({ length: 19 }, (_, i) => `${String(9 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);

interface Pref { style: HandoutStyle; accent: string }
function loadPref(): Pref {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Pref | null;
    if (p && HANDOUT_STYLES.some((s) => s.id === p.style) && /^#[0-9a-f]{6}$/i.test(p.accent)) return p;
  } catch { /* se usa el valor por omisión */ }
  return { style: 'clasico', accent: BRAND_PALETTES[0].primary };
}

const isoDay = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Paso final de la consulta: indicaciones, suplementación, documento para el paciente, envío y próxima consulta. */
@Component({
  selector: 'app-dc-entrega',
  imports: [RouterLink, TuiButton, Icon, Handout],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: grid; gap: var(--space-5); align-content: start; min-inline-size: 0; }
    .grid { display: grid; gap: var(--space-5); grid-template-columns: minmax(0, 1fr); align-items: start; }
    @media (min-width: 64rem) { .grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); } }
    .grid > * { min-inline-size: 0; }
    h2 { font-size: 1.125rem; }
    .sup { display: grid; gap: var(--space-2); grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr) auto; align-items: end; padding-block: var(--space-3); border-block-end: 1px solid var(--line); }
    .sup .how { grid-column: 1 / -2; }
    @media (max-width: 40rem) { .sup { grid-template-columns: minmax(0, 1fr) auto; } .sup .how { grid-column: 1 / -1; } .sup .field:first-child { grid-column: 1 / -1; } }
    .styles { display: grid; gap: var(--space-2); grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); }
    .styles button { display: grid; gap: .125rem; text-align: start; padding: var(--space-3); border: 1.5px solid var(--line); border-radius: var(--radius-m); background: var(--surface); color: inherit; font: inherit; cursor: pointer; min-block-size: var(--tap); }
    .styles button[aria-checked='true'] { border-color: var(--brand-ink); background: color-mix(in srgb, var(--brand-secondary) 40%, var(--surface)); }
    .styles small { color: var(--muted); }
    .acc { display: flex; flex-wrap: wrap; gap: var(--space-2); }
    .acc button { inline-size: 2.5rem; block-size: 2.5rem; border-radius: 50%; border: 2px solid var(--surface); box-shadow: 0 0 0 1.5px var(--line); cursor: pointer; padding: 0; }
    .acc button[aria-checked='true'] { box-shadow: 0 0 0 3px var(--brand-ink); }
    .sheet { border: 1px solid var(--line); border-radius: var(--radius-m); overflow: hidden; max-block-size: 36rem; overflow-y: auto; background: #fff; }
    .times { display: grid; gap: var(--space-2); grid-template-columns: repeat(auto-fill, minmax(5rem, 1fr)); }
    .times button, .weeks button { min-block-size: var(--tap); border: 1px solid var(--line); border-radius: var(--radius-m); background: var(--surface); color: inherit; font: inherit; cursor: pointer; }
    .times button[aria-checked='true'], .weeks button[aria-checked='true'] { background: var(--brand-ink); border-color: var(--brand-ink); color: var(--surface); font-weight: 600; }
    .weeks { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-2); }
  `,
  template: `
    <div class="grid">
      <div class="stack">
        <section class="panel stack" aria-labelledby="en-ind">
          <h2 id="en-ind" class="m-0">Indicaciones</h2>
          <p class="dc-sub m-0">Lo que le dirías al despedirte. Sale impreso en su documento.</p>
          <div class="field">
            <label for="ind-t" class="visually-hidden">Indicaciones generales</label>
            <textarea id="ind-t" class="textarea" rows="6" maxlength="1200" placeholder="Ej. Toma 2 litros de agua al día. Camina 30 minutos después de comer." [value]="s.inp().indications ?? ''" (input)="setInd($event)"></textarea>
            <span class="small muted u-end">{{ (s.inp().indications ?? '').length }} / 1200</span>
          </div>
        </section>

        <section class="panel stack" aria-labelledby="en-sup">
          <div class="row row--between"><h2 id="en-sup" class="m-0">Suplementación</h2><span class="dc-sub">Opcional</span></div>
          <p class="dc-sub m-0">Qué tomar, cuánto, cuándo y cómo. Sale como tabla en su documento.</p>
          @for (sp of sups(); track $index) {
            <div class="sup">
              <div class="field"><label [for]="'sn' + $index">Suplemento</label><input [id]="'sn' + $index" class="input" maxlength="80" [value]="sp.name" (input)="editSup($index, { name: val($event) })" /></div>
              <div class="field"><label [for]="'sd' + $index">Cuánto</label><input [id]="'sd' + $index" class="input" maxlength="60" placeholder="500 mg" [value]="sp.dose ?? ''" (input)="editSup($index, { dose: val($event) })" /></div>
              <div class="field"><label [for]="'sw' + $index">Cuándo</label><input [id]="'sw' + $index" class="input" maxlength="80" placeholder="Desayuno" [value]="sp.when ?? ''" (input)="editSup($index, { when: val($event) })" /></div>
              <button type="button" class="icon-btn" [attr.aria-label]="'Quitar ' + (sp.name || 'suplemento')" (click)="removeSup($index)"><app-icon name="trash" [size]="18" /></button>
              <div class="field how"><label [for]="'sh' + $index">Cómo tomarlo</label><input [id]="'sh' + $index" class="input" maxlength="200" placeholder="Con alimentos, con un vaso de agua" [value]="sp.how ?? ''" (input)="editSup($index, { how: val($event) })" /></div>
            </div>
          }
          <div class="row">
            <button tuiButton type="button" size="m" appearance="secondary" [disabled]="sups().length >= 12" (click)="addSup()"><app-icon name="plus" [size]="18" /> Añadir suplemento</button>
            @if (s.err('supplements')) { <span class="small error" role="alert">{{ s.err('supplements') }}</span> }
          </div>
        </section>

        <section class="panel stack" aria-labelledby="en-next">
          <h2 id="en-next" class="m-0">Próxima consulta</h2>
          @if (patientId()) {
            <div class="weeks" role="radiogroup" aria-label="Dentro de cuántas semanas">
              @for (w of weeksOpts; track w) { <button type="button" role="radio" [attr.aria-checked]="weeks() === w" (click)="setWeeks(w)">{{ w }} semanas</button> }
            </div>
            <div class="field"><label for="nx-d">Fecha</label><input id="nx-d" class="input" type="date" [min]="today" [value]="date()" (change)="date.set(val($event))" /></div>
            <div class="times" role="radiogroup" aria-label="Hora">
              @for (t of slotTimes; track t) { <button type="button" role="radio" [attr.aria-checked]="time() === t" (click)="time.set(t)">{{ t }}</button> }
            </div>
            <div class="dc-seg" role="radiogroup" aria-label="Modalidad">
              <button type="button" role="radio" [attr.aria-checked]="mode() === 'in_person'" (click)="mode.set('in_person')">Presencial</button>
              <button type="button" role="radio" [attr.aria-checked]="mode() === 'online'" (click)="mode.set('online')">En línea</button>
            </div>
            <div class="row"><button tuiButton type="button" size="m" [disabled]="!date() || !time() || booking()" (click)="book()"><app-icon name="calendar" [size]="18" /> {{ booking() ? 'Agendando…' : 'Agendar consulta' }}</button>
              @if (booked()) { <span class="small" role="status"><app-icon name="check-circle" [size]="16" /> {{ booked() }}</span> }</div>
          } @else { <p class="dc-sub m-0">Enlaza la dieta con un paciente (arriba) para agendar su siguiente consulta.</p> }
        </section>
      </div>

      <div class="stack">
        <section class="panel stack" aria-labelledby="en-doc">
          <h2 id="en-doc" class="m-0">Documento para el paciente</h2>
          <div class="styles" role="radiogroup" aria-label="Estilo del documento">
            @for (st of styles; track st.id) { <button type="button" role="radio" [attr.aria-checked]="effStyle() === st.id" [disabled]="styleLocked(st.id)" [attr.aria-disabled]="styleLocked(st.id)" (click)="setStyle(st.id)"><b>{{ st.name }}</b><small>{{ styleLocked(st.id) ? 'Plan Estándar o Pro' : st.hint }}</small></button> }
          </div>
          <div class="field"><span id="acc-l" class="label">Color de acento</span>
            <div class="acc" role="radiogroup" aria-labelledby="acc-l">
              @for (p of palettes; track p.id) { <button type="button" role="radio" [attr.aria-checked]="effAccent() === p.primary" [attr.aria-label]="accentLocked(p.primary) ? p.name + ' (plan Estándar o Pro)' : p.name" [disabled]="accentLocked(p.primary)" [style.background]="p.primary" (click)="setAccent(p.primary)"></button> }
            </div>
          </div>
          <div class="sheet" tabindex="0" role="region" aria-label="Vista previa del documento del paciente"><app-handout [res]="s.r()" [inp]="s.inp()" [brand]="brand()" [profile]="profile()" [patientName]="patientName()" [style]="effStyle()" [accent]="effAccent()" [platformMark]="perks().platformMark" /></div>
          @if (!perks().allHandoutStyles || perks().platformMark) {
            <p class="dc-sub m-0">Con el plan Gratuito el documento lleva la marca de la plataforma y el estilo clásico. <a routerLink="/facturacion">Ver planes</a></p>
          }
          <div class="row">
            <button tuiButton type="button" size="m" (click)="pdf()"><app-icon name="download" [size]="18" /> Descargar PDF</button>
            <a tuiButton size="m" appearance="secondary" [class.disabled]="!waLink()" [attr.href]="waLink()" target="_blank" rel="noopener noreferrer"><app-icon name="message" [size]="18" /> WhatsApp</a>
            <a tuiButton size="m" appearance="secondary" [attr.href]="mailLink()"><app-icon name="send" [size]="18" /> Correo</a>
          </div>
          <p class="dc-sub m-0">WhatsApp y correo abren la conversación con el mensaje listo: descarga el PDF y adjúntalo antes de enviar.@if (patientId() && !waLink()) { Este paciente no tiene un teléfono registrado. }</p>
        </section>
      </div>
    </div>

  `,
})
export class DcEntrega {
  protected readonly s = inject(DietoStore);
  private readonly data = inject(DbService);
  private readonly agenda = inject(AgendaService);
  private readonly toast = inject(ToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly ent = inject(Entitlements);
  protected readonly perks = this.ent.perks;

  readonly patientId = input('');
  readonly patientName = input('');

  protected readonly styles = HANDOUT_STYLES;
  protected readonly palettes = BRAND_PALETTES;
  protected readonly weeksOpts = [2, 4, 6];
  protected readonly slotTimes = SLOTS;
  protected readonly today = isoDay(new Date());
  protected readonly pref = signal<Pref>(loadPref());
  // Lo guardado por la persona se respeta, pero solo se aplica lo que su plan permite.
  protected readonly effStyle = computed<HandoutStyle>(() => (this.perks().allHandoutStyles ? this.pref().style : 'clasico'));
  protected readonly effAccent = computed(() => (this.perks().customAccent ? this.pref().accent : BRAND_PALETTES[0].primary));
  protected styleLocked = (id: HandoutStyle): boolean => !this.perks().allHandoutStyles && id !== 'clasico';
  protected accentLocked = (primary: string): boolean => !this.perks().customAccent && primary !== BRAND_PALETTES[0].primary;
  constructor() { this.ent.load(); }
  protected readonly weeks = signal(4);
  protected readonly date = signal(this.dateIn(4));
  protected readonly time = signal('');
  protected readonly mode = signal<AppointmentMode>('in_person');
  protected readonly booking = signal(false);
  protected readonly booked = signal('');

  protected readonly brand = computed(() => this.data.db().settings.brand);
  protected readonly profile = computed(() => this.data.db().settings.profile);
  protected readonly sups = computed<Supplement[]>(() => this.s.inp().supplements ?? []);
  private readonly phone = computed(() => {
    const raw = this.data.db().patients.find((p) => p.id === this.patientId())?.profile.phone ?? '';
    const d = raw.replace(/\D/g, '');
    return d.length === 10 ? '52' + d : d.length >= 11 ? d : '';
  });
  private readonly message = computed(() => `Hola ${this.patientName().split(' ')[0] || ''}, te comparto tu plan de alimentación de ${this.brand().businessName}: ${this.s.r().energy.prescription_kcal} kcal al día. Te adjunto el documento.`.replace('Hola ,', 'Hola,'));
  protected readonly waLink = computed(() => (this.phone() ? `https://wa.me/${this.phone()}?text=${encodeURIComponent(this.message())}` : null));
  protected readonly mailLink = computed(() => {
    const to = this.data.db().patients.find((p) => p.id === this.patientId())?.profile.email ?? '';
    return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent('Tu plan de alimentación')}&body=${encodeURIComponent(this.message())}`;
  });

  protected val(e: Event): string { return (e.target as HTMLInputElement).value; }
  protected setInd(e: Event): void { this.s.patch({ indications: (e.target as HTMLTextAreaElement).value || undefined }); }

  protected addSup(): void { this.s.patch({ supplements: [...this.sups(), { name: '' }] }); }
  protected removeSup(i: number): void { const l = this.sups().filter((_, k) => k !== i); this.s.patch({ supplements: l.length ? l : undefined }); }
  protected editSup(i: number, p: Partial<Supplement>): void { this.s.patch({ supplements: this.sups().map((x, k) => (k === i ? { ...x, ...p } : x)) }); }

  private save(p: Pref): void { this.pref.set(p); try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* solo en memoria */ } }
  protected setStyle(style: HandoutStyle): void { this.save({ ...this.pref(), style }); }
  protected setAccent(accent: string): void { this.save({ ...this.pref(), accent }); }

  /**
   * Imprime solo el documento: copia el que se ve en pantalla a un contenedor propio al final de <body>, oculta todo lo
   * demás mientras dura el diálogo de impresión y lo retira al terminar (así no salen páginas en blanco de la aplicación).
   */
  protected pdf(): void {
    const sheet = this.host.nativeElement.querySelector('.sheet app-handout') as HTMLElement | null;
    if (!sheet) return;
    const root = document.documentElement;
    const box = document.createElement('div');
    box.className = 'ho-print-root';
    box.appendChild(sheet.cloneNode(true));
    document.body.appendChild(box);
    root.classList.add('printing-handout');
    const done = (): void => { root.classList.remove('printing-handout'); box.remove(); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
  }

  private dateIn(weeks: number): string { const d = new Date(); d.setDate(d.getDate() + weeks * 7); return isoDay(d); }
  protected setWeeks(w: number): void { this.weeks.set(w); this.date.set(this.dateIn(w)); }

  protected book(): void {
    const [h, m] = this.time().split(':').map(Number);
    const start = new Date(`${this.date()}T00:00:00`);
    start.setHours(h, m, 0, 0);
    const end = new Date(start.getTime() + 30 * 60_000);
    this.booking.set(true);
    this.agenda.create({ patientId: this.patientId(), startsAt: start.toISOString(), endsAt: end.toISOString(), kind: 'follow_up', mode: this.mode(), place: '', notes: '', status: 'scheduled' }).subscribe({
      next: () => { this.booking.set(false); this.booked.set(`Consulta agendada: ${start.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })}, ${this.time()}.`); this.toast.ok('Consulta agendada.'); },
      error: (e: unknown) => { this.booking.set(false); this.toast.error(e instanceof Error ? e.message : 'No se pudo agendar.'); },
    });
  }
}
