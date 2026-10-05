import { NextResponse } from "next/server";

export function ragJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Vary", "Authorization");
  return response;
}
