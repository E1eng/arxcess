export async function uploadCiphertextToPinata(file: Blob, fileName: string) {
  const formData = new FormData();
  formData.append("file", file, fileName);

  const response = await fetch("/api/pinata/upload", {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json() as Promise<{ cid: string; gatewayUrl: string }>;
}

export async function uploadJsonToPinata(payload: unknown, name: string) {
  const response = await fetch("/api/pinata/json", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ payload, name })
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json() as Promise<{ cid: string; gatewayUrl: string }>;
}
