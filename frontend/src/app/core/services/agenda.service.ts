import { Injectable, inject, signal } from '@angular/core';
import { Observable, map, of, tap, throwError } from 'rxjs';
import { ApiClient, ApiError } from '../api/api-client';
import { AuthService } from '../auth/auth.service';
import { DbService } from '../data/db.service';
import { Appointment, AppointmentKind, AppointmentMode, AppointmentStatus } from '../../shared/models/domain';
import { uid } from '../../shared/utils/format';

interface ApiAppointment {
  id: string; patient_id: string; patient_name?: string; starts_at: string; ends_at: string;
  kind: AppointmentKind; mode: AppointmentMode; place: string; notes?: string; status: AppointmentStatus;
}

export interface AppointmentInput {
  patientId: string;
  startsAt: string;
  endsAt: string;
  kind: AppointmentKind;
  mode: AppointmentMode;
  place: string;
  notes: string;
  status: AppointmentStatus;
}

const toAppointment = (a: ApiAppointment): Appointment => ({
  id: a.id, patientId: a.patient_id, patientName: a.patient_name ?? '', startsAt: a.starts_at, endsAt: a.ends_at,
  kind: a.kind, mode: a.mode, place: a.place, notes: a.notes ?? '', status: a.status,
});

const overlapError = (): ApiError => new ApiError('Ya hay otra consulta en ese horario.', 409, 'overlap');

/** Consultas: agenda de la nutrióloga y consulta próxima del paciente. En modo simulado viven en memoria (demostración). */
@Injectable({ providedIn: 'root' })
export class AgendaService {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthService);
  private readonly data = inject(DbService);
  readonly apiMode = this.api.enabled;

  /** Consultas del rango cargado (agenda de la nutrióloga). */
  readonly items = signal<Appointment[]>([]);
  /** Consultas del paciente con sesión iniciada (sin notas internas). */
  readonly mine = signal<Appointment[]>([]);
  private readonly demo = signal<Appointment[]>([]);
  private demoSeeded = false;

  private seedDemo(): void {
    if (this.demoSeeded || this.apiMode) return;
    this.demoSeeded = true;
    const pts = this.data.db().patients.filter((p) => !p.deletedAt);
    const at = (days: number, hour: number): Date => {
      const d = new Date();
      d.setDate(d.getDate() + days);
      d.setHours(hour, 0, 0, 0);
      return d;
    };
    const mk = (i: number, days: number, hour: number, kind: AppointmentKind): Appointment | null => {
      const p = pts[i];
      if (!p) return null;
      return { id: uid('ap'), patientId: p.id, patientName: `${p.profile.firstName} ${p.profile.lastName}`, startsAt: at(days, hour).toISOString(),
        endsAt: at(days, hour + 1).toISOString(), kind, mode: 'in_person', place: 'Consultorio', notes: '', status: 'scheduled' };
    };
    this.demo.set([mk(0, 0, 17, 'follow_up'), mk(1, 2, 10, 'first'), mk(0, 14, 17, 'follow_up')].filter((x): x is Appointment => x !== null));
  }

  private overlaps(list: Appointment[], startsAt: string, endsAt: string, status: AppointmentStatus, exceptId?: string): boolean {
    if (status !== 'scheduled') return false;
    const s = Date.parse(startsAt), e = Date.parse(endsAt);
    return list.some((x) => x.id !== exceptId && x.status === 'scheduled' && Date.parse(x.startsAt) < e && Date.parse(x.endsAt) > s);
  }

  /** Carga las consultas que empiezan en [from, to). */
  loadRange(from: Date, to: Date): Observable<void> {
    if (!this.apiMode) {
      this.seedDemo();
      this.items.set(this.demo().filter((a) => Date.parse(a.startsAt) >= from.getTime() && Date.parse(a.startsAt) < to.getTime()));
      return of(void 0);
    }
    return this.api.get<{ items: ApiAppointment[] }>('/appointments', { from: from.toISOString(), to: to.toISOString() }).pipe(
      tap((r) => this.items.set(r.items.map(toAppointment))),
      map(() => void 0),
    );
  }

  create(input: AppointmentInput): Observable<Appointment> {
    if (!this.apiMode) {
      this.seedDemo();
      if (this.overlaps(this.demo(), input.startsAt, input.endsAt, input.status)) return throwError(overlapError);
      const p = this.data.patient(input.patientId);
      const a: Appointment = { id: uid('ap'), ...input, patientName: p ? `${p.profile.firstName} ${p.profile.lastName}` : '' };
      this.demo.update((l) => [...l, a]);
      return of(a);
    }
    return this.api.post<ApiAppointment>('/appointments', body(input)).pipe(map(toAppointment));
  }

  update(id: string, input: AppointmentInput): Observable<Appointment> {
    if (!this.apiMode) {
      if (this.overlaps(this.demo(), input.startsAt, input.endsAt, input.status, id)) return throwError(overlapError);
      let out: Appointment | undefined;
      this.demo.update((l) => l.map((x) => (x.id === id ? (out = { ...x, ...input }) : x)));
      return out ? of(out) : throwError(() => new ApiError('No encontrado.', 404, 'not_found'));
    }
    return this.api.put<ApiAppointment>(`/appointments/${id}`, body(input)).pipe(map(toAppointment));
  }

  /** Consultas del paciente (próximas y de los últimos 30 días, sin canceladas). */
  loadMine(): Observable<void> {
    if (!this.apiMode) {
      this.seedDemo();
      const pid = this.auth.patientId();
      const cutoff = Date.now() - 30 * 86400000;
      this.mine.set(this.demo().filter((a) => a.patientId === pid && a.status !== 'cancelled' && Date.parse(a.endsAt) >= cutoff));
      return of(void 0);
    }
    return this.api.get<{ items: ApiAppointment[] }>('/me/appointments').pipe(
      tap((r) => this.mine.set(r.items.map(toAppointment))),
      map(() => void 0),
    );
  }

  /** Enlace secreto de suscripción (.ics). Solo existe con el servidor conectado. */
  feedUrl(): Observable<string | null> {
    if (!this.apiMode) return of(null);
    return this.api.get<{ path: string }>('/calendar-feed').pipe(map((r) => location.origin + r.path));
  }

  rotateFeed(): Observable<string | null> {
    if (!this.apiMode) return of(null);
    return this.api.post<{ path: string }>('/calendar-feed/rotate').pipe(map((r) => location.origin + r.path));
  }
}

const body = (i: AppointmentInput): Record<string, unknown> => ({
  patient_id: i.patientId, starts_at: i.startsAt, ends_at: i.endsAt, kind: i.kind, mode: i.mode, place: i.place, notes: i.notes, status: i.status,
});
