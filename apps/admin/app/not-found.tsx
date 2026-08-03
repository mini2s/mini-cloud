import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex h-svh flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold">404 — Page not found</h1>
      <p className="text-muted-foreground">
        The page you&apos;re looking for doesn&apos;t exist.
      </p>
      <Link
        href="/"
        className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:opacity-90"
      >
        Go home
      </Link>
    </div>
  );
}
