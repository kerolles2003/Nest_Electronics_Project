import { NextRequest, NextResponse } from "next/server";
import { getAdminServices } from "@/lib/services";

export async function GET(req: NextRequest) {
  try {
    const { supabase } = await getAdminServices();
    const { searchParams } = new URL(req.url);
    const categoryId = searchParams.get("categoryId");

    if (!categoryId) {
      return NextResponse.json({ attributes: [] });
    }

    // Fetch attributes that apply to this category or have no category restriction
    const { data: attributes } = await (supabase as any)
      .from("attributes")
      .select("*, values:attribute_values(*)")
      .or(`category_ids.cs.{${categoryId}},category_ids.is.null`)
      .order("sort_order", { ascending: true });

    return NextResponse.json({ attributes: attributes ?? [] });
  } catch {
    return NextResponse.json({ attributes: [] });
  }
}
