export async function GET() {
  return new Response("LINE webhook OK", { status: 200 });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  console.log("LINE webhook received:", body);

  return new Response("OK", { status: 200 });
}
