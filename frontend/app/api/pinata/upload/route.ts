import { NextResponse } from "next/server";

const PINATA_FILE_ENDPOINT = "https://api.pinata.cloud/pinning/pinFileToIPFS";

export async function POST(request: Request) {
  const jwt = process.env.PINATA_JWT;

  if (!jwt) {
    return new NextResponse("Missing PINATA_JWT", { status: 500 });
  }

  const inbound = await request.formData();
  const file = inbound.get("file");

  if (!(file instanceof File)) {
    return new NextResponse("Expected multipart file upload", { status: 400 });
  }

  const formData = new FormData();
  formData.append("file", file, file.name);

  const response = await fetch(PINATA_FILE_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`
    },
    body: formData
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
