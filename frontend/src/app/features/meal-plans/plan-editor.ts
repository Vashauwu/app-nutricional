import { firstValueFrom } from 'rxjs';
import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDragPreview, CdkDropList, CdkDropListGroup } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, HostListener, OnInit, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TuiButton } from '@taiga-ui/core';
import { DbService } from '../../core/data/db.service';
import { DishesService } from '../../core/services/dishes.service';
import { PlansService } from '../../core/services/plans.service';
import { ConfirmService, ToastService } from '../../core/services/ui.services';
import { HasUnsavedChanges } from '../../core/guards/unsaved.guard';
import { Totals, compareEquivalents, compareMacros, dayTotals, distributeEquivalents, itemTotals, latestMeasurement, proposeTargets, slotTotals } from '../../core/nutrition/engine';
import { Dish, DishVersion, GOAL_LABEL, NutriAlert, PLAN_STATUS_LABEL, PlanDay, PlanItem, PlanSlot } from '../../shared/models/domain';
import { AlertItem, Badge, EmptyState, PLAN_TONE } from '../../shared/components/ui';
import { CompareRow, EqChips } from '../../shared/components/nutrition-bits';
import { Icon } from '../../shared/components/icon';
import { Modal } from '../../shared/components/modal';
import { ageFrom, addDays, fmtCompact, formatDate, formatDateTime, longDate, normalizeText, shortDate, startOfWeek, todayIso, weekdayShort } from '../../shared/utils/format';
import { PlanEditorStore, SaveState } from './plan-editor.store';

interface ItemVM {
  item: PlanItem;
  name: string;
  version?: DishVersion;
  totals: Totals;
  latest: number;
  alert: 'critical' | 'warning' | 'info' | null;
}
interface SlotVM { slot: PlanSlot; kcal: string; items: ItemVM[] }
interface DayVM { day: PlanDay; totals: Totals; slots: SlotVM[]; pct: number; over: boolean; alerts: number }
interface SlotRef { kind: 'slot'; date: string; slotId: string }
interface LibRef { kind: 'lib' }

const SAVE_TEXT: Record<SaveState, string> = {
  idle: 'Sin cambios',
  dirty: 'Cambios sin guardar…',
  saving: 'Guardando…',
  saved: 'Guardado',
  error: 'No se pudo guardar',
  offline: 'Sin conexión: cambios en cola',
  conflict: 'Conflicto de edición',
};

@Component({
  selector: 'app-plan-editor',
  imports: [RouterLink, TuiButton, Icon, Badge, EmptyState, AlertItem, Modal, CompareRow, CdkDropListGroup, CdkDropList, CdkDrag, CdkDragHandle, CdkDragPreview],
  providers: [PlanEditorStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './plan-editor.scss',
  template: `
    @if (store.working() && store.meta(); as meta) {
      <h1 class="visually-hidden">Editor del plan {{ store.name() }}</h1>
      <div class="bar">
        <a class="icon-btn" routerLink="/planes" aria-label="Volver a planes"><app-icon name="arrow-left" /></a>
        <div class="title">
          <label class="visually-hidden" for="plan-name">Nombre del plan</label>
          <input id="plan-name" class="name-input" [value]="store.name()" [disabled]="readOnly()" (change)="store.rename($any($event.target).value)" />
          <div class="row small muted"><a [routerLink]="['/pacientes', meta.patientId]">{{ patientName() }}</a><app-badge [tone]="tone[meta.status]">{{ statusLabel[meta.status] }}</app-badge><span>{{ fd(firstDate()) }} – {{ fd(lastDate()) }}</span></div>
        </div>
        <span class="save-state" [class.is-error]="store.saveState() === 'error' || store.saveState() === 'conflict'" [class.is-saved]="store.saveState() === 'saved'" role="status" aria-live="polite">
          <app-icon [name]="stateIcon()" [size]="16" />{{ saveText() }}@if (store.saveState() === 'saved' && store.lastSavedAt(); as t) { {{ time(t) }} }
          @if (store.saveState() === 'error') { <button type="button" class="link-btn" (click)="store.retry()">Reintentar</button> }
        </span>
        <button type="button" class="icon-btn" aria-label="Deshacer" title="Deshacer" [disabled]="!store.canUndo() || readOnly()" (click)="store.undoLast()"><app-icon name="undo" /></button>
        <button type="button" class="icon-btn" aria-label="Rehacer" title="Rehacer" [disabled]="!store.canRedo() || readOnly()" (click)="store.redoLast()"><app-icon name="redo" /></button>
        <button tuiButton type="button" size="s" appearance="secondary" (click)="alertsOpen.set(true)"><app-icon name="alert" [size]="16" /> Alertas ({{ alerts().length }})</button>
        <button tuiButton type="button" size="s" appearance="secondary" (click)="openTargets()"><app-icon name="target" [size]="16" /> Objetivos</button>
        <button tuiButton type="button" size="s" appearance="secondary" (click)="historyOpen.set(true)"><app-icon name="history" [size]="16" /> Historial</button>
        <button tuiButton type="button" size="s" appearance="secondary" (click)="openTemplate()"><app-icon name="copy" [size]="16" /> Plantilla</button>
        @switch (meta.status) {
          @case ('draft') { <button tuiButton type="button" size="s" (click)="openPublish()"><app-icon name="send" [size]="16" /> Publicar</button> }
          @case ('published') {
            <button tuiButton type="button" size="s" appearance="secondary" (click)="status('unpublish')">Volver a borrador</button>
            <button tuiButton type="button" size="s" (click)="status('finalize')">Finalizar plan</button>
          }
          @case ('finished') { <button tuiButton type="button" size="s" (click)="status('archive')">Archivar</button><a tuiButton size="s" routerLink="/planes/nuevo" [queryParams]="{ copiar: meta.id }">Crear el siguiente plan</a> }
          @case ('archived') { <button tuiButton type="button" size="s" (click)="status('restore')">Restaurar</button> }
        }
      </div>

      @if (store.saveState() === 'conflict') {
        <div class="callout callout--crit banner" role="alert"><app-icon name="alert" /><div class="callout-body">
          <p><strong>Otra persona o sesión modificó este plan.</strong> Para evitar sobrescrituras silenciosas debes elegir cómo continuar.</p>
          <p class="small">Versión más reciente: {{ store.remote()?.updatedBy }} · {{ fdt(store.remote()?.updatedAt) }}</p>
          <div class="row"><button tuiButton type="button" size="s" (click)="store.resolveConflict('theirs')">Cargar la versión más reciente (descarto mis cambios)</button><button tuiButton type="button" size="s" appearance="secondary-destructive" (click)="store.resolveConflict('mine')">Conservar mis cambios y reemplazar</button></div>
        </div></div>
      }
      @if (store.recovered()) {
        <div class="callout callout--warn banner" role="status"><app-icon name="refresh" /><div class="callout-body">Recuperamos cambios pendientes de tu última sesión y se están sincronizando.</div></div>
      }
      @if (!data.isOnline()) {
        <div class="callout callout--warn banner" role="status"><app-icon name="wifi-off" /><div class="callout-body">Sin conexión. Puedes seguir editando; los cambios quedan en cola y se guardan al reconectar.</div></div>
      }
      @if (readOnly()) {
        <div class="callout banner" role="status"><app-icon name="lock" /><div class="callout-body">Plan {{ statusLabel[meta.status].toLowerCase() }}: es histórico y solo se puede consultar. Crea el siguiente a partir de este para editar.</div></div>
      } @else if (meta.status === 'published') {
        <div class="callout callout--ok banner" role="status"><app-icon name="eye" /><div class="callout-body">Plan publicado: los cambios se reflejan de inmediato en la vista de la paciente y quedan en el historial.</div></div>
      }

      <div class="ed" cdkDropListGroup>
        <aside class="lib panel" [class.closed]="!libOpen()" aria-label="Biblioteca de platillos">
          <h2 class="panel-head" style="font-size: 1.0625rem">Biblioteca</h2>
          <div class="field"><label class="visually-hidden" for="lib-s">Buscar platillo</label><div class="input-affix"><app-icon name="search" [size]="18" /><input id="lib-s" class="input" type="search" placeholder="Buscar platillo…" [value]="libSearch()" (input)="libSearch.set($any($event.target).value)" /></div></div>
          <div class="field"><label class="visually-hidden" for="lib-c">Categoría</label><select id="lib-c" class="select" (change)="libCat.set($any($event.target).value)"><option value="">Todas las categorías</option>@for (c of categories(); track c) { <option [value]="c">{{ c }}</option> }</select></div>
          <p class="small muted">Arrastra al calendario o usa "Agregar a…".</p>
          <div cdkDropList [cdkDropListData]="libRef" [cdkDropListSortingDisabled]="true" [cdkDropListEnterPredicate]="noEnter" class="stack--s" role="list">
            @for (d of library(); track d.id) {
              <div class="dish-card" role="listitem" cdkDrag [cdkDragData]="d" [cdkDragDisabled]="readOnly()">
                <div class="cdk-drag-preview" *cdkDragPreview>{{ d.name }}</div>
                <span class="t">{{ d.name }}</span>
                <span class="small muted">{{ c(cur(d).nutrition.perServing.energy) }} kcal · {{ d.category }}</span>
                @if (flagged(d)) { <span class="small" style="color: var(--danger)"><app-icon name="alert" [size]="12" /> {{ flagged(d) }}</span> }
                <button tuiButton type="button" size="xs" appearance="secondary" [disabled]="readOnly()" (click)="openAdd(d)">Agregar a…</button>
              </div>
            } @empty { <app-empty icon="dish" title="Sin platillos" text="Ajusta la búsqueda." /> }
          </div>
        </aside>

        <section class="cal" aria-label="Calendario del plan">
          <div class="week-nav">
            <button type="button" class="chip-toggle lib-toggle" [attr.aria-pressed]="libOpen()" (click)="libOpen.set(!libOpen())"><app-icon name="dish" [size]="16" /> Biblioteca</button>
            <button tuiButton type="button" size="s" appearance="secondary" [disabled]="!hasPrev()" (click)="shiftWeek(-1)"><app-icon name="chevron-left" [size]="16" /> Anterior</button>
            <strong aria-live="polite">{{ rangeLabel() }}</strong>
            <button tuiButton type="button" size="s" appearance="secondary" [disabled]="!hasNext()" (click)="shiftWeek(1)">Siguiente <app-icon name="chevron-right" [size]="16" /></button>
            <span class="grow"></span>
            <div class="chips" role="group" aria-label="Vista"><button type="button" class="chip-toggle" [attr.aria-pressed]="viewMode() === 'week'" (click)="viewMode.set('week')">Semana</button><button type="button" class="chip-toggle" [attr.aria-pressed]="viewMode() === 'day'" (click)="viewMode.set('day')">Día</button></div>
            @if (!readOnly()) {
              <button tuiButton type="button" size="s" appearance="secondary" (click)="dupWeekOpen.set(true)"><app-icon name="copy" [size]="16" /> Duplicar semana</button>
              <button tuiButton type="button" size="s" appearance="secondary" (click)="store.extendPeriod(1)"><app-icon name="plus" [size]="16" /> Día</button>
            }
          </div>
          @if (viewMode() === 'day') {
            <div class="chips" role="group" aria-label="Días de la semana">@for (v of windowVMs(); track v.day.date) { <button type="button" class="chip-toggle" [attr.aria-pressed]="selected() === v.day.date" (click)="selected.set(v.day.date)">{{ wd(v.day.date) }} {{ sd(v.day.date) }}</button> }</div>
          }
          <div class="scroller" tabindex="0" role="region" aria-label="Días del plan (desplázate horizontalmente)">
            <div class="week">
              @for (v of visibleVMs(); track v.day.date) {
                <article class="day" [class.sel]="selected() === v.day.date" [class.today]="v.day.date === today">
                  <header>
                    <div class="row row--between" style="gap: .25rem"><h3><button type="button" class="link-btn" style="text-decoration: none; color: inherit" (click)="selected.set(v.day.date)" [attr.aria-pressed]="selected() === v.day.date">{{ cap(wd(v.day.date)) }} {{ sd(v.day.date) }}</button></h3>
                      @if (v.alerts) { <app-badge tone="crit" icon="alert"><span class="visually-hidden">Alertas:</span> {{ v.alerts }}</app-badge> }</div>
                    <div class="meter" role="img" [attr.aria-label]="c(v.totals.nutrients.energy) + ' de ' + c(store.targets()?.energy) + ' kcal'"><span [style.inline-size.%]="v.pct > 100 ? 100 : v.pct" [style.background]="v.over ? 'var(--danger)' : null"></span></div>
                    <span class="small mono">{{ c(v.totals.nutrients.energy) }} / {{ c(store.targets()?.energy) }} kcal</span>
                  </header>
                  @for (s of v.slots; track s.slot.id) {
                    <div class="slot">
                      <div class="sh"><span>{{ s.slot.name }}</span><span class="mono">{{ c(s.kcal) }} kcal</span></div>
                      <div class="drop" cdkDropList [cdkDropListData]="slotRef(v.day.date, s.slot.id)" [cdkDropListDisabled]="readOnly()" (cdkDropListDropped)="onDrop($event, v.day.date, s.slot.id)" role="list" [attr.aria-label]="s.slot.name + ' del ' + sd(v.day.date)">
                        @for (it of s.items; track it.item.id) {
                          <div class="item" role="listitem" cdkDrag [cdkDragData]="it.item.id" [cdkDragDisabled]="readOnly()" [class.al-critical]="it.alert === 'critical'" [class.al-warning]="it.alert === 'warning'">
                            <span class="grip" cdkDragHandle aria-hidden="true"><app-icon name="grip" [size]="16" /></span>
                            <button type="button" class="nm" [attr.aria-label]="'Opciones de ' + it.name" (click)="openItem(v.day.date, s.slot.id, it.item.id)">{{ it.name }}</button>
                            <button type="button" class="icon-btn icon-btn--s" [attr.aria-label]="'Quitar ' + it.name" [disabled]="readOnly()" (click)="remove(v.day.date, s.slot.id, it)"><app-icon name="x" [size]="16" /></button>
                            <div class="meta">
                              <span>{{ c(it.totals.nutrients.energy) }} kcal</span>
                              @if (it.item.servings !== '1') { <span>× {{ it.item.servings }}</span> }
                              @if (it.alert) { <span style="color: var(--danger); font-weight: 600"><app-icon name="alert" [size]="12" /> {{ it.alert === 'critical' ? 'Alerta crítica' : 'Advertencia' }}</span> }
                              @if (it.latest > it.item.dishVersion) { <span style="color: var(--info)">Nueva versión v{{ it.latest }}</span> }
                            </div>
                          </div>
                        } @empty { <span class="hint">{{ readOnly() ? 'Vacío' : 'Suelta un platillo aquí' }}</span> }
                      </div>
                    </div>
                  }
                </article>
              }
            </div>
          </div>
        </section>

        <aside class="sum panel" aria-label="Resumen del día seleccionado" aria-live="polite">
          @if (selVM(); as sv) {
            <div class="panel-head"><h2 style="font-size: 1.0625rem">{{ longDate(sv.day.date) }}</h2><span class="small muted">Resumen del día</span></div>
            @for (m of selMacros(); track m.key) { <app-compare-row [m]="m" /> }
            <div class="eyebrow">Equivalentes SMAE (planeado / objetivo)</div>
            <div>
              @for (m of selEq(); track m.key) { <div class="eq-row"><span>{{ m.label }}</span><span>{{ c(m.planned, 1) }} / {{ c(m.target, 1) }}</span><span [style.color]="m.status === 'ok' ? 'var(--ok)' : m.status === 'over' ? 'var(--danger)' : 'var(--warn)'">{{ m.status === 'ok' ? 'En meta' : m.status === 'over' ? 'Excede' : 'Faltan' }}</span></div> }
            </div>
            <div class="field"><label for="dn">Indicaciones especiales del día</label><textarea id="dn" class="textarea" style="min-block-size: 4rem" [value]="sv.day.notes" [disabled]="readOnly()" (change)="store.setDayNotes(sv.day.date, $any($event.target).value)"></textarea></div>
            @if (!readOnly()) {
              <div class="row"><button tuiButton type="button" size="s" appearance="secondary" (click)="openDupDay()"><app-icon name="copy" [size]="16" /> Duplicar día</button><button tuiButton type="button" size="s" appearance="secondary-destructive" (click)="clearDay(sv.day.date)">Vaciar día</button></div>
            }
            @for (a of dayAlerts(); track a.id) { <app-alert-item [alert]="a" [link]="false" /> }
          }
        </aside>
      </div>

      <!-- Diálogos -->
      <app-modal [open]="!!itemSel()" (closed)="itemSel.set(null)" [title]="itemVM()?.name ?? 'Platillo'">
        @if (itemVM(); as iv) {
          <p class="small muted">{{ c(iv.totals.nutrients.energy) }} kcal con las porciones elegidas · versión v{{ iv.item.dishVersion }}</p>
          @if (iv.latest > iv.item.dishVersion) {
            <div class="callout"><app-icon name="info" /><div class="callout-body"><p>Hay una versión más reciente (v{{ iv.latest }}) de este platillo.</p><button tuiButton type="button" size="s" appearance="secondary" [disabled]="readOnly()" (click)="updateVersion(iv)">Actualizar a v{{ iv.latest }}</button></div></div>
          }
          <div class="form-grid">
            <div class="field"><label for="it-sv">Porciones</label><input id="it-sv" class="input" inputmode="decimal" [value]="servingsDraft()" [disabled]="readOnly()" (input)="servingsDraft.set($any($event.target).value)" />@if (!servingsOk()) { <p class="error" role="alert">Escribe un número mayor a cero.</p> }</div>
          </div>
          <div class="field"><label for="it-in">Indicaciones especiales del platillo</label><textarea id="it-in" class="textarea" [value]="instrDraft()" [disabled]="readOnly()" (input)="instrDraft.set($any($event.target).value)"></textarea></div>
          @if (!readOnly()) {
            <div class="row">
              <button tuiButton type="button" size="s" appearance="secondary" (click)="nudge(-1)"><app-icon name="chevron-up" [size]="16" /> Subir</button>
              <button tuiButton type="button" size="s" appearance="secondary" (click)="nudge(1)"><app-icon name="chevron-down" [size]="16" /> Bajar</button>
              <button tuiButton type="button" size="s" appearance="secondary" (click)="openSubstitute()"><app-icon name="swap" [size]="16" /> Sustituir…</button>
            </div>
            <fieldset style="border: 0; padding: 0; margin: 0"><legend class="eyebrow">Copiar a otros días (mismo tiempo de comida)</legend>
              <div class="chips">@for (d of otherDays(); track d) { <label class="chip-toggle" [class.is-on]="copyTo().includes(d)"><input type="checkbox" class="visually-hidden" [checked]="copyTo().includes(d)" (change)="toggleCopy(d)" />{{ wd(d) }} {{ sd(d) }}</label> }</div></fieldset>
          }
        }
        <ng-container modalFooter>
          <button tuiButton type="button" appearance="secondary" size="m" (click)="itemSel.set(null)">Cerrar</button>
          @if (!readOnly()) {
            @if (copyTo().length) { <button tuiButton type="button" appearance="secondary" size="m" (click)="applyCopy()">Copiar a {{ copyTo().length }} día(s)</button> }
            <button tuiButton type="button" size="m" [disabled]="!servingsOk()" (click)="applyItem()">Aplicar cambios</button>
          }
        </ng-container>
      </app-modal>

      <app-modal [open]="!!addDish()" (closed)="addDish.set(null)" [title]="'Agregar: ' + (addDish()?.name ?? '')" size="narrow">
        <div class="field"><label for="ad-d">Día</label><select id="ad-d" class="select" (change)="addDate.set($any($event.target).value)">@for (d of store.days(); track d.date) { <option [value]="d.date" [selected]="d.date === addDate()">{{ cap(wd(d.date)) }} {{ sd(d.date) }}</option> }</select></div>
        <div class="field"><label for="ad-s">Tiempo de comida</label><select id="ad-s" class="select" (change)="addSlotName.set($any($event.target).value)">@for (n of slotNames(); track n) { <option [value]="n" [selected]="n === addSlotName()">{{ n }}</option> }</select></div>
        <div class="field"><label for="ad-p">Porciones</label><input id="ad-p" class="input" inputmode="decimal" [value]="addServings()" (input)="addServings.set($any($event.target).value)" /></div>
        <ng-container modalFooter><button tuiButton type="button" appearance="secondary" size="m" (click)="addDish.set(null)">Cancelar</button><button tuiButton type="button" size="m" (click)="confirmAdd()">Agregar</button></ng-container>
      </app-modal>

      <app-modal [open]="subOpen()" (closed)="subOpen.set(false)" title="Sustituir platillo" size="wide">
        <p class="small muted">{{ meta.status === 'published' ? 'El plan está publicado: el platillo nuevo reemplaza de inmediato al visible para la paciente y el anterior queda en el historial. Los seguimientos previos se conservan con su versión original.' : 'Se reemplazará el platillo en este borrador.' }}</p>
        <div class="field"><label for="sub-r">Motivo</label><input id="sub-r" class="input" [value]="subReason()" (input)="subReason.set($any($event.target).value)" placeholder="Ej.: la paciente no encuentra el ingrediente" /></div>
        <div class="table-wrap"><table class="table"><thead><tr><th scope="col">Candidato</th><th scope="col" class="num">Δ kcal</th><th scope="col">Motivo de la sugerencia</th><th scope="col"><span class="visually-hidden">Acción</span></th></tr></thead><tbody>
          @for (cnd of candidates(); track cnd.dish.id) {
            <tr><td><strong>{{ cnd.dish.name }}</strong>@for (cf of cnd.conflicts; track cf) { <div><app-badge tone="crit" icon="alert">{{ cf }}</app-badge></div> }</td><td class="num">{{ sg(cnd.diff.energy) }}</td><td class="small">{{ cnd.reason }}</td>
              <td><button tuiButton type="button" size="s" [appearance]="cnd.conflicts.length ? 'secondary-destructive' : 'primary'" (click)="substitute(cnd.dish.id, cnd.version.versionNumber)">Sustituir</button></td></tr>
          } @empty { <tr><td colspan="4" class="muted">Sin candidatos similares. Arrastra otro platillo manualmente.</td></tr> }
        </tbody></table></div>
        <ng-container modalFooter><button tuiButton type="button" appearance="secondary" size="m" (click)="subOpen.set(false)">Cerrar</button></ng-container>
      </app-modal>

      <app-modal [(open)]="alertsOpen" title="Alertas nutricionales" size="wide">
        <p class="small muted">Apoyan tu revisión; no bloquean la publicación. Los umbrales y reglas se configuran en Configuración › Alertas.</p>
        @for (a of alerts(); track a.id) { <app-alert-item [alert]="a" [link]="false" /> } @empty { <app-empty icon="check-circle" title="Sin alertas" text="El plan está dentro de tus reglas y umbrales." /> }
        <ng-container modalFooter><button tuiButton type="button" size="m" (click)="alertsOpen.set(false)">Cerrar</button></ng-container>
      </app-modal>

      <app-modal [(open)]="publishOpen" title="Publicar plan" size="narrow">
        <p>La paciente verá este plan de inmediato y se guardará una copia exacta (versión) de lo publicado.</p>
        @if (critical().length) { <div class="callout callout--crit" role="alert"><app-icon name="alert" /><div class="callout-body"><p><strong>{{ critical().length }} alerta(s) crítica(s) sin resolver.</strong></p><p class="small">Puedes publicar de todos modos; la decisión clínica es tuya.</p><button type="button" class="link-btn small" (click)="publishOpen.set(false); alertsOpen.set(true)">Revisar alertas</button></div></div> }
        @else if (alerts().length) { <div class="callout callout--warn"><app-icon name="alert-circle" /><div class="callout-body">{{ alerts().length }} alerta(s) de menor nivel.</div></div> }
        @if (emptyDays() > 0) { <div class="callout callout--warn"><app-icon name="info" /><div class="callout-body">{{ emptyDays() }} día(s) no tienen platillos.</div></div> }
        <div class="field"><label for="pub-s">Resumen de la publicación</label><input id="pub-s" class="input" [value]="pubSummary()" (input)="pubSummary.set($any($event.target).value)" placeholder="Ej.: Plan de la semana 3" /></div>
        <ng-container modalFooter><button tuiButton type="button" appearance="secondary" size="m" (click)="publishOpen.set(false)">Cancelar</button><button tuiButton type="button" size="m" (click)="publish()">Publicar ahora</button></ng-container>
      </app-modal>

      <app-modal [(open)]="targetsOpen" title="Objetivos diarios" size="wide">
        <p class="small muted">Las propuestas son orientativas y siempre editables. Se guarda la versión de objetivos usada en cada plan (v{{ store.targets()?.version }}).</p>
        <div class="row"><button tuiButton type="button" size="s" appearance="secondary" (click)="propose()"><app-icon name="zap" [size]="16" /> Proponer según el paciente</button></div>
        @if (proposalNotes().length) { <div class="callout"><app-icon name="info" /><ul class="callout-body" style="margin: 0; padding-inline-start: 1rem">@for (n of proposalNotes(); track n) { <li class="small">{{ n }}</li> }</ul></div> }
        <div class="form-grid">
          @for (k of macroKeys; track k.key) { <div class="field"><label [for]="'tg-' + k.key">{{ k.label }}</label><input [id]="'tg-' + k.key" class="input" inputmode="decimal" [value]="tgDraft()[k.key]" (input)="setTg(k.key, $any($event.target).value)" /></div> }
        </div>
        <div class="eyebrow">Equivalentes por día</div>
        <div class="form-grid">@for (s of subgroups(); track s.id) { <div class="field"><label [for]="'eq-' + s.code">{{ s.name }}</label><input [id]="'eq-' + s.code" class="input" inputmode="decimal" [value]="eqDraft()[s.code] ?? ''" (input)="setEq(s.code, $any($event.target).value)" /></div> }</div>
        @if (distribution().length) {
          <div class="eyebrow">Reparto orientativo por tiempo de comida</div>
          <div class="table-wrap"><table class="table"><thead><tr><th scope="col">Tiempo</th>@for (c2 of eqCols(); track c2) { <th scope="col" class="num">{{ c2 }}</th> }</tr></thead><tbody>@for (r of distribution(); track r.name) { <tr><td>{{ r.name }}</td>@for (c2 of eqCols(); track c2) { <td class="num">{{ r.map[c2] ?? '—' }}</td> }</tr> }</tbody></table></div>
        }
        <ng-container modalFooter><button tuiButton type="button" appearance="secondary" size="m" (click)="targetsOpen.set(false)">Cancelar</button><button tuiButton type="button" size="m" (click)="applyTargets()">Guardar objetivos</button></ng-container>
      </app-modal>

      <app-modal [(open)]="templateOpen" title="Guardar como plantilla" size="narrow">
        <p class="small muted">La plantilla es una copia: modificarla no cambia planes ya asignados, y los planes que crees desde ella son independientes.</p>
        <div class="field"><label for="tp-n">Nombre</label><input id="tp-n" class="input" [value]="tpName()" (input)="tpName.set($any($event.target).value)" /></div>
        <div class="field"><label for="tp-d">Descripción</label><input id="tp-d" class="input" [value]="tpDesc()" (input)="tpDesc.set($any($event.target).value)" /></div>
        <div class="field"><label for="tp-s">Alcance</label><select id="tp-s" class="select" (change)="tpScope.set($any($event.target).value)"><option value="global">Global (reutilizable con cualquier paciente)</option><option value="patient">Solo para este paciente</option></select></div>
        <div class="form-grid"><div class="field"><label for="tp-f">Desde</label><select id="tp-f" class="select" (change)="tpFrom.set($any($event.target).value)">@for (d of store.days(); track d.date) { <option [value]="d.date" [selected]="d.date === tpFrom()">{{ sd(d.date) }}</option> }</select></div>
        <div class="field"><label for="tp-t">Hasta</label><select id="tp-t" class="select" (change)="tpTo.set($any($event.target).value)">@for (d of store.days(); track d.date) { <option [value]="d.date" [selected]="d.date === tpTo()">{{ sd(d.date) }}</option> }</select></div></div>
        <ng-container modalFooter><button tuiButton type="button" appearance="secondary" size="m" (click)="templateOpen.set(false)">Cancelar</button><button tuiButton type="button" size="m" [disabled]="!tpName().trim()" (click)="saveTemplate()">Guardar plantilla</button></ng-container>
      </app-modal>

      <app-modal [(open)]="dupDayOpen" title="Duplicar día" size="narrow">
        <p>Copiar <strong>{{ selected() ? longDate(selected()) : '' }}</strong> a (reemplaza el contenido de esos días):</p>
        <div class="chips">@for (d of otherDays(); track d) { <label class="chip-toggle" [class.is-on]="dupTo().includes(d)"><input type="checkbox" class="visually-hidden" [checked]="dupTo().includes(d)" (change)="toggleDup(d)" />{{ wd(d) }} {{ sd(d) }}</label> }</div>
        <ng-container modalFooter><button tuiButton type="button" appearance="secondary" size="m" (click)="dupDayOpen.set(false)">Cancelar</button><button tuiButton type="button" size="m" [disabled]="!dupTo().length" (click)="applyDupDay()">Duplicar</button></ng-container>
      </app-modal>

      <app-modal [(open)]="dupWeekOpen" title="Duplicar semana" size="narrow">
        <p>Copiar la semana del <strong>{{ sd(windowStart()) }}</strong> a la semana que inicia el:</p>
        <div class="field"><label for="dw">Semana destino</label><select id="dw" class="select" (change)="dupWeekTo.set($any($event.target).value)">@for (w of weekOptions(); track w) { <option [value]="w" [selected]="w === dupWeekTo()">{{ sd(w) }} – {{ sd(add(w, 6)) }}</option> }</select></div>
        <ng-container modalFooter><button tuiButton type="button" appearance="secondary" size="m" (click)="dupWeekOpen.set(false)">Cancelar</button><button tuiButton type="button" size="m" (click)="applyDupWeek()">Duplicar semana</button></ng-container>
      </app-modal>

      <app-modal [(open)]="historyOpen" title="Historial del plan" size="wide">
        <div class="tabs" role="tablist"><button type="button" role="tab" [attr.aria-selected]="histTab() === 'events'" (click)="histTab.set('events')">Eventos</button><button type="button" role="tab" [attr.aria-selected]="histTab() === 'pubs'" (click)="histTab.set('pubs')">Publicaciones</button></div>
        @if (histTab() === 'events') {
          <ul class="list-plain list-rows">@for (e of eventsDesc(); track e.id) { <li><div class="grow"><strong>{{ e.summary }}</strong><p class="small muted">{{ e.by }} · {{ fdt(e.at) }}</p></div></li> }</ul>
        } @else {
          <p class="small muted">Copia exacta de lo que vio la paciente en cada publicación.</p>
          @for (p of pubsDesc(); track p.versionNumber) {
            <details class="panel" style="padding: var(--space-3) var(--space-4)"><summary><strong>Versión {{ p.versionNumber }}</strong> · {{ fdt(p.publishedAt) }} · {{ p.by }} — {{ p.summary }}</summary>
              <div class="stack--s" style="margin-block-start: var(--space-3)">@for (d of p.days; track d.date) { <p class="small"><strong>{{ cap(wd(d.date)) }} {{ sd(d.date) }}:</strong> {{ dayNames(d) }}</p> }</div></details>
          } @empty { <app-empty icon="send" title="Aún sin publicaciones" /> }
        }
        <ng-container modalFooter><button tuiButton type="button" size="m" (click)="historyOpen.set(false)">Cerrar</button></ng-container>
      </app-modal>
    } @else {
      <div class="page"><app-empty icon="calendar" title="Plan no encontrado"><a tuiButton routerLink="/planes" appearance="secondary" size="m">Volver a planes</a></app-empty></div>
    }
  `,
})
export class PlanEditor implements OnInit, HasUnsavedChanges {
  protected readonly store = inject(PlanEditorStore);
  protected readonly data = inject(DbService);
  private readonly plans = inject(PlansService);
  private readonly dishes = inject(DishesService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly router = inject(Router);

  readonly id = input.required<string>();
  readonly fecha = input<string>();

  protected readonly tone = PLAN_TONE;
  protected readonly statusLabel = PLAN_STATUS_LABEL;
  protected readonly today = todayIso();
  protected readonly noEnter = (): boolean => false;
  protected readonly libRef: LibRef = { kind: 'lib' };
  protected readonly fd = formatDate;
  protected readonly fdt = (v?: string): string => formatDateTime(v);
  protected readonly c = (v: string | undefined | null, p = 0): string => fmtCompact(v ?? undefined, p);
  protected readonly sd = shortDate;
  protected readonly wd = weekdayShort;
  protected readonly cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
  protected readonly longDate = longDate;
  protected readonly add = addDays;
  protected readonly time = (d: Date): string => d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  protected readonly sg = (v: string): string => { const n = Number(v); return (n > 0 ? '+' : '') + n.toFixed(0); };

  protected readonly selected = signal('');
  protected readonly viewMode = signal<'week' | 'day'>(typeof matchMedia === 'function' && matchMedia('(max-width: 48rem)').matches ? 'day' : 'week');
  protected readonly libOpen = signal(true);
  protected readonly libSearch = signal('');
  protected readonly libCat = signal('');

  // Diálogos
  protected readonly alertsOpen = signal(false);
  protected readonly publishOpen = signal(false);
  protected readonly targetsOpen = signal(false);
  protected readonly templateOpen = signal(false);
  protected readonly dupDayOpen = signal(false);
  protected readonly dupWeekOpen = signal(false);
  protected readonly historyOpen = signal(false);
  protected readonly histTab = signal<'events' | 'pubs'>('events');
  protected readonly subOpen = signal(false);
  protected readonly itemSel = signal<{ date: string; slotId: string; itemId: string } | null>(null);
  protected readonly servingsDraft = signal('1');
  protected readonly instrDraft = signal('');
  protected readonly copyTo = signal<string[]>([]);
  protected readonly dupTo = signal<string[]>([]);
  protected readonly dupWeekTo = signal('');
  protected readonly addDish = signal<Dish | null>(null);
  protected readonly addDate = signal('');
  protected readonly addSlotName = signal('');
  protected readonly addServings = signal('1');
  protected readonly subReason = signal('');
  protected readonly pubSummary = signal('');
  protected readonly tpName = signal('');
  protected readonly tpDesc = signal('');
  protected readonly tpScope = signal<'global' | 'patient'>('global');
  protected readonly tpFrom = signal('');
  protected readonly tpTo = signal('');
  protected readonly tgDraft = signal<Record<string, string>>({ energy: '', protein: '', carbs: '', lipids: '' });
  protected readonly eqDraft = signal<Record<string, string>>({});
  protected readonly proposalNotes = signal<string[]>([]);
  protected readonly macroKeys = [{ key: 'energy', label: 'Energía (kcal)' }, { key: 'protein', label: 'Proteínas (g)' }, { key: 'carbs', label: 'Carbohidratos (g)' }, { key: 'lipids', label: 'Lípidos (g)' }];

  protected readonly planSvc = computed(() => (this.data.version(), this.plans.get(this.id())));
  protected readonly readOnly = computed(() => ['finished', 'archived'].includes(this.store.meta()?.status ?? ''));
  protected readonly patient = computed(() => this.data.patient(this.store.meta()?.patientId ?? ''));
  protected readonly patientName = computed(() => this.data.patientName(this.store.meta()?.patientId ?? ''));
  protected readonly firstDate = computed(() => this.store.days()[0]?.date ?? '');
  protected readonly lastDate = computed(() => this.store.days()[this.store.days().length - 1]?.date ?? '');
  protected readonly saveText = computed(() => SAVE_TEXT[this.store.saveState()]);
  protected readonly stateIcon = computed(() => ({ idle: 'check', dirty: 'clock', saving: 'refresh', saved: 'check-circle', error: 'alert-circle', offline: 'wifi-off', conflict: 'alert' } as const)[this.store.saveState()]);
  protected readonly subgroups = this.data.activeSubgroups;
  protected readonly categories = computed(() => [...new Set(this.data.db().dishes.map((d) => d.category))]);
  protected readonly slotNames = computed(() => [...new Set(this.store.days().flatMap((d) => d.slots.map((s) => s.name)))]);
  protected readonly emptyDays = computed(() => this.store.days().filter((d) => !d.slots.some((s) => s.items.length)).length);

  protected readonly library = computed(() => {
    const t = normalizeText(this.libSearch());
    return this.data.db().dishes
      .filter((d) => !d.deletedAt && d.status === 'active' && (!this.libCat() || d.category === this.libCat()) && (!t || normalizeText(`${d.name} ${d.tags.join(' ')}`).includes(t)))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  });

  private readonly lookup = (id: string, v: number): DishVersion | undefined => this.data.dishVersion(id, v);

  /** Alertas del borrador de trabajo, no solo del último guardado. */
  protected readonly alerts = computed<NutriAlert[]>(() => {
    const p = this.planSvc();
    const targets = this.store.targets();
    if (!p || !targets) return [];
    return this.plans.alertsFor({ ...p, days: this.store.days(), targets });
  });
  protected readonly critical = computed(() => this.alerts().filter((a) => a.level === 'critical'));
  private readonly itemAlert = computed(() => {
    const m = new Map<string, 'critical' | 'warning' | 'info'>();
    for (const a of this.alerts()) {
      const itemId = a.id.split(':')[4];
      if (!itemId || !['allergy', 'avoid', 'clin'].includes(a.id.split(':')[0])) continue;
      if (m.get(itemId) !== 'critical') m.set(itemId, a.level);
    }
    return m;
  });

  protected readonly dayVMs = computed<DayVM[]>(() => {
    const targets = this.store.targets();
    const alertCount = new Map<string, number>();
    for (const a of this.alerts()) if (a.date) alertCount.set(a.date, (alertCount.get(a.date) ?? 0) + 1);
    return this.store.days().map((day) => {
      const totals = dayTotals(day, this.lookup);
      const target = Number(targets?.energy ?? 0);
      const kcal = Number(totals.nutrients.energy);
      return {
        day, totals, pct: target ? Math.round((kcal / target) * 100) : 0, over: target ? kcal > target * 1.1 : false, alerts: alertCount.get(day.date) ?? 0,
        slots: day.slots.map((slot) => ({
          slot, kcal: slotTotals(slot.items, this.lookup).nutrients.energy,
          items: slot.items.map((item): ItemVM => {
            const dish = this.data.dish(item.dishId);
            const version = this.lookup(item.dishId, item.dishVersion);
            return { item, name: dish?.name ?? 'Platillo eliminado', version, totals: itemTotals(version, item.servings), latest: dish?.currentVersion ?? item.dishVersion, alert: this.itemAlert().get(item.id) ?? null };
          }),
        })),
      };
    });
  });

  protected readonly windowStart = computed(() => startOfWeek(this.selected() || this.firstDate() || this.today, this.data.db().settings.region.weekStart));
  protected readonly windowVMs = computed(() => this.dayVMs().filter((v) => v.day.date >= this.windowStart() && v.day.date <= addDays(this.windowStart(), 6)));
  protected readonly visibleVMs = computed(() => (this.viewMode() === 'day' ? this.dayVMs().filter((v) => v.day.date === this.selected()) : this.windowVMs()));
  protected readonly rangeLabel = computed(() => (this.viewMode() === 'day' ? longDate(this.selected()) : `${shortDate(this.windowStart())} – ${shortDate(addDays(this.windowStart(), 6))}`));
  protected readonly hasPrev = computed(() => this.firstDate() < this.windowStart());
  protected readonly hasNext = computed(() => this.lastDate() > addDays(this.windowStart(), 6));
  protected readonly selVM = computed(() => this.dayVMs().find((v) => v.day.date === this.selected()));
  protected readonly selMacros = computed(() => { const v = this.selVM(); const t = this.store.targets(); return v && t ? compareMacros(v.totals, t, this.plans.tolerances()) : []; });
  protected readonly selEq = computed(() => { const v = this.selVM(); const t = this.store.targets(); return v && t ? compareEquivalents(v.totals, t, this.data.subgroupName, this.plans.tolerances()).filter((m) => m.status !== 'none') : []; });
  protected readonly dayAlerts = computed(() => this.alerts().filter((a) => a.date === this.selected()));
  protected readonly otherDays = computed(() => this.store.days().map((d) => d.date).filter((d) => d !== (this.itemSel()?.date ?? this.selected())));
  protected readonly weekOptions = computed(() => [-14, -7, 7, 14, 21].map((n) => addDays(this.windowStart(), n)));

  protected readonly itemVM = computed(() => {
    const s = this.itemSel();
    if (!s) return null;
    return this.dayVMs().find((v) => v.day.date === s.date)?.slots.find((x) => x.slot.id === s.slotId)?.items.find((i) => i.item.id === s.itemId) ?? null;
  });
  protected readonly servingsOk = computed(() => /^\d+(\.\d+)?$/.test(this.servingsDraft().trim()) && Number(this.servingsDraft()) > 0);
  protected readonly candidates = computed(() => {
    const iv = this.itemVM();
    return iv ? this.dishes.candidates(iv.item.dishId, this.patient()) : [];
  });
  protected readonly eventsDesc = computed(() => [...(this.store.meta()?.history ?? [])].reverse());
  protected readonly pubsDesc = computed(() => [...(this.store.meta()?.publications ?? [])].reverse());
  protected readonly distribution = computed(() => {
    const eq = Object.fromEntries(Object.entries(this.eqDraft()).filter(([, v]) => /^\d+(\.\d+)?$/.test(v) && Number(v) > 0));
    if (!Object.keys(eq).length) return [];
    const d = distributeEquivalents(eq, this.slotNames());
    return Object.entries(d).map(([name, map]) => ({ name, map }));
  });
  protected readonly eqCols = computed(() => Object.entries(this.eqDraft()).filter(([, v]) => Number(v) > 0).map(([k]) => k));

  constructor() {
    effect(() => {
      this.data.version();
      untracked(() => {
        if (this.store.meta()) this.store.refreshMeta();
      });
    });
  }

  ngOnInit(): void {
    // Modo API: el plan completo (con historial y alertas) se pide al servidor antes de abrir el editor.
    this.plans.load(this.id()).subscribe({ next: () => this.openEditor(), error: () => void this.router.navigate(['/planes']) });
  }

  private openEditor(): void {
    if (!this.store.load(this.id())) {
      void this.router.navigate(['/planes']);
      return;
    }
    const days = this.store.days();
    const wanted = this.fecha();
    this.selected.set(days.find((d) => d.date === wanted)?.date ?? days.find((d) => d.date === this.today)?.date ?? days[0]?.date ?? '');
    this.addDate.set(this.selected());
    this.addSlotName.set(this.slotNames()[0] ?? '');
  }

  hasUnsavedChanges(): boolean { return this.store.hasUnsavedChanges(); }

  @HostListener('window:beforeunload', ['$event'])
  protected warn(e: BeforeUnloadEvent): void { if (this.hasUnsavedChanges()) e.preventDefault(); }

  @HostListener('document:keydown', ['$event'])
  protected onKey(e: KeyboardEvent): void {
    const mod = e.ctrlKey || e.metaKey;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (!mod || tag === 'INPUT' || tag === 'TEXTAREA' || this.readOnly()) return;
    if (e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.store.redoLast() : this.store.undoLast(); }
    else if (e.key.toLowerCase() === 'y') { e.preventDefault(); this.store.redoLast(); }
  }

  protected slotRef = (date: string, slotId: string): SlotRef => ({ kind: 'slot', date, slotId });
  protected cur = (d: Dish): DishVersion => d.versions.find((v) => v.versionNumber === d.currentVersion) ?? d.versions[d.versions.length - 1];

  /** Muestra un aviso si el platillo de la biblioteca choca con las alergias del paciente. */
  protected flagged(d: Dish): string {
    const p = this.patient();
    if (!p) return '';
    const words = [d.name, ...d.tags, ...this.cur(d).ingredients.map((i) => i.nameSnapshot)].map(normalizeText);
    for (const a of p.allergies.filter((x) => x.status === 'active')) {
      if ([a.allergen, ...a.aliases].map(normalizeText).some((t) => t.length > 2 && words.some((w) => w.includes(t)))) return `Alergia: ${a.allergen}`;
    }
    return '';
  }

  protected shiftWeek(dir: -1 | 1): void {
    const next = addDays(this.windowStart(), 7 * dir);
    const inWindow = this.store.days().find((d) => d.date >= next && d.date <= addDays(next, 6));
    if (inWindow) this.selected.set(inWindow.date);
  }

  // ---------- Arrastrar y soltar (§9.2) ----------
  protected onDrop(e: CdkDragDrop<SlotRef, any, any>, date: string, slotId: string): void {
    if (this.readOnly()) return;
    const from = e.previousContainer.data as SlotRef | LibRef;
    if (from.kind === 'lib') {
      const dish = e.item.data as Dish;
      this.store.addItem(date, slotId, dish.id, dish.currentVersion, e.currentIndex);
      this.toast.info(`"${dish.name}" agregado.`);
      return;
    }
    this.store.moveItem({ date: from.date, slotId: from.slotId, index: e.previousIndex }, { date, slotId, index: e.currentIndex });
  }

  protected remove(date: string, slotId: string, it: ItemVM): void {
    this.store.removeItem(date, slotId, it.item.id);
    this.toast.info(`"${it.name}" eliminado. Puedes deshacer con Ctrl+Z.`);
  }

  protected clearDay(date: string): void { this.store.clearDay(date); this.toast.info('Día vaciado. Puedes deshacer.'); }

  // ---------- Platillo ----------
  protected openItem(date: string, slotId: string, itemId: string): void {
    const it = this.dayVMs().find((v) => v.day.date === date)?.slots.find((s) => s.slot.id === slotId)?.items.find((i) => i.item.id === itemId);
    this.servingsDraft.set(it?.item.servings ?? '1');
    this.instrDraft.set(it?.item.instructions ?? '');
    this.copyTo.set([]);
    this.itemSel.set({ date, slotId, itemId });
  }

  protected applyItem(): void {
    const s = this.itemSel();
    if (!s || !this.servingsOk()) return;
    this.store.updateItem(s.date, s.slotId, s.itemId, { servings: this.servingsDraft().trim(), instructions: this.instrDraft().trim() || undefined });
    this.itemSel.set(null);
  }

  protected updateVersion(iv: ItemVM): void {
    const s = this.itemSel();
    if (!s) return;
    this.store.updateItem(s.date, s.slotId, s.itemId, { dishVersion: iv.latest });
    this.toast.ok(`Actualizado a la versión v${iv.latest}.`);
  }

  protected nudge(dir: -1 | 1): void { const s = this.itemSel(); if (s) this.store.nudge(s.date, s.slotId, s.itemId, dir); }
  protected toggleCopy(d: string): void { this.copyTo.update((l) => (l.includes(d) ? l.filter((x) => x !== d) : [...l, d])); }
  protected applyCopy(): void {
    const s = this.itemSel();
    if (!s) return;
    this.store.copyItemToDays(s.date, s.slotId, s.itemId, this.copyTo());
    this.toast.ok(`Copiado a ${this.copyTo().length} día(s).`);
    this.itemSel.set(null);
  }

  // ---------- Agregar desde la biblioteca (alternativa accesible al arrastre) ----------
  protected openAdd(d: Dish): void {
    this.addDate.set(this.selected() || this.firstDate());
    this.addSlotName.set(this.slotNames()[0] ?? '');
    this.addServings.set('1');
    this.addDish.set(d);
  }

  protected confirmAdd(): void {
    const d = this.addDish();
    const slot = this.store.days().find((x) => x.date === this.addDate())?.slots.find((s) => s.name === this.addSlotName());
    if (!d || !slot || !/^\d+(\.\d+)?$/.test(this.addServings()) || Number(this.addServings()) <= 0) { this.toast.error('Revisa día, tiempo de comida y porciones.'); return; }
    this.store.addItem(this.addDate(), slot.id, d.id, d.currentVersion, undefined, this.addServings());
    this.addDish.set(null);
    this.toast.ok(`"${d.name}" agregado.`);
  }

  // ---------- Sustitución (§8) ----------
  protected openSubstitute(): void { this.subReason.set(''); this.subOpen.set(true); }

  protected async substitute(dishId: string, version: number): Promise<void> {
    const s = this.itemSel();
    if (!s) return;
    if (this.store.meta()?.status === 'published') {
      if (!(await this.store.flush())) { this.toast.error('Guarda los cambios pendientes antes de sustituir.'); return; }
      try { await firstValueFrom(this.plans.substitute(this.id(), s.date, s.slotId, s.itemId, { dishId, dishVersion: version }, this.subReason().trim())); }
      catch (e) { this.toast.error(e instanceof Error ? e.message : 'No se pudo sustituir.'); return; }
      this.store.reloadFromServer();
      this.toast.ok('Sustitución aplicada. La paciente ya ve el platillo nuevo; el anterior queda en el historial.');
    } else {
      this.store.replaceItem(s.date, s.slotId, s.itemId, dishId, version);
      this.toast.ok('Platillo sustituido en el borrador.');
    }
    this.subOpen.set(false);
    this.itemSel.set(null);
  }

  // ---------- Duplicar ----------
  protected openDupDay(): void { this.dupTo.set([]); this.dupDayOpen.set(true); }
  protected toggleDup(d: string): void { this.dupTo.update((l) => (l.includes(d) ? l.filter((x) => x !== d) : [...l, d])); }
  protected applyDupDay(): void {
    this.store.duplicateDay(this.selected(), this.dupTo());
    this.dupDayOpen.set(false);
    this.toast.ok(`Día duplicado en ${this.dupTo().length} día(s).`);
  }
  protected applyDupWeek(): void {
    const to = this.dupWeekTo() || this.weekOptions()[2];
    this.store.duplicateWeek(this.windowStart(), to);
    this.dupWeekOpen.set(false);
    this.toast.ok('Semana duplicada.');
  }

  // ---------- Publicar y ciclo de vida (§11) ----------
  protected async openPublish(): Promise<void> {
    this.pubSummary.set('');
    this.publishOpen.set(true);
  }

  protected async publish(): Promise<void> {
    if (!(await this.store.flush())) { this.toast.error('Primero se deben guardar los cambios pendientes.'); return; }
    try { await firstValueFrom(this.plans.publish(this.id(), this.pubSummary().trim())); }
    catch (e) { this.toast.error(e instanceof Error ? e.message : 'No se pudo publicar.'); return; }
    this.store.reloadFromServer();
    this.publishOpen.set(false);
    this.toast.ok('Plan publicado. La paciente ya puede verlo.');
  }

  protected async status(action: 'unpublish' | 'finalize' | 'archive' | 'restore'): Promise<void> {
    const texts = {
      unpublish: ['Volver a borrador', 'La paciente dejará de ver este plan hasta que lo publiques de nuevo.'],
      finalize: ['Finalizar plan', 'Pasa al historial y deja de ser el plan vigente. Tú decides cuándo crear el siguiente.'],
      archive: ['Archivar plan', 'Se conserva, pero sale de la operación habitual.'],
      restore: ['Restaurar plan', 'Volverá a la lista como finalizado.'],
    } as const;
    if (!(await this.store.flush())) { this.toast.error('Guarda los cambios pendientes primero.'); return; }
    const ok = await this.confirm.ask({ title: texts[action][0], message: texts[action][1], confirmLabel: texts[action][0] });
    if (!ok) return;
    const map = { unpublish: () => this.plans.unpublish(this.id()), finalize: () => this.plans.finalize(this.id()), archive: () => this.plans.archive(this.id()), restore: () => this.plans.restore(this.id()) };
    try { await firstValueFrom(map[action]()); }
    catch (e) { this.toast.error(e instanceof Error ? e.message : 'No se pudo cambiar el estado.'); return; }
    this.store.reloadFromServer();
    this.toast.ok('Estado del plan actualizado.');
  }

  // ---------- Objetivos (§30.7) ----------
  protected openTargets(): void {
    const t = this.store.targets();
    if (!t) return;
    this.tgDraft.set({ energy: t.energy, protein: t.protein, carbs: t.carbs, lipids: t.lipids });
    this.eqDraft.set({ ...t.equivalents });
    this.proposalNotes.set([]);
    this.targetsOpen.set(true);
  }

  protected setTg(key: string, v: string): void { this.tgDraft.update((d) => ({ ...d, [key]: v })); }
  protected setEq(code: string, v: string): void { this.eqDraft.update((d) => ({ ...d, [code]: v })); }

  protected propose(): void {
    const p = this.patient();
    const m = p ? latestMeasurement(p.measurements) : undefined;
    if (!p || !m) { this.toast.error('Registra una medición del paciente para proponer objetivos.'); return; }
    const r = proposeTargets({ sex: p.profile.sex, age: ageFrom(p.profile.birthDate), weightKg: m.weightKg, heightCm: m.heightCm, goal: p.goal });
    this.tgDraft.set({ energy: r.energy, protein: r.protein, carbs: r.carbs, lipids: r.lipids });
    this.eqDraft.set(r.equivalentsByCode);
    this.proposalNotes.set([...r.rationale, `Objetivo registrado: ${GOAL_LABEL[p.goal]}. Es una propuesta orientativa: ajústala con tu criterio clínico.`]);
  }

  protected applyTargets(): void {
    const g = this.tgDraft();
    const nums = ['energy', 'protein', 'carbs', 'lipids'];
    if (nums.some((k) => !/^\d+(\.\d+)?$/.test((g[k] ?? '').trim()))) { this.toast.error('Revisa que energía y macros sean números válidos.'); return; }
    const eq = Object.fromEntries(Object.entries(this.eqDraft()).filter(([, v]) => /^\d+(\.\d+)?$/.test(v) && Number(v) > 0));
    this.store.setTargets({ energy: g['energy'].trim(), protein: g['protein'].trim(), carbs: g['carbs'].trim(), lipids: g['lipids'].trim(), equivalents: eq, version: this.store.targets()?.version ?? 1 });
    this.targetsOpen.set(false);
    this.toast.ok('Objetivos actualizados (nueva versión de objetivos).');
  }

  // ---------- Plantillas (§10) ----------
  protected openTemplate(): void {
    this.tpName.set(`${this.store.name()} (plantilla)`);
    this.tpDesc.set('');
    this.tpScope.set('global');
    this.tpFrom.set(this.firstDate());
    this.tpTo.set(this.lastDate());
    this.templateOpen.set(true);
  }

  protected saveTemplate(): void {
    if (this.tpFrom() > this.tpTo()) { this.toast.error('La fecha de inicio debe ser anterior al final.'); return; }
    void this.store.flush().then(() => {
      this.plans.saveTemplateFromPlan(this.id(), { name: this.tpName(), description: this.tpDesc(), scope: this.tpScope(), fromDate: this.tpFrom(), toDate: this.tpTo() }).subscribe({
        next: () => { this.templateOpen.set(false); this.toast.ok('Plantilla guardada.'); },
        error: (e: unknown) => this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.'),
      });
    });
  }

  protected dayNames(d: PlanDay): string {
    const names = d.slots.flatMap((s) => s.items.map((i) => this.data.dish(i.dishId)?.name ?? 'Platillo'));
    return names.length ? names.join(' · ') : 'sin platillos';
  }
}
