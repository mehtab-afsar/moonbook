import { NextResponse } from "next/server";

export type ApiOk<T> = { data: T };
export type ApiErr = { error: string };

export function apiOk<T>(data: T, status = 200) {
  return NextResponse.json<ApiOk<T>>({ data }, { status });
}

export function apiErr(error: string, status = 400) {
  return NextResponse.json<ApiErr>({ error }, { status });
}
