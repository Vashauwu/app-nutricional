import { ChangeDetectionStrategy, Component, ElementRef, HostListener, Injectable, computed, effect, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { DbService } from '../../core/data/db.service';
import { PatientsService } from '../../core/services/patients.service';
import { PlansService } from '../../core/services/plans.service';
import { normalizeText } from '../utils/format';
import { Icon, IconName } from './icon';

@Injectable({ providedIn: 'root' })
export class CommandPaletteService {
  readonly isOpen = signal(false);
  open(): void { this.isOpen.set(true); }
  close(): void { this.isOpen.set(false); }
  toggle(): void { this.isOpen.update((v) => !v); }
}

interface Entry {
  group: 'Acciones' | 'Ir a' | 'Pacientes' | 'Planes' | 'Platillos';
  label: string;
  hint?: string;
  icon: IconName;
  link: string;
}

const ACTIONS: Entry[] = [
  { group: 'Acciones', label: 'Nuevo paciente', icon: 'user-plus', link: '/pacientes/nuevo' },
  { group: 'Acciones', label: 'Nuevo plan alimentario', icon: 'calendar', link: '/planes/nuevo' },
  { group: 'Acciones', label: 'Nueva dieta (Dietocálculo)', icon: 'scale', link: '/dietocalculo/nuevo' },
  { group: 'Acciones', label: 'Nuevo platillo', icon: 'dish', link: '/platillos/nuevo' },
  { group: 'Acciones', label: 'Agendar consulta', icon: 'clock', link: '/consultas' },
];
const PAGES: Entry[] = [
  { group: 'Ir a', label: 'Inicio', icon: 'home', link: '/' },
  { group: 'Ir a', label: 'Pacientes', icon: 'users', link: '/pacientes' },
  { group: 'Ir a', label: 'Consultas', icon: 'clock', link: '/consultas' },
  { group: 'Ir a', label: 'Planes', icon: 'calendar', link: '/planes' },
  { group: 'Ir a', label: 'Dietocálculo', icon: 'scale', link: '/dietocalculo' },
  { group: 'Ir a', label: 'Seguimiento', icon: 'activity', link: '/seguimiento' },
  { group: 'Ir a', label: 'Platillos', icon: 'dish', link: '/platillos' },
  { group: 'Ir a', label: 'Catálogo SMAE', icon: 'book', link: '/catalogo' },
  { group: 'Ir a', label: 'Reportes', icon: 'chart', link: '/reportes' },
  { group: 'Ir a', label: 'Configuración', icon: 'settings', link: '/configuracion' },
];

/** Búsqueda global (Ctrl/Cmd + K): pacientes, planes, platillos y acciones, todo desde el teclado. */
@Component({
  selector: 'app-command-palette',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    dialog { border: 0; padding: 0; border-radius: var(--radius-l); background: var(--surface); color: var(--nutri-texto); inline-size: min(100% - 2rem, 38rem);
      margin-block-start: min(14vh, 8rem); box-shadow: var(--shadow-m); overflow: hidden; }
    dialog::backdrop { background: rgb(40 30 42 / 45%); }
    .search { display: flex; align-items: center; gap: .75rem; padding: 0 1rem; border-block-end: 1px solid var(--line); }
    .search input { flex: 1; min-block-size: 3.5rem; border: 0; background: transparent; color: inherit; font: inherit; font-size: 1.0625rem; outline: none; }
    .kbd { font-size: .75rem; padding: .125rem .4rem; border: 1px solid var(--line); border-radius: .375rem; color: var(--muted); }
    ul { list-style: none; margin: 0; padding: .5rem; max-block-size: 22rem; overflow: auto; }
    .group { padding: .5rem .75rem .25rem; font-size: .75rem; font-weight: 600; color: var(--muted); }
    li.opt { display: flex; align-items: center; gap: .75rem; min-block-size: 2.75rem; padding: 0 .75rem; border-radius: var(--radius-s); cursor: pointer; }
    li.opt[aria-selected='true'] { background: color-mix(in srgb, var(--nutri-lavanda) 60%, transparent); }
    li.opt .hint { margin-inline-start: auto; font-size: .8125rem; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-inline-size: 45%; }
    .none { padding: 2rem 1rem; text-align: center; color: var(--muted); }
    .foot { display: flex; gap: 1rem; padding: .5rem 1rem; border-block-start: 1px solid var(--line); font-size: .8125rem; color: var(--muted); background: var(--nutri-marfil); }
    @media (prefers-reduced-motion: no-preference) { dialog[open] { animation: pal-in .16s cubic-bezier(.16, 1, .3, 1); } @keyframes pal-in { from { opacity: 0; transform: translateY(-8px) scale(.985); } } }
  `,
  template: `
    <dialog #dlg aria-label="Búsqueda global" (cancel)="$event.preventDefault(); svc.close()" (click)="$event.target === dlg && svc.close()">
      <div class="search">
        <app-icon name="search" />
        <input #inp type="search" role="combobox" aria-expanded="true" aria-controls="pal-list" [attr.aria-activedescendant]="'pal-' + active()" autocomplete="off"
          placeholder="Busca un paciente, plan, platillo o acción…" [value]="term()" (input)="onInput($any($event.target).value)" (keydown)="onKey($event)" />
        <span class="kbd" aria-hidden="true">Esc</span>
      </div>
      <ul id="pal-list" role="listbox" aria-label="Resultados">
        @for (e of results(); track $index; let i = $index) {
          @if (i === 0 || results()[i - 1].group !== e.group) { <li class="group" role="presentation">{{ e.group }}</li> }
          <li class="opt" role="option" [id]="'pal-' + i" [attr.aria-selected]="i === active()" (mouseenter)="active.set(i)" (click)="go(e)">
            <app-icon [name]="e.icon" [size]="18" /><span>{{ e.label }}</span>@if (e.hint) { <span class="hint">{{ e.hint }}</span> }
          </li>
        } @empty { <li class="none" role="presentation">Sin resultados para «{{ term() }}». Prueba con el nombre o el correo.</li> }
      </ul>
      <div class="foot"><span>↑ ↓ para moverte</span><span>Enter para abrir</span></div>
    </dialog>
  `,
})
export class CommandPalette {
  protected readonly svc = inject(CommandPaletteService);
  private readonly db = inject(DbService);
  private readonly router = inject(Router);
  private readonly patients = inject(PatientsService);
  private readonly plans = inject(PlansService);
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  private readonly inp = viewChild.required<ElementRef<HTMLInputElement>>('inp');
  protected readonly term = signal('');
  protected readonly active = signal(0);

  protected readonly results = computed<Entry[]>(() => {
    const t = normalizeText(this.term().trim());
    const d = this.db.db();
    const matchAll = (label: string): boolean => !t || normalizeText(label).includes(t);
    const out: Entry[] = [...ACTIONS, ...PAGES].filter((e) => matchAll(e.label)).slice(0, t ? 6 : 8);
    if (!t) return out;
    const pats = d.patients.filter((p) => matchAll(`${p.profile.firstName} ${p.profile.lastName} ${p.profile.email}`)).slice(0, 6)
      .map((p): Entry => ({ group: 'Pacientes', label: `${p.profile.firstName} ${p.profile.lastName}`, hint: p.profile.email, icon: 'user', link: `/pacientes/${p.id}` }));
    const pls = d.plans.filter((p) => !p.deletedAt && matchAll(p.name)).slice(0, 5)
      .map((p): Entry => ({ group: 'Planes', label: p.name, hint: this.db.patientName(p.patientId), icon: 'calendar', link: `/planes/${p.id}` }));
    const dis = d.dishes.filter((x) => matchAll(`${x.name} ${(x.tags ?? []).join(' ')}`)).slice(0, 5)
      .map((x): Entry => ({ group: 'Platillos', label: x.name, hint: x.category, icon: 'dish', link: `/platillos/${x.id}` }));
    // Pacientes, planes y platillos primero: lo habitual al buscar con texto es encontrar un registro.
    return [...pats, ...pls, ...dis, ...out];
  });

  constructor() {
    effect(() => {
      const el = this.dlg().nativeElement;
      if (this.svc.isOpen() && !el.open) {
        // Carga los listados (en modo API) para que la búsqueda tenga con qué trabajar.
        this.patients.loadAll().subscribe({ error: () => undefined });
        this.plans.loadAllSummaries().subscribe({ error: () => undefined });
        this.term.set('');
        this.active.set(0);
        el.showModal();
        queueMicrotask(() => this.inp().nativeElement.focus());
      } else if (!this.svc.isOpen() && el.open) el.close();
    });
  }

  @HostListener('document:keydown', ['$event'])
  protected shortcut(e: KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      this.svc.toggle();
    }
  }

  protected onInput(v: string): void { this.term.set(v); this.active.set(0); }

  protected onKey(e: KeyboardEvent): void {
    const n = this.results().length;
    if (e.key === 'ArrowDown') { e.preventDefault(); this.active.set(n ? (this.active() + 1) % n : 0); this.scroll(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.active.set(n ? (this.active() - 1 + n) % n : 0); this.scroll(); }
    else if (e.key === 'Enter') { e.preventDefault(); const r = this.results()[this.active()]; if (r) this.go(r); }
  }

  private scroll(): void {
    queueMicrotask(() => document.getElementById('pal-' + this.active())?.scrollIntoView({ block: 'nearest' }));
  }

  protected go(e: Entry): void {
    this.svc.close();
    void this.router.navigateByUrl(e.link);
  }
}
