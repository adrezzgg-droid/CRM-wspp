import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid min-h-full place-items-center p-6">
      <div className="max-w-sm text-center">
        <p className="text-sm font-semibold text-brand-600">404</p>
        <h1 className="mt-1 text-lg font-semibold">No encontramos esta página</h1>
        <Link
          href="/"
          className="mt-6 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          Ir al inicio
        </Link>
      </div>
    </div>
  );
}
