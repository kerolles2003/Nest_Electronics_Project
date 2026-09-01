import Image from "next/image";
import Link from "next/link";
import type { BlogPost } from "@nest/types";

interface BlogCardProps {
  post: BlogPost;
}

function formatDate(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function BlogCard({ post }: BlogCardProps) {
  return (
    <Link
      href={`/blog/${post.slug}`}
      className="card card-hover group rounded-xl overflow-hidden flex flex-col"
    >
      <div className="aspect-[16/10] bg-surface-low relative overflow-hidden">
        {post.cover_image ? (
          <Image
            src={post.cover_image}
            alt={post.title_en}
            fill
            className="object-cover group-hover:scale-[1.04] transition-transform duration-500 ease-out"
            sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-foreground-disabled/20 text-4xl font-black">
            {post.title_en.charAt(0)}
          </div>
        )}
        {post.category && (
          <span className="absolute top-3 left-3 badge bg-rose-500/90 text-white text-[11px] font-bold px-2.5 py-1 rounded-full">
            {post.category}
          </span>
        )}
      </div>
      <div className="p-5 flex-1 flex flex-col gap-2.5">
        <h3 className="text-[16px] font-heading font-bold text-foreground leading-snug line-clamp-2 group-hover:text-primary transition-colors duration-300">
          {post.title_en}
        </h3>
        {post.excerpt && (
          <p className="text-[13px] text-foreground-muted leading-relaxed line-clamp-2">
            {post.excerpt}
          </p>
        )}
        <div className="flex items-center gap-3 mt-auto pt-3">
          {post.published_at && (
            <span className="text-[12px] text-foreground-muted">
              {formatDate(post.published_at)}
            </span>
          )}
          <span className="ml-auto text-[13px] font-semibold text-primary group-hover:translate-x-1 transition-transform duration-300 inline-flex items-center gap-1">
            Read more
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </span>
        </div>
      </div>
    </Link>
  );
}

export function BlogCardSkeleton() {
  return (
    <div className="card rounded-xl overflow-hidden flex flex-col animate-pulse">
      <div className="aspect-[16/10] bg-[var(--color-border)]" />
      <div className="p-5 flex-1 flex flex-col gap-3">
        <div className="h-5 w-full bg-[var(--color-border)] rounded" />
        <div className="h-5 w-3/4 bg-[var(--color-border)] rounded" />
        <div className="h-3 w-full bg-[var(--color-border)] rounded" />
        <div className="h-3 w-2/3 bg-[var(--color-border)] rounded" />
        <div className="flex items-center gap-3 mt-auto pt-3">
          <div className="h-3 w-20 bg-[var(--color-border)] rounded" />
          <div className="h-3 w-16 bg-[var(--color-border)] rounded ml-auto" />
        </div>
      </div>
    </div>
  );
}
