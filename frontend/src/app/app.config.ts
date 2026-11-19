import {
  ApplicationConfig,
  ErrorHandler,
  inject,
  provideAppInitializer,
  LOCALE_ID,
  isDevMode,
  signal,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { registerLocaleData } from '@angular/common';
import { provideHttpClient, withFetch, withInterceptors, withXsrfConfiguration } from '@angular/common/http';
import localeEsMx from '@angular/common/locales/es-MX';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { provideTaiga } from '@taiga-ui/core';
import { tuiDateFormatProvider } from '@taiga-ui/core/tokens';
import { TUI_DEFAULT_LANGUAGE, TUI_LANGUAGE } from '@taiga-ui/i18n/tokens';

import { routes } from './app.routes';
import { credentialsInterceptor } from './core/interceptors/credentials.interceptor';
import { refreshInterceptor } from './core/interceptors/refresh.interceptor';
import { AuthService } from './core/auth/auth.service';
import { ReportingErrorHandler } from './core/services/error-reporter';
import { startWebVitals } from './core/services/web-vitals';

registerLocaleData(localeEsMx);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(
      withFetch(),
      withInterceptors([credentialsInterceptor, refreshInterceptor]),
      // CSRF double-submit: el backend emite la cookie y valida el header (§5.1).
      withXsrfConfiguration({ cookieName: 'XSRF-TOKEN', headerName: 'X-XSRF-TOKEN' }),
    ),
    provideTaiga(),
    // Textos de Taiga (calendario, paginación…) en español. El idioma se descarga aparte y solo cuando un componente de Taiga lo pide:
    // no entra en el paquete inicial. Mientras llega se usa el predeterminado.
    {
      provide: TUI_LANGUAGE,
      useFactory: () => {
        const lang = signal(inject(TUI_DEFAULT_LANGUAGE));
        void import('@taiga-ui/i18n/languages/spanish').then((m) => lang.set(m.TUI_SPANISH_LANGUAGE));
        return lang;
      },
    },
    tuiDateFormatProvider({ mode: 'dd/mm/yyyy', separator: '/' }),
    { provide: ErrorHandler, useClass: ReportingErrorHandler },
    // Modo API: recupera la sesión (cookies HttpOnly) antes de resolver las rutas protegidas.
    provideAppInitializer(() => inject(AuthService).restore()),
    provideAppInitializer(() => startWebVitals()),
    { provide: LOCALE_ID, useValue: 'es-MX' },
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
