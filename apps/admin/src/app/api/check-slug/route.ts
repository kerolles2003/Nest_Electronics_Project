import { NextRequest, NextResponse } from "next/server";
import { getAdminServices } from "@/lib/services";

export async function GET(req: NextRequest) {
  try {
    const { supabase } = await getAdminServices();
    const { searchParams } = new URL(req.url);
    const slug = searchParams.get("slug");

    if (!slug) {
      return NextResponse.json({ exists: false });
    }

    const { data, error } = await (supabase as any)
      .from("products")
      .select("id")
      .eq("slug", slug)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ exists: false });
    }

    return NextResponse.json({ exists: !!data });
  } catch {
    return NextResponse.json({ exists: false });
  }
}
