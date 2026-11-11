import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, map, of, shareReplay, switchMap, tap, throwError } from 'rxjs';
import { ApiClient, ApiError } from '../api/api-client';
import { DbService } from '../data/db.service';
import { ConsentDocument, Role, SessionRecord, User } from '../../shared/models/domain';
import { uid } from '../../shared/utils/format';

const COOKIE = 'nutri_session';

function readCookie(): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${COOKIE}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function describeClient(): { device: string; browser: string } {
  const ua = navigator.userAgent;
  const device = /iPhone|iPad/.test(ua) ? 'iPhone / iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Otro dispositivo';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  return { device, browser };
}

export class AuthError extends Error {}

// ---- Formas de la API (ver backend/internal/auth y patients) ----
interface ApiIdentity { id: string; email: string; name: string; role: Role; permissions: string[] }
interface ApiSession { id: string; device: string; user_agent: string; created_at: string; last_seen_at: string; current: boolean }
interface ApiConsentDoc { id: string; document_type: 'privacy' | 'informed'; version: number; title: string; content: string; published_at: string; is_active: boolean }

/**
 * Autenticación con dos modos (public/config.js):
 * - mock: simulación local; solo guarda el id de sesión en una cookie de sustitución.
 * - api: cookies HttpOnly emitidas por el backend (§5.1). El frontend NUNCA ve ni guarda
 *   tokens; solo conserva en memoria los datos del usuario.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly data = inject(DbService);
  private readonly api = inject(ApiClient);
  readonly apiMode = this.api.enabled;

  // ----- Estado modo API (en memoria) -----
  private readonly apiUser = signal<User | null>(null);
  private readonly apiPatientId = signal<string | null>(null);
  private readonly apiPending = signal<ConsentDocument[]>([]);
  private readonly apiSessions = signal<(SessionRecord & { current: boolean })[]>([]);
  private refreshing: Observable<boolean> | null = null;

  // ----- Estado modo mock -----
  private readonly sessionId = signal<string | null>(null);
  private readonly resetTokens = new Map<string, { userId: string; expiresAt: number }>();

  readonly user = computed<User | null>(() => {
    if (this.apiMode) return this.apiUser();
    this.data.version();
    const sid = this.sessionId();
    if (!sid) return null;
    const s = this.data.db().sessions.find((x) => x.id === sid && !x.revokedAt);
    return s ? (this.data.db().users.find((u) => u.id === s.userId && u.status === 'active') ?? null) : null;
  });
  readonly role = computed<Role | null>(() => this.user()?.role ?? null);
  readonly isAuthenticated = computed(() => this.user() !== null);
  readonly patientId = computed(() => (this.apiMode ? this.apiPatientId() : (this.user()?.patientId ?? null)));

  readonly mySessions = computed<SessionRecord[]>(() => {
    if (this.apiMode) return this.apiSessions();
    const u = this.user();
    return u ? this.data.db().sessions.filter((s) => s.userId === u.id && !s.revokedAt) : [];
  });
  readonly currentSessionId = computed(() => (this.apiMode ? (this.apiSessions().find((s) => s.current)?.id ?? null) : this.sessionId()));

  constructor() {
    if (!this.apiMode) {
      const raw = readCookie();
      if (raw && this.data.db().sessions.some((s) => s.id === raw && !s.revokedAt)) {
        this.sessionId.set(raw);
        this.syncActor();
      }
    }
  }

  private syncActor(): void {
    this.data.actor.set(this.user()?.name ?? 'Sistema');
  }

  // =====================================================================
  // Arranque (modo API): recupera la sesión desde las cookies HttpOnly
  // =====================================================================
  restore(): Promise<void> {
    if (!this.apiMode) return Promise.resolve();
    return new Promise((resolve) => {
      const me$ = this.api.get<{ user: ApiIdentity }>('/auth/me');
      // Si el access token venció, se intenta una renovación con el refresh token y se reconsulta.
      me$
        .pipe(
          catchError(() => this.refresh().pipe(switchMap((ok) => (ok ? me$ : throwError(() => new Error('sin sesión')))))),
          switchMap((r) => this.afterAuth(r.user)),
          catchError(() => of(null)),
        )
        .subscribe(() => resolve());
    });
  }

  private toUser(i: ApiIdentity): User {
    return { id: i.id, email: i.email, password: '', role: i.role, name: i.name, status: 'active' };
  }

  /** Carga lo que la interfaz necesita tras autenticar (contexto de paciente y sesiones). */
  private afterAuth(identity: ApiIdentity): Observable<User> {
    const user = this.toUser(identity);
    this.apiUser.set(user);
    this.data.actor.set(user.name);
    const ctx$ =
      identity.role === 'patient'
        ? this.api.get<{ id: string }>('/me/patient').pipe(
            tap((p) => this.apiPatientId.set(p.id)),
            switchMap(() => this.loadPending()),
            catchError(() => of(void 0)),
          )
        : of(void 0);
    return ctx$.pipe(
      switchMap(() => this.loadSessions()),
      map(() => user),
    );
  }

  private loadPending(): Observable<void> {
    return this.api.get<{ items: ApiConsentDoc[] }>('/me/consents/pending').pipe(
      tap((r) =>
        this.apiPending.set(
          r.items.map((d) => ({ id: d.id, type: d.document_type, version: d.version, title: d.title, content: d.content, publishedAt: d.published_at, isActive: d.is_active })),
        ),
      ),
      map(() => void 0),
    );
  }

  loadSessions(): Observable<void> {
    if (!this.apiMode) return of(void 0);
    return this.api.get<{ items: ApiSession[] }>('/auth/sessions').pipe(
      tap((r) =>
        this.apiSessions.set(
          r.items.map((s) => ({ id: s.id, userId: this.apiUser()?.id ?? '', device: s.device, browser: '', createdAt: s.created_at, lastSeenAt: s.last_seen_at, current: s.current })),
        ),
      ),
      map(() => void 0),
      catchError(() => of(void 0)),
    );
  }

  /** Renueva el access token con el refresh token (una sola petición a la vez). */
  refresh(): Observable<boolean> {
    // Sin cookie XSRF no hubo sesión iniciada en este navegador: no hay nada que renovar (evita un 403 inútil).
    if (!document.cookie.includes('XSRF-TOKEN=')) return of(false);
    if (!this.refreshing) {
      this.refreshing = this.api.post('/auth/refresh').pipe(
        map(() => true),
        catchError(() => of(false)),
        finalize(() => (this.refreshing = null)),
        shareReplay(1),
      );
    }
    return this.refreshing;
  }

  /** La sesión terminó en el servidor: se limpia el estado local. */
  sessionLost(): void {
    this.apiUser.set(null);
    this.apiPatientId.set(null);
    this.apiPending.set([]);
    this.apiSessions.set([]);
    this.data.actor.set('Sistema');
  }

  // =====================================================================
  // Operaciones públicas
  // =====================================================================
  login(email: string, password: string): Observable<User> {
    if (this.apiMode) {
      return this.api.post<{ user: ApiIdentity }>('/auth/login', { email, password }).pipe(
        switchMap((r) => this.afterAuth(r.user)),
        catchError((e: unknown) => throwError(() => new AuthError(e instanceof ApiError ? e.message : 'No se pudo iniciar sesión.'))),
      );
    }
    return this.data.respond(() => {
      const user = this.data.db().users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
      // Mensaje genérico: no revela si la cuenta existe (§5.2).
      if (!user || user.password !== password || user.status !== 'active') {
        throw new AuthError('Correo o contraseña incorrectos.');
      }
      const id = uid('ses-');
      const now = new Date().toISOString();
      this.data.mutate((d) => {
        d.sessions.push({ id, userId: user.id, ...describeClient(), createdAt: now, lastSeenAt: now });
        d.audit.unshift({ id: uid('au'), at: now, actor: user.name, action: 'auth.login', resourceType: 'session', resourceId: id, summary: 'Inicio de sesión', requestId: `req-${uid().slice(0, 6)}` });
      });
      document.cookie = `${COOKIE}=${encodeURIComponent(id)}; path=/; SameSite=Strict`;
      this.sessionId.set(id);
      this.syncActor();
      return user;
    }, 450);
  }

  logout(): void {
    if (this.apiMode) {
      this.api.post('/auth/logout').pipe(catchError(() => of(void 0))).subscribe();
      this.sessionLost();
    } else {
      const sid = this.sessionId();
      if (sid) {
        this.data.mutate((d) => {
          const s = d.sessions.find((x) => x.id === sid);
          if (s) s.revokedAt = new Date().toISOString();
        });
      }
      document.cookie = `${COOKIE}=; path=/; max-age=0; SameSite=Strict`;
      this.sessionId.set(null);
      this.syncActor();
    }
    // §12.5: al cerrar sesión se borra la caché local del dispositivo.
    if ('caches' in window) caches.keys().then((keys) => keys.forEach((k) => caches.delete(k))).catch(() => undefined);
  }

  revokeSession(id: string): void {
    if (this.apiMode) {
      const wasCurrent = id === this.currentSessionId();
      this.api.delete(`/auth/sessions/${id}`).pipe(switchMap(() => this.loadSessions())).subscribe();
      if (wasCurrent) this.sessionLost();
      return;
    }
    this.data.mutate((d) => {
      const s = d.sessions.find((x) => x.id === id);
      if (s) s.revokedAt = new Date().toISOString();
      this.data.audit(d, 'auth.session_revoked', 'session', id, 'Cerró una sesión');
    });
    if (id === this.sessionId()) this.logout();
  }

  revokeOtherSessions(): void {
    if (this.apiMode) {
      this.api.post('/auth/sessions/revoke-others').pipe(switchMap(() => this.loadSessions())).subscribe();
      return;
    }
    const me = this.sessionId();
    const uidn = this.user()?.id;
    this.data.mutate((d) => {
      for (const s of d.sessions) if (s.userId === uidn && s.id !== me && !s.revokedAt) s.revokedAt = new Date().toISOString();
      this.data.audit(d, 'auth.sessions_revoked_all', 'session', '*', 'Cerró todas las demás sesiones');
    });
  }

  /** Siempre responde igual, exista o no la cuenta. `demoLink` solo existe en modo simulado. */
  requestPasswordReset(email: string): Observable<{ demoLink: string | null }> {
    if (this.apiMode) {
      return this.api.post('/auth/password/forgot', { email }).pipe(
        map(() => ({ demoLink: null })),
        // Respuesta genérica incluso ante errores del servidor: no se revela nada.
        catchError(() => of({ demoLink: null })),
      );
    }
    return this.data.respond(() => {
      const user = this.data.db().users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase() && u.status === 'active');
      if (!user) return { demoLink: null };
      const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
      this.resetTokens.set(token, { userId: user.id, expiresAt: Date.now() + 30 * 60_000 });
      return { demoLink: `/restablecer/${token}` };
    }, 500);
  }

  /** En modo API la validez la decide el servidor al enviar la nueva contraseña. */
  isResetTokenValid(token: string): boolean {
    if (this.apiMode) return token.length > 20;
    const t = this.resetTokens.get(token);
    return !!t && t.expiresAt > Date.now();
  }

  resetPassword(token: string, password: string): Observable<void> {
    if (this.apiMode) {
      return this.api.post('/auth/password/reset', { token, password }).pipe(
        map(() => void 0),
        catchError((e: unknown) => throwError(() => new AuthError(e instanceof ApiError ? e.message : 'No se pudo cambiar la contraseña.'))),
      );
    }
    if (!this.isResetTokenValid(token)) {
      return throwError(() => new AuthError('El enlace no es válido o ya expiró. Solicita uno nuevo.'));
    }
    return this.data.respond(() => {
      const t = this.resetTokens.get(token)!;
      this.resetTokens.delete(token); // un solo uso
      this.data.mutate((d) => {
        const u = d.users.find((x) => x.id === t.userId);
        if (u) u.password = password;
        for (const s of d.sessions) if (s.userId === t.userId) s.revokedAt ??= new Date().toISOString();
        d.audit.unshift({ id: uid('au'), at: new Date().toISOString(), actor: u?.name ?? 'Usuario', action: 'auth.password_reset', resourceType: 'user', resourceId: t.userId, summary: 'Restableció su contraseña', requestId: `req-${uid().slice(0, 6)}` });
      });
    }, 500);
  }

  // ---------- Consentimiento (§4.1) ----------
  pendingConsents(patientId: string | null): ConsentDocument[] {
    if (this.apiMode) return this.apiPending();
    if (!patientId) return [];
    const d = this.data.db();
    const accepted = new Set(d.consentAcceptances.filter((a) => a.patientId === patientId && !a.revokedAt).map((a) => a.consentDocumentId));
    return d.consentDocuments.filter((c) => c.isActive && !accepted.has(c.id));
  }

  /** Devuelve un Observable: en modo API hay que esperar al servidor antes de navegar. */
  acceptConsents(patientId: string, docIds: string[]): Observable<void> {
    if (this.apiMode) {
      return this.api.post('/me/consents/accept', { document_ids: docIds }).pipe(
        switchMap(() => this.loadPending()),
        catchError((e: unknown) => throwError(() => new AuthError(e instanceof ApiError ? e.message : 'No se pudo registrar la aceptación.'))),
      );
    }
    this.data.mutate((d) => {
      const now = new Date().toISOString();
      for (const id of docIds) {
        d.consentAcceptances.push({
          id: uid('ac'), patientId, consentDocumentId: id, acceptedAt: now, method: 'web_checkbox', evidence: { userAgent: navigator.userAgent, recordedBy: 'paciente' },
        });
      }
      this.data.audit(d, 'consent.accepted', 'patient', patientId, `Aceptó ${docIds.length} documento(s) de consentimiento`);
    });
    return of(void 0);
  }
}
