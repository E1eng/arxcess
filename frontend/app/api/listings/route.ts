import { NextResponse } from "next/server";
import { type LocalProductListing } from "@/lib/storage/marketplace";
import { hasSupabaseListingConfig, isMissingSupabaseListingsTableError, listSupabaseListings, upsertSupabaseListing } from "../../../lib/supabase/listings";

export async function GET() {
  if (!hasSupabaseListingConfig()) {
    return new NextResponse("Missing Supabase configuration", { status: 503 });
  }

  try {
    const listings = await listSupabaseListings();
    return NextResponse.json(listings);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Failed to load marketplace listings";
    const status = isMissingSupabaseListingsTableError(message) ? 503 : 500;
    return new NextResponse(message, { status });
  }
}

export async function POST(request: Request) {
  let body: LocalProductListing;

  try {
    body = (await request.json()) as LocalProductListing;
    console.log("POST /api/listings - body:", body);
  } catch (error) {
    console.error("POST /api/listings - JSON parse error:", error);
    return new NextResponse("Invalid listing payload", { status: 400 });
  }

  if (!body.productIdHex || !body.title || !body.priceSol) {
    console.error("POST /api/listings - Missing fields:", { productIdHex: !!body.productIdHex, title: !!body.title, priceSol: !!body.priceSol });
    return new NextResponse("Missing required listing fields", { status: 400 });
  }

  if (!hasSupabaseListingConfig()) {
    console.error("POST /api/listings - Missing Supabase config");
    return new NextResponse("Missing Supabase configuration", { status: 503 });
  }

  try {
    console.log("POST /api/listings - Calling upsertSupabaseListing");
    const listing = await upsertSupabaseListing(body);
    console.log("POST /api/listings - Success:", listing);
    return NextResponse.json(listing);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Failed to store marketplace listing";
    console.error("POST /api/listings - Error:", message, cause);
    const status = isMissingSupabaseListingsTableError(message) ? 503 : 500;
    return new NextResponse(message, { status });
  }
}
