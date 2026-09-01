import Link from 'next/link';

export default function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-4 text-center">
      <span className="text-[120px] font-bold text-surface-low leading-none">404</span>
      <h1 className="text-2xl font-bold tracking-tight text-foreground mt-4">
        Page Not Found
      </h1>
      <p className="text-sm text-muted-foreground mt-2 max-w-sm">
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>
      <div className="flex gap-3 mt-6">
        <Link
          href="/"
          className="inline-flex items-center px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary-hover transition-colors"
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
