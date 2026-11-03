import { NextResponse } from "next/server";

export async function middleware() {
  // The shell contains no business records. APIs independently authenticate
  // every request; login/logout use a same-origin signed HttpOnly session.
  const response=NextResponse.next();
  response.headers.set('Cache-Control','private, no-store');
  response.headers.set('X-Content-Type-Options','nosniff');
  return response;
}
export const config = { matcher: ["/", "/api/:path*"] };
