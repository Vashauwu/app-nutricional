import { inject } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';
import { ConfirmService } from '../services/ui.services';

export interface HasUnsavedChanges {
  hasUnsavedChanges(): boolean;
}

/** Confirma antes de salir si hay cambios sin guardar (§9.3). */
export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = (component) => {
  if (!component.hasUnsavedChanges()) return true;
  return inject(ConfirmService).ask({
    title: 'Hay cambios sin guardar',
    message: 'Si sales ahora perderás lo que no has guardado.',
    confirmLabel: 'Salir sin guardar',
    tone: 'danger',
  });
};
