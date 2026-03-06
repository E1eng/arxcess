import { NextResponse } from "next/server";

const PINATA_JSON_ENDPOINT = "https://api.pinata.cloud/pinning/pinJSONToIPFS";

export async function POST(request: Request) {
  const jwt = process.env.PINATA_JWT;

  if (!jwt) {
    return new NextResponse("Missing PINATA_JWT", { status: 500 });
  }

  const body = (await request.json()) as { payload?: unknown; name?: string };

  if (!body.payload) {
    return new NextResponse("Missing JSON payload", { status: 400 });
  }

  const response = await fetch(PINATA_JSON_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`
    },
    body: JSON.stringify({
      pinataMetadata: {
        name: body.name ?? "arxcess-metadata"
      },
      pinataContent: body.payload
    })
  });

  if (!response.ok) {
    return new NextResponse(await response.text(), { status: response.status });
  }

  const payload = (await response.json()) as { IpfsHash: string };
  const cid = payload.IpfsHash;

  return NextResponse.json({
    cid,
    gatewayUrl: `https://gateway.pinata.cloud/ipfs/${cid}`
  });
}
