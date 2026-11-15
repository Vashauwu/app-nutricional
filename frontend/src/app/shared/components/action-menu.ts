import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, input, signal, viewChildren } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationStart, Router, RouterLink } from '@angular/router';
import { filter } from 'rxjs';
import { Icon, IconName } from './icon';

export interface MenuItem {
  label: string;
  icon?: IconName;
  /** Acción al elegir la opción. */
  run?: () => void;
  /** Ruta interna (en lugar de `run`). */
  link?: string | unknown[];
  danger?: boolean;
  /** Para opciones excluyentes (tema, densidad): marca la activa. */
  checked?: boolean;
  /** Muestra una línea divisoria antes de esta opción. */
  separator?: boolean;
}

/**
 * Menú desplegable accesible (patrón «menu button»): flechas, Inicio/Fin, Escape y clic fuera.
 * Sirve para agrupar acciones secundarias («Más»), para elegir el tema y para acciones destructivas apartadas.
 */
@Component({
  selector: 'app-action-menu',
  imports: [Icon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { position: relative; display: inline-flex; }
    .trigger { display: inline-flex; align-items: center; gap: .5rem; min-block-size: var(--tap); padding: 0 .75rem; border: 1px solid var(--line); border-radius: var(--radius-s);
      background: var(--surface); color: var(--nutri-texto); font: inherit; font-weight: 500; cursor: pointer; }
    .trigger:hover { border-color: var(--nutri-texto); }
    .trigger.primary { background: var(--brand-ink); border-color: var(--brand-ink); color: var(--nutri-marfil); font-weight: 600; }
    .trigger.primary:hover { background: color-mix(in srgb, var(--brand-ink) 86%, black); }
    .trigger.bare { border-color: transparent; background: transparent; padding: 0; inline-size: var(--tap); justify-content: center; }
    .trigger.bare:hover { background: color-mix(in srgb, var(--nutri-borde) 70%, transparent); }
    .panel { position: absolute; inset-block-start: calc(100% + .25rem); z-index: 60; min-inline-size: 12.5rem; padding: .25rem; border: 1px solid var(--line); border-radius: var(--radius-m);
      background: var(--surface); box-shadow: var(--shadow-m); display: grid; gap: 1px; }
    .panel.end { inset-inline-end: 0; }
    .panel.start { inset-inline-start: 0; }
    .item { display: flex; align-items: center; gap: .625rem; inline-size: 100%; min-block-size: 2.5rem; padding: 0 .75rem; border: 0; border-radius: var(--radius-s); background: none;
      color: var(--nutri-texto); font: inherit; text-align: start; text-decoration: none; cursor: pointer; }
    .item:hover, .item:focus-visible { background: color-mix(in srgb, var(--nutri-lavanda) 55%, transparent); outline: none; }
    .item.danger { color: var(--danger); }
    .item .check { margin-inline-start: auto; color: var(--brand-ink); }
    hr { border: 0; border-block-start: 1px solid var(--line); margin: .25rem .5rem; }
    @media (prefers-reduced-motion: no-preference) { .panel { animation: menu-in .14s cubic-bezier(.16, 1, .3, 1); } @keyframes menu-in { from { opacity: 0; transform: translateY(-4px); } } }
  `,
  template: `
    <button type="button" class="trigger" [class.bare]="!text()" [class.primary]="primary()" aria-haspopup="menu" [attr.aria-expanded]="open()" [attr.aria-label]="text() ? null : label()"
      (click)="toggle()" (keydown.arrowdown)="openAndFocus($event, 0)" (keydown.arrowup)="openAndFocus($event, -1)">
      @if (icon()) { <app-icon [name]="icon()!" [size]="18" /> }
      @if (text()) { <span>{{ text() }}</span><app-icon name="chevron-down" [size]="16" /> }
    </button>
    @if (open()) {
      <div class="panel" [class.end]="align() === 'end'" [class.start]="align() === 'start'" role="menu" [attr.aria-label]="label()" (keydown)="onKey($event)">
        @for (it of items(); track $index) {
          @if (it.separator) { <hr role="separator" /> }
          @if (it.link) {
            <a #entry class="item" [class.danger]="it.danger" role="menuitem" [routerLink]="it.link" (click)="close(false)">
              @if (it.icon) { <app-icon [name]="it.icon" [size]="18" /> }<span>{{ it.label }}</span>
            </a>
          } @else {
            <button #entry type="button" class="item" [class.danger]="it.danger" [attr.role]="it.checked === undefined ? 'menuitem' : 'menuitemradio'" [attr.aria-checked]="it.checked ?? null" (click)="choose(it)">
              @if (it.icon) { <app-icon [name]="it.icon" [size]="18" /> }<span>{{ it.label }}</span>
              @if (it.checked) { <app-icon class="check" name="check" [size]="16" /> }
            </button>
          }
        }
      </div>
    }
  `,
})
export class ActionMenu {
  readonly items = input.required<MenuItem[]>();
  /** Nombre accesible del menú. */
  readonly label = input('Más acciones');
  /** Texto visible del botón; sin texto, el botón es solo un icono. */
  readonly text = input('');
  readonly icon = input<IconName | null>('more');
  readonly align = input<'start' | 'end'>('end');
  /** Botón principal de la página (relleno con la tinta de marca). */
  readonly primary = input(false);

  protected readonly open = signal(false);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly router = inject(Router);
  private readonly entries = viewChildren<ElementRef<HTMLElement>>('entry');
  protected readonly count = computed(() => this.items().length);

  protected toggle(): void {
    this.open() ? this.close() : this.openAndFocus(null, null);
  }

  protected openAndFocus(e: Event | null, at: number | null): void {
    e?.preventDefault();
    this.open.set(true);
    if (at === null) return;
    // El panel se pinta en el siguiente ciclo; después se mueve el foco.
    queueMicrotask(() => setTimeout(() => this.focusAt(at)));
  }

  protected close(returnFocus = true): void {
    if (!this.open()) return;
    this.open.set(false);
    if (returnFocus) (this.host.nativeElement.querySelector('.trigger') as HTMLElement | null)?.focus();
  }

  protected choose(it: MenuItem): void {
    this.close();
    it.run?.();
  }

  private focusAt(i: number): void {
    const list = this.entries();
    if (!list.length) return;
    const idx = i < 0 ? list.length - 1 : Math.min(i, list.length - 1);
    list[idx].nativeElement.focus();
  }

  protected onKey(e: KeyboardEvent): void {
    const list = this.entries().map((x) => x.nativeElement);
    const at = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); list[(at + 1) % list.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(at - 1 + list.length) % list.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus(); }
    else if (e.key === 'Tab') this.close(false);
  }

  @HostListener('document:click', ['$event'])
  protected outside(e: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(e.target as Node)) this.close(false);
  }

  /** Evita que una ruta cambiada deje el menú abierto. */
  constructor() {
    this.router.events.pipe(filter((e) => e instanceof NavigationStart), takeUntilDestroyed()).subscribe(() => this.open.set(false));
  }
}
