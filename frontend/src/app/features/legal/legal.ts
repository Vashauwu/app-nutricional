import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DbService } from '../../core/data/db.service';
import { SettingsService } from '../../core/services/settings.service';
import { Icon } from '../../shared/components/icon';
import { ThemeToggle } from '../../shared/components/theme-toggle';

interface Section { title: string; body: string[] }

/** Última revisión de los textos. Cámbiala cuando el despacho legal los apruebe o se modifiquen. */
const UPDATED = '12 de noviembre de 2026';

const privacy = (who: string): Section[] => [
  { title: '¿Quién es responsable de tus datos?', body: [`${who} (en adelante, «la consulta») es responsable del tratamiento de tus datos personales, conforme a la Ley Federal de Protección de Datos Personales en Posesión de los Particulares (LFPDPPP).`] },
  { title: '¿Qué datos recabamos?', body: [
    'Datos de identificación y contacto: nombre, fecha de nacimiento, sexo, correo electrónico y teléfono.',
    'Datos de salud, que son datos personales sensibles: peso, estatura, medidas corporales, composición corporal, estudios de laboratorio, padecimientos, alergias, medicamentos, hábitos y preferencias alimentarias, notas clínicas y las fotografías o comentarios que registres al dar seguimiento a tu plan.',
    'Datos de uso: citas programadas, registro de comidas y la actividad técnica mínima de tu sesión (por ejemplo, el dispositivo y la fecha de tu último acceso) para proteger tu cuenta.' ] },
  { title: '¿Para qué los usamos?', body: [
    'Finalidades necesarias: elaborar y dar seguimiento a tu plan de alimentación, programar tus consultas, mostrarte tu progreso y mantener tu expediente clínico.',
    'No usamos tus datos para publicidad ni los vendemos. No utilizamos servicios de analítica ni de rastreo de terceros.' ] },
  { title: '¿Con quién los compartimos?', body: [
    'Solo tu nutrióloga y el personal autorizado de la consulta acceden a tu expediente. Para operar la plataforma intervienen proveedores técnicos (alojamiento del servidor y envío de correos) que tratan los datos únicamente por cuenta de la consulta y bajo confidencialidad.',
    'No hacemos transferencias a terceros sin tu consentimiento, salvo las que exija una autoridad competente.' ] },
  { title: 'Tus derechos (ARCO)', body: [
    'Puedes Acceder a tus datos, Rectificarlos si son inexactos, Cancelarlos y Oponerte a su tratamiento. Para ejercerlos, solicítalo a tu nutrióloga por los medios de contacto de la consulta.',
    'Desde tu perfil puedes dar de baja tu cuenta en cualquier momento: dejarás de tener acceso y tu expediente se desactiva. Por disposición de la NOM-004-SSA3-2012, el expediente clínico debe conservarse al menos cinco años desde la última consulta; durante ese periodo se mantiene bloqueado y sin uso, y después se elimina.',
    'También puedes retirar tu consentimiento; hacerlo puede impedir que continuemos con tu atención.' ] },
  { title: 'Seguridad', body: ['Protegemos tu información con conexión cifrada, contraseñas almacenadas de forma irreversible, control de acceso por rol, bitácora de auditoría y copias de seguridad cifradas en el servidor. Ninguna medida es infalible; si ocurriera una vulneración que afecte tus derechos, te lo notificaremos.'] },
  { title: 'Cambios a este aviso', body: ['Si el aviso cambia de forma sustancial, te pediremos aceptar la nueva versión antes de continuar. Siempre puedes consultar la versión vigente en esta página.'] },
];

const terms = (who: string): Section[] => [
  { title: 'Qué es esta plataforma', body: [`Es el espacio de ${who} para compartirte tu plan de alimentación, registrar tu seguimiento y programar tus consultas. Es una herramienta de apoyo: no sustituye la valoración de un profesional de la salud ni atiende urgencias médicas.`] },
  { title: 'Tu cuenta', body: [
    'Tu nutrióloga te registra y te invita por correo. Eres responsable de mantener la confidencialidad de tu contraseña y de la actividad en tu cuenta; no la compartas.',
    'Si sospechas que alguien más accedió, cierra tus sesiones desde «Mi perfil» y cambia tu contraseña.' ] },
  { title: 'Uso adecuado', body: ['Usa la plataforma solo para tu atención nutricional, con información veraz. No intentes acceder a datos de otras personas, alterar el sistema ni interferir con su funcionamiento.'] },
  { title: 'Información de salud', body: ['Tu plan es personal y se elabora para ti. Síguelo según las indicaciones de tu nutrióloga y avísale de cualquier cambio en tu salud, medicamentos o alergias. Ante una emergencia, acude a un servicio médico.'] },
  { title: 'Disponibilidad', body: ['Procuramos que la plataforma esté siempre disponible, pero puede haber interrupciones por mantenimiento o causas ajenas. Algunas funciones pueden consultarse sin conexión con la información que ya se descargó en tu dispositivo.'] },
  { title: 'Baja de la cuenta', body: ['Puedes dar de baja tu cuenta desde «Mi perfil». La consulta también puede suspender cuentas que incumplan estos términos. En ambos casos aplica la conservación del expediente descrita en el aviso de privacidad.'] },
  { title: 'Cambios y contacto', body: ['Podemos actualizar estos términos; la versión vigente siempre estará en esta página. Para dudas o aclaraciones, comunícate con tu nutrióloga.'] },
];

@Component({
  selector: 'app-legal',
  imports: [RouterLink, Icon, ThemeToggle],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; min-block-size: 100dvh; background: var(--nutri-marfil); }
    .bar { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding: var(--space-3) clamp(1rem, 4vw, 2rem); background: var(--nutri-lavanda); color: var(--nutri-texto-fuerte); }
    .bar a { color: inherit; font-weight: 600; text-decoration: none; display: inline-flex; align-items: center; gap: .5rem; }
    article { max-inline-size: 46rem; margin-inline: auto; padding: clamp(1.5rem, 4vw, 3rem) clamp(1rem, 4vw, 2rem) 4rem; display: grid; gap: var(--space-5); }
    h1 { font-size: clamp(1.75rem, 3.5vw, 2.5rem); }
    h2 { font-size: 1.125rem; margin-block-end: var(--space-2); }
    p { margin: 0 0 var(--space-2); line-height: 1.65; max-inline-size: 68ch; }
    nav.also { display: flex; flex-wrap: wrap; gap: var(--space-4); padding-block-start: var(--space-4); border-block-start: 1px solid var(--line); }
  `,
  template: `
    <header class="bar">
      <a routerLink="/"><app-icon name="arrow-left" [size]="18" /> {{ brand().businessName }}</a>
      <app-theme-toggle />
    </header>
    <main id="contenido">
      <article>
        <header>
          <p class="eyebrow">Última actualización: {{ updated }}</p>
          <h1>{{ isPrivacy() ? 'Aviso de privacidad' : 'Términos de uso' }}</h1>
        </header>
        @for (s of sections(); track s.title) {
          <section>
            <h2>{{ s.title }}</h2>
            @for (p of s.body; track p) { <p>{{ p }}</p> }
          </section>
        }
        <nav class="also" aria-label="Otros documentos">
          @if (isPrivacy()) { <a routerLink="/terminos">Términos de uso</a> } @else { <a routerLink="/privacidad">Aviso de privacidad</a> }
          <a routerLink="/">Volver</a>
        </nav>
      </article>
    </main>
  `,
})
export class Legal {
  private readonly doc = inject(ActivatedRoute).snapshot.data['doc'] as 'privacidad' | 'terminos';
  private readonly data = inject(DbService);
  // Modo API: nombre público de la consulta (esta página se abre sin iniciar sesión).
  private readonly publicBrand = inject(SettingsService).loadPublicBrand().subscribe({ error: () => undefined });
  protected readonly brand = computed(() => this.data.db().settings.brand);
  protected readonly updated = UPDATED;
  protected readonly isPrivacy = () => this.doc === 'privacidad';
  protected readonly sections = computed<Section[]>(() => {
    const who = this.brand().businessName.trim() || 'la consulta';
    return this.isPrivacy() ? privacy(who) : terms(who);
  });
}
