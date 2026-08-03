import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.redirect(
    new URL(
      "/favicon.svg",
      process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3100",
    ),
  );
}
