import Link from 'next/link';

export default function NotFoundPage() {
  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center text-center px-4">
      <span className="text-[120px] font-heading font-bold text-surface-low leading-none">404</span>
      <h1 className="text-2xl font-heading font-semibold text-foreground mt-4">Page Not Found</h1>
      <p className="text-base text-foreground-muted mt-2 max-w-sm">
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>
      <div className="flex flex-col gap-2 mt-6">
        <Link href="/" className="btn-primary px-6 py-2.5 text-sm inline-flex items-center justify-center">
          Go to Homepage
        </Link>
        <Link href="/products" className="btn-ghost text-sm inline-flex items-center justify-center">
          Browse Products
        </Link>
      </div>
    </div>
  );
}
