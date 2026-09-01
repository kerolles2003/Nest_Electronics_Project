import { getCachedBlogPostBySlug } from "@/lib/services";
import { notFound } from "next/navigation";
import { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { generateBreadcrumbJsonLd } from "@/lib/json-ld";
import { SITE_URL } from "@nest/config/constants";
import { BlogContent } from "@/components/blog/BlogContent";
import { RelatedPosts } from "@/components/blog/RelatedPosts";

export const revalidate = 3600;

function formatDate(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export async function generateMetadata(
  props: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const params = await props.params;
  const post = await getCachedBlogPostBySlug(params.slug);

  if (!post) {
    return { title: "Post Not Found" };
  }

  const description = post.excerpt ?? undefined;
  const title = `${post.title_en} | Nest Electronics Blog`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "article",
      publishedTime: post.published_at ?? undefined,
      url: `${SITE_URL}/blog/${post.slug}`,
      images: post.cover_image
        ? [{ url: post.cover_image, width: 1200, height: 630, alt: post.title_en }]
        : [],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: post.cover_image ? [post.cover_image] : [],
    },
    alternates: {
      canonical: `${SITE_URL}/blog/${post.slug}`,
    },
    robots: {
      index: true,
      follow: true,
    },
  };
}

export default async function BlogPostPage(
  props: { params: Promise<{ slug: string }> }
) {
  const params = await props.params;

  const post = await getCachedBlogPostBySlug(params.slug);

  if (!post) {
    notFound();
  }

  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title_en,
    description: post.excerpt,
    image: post.cover_image,
    datePublished: post.published_at,
    author: post.author
      ? { "@type": "Person", name: post.author.full_name }
      : { "@type": "Organization", name: "Nest Electronics" },
  };

  const breadcrumbJsonLd = generateBreadcrumbJsonLd([
    { name: "Home", url: SITE_URL },
    { name: "Blog", url: `${SITE_URL}/blog` },
    { name: post.title_en, url: `${SITE_URL}/blog/${post.slug}` },
  ]);

  return (
    <div className="container-nest py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />

      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-[13px] font-medium text-foreground-muted mb-10 bg-surface-low px-4 py-2.5 rounded-full inline-flex border border-border/50" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-primary transition-colors duration-300 flex items-center gap-1.5">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
          Home
        </Link>
        <span className="w-1 h-1 rounded-full bg-border-strong mx-1" />
        <Link href="/blog" className="hover:text-primary transition-colors duration-300">
          Blog
        </Link>
        <span className="w-1 h-1 rounded-full bg-border-strong mx-1" />
        <span className="text-foreground truncate max-w-[200px] md:max-w-md">{post.title_en}</span>
      </nav>

      {/* Cover Image */}
      {post.cover_image && (
        <div className="aspect-[21/9] relative rounded-2xl overflow-hidden mb-10 border border-border/50">
          <Image
            src={post.cover_image}
            alt={post.title_en}
            fill
            className="object-cover"
            priority
            sizes="100vw"
          />
        </div>
      )}

      <article className="max-w-3xl mx-auto">
        {/* Article Meta */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          {post.category && (
            <Link
              href={`/blog?category=${encodeURIComponent(post.category)}`}
              className="badge bg-primary/10 text-primary text-[12px] font-bold px-3 py-1 rounded-full border border-primary/20"
            >
              {post.category}
            </Link>
          )}
          {post.published_at && (
            <span className="text-[13px] text-foreground-muted font-medium">
              {formatDate(post.published_at)}
            </span>
          )}
          {post.author && (
            <span className="text-[13px] text-foreground-muted font-medium">
              by {post.author.full_name}
            </span>
          )}
        </div>

        <h1 className="text-3xl lg:text-4xl font-heading font-black text-foreground leading-[1.2] mb-8 tracking-tight">
          {post.title_en}
        </h1>

        {post.content_en ? (
          <BlogContent html={post.content_en} />
        ) : (
          <p className="italic text-foreground-muted">No content available.</p>
        )}

        {/* Tags */}
        {post.tags && post.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-10 pt-8 border-t border-border/50">
            {post.tags.map((tag) => (
              <Link
                key={tag}
                href={`/blog?tag=${encodeURIComponent(tag)}`}
                className="badge text-[12px] font-medium px-3 py-1 rounded-full bg-surface-low text-foreground-muted hover:bg-primary/10 hover:text-primary border border-border/50 hover:border-primary/20 transition-all duration-300"
              >
                #{tag}
              </Link>
            ))}
          </div>
        )}
      </article>

      <RelatedPosts
        slug={post.slug}
        category={post.category}
        tags={post.tags}
        limit={3}
      />
    </div>
  );
}
