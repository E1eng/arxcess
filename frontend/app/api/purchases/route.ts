import { NextResponse } from "next/server";
import { type LocalPurchaseIntent } from "@/lib/storage/marketplace";
import { hasSupabasePurchaseConfig, isMissingSupabasePurchasesTableError, listSupabasePurchases, upsertSupabasePurchase } from "@/lib/supabase/purchases";

export async function GET() {
  if (!hasSupabasePurchaseConfig()) {
    return new NextResponse("Missing Supabase configuration", { status: 503 });
  }

  try {
    const purchases = await listSupabasePurchases();
    return NextResponse.json(purchases);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Failed to load purchases";
    const status = isMissingSupabasePurchasesTableError(message) ? 503 : 500;
    return new NextResponse(message, { status });
  }
}

export async function POST(request: Request) {
  let body: LocalPurchaseIntent;

  try {
    body = (await request.json()) as LocalPurchaseIntent;
  } catch {
    return new NextResponse("Invalid purchase payload", { status: 400 });
  }

  if (!body.purchaseIdHex || !body.productIdHex || !body.amountSol) {
    return new NextResponse("Missing required purchase fields", { status: 400 });
  }

  if (!hasSupabasePurchaseConfig()) {
    return new NextResponse("Missing Supabase configuration", { status: 503 });
  }

  try {
    const purchase = await upsertSupabasePurchase(body);
    return NextResponse.json(purchase);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Failed to store purchase";
    const status = isMissingSupabasePurchasesTableError(message) ? 503 : 500;
    return new NextResponse(message, { status });
  }
}
