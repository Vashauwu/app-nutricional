import { describe, expect, it } from 'vitest';
import { ACTIVITY_TONE, AUDIT_LABEL, CATEGORY_LABEL, auditLabel, categoryOf } from './labels';

describe('etiquetas de la bitácora global', () => {
  it('traduce los eventos conocidos y deja tal cual los desconocidos', () => {
    expect(auditLabel('billing.refund')).toBe('Reembolso');
    expect(auditLabel('platform.provider_subscription_canceled')).toContain('cortesía');
    expect(auditLabel('algo.nuevo')).toBe('algo.nuevo');
  });

  it('la familia del evento tiene nombre y tono', () => {
    for (const a of Object.keys(AUDIT_LABEL)) {
      const c = categoryOf(a);
      expect(CATEGORY_LABEL[c], a).toBeTruthy();
      expect(ACTIVITY_TONE[c], a).toBeTruthy();
    }
  });
});
