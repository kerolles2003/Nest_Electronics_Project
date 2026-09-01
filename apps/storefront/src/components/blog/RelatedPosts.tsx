import { getServices } from "@/lib/services";
import { BlogCard } from "./BlogCard";

interface RelatedPostsProps {
  slug: string;
  category: string | null;
  tags: string[] | null;
  limit?: number;
}

function formatDate(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export async function RelatedPosts({
  slug,
  category,
  tags,
  limit = 3,
}: RelatedPostsProps) {
  const { blogService } = await getServices();
  const posts = await blogService.getRelatedPosts(slug, category, tags, limit);

  if (posts.length === 0) return null;

  return (
    <div className="mt-16 border-t border-border pt-12">
      <p className="section-kicker">You might also like</p>
      <h2 className="text-2xl font-heading font-bold text-foreground mb-8">
        Related Articles
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {posts.map((post) => (
          <BlogCard key={post.id} post={post} />
        ))}
      </div>
    </div>
  );
}
