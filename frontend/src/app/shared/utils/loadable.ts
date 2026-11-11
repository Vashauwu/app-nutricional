import { Observable, catchError, map, of, startWith } from 'rxjs';

export type Loadable<T> =
  | { state: 'loading' }
  | { state: 'ready'; data: T }
  | { state: 'error'; message: string };

/** Convierte una consulta asíncrona en estados de UI: cargando, listo o error (§20.2). */
export function loadable<T>(source: Observable<T>): Observable<Loadable<T>> {
  return source.pipe(
    map((data): Loadable<T> => ({ state: 'ready', data })),
    catchError((e: unknown) =>
      of<Loadable<T>>({ state: 'error', message: e instanceof Error ? e.message : 'No se pudo cargar la información.' }),
    ),
    startWith<Loadable<T>>({ state: 'loading' }),
  );
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function paginate<T>(all: T[], page: number, pageSize: number): Page<T> {
  const start = (page - 1) * pageSize;
  return { items: all.slice(start, start + pageSize), total: all.length, page, pageSize };
}
