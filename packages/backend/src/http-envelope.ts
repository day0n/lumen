export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiFailure {
  ok: false;
  error: {
    message: string;
    detail?: unknown;
    code?: string;
  };
}

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

export function apiSuccess<T>(data: T): ApiSuccess<T> {
  return { ok: true, data };
}

export function apiFailure(message: string, detail?: unknown, code?: string): ApiFailure {
  return {
    ok: false,
    error: {
      message,
      ...(detail === undefined ? {} : { detail }),
      ...(code === undefined ? {} : { code }),
    },
  };
}
